"""Shared HTML helpers for CSRF-protected Jinja responses."""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from src.csrf import set_csrf_cookie
from src.oidc import deps

if TYPE_CHECKING:
    from fastapi.templating import Jinja2Templates
    from starlette.requests import Request
    from starlette.responses import Response


def render_with_csrf(
    templates: Jinja2Templates,
    request: Request,
    name: str,
    context: dict[str, Any],
    *,
    status_code: int = 200,
) -> Response:
    """Render ``name`` with a fresh CSRF token in context and cookie."""
    config = deps.config(request)
    store = deps.csrf_store(request)
    token = store.new_token()
    response = templates.TemplateResponse(
        request,
        name,
        {**context, "csrf_token": token},
        status_code=status_code,
    )
    set_csrf_cookie(response, config, store.dump(token))
    return response
