"""Developer portal: clients, testers, redirect URIs, Production request."""

from __future__ import annotations

import secrets
from datetime import UTC, datetime
from pathlib import Path
from typing import TYPE_CHECKING
from urllib.parse import urlparse

from fastapi import APIRouter, Form, Request
from fastapi.responses import HTMLResponse, RedirectResponse, Response
from fastapi.templating import Jinja2Templates

from src.academy.models import AcademyAuthError
from src.client_ip import client_ip
from src.crypto.hashing import sha256_hex
from src.crypto.ids import new_client_id, new_request_id
from src.mailer.port import notify_sub_quietly
from src.models.client import Client, PublishingStatus
from src.models.production_request import ProductionRequest, ProductionRequestStatus
from src.oidc import deps
from src.session_cookie import PortalFlash, PortalSession

if TYPE_CHECKING:
    from src.config import AppConfig
    from src.models.client import Client as ClientModel
    from src.session_cookie import PortalSessionStore

router = APIRouter(prefix="/portal", tags=["portal"])

PORTAL_COOKIE = "oauth2_portal"
FLASH_COOKIE = "oauth2_portal_flash"
_TEMPLATES_DIR = Path(__file__).resolve().parent.parent / "templates"
templates = Jinja2Templates(directory=str(_TEMPLATES_DIR))


def _set_portal_cookie(response: Response, config: AppConfig, value: str) -> None:
    response.set_cookie(
        key=PORTAL_COOKIE,
        value=value,
        httponly=True,
        secure=config.app_env != "local",
        samesite="lax",
        max_age=config.session_cookie_ttl_seconds,
        path="/",
    )


def _clear_portal_cookie(response: Response, config: AppConfig) -> None:
    response.delete_cookie(
        key=PORTAL_COOKIE,
        path="/",
        secure=config.app_env != "local",
        httponly=True,
        samesite="lax",
    )


def _set_flash_cookie(response: Response, config: AppConfig, value: str) -> None:
    response.set_cookie(
        key=FLASH_COOKIE,
        value=value,
        httponly=True,
        secure=config.app_env != "local",
        samesite="lax",
        max_age=300,
        path="/",
    )


def _clear_flash_cookie(response: Response, config: AppConfig) -> None:
    response.delete_cookie(
        key=FLASH_COOKIE,
        path="/",
        secure=config.app_env != "local",
        httponly=True,
        samesite="lax",
    )


def _portal_store(request: Request) -> PortalSessionStore:
    return deps.portal_session_store(request)


def _load_portal_session(request: Request) -> PortalSession | None:
    raw = request.cookies.get(PORTAL_COOKIE)
    if raw is None:
        return None
    return _portal_store(request).load_session(raw)


def _require_portal_session(request: Request) -> PortalSession | RedirectResponse:
    session = _load_portal_session(request)
    if session is None:
        return RedirectResponse(url="/portal/login", status_code=302)
    return session


def _error_page(request: Request, *, title: str, message: str, status_code: int = 400) -> HTMLResponse:
    return templates.TemplateResponse(
        request,
        "error.html",
        {"title": title, "message": message},
        status_code=status_code,
    )


def _valid_https_redirect(uri: str) -> bool:
    parsed = urlparse(uri.strip())
    if parsed.scheme == "https" and parsed.netloc:
        return True
    # Local loopback http allowed for developer testing
    if parsed.scheme == "http" and parsed.hostname in {"localhost", "127.0.0.1"}:
        return True
    return False


def _parse_redirect_uris(raw: str) -> tuple[str, ...] | None:
    uris = [line.strip() for line in raw.splitlines() if line.strip()]
    if not uris:
        return None
    if not all(_valid_https_redirect(u) for u in uris):
        return None
    # Preserve order, drop duplicates
    seen: set[str] = set()
    ordered: list[str] = []
    for uri in uris:
        if uri not in seen:
            seen.add(uri)
            ordered.append(uri)
    return tuple(ordered)


@router.get("", response_class=HTMLResponse)
@router.get("/", response_class=HTMLResponse)
async def portal_home(request: Request) -> Response:
    """Developer dashboard listing owned clients."""
    session = _require_portal_session(request)
    if isinstance(session, RedirectResponse):
        return session
    clients = await deps.clients(request).list_clients_by_owner(session.sub)
    return templates.TemplateResponse(
        request,
        "portal/dashboard.html",
        {
            "title": "Developer portal — PESU OAuth2",
            "clients": clients,
            "sub": session.sub,
        },
    )


@router.get("/login", response_class=HTMLResponse)
async def portal_login_get(request: Request) -> Response:
    """PESU Academy login for the developer portal (distinct cookie from OIDC)."""
    if _load_portal_session(request) is not None:
        return RedirectResponse(url="/portal", status_code=302)
    return templates.TemplateResponse(
        request,
        "portal/login.html",
        {"title": "Portal sign in — PESU OAuth2", "error": None},
    )


@router.post("/login")
async def portal_login_post(
    request: Request,
    username: str = Form(...),
    password: str = Form(...),
) -> Response:
    """Authenticate via Academy and set the portal session cookie."""
    config = deps.config(request)
    limiter = deps.login_limiter(request)
    ip = client_ip(request)
    if not limiter.allow(f"portal:{ip}"):
        return _error_page(
            request,
            title="Too many attempts",
            message="Too many login attempts. Please wait a minute and try again.",
            status_code=429,
        )

    try:
        result = await deps.academy(request).login(username.strip(), password)
    except AcademyAuthError:
        return templates.TemplateResponse(
            request,
            "portal/login.html",
            {
                "title": "Portal sign in — PESU OAuth2",
                "error": "Invalid username or password.",
            },
            status_code=200,
        )

    user = await deps.users(request).upsert_user_from_profile(result.profile)
    store = _portal_store(request)
    redirect = RedirectResponse(url="/portal", status_code=302)
    _set_portal_cookie(redirect, config, store.dump_session(PortalSession(sub=user.sub)))
    return redirect


@router.post("/logout")
async def portal_logout(request: Request) -> Response:
    """Clear the portal session cookie."""
    config = deps.config(request)
    response = RedirectResponse(url="/portal/login", status_code=302)
    _clear_portal_cookie(response, config)
    _clear_flash_cookie(response, config)
    return response


@router.get("/clients/new", response_class=HTMLResponse)
async def portal_new_client_get(request: Request) -> Response:
    """Form to register a new OAuth client."""
    session = _require_portal_session(request)
    if isinstance(session, RedirectResponse):
        return session
    return templates.TemplateResponse(
        request,
        "portal/client_new.html",
        {"title": "New client — PESU OAuth2", "error": None},
    )


@router.post("/clients")
async def portal_create_client(
    request: Request,
    name: str = Form(...),
    redirect_uri: str = Form(...),
) -> Response:
    """Create a Testing client; flash the plaintext secret once."""
    session = _require_portal_session(request)
    if isinstance(session, RedirectResponse):
        return session
    config = deps.config(request)
    cleaned_name = name.strip()
    if not cleaned_name:
        return templates.TemplateResponse(
            request,
            "portal/client_new.html",
            {"title": "New client — PESU OAuth2", "error": "Name is required."},
            status_code=400,
        )
    if not _valid_https_redirect(redirect_uri):
        return templates.TemplateResponse(
            request,
            "portal/client_new.html",
            {
                "title": "New client — PESU OAuth2",
                "error": "Redirect URI must be https (or http://localhost).",
            },
            status_code=400,
        )

    raw_secret = secrets.token_urlsafe(32)
    now = datetime.now(UTC)
    client = Client(
        client_id=new_client_id(),
        client_secret_hash=sha256_hex(raw_secret),
        name=cleaned_name,
        owner_sub=session.sub,
        redirect_uris=(redirect_uri.strip(),),
        token_endpoint_auth_method="client_secret_post",
        publishing_status=PublishingStatus.TESTING,
        delegated_allowed=False,
        created_at=now,
        updated_at=now,
    )
    await deps.clients(request).create_client(client)

    store = _portal_store(request)
    redirect = RedirectResponse(url=f"/portal/clients/{client.client_id}", status_code=302)
    _set_flash_cookie(
        redirect,
        config,
        store.dump_flash(PortalFlash(client_id=client.client_id, client_secret=raw_secret)),
    )
    return redirect


@router.get("/clients/{client_id}", response_class=HTMLResponse)
async def portal_client_detail(request: Request, client_id: str) -> Response:
    """Client detail; shows plaintext secret only when flash cookie is present."""
    session = _require_portal_session(request)
    if isinstance(session, RedirectResponse):
        return session
    config = deps.config(request)
    client = await deps.clients(request).get_client(client_id)
    if client is None or client.owner_sub != session.sub:
        return _error_page(request, title="Not found", message="Client not found.", status_code=404)

    plaintext_secret: str | None = None
    flash_raw = request.cookies.get(FLASH_COOKIE)
    if flash_raw is not None:
        flash = _portal_store(request).load_flash(flash_raw)
        if flash is not None and flash.client_id == client_id:
            plaintext_secret = flash.client_secret

    testers = await deps.testers(request).list_testers(client_id)
    response = templates.TemplateResponse(
        request,
        "portal/client_detail.html",
        {
            "title": f"{client.name} — PESU OAuth2",
            "client": client,
            "testers": testers,
            "plaintext_secret": plaintext_secret,
            "error": None,
        },
    )
    if plaintext_secret is not None:
        _clear_flash_cookie(response, config)
    return response


@router.post("/clients/{client_id}/redirect-uris")
async def portal_update_redirect_uris(
    request: Request,
    client_id: str,
    redirect_uris: str = Form(...),
) -> Response:
    """Replace the client's redirect URI list."""
    session = _require_portal_session(request)
    if isinstance(session, RedirectResponse):
        return session
    client = await _owned_client(request, client_id, session.sub)
    if isinstance(client, HTMLResponse):
        return client
    parsed = _parse_redirect_uris(redirect_uris)
    if parsed is None:
        return _error_page(
            request,
            title="Invalid redirect URIs",
            message="Provide at least one https redirect URI (http://localhost allowed).",
        )
    updated = Client(
        client_id=client.client_id,
        client_secret_hash=client.client_secret_hash,
        name=client.name,
        owner_sub=client.owner_sub,
        redirect_uris=parsed,
        token_endpoint_auth_method=client.token_endpoint_auth_method,
        publishing_status=client.publishing_status,
        delegated_allowed=client.delegated_allowed,
        created_at=client.created_at,
        updated_at=datetime.now(UTC),
    )
    await deps.clients(request).update_client(updated)
    return RedirectResponse(url=f"/portal/clients/{client_id}", status_code=302)


@router.post("/clients/{client_id}/testers")
async def portal_add_tester(
    request: Request,
    client_id: str,
    sub: str = Form(...),
) -> Response:
    """Add a tester ``sub`` to the Testing allowlist."""
    session = _require_portal_session(request)
    if isinstance(session, RedirectResponse):
        return session
    client = await _owned_client(request, client_id, session.sub)
    if isinstance(client, HTMLResponse):
        return client
    cleaned = sub.strip()
    if not cleaned.startswith("usr_"):
        return _error_page(request, title="Invalid tester", message="Tester must be a usr_ subject.")
    await deps.testers(request).add_tester(client_id, cleaned)
    return RedirectResponse(url=f"/portal/clients/{client_id}", status_code=302)


@router.post("/clients/{client_id}/request-production")
async def portal_request_production(request: Request, client_id: str) -> Response:
    """Move client to pending_production and enqueue an admin review row."""
    session = _require_portal_session(request)
    if isinstance(session, RedirectResponse):
        return session
    client = await _owned_client(request, client_id, session.sub)
    if isinstance(client, HTMLResponse):
        return client
    if client.publishing_status != PublishingStatus.TESTING:
        return _error_page(
            request,
            title="Cannot request Production",
            message="Only Testing clients can request Production approval.",
        )
    now = datetime.now(UTC)
    queue = deps.production_requests(request)
    request_id = new_request_id()
    await queue.create_request(
        ProductionRequest(
            request_id=request_id,
            client_id=client.client_id,
            requested_by_sub=session.sub,
            status=ProductionRequestStatus.PENDING,
            delegated_requested=False,
            created_at=now,
            resolved_at=None,
            resolved_by_sub=None,
        )
    )
    updated = Client(
        client_id=client.client_id,
        client_secret_hash=client.client_secret_hash,
        name=client.name,
        owner_sub=client.owner_sub,
        redirect_uris=client.redirect_uris,
        token_endpoint_auth_method=client.token_endpoint_auth_method,
        publishing_status=PublishingStatus.PENDING_PRODUCTION,
        delegated_allowed=client.delegated_allowed,
        created_at=client.created_at,
        updated_at=now,
    )
    try:
        await deps.clients(request).update_client(updated)
    except Exception:
        # Compensate: drop the orphan queue row so the client stays Testing and can retry.
        await queue.delete_request(request_id)
        return _error_page(
            request,
            title="Request failed",
            message="Could not submit Production request. Please try again.",
            status_code=500,
        )
    await notify_sub_quietly(
        deps.mailer(request),
        deps.users(request),
        sub=session.sub,
        subject=f"Production review requested for {client.name}",
        body=(
            f"Your client {client.name} ({client.client_id}) was submitted for "
            "Production review. An admin will approve or reject the request."
        ),
    )
    return RedirectResponse(url=f"/portal/clients/{client_id}", status_code=302)


async def _owned_client(
    request: Request,
    client_id: str,
    owner_sub: str,
) -> ClientModel | HTMLResponse:
    client = await deps.clients(request).get_client(client_id)
    if client is None or client.owner_sub != owner_sub:
        return _error_page(request, title="Not found", message="Client not found.", status_code=404)
    return client
