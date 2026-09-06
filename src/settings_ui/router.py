"""Student settings: revoke apps, update/delete credentials, delete account."""

from __future__ import annotations

import logging
from pathlib import Path
from typing import TYPE_CHECKING

from fastapi import APIRouter, Form, Request
from fastapi.responses import HTMLResponse, RedirectResponse, Response
from fastapi.templating import Jinja2Templates

from src.academy.models import AcademyAuthError
from src.client_ip import client_ip
from src.crypto.vault_crypto import master_key_from_secret, seal
from src.crypto.vault_payload import CURRENT_VAULT_KEY_VERSION, VaultPlaintext, pack_vault_plaintext
from src.csrf import clear_csrf_cookie, verify_csrf
from src.html_csrf import render_with_csrf
from src.mailer.port import notify_sub_quietly
from src.models.consent import ConsentMode
from src.models.vault import VaultEntry
from src.oidc import deps
from src.session_cookie import SettingsSession

if TYPE_CHECKING:
    from src.config import AppConfig
    from src.session_cookie import SettingsSessionStore

logger = logging.getLogger(__name__)

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


def _csrf_reject(request: Request) -> HTMLResponse:
    return templates.TemplateResponse(
        request,
        "error.html",
        {
            "title": "Invalid request",
            "message": "Security token missing or expired. Reload the page and try again.",
        },
        status_code=403,
    )


def _check_csrf(request: Request, csrf_token: str | None) -> HTMLResponse | None:
    if verify_csrf(request, deps.csrf_store(request), csrf_token):
        return None
    return _csrf_reject(request)


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


async def _home_context(
    request: Request,
    *,
    sub: str,
    error: str | None = None,
) -> dict[str, object]:
    apps = await _connected_apps(request, sub)
    vault_entry = await deps.vault(request).get_vault(sub)
    ctx: dict[str, object] = {
        "title": "Settings — PESU OAuth2",
        "sub": sub,
        "apps": apps,
        "has_vault": vault_entry is not None,
    }
    if error is not None:
        ctx["error"] = error
    return ctx


@router.get("/login", response_class=HTMLResponse)
async def settings_login_get(request: Request) -> Response:
    """PESU Academy login for student settings (dedicated cookie)."""
    if _load_settings_session(request) is not None:
        return RedirectResponse(url="/settings", status_code=302)
    return render_with_csrf(
        templates,
        request,
        "settings/login.html",
        {"title": "Settings sign in — PESU OAuth2"},
    )


@router.post("/login", response_model=None)
async def settings_login_post(
    request: Request,
    username: str = Form(""),
    password: str = Form(""),
    csrf_token: str = Form(""),
) -> Response:
    """Authenticate via Academy and set the settings session cookie."""
    rejected = _check_csrf(request, csrf_token)
    if rejected is not None:
        return rejected

    config = deps.config(request)
    limiter = deps.login_limiter(request)
    ip = client_ip(request)
    if not limiter.allow(f"settings:{ip}"):
        return render_with_csrf(
            templates,
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
        return render_with_csrf(
            templates,
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
async def settings_logout(request: Request, csrf_token: str = Form("")) -> Response:
    """Clear the settings session cookie."""
    rejected = _check_csrf(request, csrf_token)
    if rejected is not None:
        return rejected
    config = deps.config(request)
    response = RedirectResponse(url="/settings/login", status_code=302)
    _clear_settings_cookie(response, config)
    clear_csrf_cookie(response, config)
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

    return render_with_csrf(
        templates,
        request,
        "settings/home.html",
        await _home_context(request, sub=session.sub),
    )


@router.post("/apps/{client_id}/revoke", response_model=None)
async def settings_revoke_app(
    request: Request,
    client_id: str,
    csrf_token: str = Form(""),
) -> Response:
    """Revoke consent for one app and kill its refresh tokens."""
    rejected = _check_csrf(request, csrf_token)
    if rejected is not None:
        return rejected
    session = _require_settings_session(request)
    if isinstance(session, RedirectResponse):
        return session

    await deps.consents(request).delete_consent(session.sub, client_id)
    await deps.refresh_tokens(request).revoke_for_subject_client(session.sub, client_id)
    await _maybe_drop_vault_if_no_delegated(request, session.sub)
    # Name lookup is mail-only — never block revoke mutations.
    try:
        try:
            client = await deps.clients(request).get_client(client_id)
            app_name = client.name if client is not None else client_id
        except Exception:
            logger.exception("settings revoke mail: get_client failed client_id=%s", client_id)
            app_name = client_id
        await notify_sub_quietly(
            deps.mailer(request),
            deps.users(request),
            sub=session.sub,
            subject=f"Access revoked for {app_name}",
            body=(f"You revoked access for {app_name} ({client_id}). Refresh tokens for this app are no longer valid."),
        )
    except Exception:
        logger.exception(
            "settings revoke mail: notify failed sub=%s client_id=%s",
            session.sub,
            client_id,
        )
    return RedirectResponse(url="/settings", status_code=302)


@router.post("/credentials/update", response_model=None)
async def settings_update_credentials(
    request: Request,
    username: str = Form(""),
    password: str = Form(""),
    csrf_token: str = Form(""),
) -> Response:
    """Re-auth with PESU password and overwrite the vault (spec vault lifecycle §3)."""
    rejected = _check_csrf(request, csrf_token)
    if rejected is not None:
        return rejected
    session = _require_settings_session(request)
    if isinstance(session, RedirectResponse):
        return session

    existing = await deps.vault(request).get_vault(session.sub)
    if existing is None:
        return render_with_csrf(
            templates,
            request,
            "settings/home.html",
            await _home_context(request, sub=session.sub, error="No saved credentials to update."),
            status_code=400,
        )

    config = deps.config(request)
    if config.vault_master_key is None:
        return render_with_csrf(
            templates,
            request,
            "settings/home.html",
            await _home_context(
                request,
                sub=session.sub,
                error="Credential storage is not configured. Try again later.",
            ),
            status_code=503,
        )

    try:
        result = await deps.academy(request).login(username.strip(), password)
    except AcademyAuthError:
        return render_with_csrf(
            templates,
            request,
            "settings/home.html",
            await _home_context(
                request,
                sub=session.sub,
                error="Incorrect username or password.",
            ),
            status_code=401,
        )

    user = await deps.users(request).upsert_user_from_profile(result.profile)
    if user.sub != session.sub:
        return render_with_csrf(
            templates,
            request,
            "settings/home.html",
            await _home_context(
                request,
                sub=session.sub,
                error="Those credentials belong to a different account.",
            ),
            status_code=400,
        )

    plaintext = pack_vault_plaintext(
        VaultPlaintext(
            username=username.strip(),
            password=password,
            session=result.session,
        )
    )
    master = master_key_from_secret(config.vault_master_key)
    blob = seal(master, plaintext, key_version=CURRENT_VAULT_KEY_VERSION)
    await deps.vault(request).upsert_vault(
        VaultEntry(sub=session.sub, blob=blob, session_expires_at=result.session.expires_at),
    )
    await notify_sub_quietly(
        deps.mailer(request),
        deps.users(request),
        sub=session.sub,
        subject="Saved credentials updated",
        body="Your stored PESU Academy credentials were updated after a successful re-authentication.",
    )
    return RedirectResponse(url="/settings", status_code=302)


@router.post("/credentials/delete", response_model=None)
async def settings_delete_credentials(
    request: Request,
    csrf_token: str = Form(""),
) -> Response:
    """Delete vault only; identity consents may remain."""
    rejected = _check_csrf(request, csrf_token)
    if rejected is not None:
        return rejected
    session = _require_settings_session(request)
    if isinstance(session, RedirectResponse):
        return session

    await deps.vault(request).delete_vault(session.sub)
    await notify_sub_quietly(
        deps.mailer(request),
        deps.users(request),
        sub=session.sub,
        subject="Stored credentials deleted",
        body=(
            "Your stored PESU Academy credentials were deleted from the vault. "
            "Identity consents (if any) remain until you revoke them."
        ),
    )
    return RedirectResponse(url="/settings", status_code=302)


@router.post("/account/delete", response_model=None)
async def settings_delete_account(
    request: Request,
    confirm: str = Form(""),
    csrf_token: str = Form(""),
) -> Response:
    """Tombstone user, revoke grants/tokens, delete vault; never reuse ``sub``."""
    rejected = _check_csrf(request, csrf_token)
    if rejected is not None:
        return rejected
    session = _require_settings_session(request)
    if isinstance(session, RedirectResponse):
        return session

    if confirm.strip() != "DELETE":
        return render_with_csrf(
            templates,
            request,
            "settings/home.html",
            await _home_context(
                request,
                sub=session.sub,
                error="Type DELETE to confirm account deletion.",
            ),
            status_code=400,
        )

    sub = session.sub
    await notify_sub_quietly(
        deps.mailer(request),
        deps.users(request),
        sub=sub,
        subject="Account deleted",
        body=(
            "Your PESU OAuth2 account was deleted. "
            "Consents, refresh tokens, and stored credentials were removed. "
            "Your subject id will not be reused."
        ),
    )
    await deps.refresh_tokens(request).revoke_all_for_subject(sub)
    await deps.consents(request).delete_all_for_sub(sub)
    await deps.vault(request).delete_vault(sub)
    await deps.users(request).tombstone(sub)

    config = deps.config(request)
    response = RedirectResponse(url="/settings/login", status_code=302)
    _clear_settings_cookie(response, config)
    clear_csrf_cookie(response, config)
    return response
