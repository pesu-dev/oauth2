"""Student settings: revoke apps, delete credentials, delete account."""

from __future__ import annotations

from pathlib import Path
from typing import TYPE_CHECKING

from fastapi import APIRouter, Form, Request
from fastapi.responses import HTMLResponse, RedirectResponse, Response
from fastapi.templating import Jinja2Templates

from src.academy.models import AcademyAuthError
from src.models.consent import ConsentMode
from src.oidc import deps
from src.session_cookie import SettingsSession

if TYPE_CHECKING:
    from src.config import AppConfig
    from src.session_cookie import SettingsSessionStore

router = APIRouter(prefix="/settings", tags=["settings"])

SETTINGS_COOKIE = "oauth2_settings"
_TEMPLATES_DIR = Path(__file__).resolve().parent.parent / "templates"
templates = Jinja2Templates(directory=str(_TEMPLATES_DIR))


def _set_settings_cookie(response: Response, config: AppConfig, value: str) -> None:
    response.set_cookie(
        key=SETTINGS_COOKIE,
        value=value,
        httponly=True,
        secure=config.app_env != "local",
        samesite="lax",
        max_age=config.session_cookie_ttl_seconds,
        path="/",
    )


def _clear_settings_cookie(response: Response, config: AppConfig) -> None:
    response.delete_cookie(
        key=SETTINGS_COOKIE,
        path="/",
        secure=config.app_env != "local",
        httponly=True,
        samesite="lax",
    )


def _settings_store(request: Request) -> SettingsSessionStore:
    return deps.settings_session_store(request)


def _load_settings_session(request: Request) -> SettingsSession | None:
    raw = request.cookies.get(SETTINGS_COOKIE)
    if raw is None:
        return None
    return _settings_store(request).load_session(raw)


def _require_settings_session(request: Request) -> SettingsSession | RedirectResponse:
    session = _load_settings_session(request)
    if session is None:
        return RedirectResponse(url="/settings/login", status_code=302)
    return session


async def _maybe_drop_vault_if_no_delegated(request: Request, sub: str) -> None:
    """Delete vault when no delegated consents remain for ``sub``."""
    remaining = await deps.consents(request).list_consents_for_sub(sub)
    if any(c.mode == ConsentMode.DELEGATED for c in remaining):
        return
    await deps.vault(request).delete_vault(sub)


async def _connected_apps(request: Request, sub: str) -> list[dict[str, str]]:
    consents = await deps.consents(request).list_consents_for_sub(sub)
    apps: list[dict[str, str]] = []
    for consent in consents:
        client = await deps.clients(request).get_client(consent.client_id)
        name = client.name if client is not None else consent.client_id
        apps.append(
            {
                "client_id": consent.client_id,
                "name": name,
                "mode": str(consent.mode),
            }
        )
    return apps


@router.get("/login", response_class=HTMLResponse)
async def settings_login_get(request: Request) -> Response:
    """PESU Academy login for student settings (dedicated cookie)."""
    if _load_settings_session(request) is not None:
        return RedirectResponse(url="/settings", status_code=302)
    return templates.TemplateResponse(
        request,
        "settings/login.html",
        {"title": "Settings sign in — PESU OAuth2"},
    )


@router.post("/login", response_model=None)
async def settings_login_post(
    request: Request,
    username: str = Form(""),
    password: str = Form(""),
) -> Response:
    """Authenticate via Academy and set the settings session cookie."""
    config = deps.config(request)
    limiter = deps.login_limiter(request)
    ip = request.client.host if request.client else "unknown"
    if not limiter.allow(f"settings:{ip}"):
        return templates.TemplateResponse(
            request,
            "settings/login.html",
            {
                "title": "Settings sign in — PESU OAuth2",
                "error": "Too many attempts. Try again shortly.",
            },
            status_code=429,
        )

    try:
        result = await deps.academy(request).login(username.strip(), password)
    except AcademyAuthError:
        return templates.TemplateResponse(
            request,
            "settings/login.html",
            {
                "title": "Settings sign in — PESU OAuth2",
                "error": "Incorrect username or password.",
            },
            status_code=401,
        )

    user = await deps.users(request).upsert_user_from_profile(result.profile)
    store = _settings_store(request)
    redirect = RedirectResponse(url="/settings", status_code=302)
    _set_settings_cookie(redirect, config, store.dump_session(SettingsSession(sub=user.sub)))
    return redirect


@router.post("/logout", response_model=None)
async def settings_logout(request: Request) -> Response:
    """Clear the settings session cookie."""
    config = deps.config(request)
    response = RedirectResponse(url="/settings/login", status_code=302)
    _clear_settings_cookie(response, config)
    return response


@router.get("", response_class=HTMLResponse)
@router.get("/", response_class=HTMLResponse)
async def settings_home(request: Request) -> Response:
    """Connected apps, vault controls, and delete account."""
    session = _require_settings_session(request)
    if isinstance(session, RedirectResponse):
        return session

    user = await deps.users(request).get_user(session.sub)
    if user is None:
        config = deps.config(request)
        response = RedirectResponse(url="/settings/login", status_code=302)
        _clear_settings_cookie(response, config)
        return response

    apps = await _connected_apps(request, session.sub)
    vault_entry = await deps.vault(request).get_vault(session.sub)
    return templates.TemplateResponse(
        request,
        "settings/home.html",
        {
            "title": "Settings — PESU OAuth2",
            "sub": session.sub,
            "apps": apps,
            "has_vault": vault_entry is not None,
        },
    )


@router.post("/apps/{client_id}/revoke", response_model=None)
async def settings_revoke_app(request: Request, client_id: str) -> Response:
    """Revoke consent for one app and kill its refresh tokens."""
    session = _require_settings_session(request)
    if isinstance(session, RedirectResponse):
        return session

    await deps.consents(request).delete_consent(session.sub, client_id)
    await deps.refresh_tokens(request).revoke_for_subject_client(session.sub, client_id)
    await _maybe_drop_vault_if_no_delegated(request, session.sub)
    return RedirectResponse(url="/settings", status_code=302)


@router.post("/credentials/delete", response_model=None)
async def settings_delete_credentials(request: Request) -> Response:
    """Delete vault only; identity consents may remain."""
    session = _require_settings_session(request)
    if isinstance(session, RedirectResponse):
        return session

    await deps.vault(request).delete_vault(session.sub)
    return RedirectResponse(url="/settings", status_code=302)


@router.post("/account/delete", response_model=None)
async def settings_delete_account(
    request: Request,
    confirm: str = Form(""),
) -> Response:
    """Tombstone user, revoke grants/tokens, delete vault; never reuse ``sub``."""
    session = _require_settings_session(request)
    if isinstance(session, RedirectResponse):
        return session

    if confirm.strip() != "DELETE":
        apps = await _connected_apps(request, session.sub)
        vault_entry = await deps.vault(request).get_vault(session.sub)
        return templates.TemplateResponse(
            request,
            "settings/home.html",
            {
                "title": "Settings — PESU OAuth2",
                "sub": session.sub,
                "apps": apps,
                "has_vault": vault_entry is not None,
                "error": "Type DELETE to confirm account deletion.",
            },
            status_code=400,
        )

    sub = session.sub
    await deps.refresh_tokens(request).revoke_all_for_subject(sub)
    await deps.consents(request).delete_all_for_sub(sub)
    await deps.vault(request).delete_vault(sub)
    await deps.users(request).tombstone(sub)

    config = deps.config(request)
    response = RedirectResponse(url="/settings/login", status_code=302)
    _clear_settings_cookie(response, config)
    return response
