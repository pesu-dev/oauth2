"""Admin Production queue."""

from __future__ import annotations

from datetime import UTC, datetime
from pathlib import Path

from fastapi import APIRouter, Form, Request
from fastapi.responses import HTMLResponse, RedirectResponse, Response
from fastapi.templating import Jinja2Templates

from src.html_csrf import render_with_csrf
from src.mailer.port import notify_sub_quietly
from src.models.client import Client, PublishingStatus
from src.models.production_request import ProductionRequestStatus
from src.oidc import deps
from src.portal.router import PORTAL_COOKIE, _check_csrf, _error_page
from src.session_cookie import PortalSession

router = APIRouter(prefix="/admin", tags=["admin"])

_TEMPLATES_DIR = Path(__file__).resolve().parent.parent / "templates"
templates = Jinja2Templates(directory=str(_TEMPLATES_DIR))


def _load_portal_session(request: Request) -> PortalSession | None:
    raw = request.cookies.get(PORTAL_COOKIE)
    if raw is None:
        return None
    return deps.portal_session_store(request).load_session(raw)


async def _require_admin(request: Request) -> PortalSession | Response:
    session = _load_portal_session(request)
    if session is None:
        return RedirectResponse(url="/portal/login", status_code=302)
    if not await deps.admins(request).is_admin(session.sub):
        return _error_page(
            request,
            title="Forbidden",
            message="Admin access required.",
            status_code=403,
        )
    return session


@router.get("", response_class=HTMLResponse)
@router.get("/", response_class=HTMLResponse)
async def admin_queue(request: Request) -> Response:
    """List pending Production requests."""
    session = await _require_admin(request)
    if not isinstance(session, PortalSession):
        return session
    pending = await deps.production_requests(request).list_pending()
    clients = deps.clients(request)
    rows: list[dict[str, object]] = []
    for req in pending:
        client = await clients.get_client(req.client_id)
        rows.append({"request": req, "client": client})
    return render_with_csrf(
        templates,
        request,
        "admin/queue.html",
        {
            "title": "Admin queue — PESU OAuth2",
            "rows": rows,
            "sub": session.sub,
        },
    )


@router.post("/requests/{request_id}/approve")
async def admin_approve(
    request: Request,
    request_id: str,
    delegated_allowed: str = Form("false"),
    csrf_token: str = Form(""),
) -> Response:
    """Approve Production; optionally enable delegated_allowed."""
    rejected = _check_csrf(request, csrf_token)
    if rejected is not None:
        return rejected
    session = await _require_admin(request)
    if not isinstance(session, PortalSession):
        return session
    queue = deps.production_requests(request)
    existing = await queue.get_request(request_id)
    if existing is None or existing.status != ProductionRequestStatus.PENDING:
        return _error_page(request, title="Not found", message="Request not found.", status_code=404)

    client_repo = deps.clients(request)
    client = await client_repo.get_client(existing.client_id)
    if client is None:
        return _error_page(request, title="Not found", message="Client missing.", status_code=404)

    now = datetime.now(UTC)
    allow_delegated = delegated_allowed.strip().lower() in {"true", "1", "on", "yes"}
    updated = Client(
        client_id=client.client_id,
        client_secret_hash=client.client_secret_hash,
        name=client.name,
        owner_sub=client.owner_sub,
        redirect_uris=client.redirect_uris,
        token_endpoint_auth_method=client.token_endpoint_auth_method,
        publishing_status=PublishingStatus.PRODUCTION,
        delegated_allowed=allow_delegated,
        created_at=client.created_at,
        updated_at=now,
    )
    try:
        await client_repo.update_client(updated)
    except Exception:
        # Leave queue row pending so admin can retry.
        return _error_page(
            request,
            title="Approve failed",
            message="Could not update client. Please try again.",
            status_code=500,
        )
    await queue.resolve_request(
        request_id,
        status=ProductionRequestStatus.APPROVED,
        resolved_by_sub=session.sub,
        resolved_at=now,
    )
    # Concurrent resolve returning None is OK — client is already Production.
    await notify_sub_quietly(
        deps.mailer(request),
        deps.users(request),
        sub=client.owner_sub,
        subject=f"{client.name} approved for Production",
        body=(
            f"Your client {client.name} ({client.client_id}) was approved for Production."
            + (" Delegated mode is allowed." if allow_delegated else "")
        ),
    )
    return RedirectResponse(url="/admin", status_code=302)


@router.post("/requests/{request_id}/reject")
async def admin_reject(
    request: Request,
    request_id: str,
    csrf_token: str = Form(""),
) -> Response:
    """Reject Production; return client to Testing."""
    rejected = _check_csrf(request, csrf_token)
    if rejected is not None:
        return rejected
    session = await _require_admin(request)
    if not isinstance(session, PortalSession):
        return session
    queue = deps.production_requests(request)
    existing = await queue.get_request(request_id)
    if existing is None or existing.status != ProductionRequestStatus.PENDING:
        return _error_page(request, title="Not found", message="Request not found.", status_code=404)

    client_repo = deps.clients(request)
    client = await client_repo.get_client(existing.client_id)
    if client is None:
        return _error_page(request, title="Not found", message="Client missing.", status_code=404)

    now = datetime.now(UTC)
    updated = Client(
        client_id=client.client_id,
        client_secret_hash=client.client_secret_hash,
        name=client.name,
        owner_sub=client.owner_sub,
        redirect_uris=client.redirect_uris,
        token_endpoint_auth_method=client.token_endpoint_auth_method,
        publishing_status=PublishingStatus.TESTING,
        delegated_allowed=False,
        created_at=client.created_at,
        updated_at=now,
    )
    try:
        await client_repo.update_client(updated)
    except Exception:
        # Leave queue row pending so admin can retry.
        return _error_page(
            request,
            title="Reject failed",
            message="Could not update client. Please try again.",
            status_code=500,
        )
    await queue.resolve_request(
        request_id,
        status=ProductionRequestStatus.REJECTED,
        resolved_by_sub=session.sub,
        resolved_at=now,
    )
    # Concurrent resolve returning None is OK — client is already Testing.
    await notify_sub_quietly(
        deps.mailer(request),
        deps.users(request),
        sub=client.owner_sub,
        subject=f"{client.name} returned to Testing",
        body=(
            f"Your Production request for {client.name} ({client.client_id}) "
            "was rejected. The client remains in Testing."
        ),
    )
    return RedirectResponse(url="/admin", status_code=302)
