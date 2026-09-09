"""OAuth 2.0 token revocation endpoint (RFC 7009) — ``POST /revoke``."""

from __future__ import annotations

from typing import TYPE_CHECKING

from fastapi import APIRouter, Form, Request, Response
from fastapi.responses import JSONResponse

from src.crypto.hashing import sha256_hex, verify_client_secret
from src.oidc import deps

if TYPE_CHECKING:
    from src.models.client import Client

router = APIRouter(tags=["oidc"])


def _token_error(error: str, description: str, status_code: int = 400) -> JSONResponse:
    return JSONResponse(
        status_code=status_code,
        content={"error": error, "error_description": description},
    )


async def _authenticate_client(
    request: Request,
    client_id: str | None,
    client_secret: str | None,
) -> Client | JSONResponse:
    if not client_id:
        return _token_error("invalid_client", "client_id is required", status_code=401)
    client = await deps.clients(request).get_client(client_id)
    if client is None:
        return _token_error("invalid_client", "Unknown client", status_code=401)

    if client.token_endpoint_auth_method == "none":
        return client

    if client.client_secret_hash is None:
        return _token_error("invalid_client", "Client is not configured for secret auth", status_code=401)
    if not client_secret:
        return _token_error("invalid_client", "Invalid client credentials", status_code=401)
    if not verify_client_secret(client_secret, client.client_secret_hash):
        return _token_error("invalid_client", "Invalid client credentials", status_code=401)
    return client


@router.post("/revoke", response_model=None)
async def revoke(
    request: Request,
    token: str | None = Form(None),
    token_type_hint: str | None = Form(None),
    client_id: str | None = Form(None),
    client_secret: str | None = Form(None),
) -> Response:
    """Revoke a refresh token. Access JWTs are expiry-only (no jti denylist in v1).

    Per RFC 7009, successful responses are 200 with an empty body even when the
    token was already invalid, so clients cannot probe for valid tokens.
    """
    client_or_err = await _authenticate_client(request, client_id, client_secret)
    if isinstance(client_or_err, JSONResponse):
        return client_or_err
    client = client_or_err

    if not token:
        # Missing token is an invalid_request (not a silent success)
        return _token_error("invalid_request", "token is required")

    # Access tokens: no denylist — acknowledge and return 200
    if token_type_hint == "access_token":
        return Response(status_code=200)

    token_hash = sha256_hex(token)
    existing = await deps.refresh_tokens(request).get_refresh(token_hash)
    if existing is not None and existing.client_id == client.client_id:
        await deps.refresh_tokens(request).revoke_by_hash(token_hash)

    return Response(status_code=200)
