"""Extract client IP from ASGI requests (Cloud Run / reverse-proxy aware)."""

from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from starlette.requests import Request


def client_ip(request: Request) -> str:
    """Return leftmost ``X-Forwarded-For`` hop, else the socket peer, else ``unknown``.

    Cloud Run and similar platforms overwrite ``X-Forwarded-For`` with the
    true client; we trust the leftmost entry when present (same behavior as
    authorize/portal login rate limits).
    """
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    if request.client is not None:
        return request.client.host
    return "unknown"
