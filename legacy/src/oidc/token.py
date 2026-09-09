"""OAuth2 token endpoint — authorization_code and refresh_token grants."""

from __future__ import annotations

import re
import secrets
from datetime import UTC, datetime, timedelta
from typing import TYPE_CHECKING, Any

from fastapi import APIRouter, Form, Request
from fastapi.responses import JSONResponse

from src.client_ip import client_ip
from src.crypto.hashing import sha256_hex, verify_client_secret
from src.crypto.tokens import sign_access_token, sign_id_token
from src.models.refresh_token import RefreshToken
from src.oidc import deps
from src.oidc.claims import profile_claims
from src.oidc.pkce import verify_s256

if TYPE_CHECKING:
    from src.models.authorization_code import AuthorizationCode
    from src.models.client import Client
    from src.models.user import User

router = APIRouter(tags=["oidc"])

_VERIFIER_RE = re.compile(r"^[A-Za-z0-9\-._~]{43,128}$")


def _token_error(error: str, description: str, status_code: int = 400) -> JSONResponse:
    return JSONResponse(
        status_code=status_code,
        content={"error": error, "error_description": description},
    )


def _scope_string(scopes: frozenset[str]) -> str:
    return " ".join(sorted(scopes))


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


@router.post("/token", response_model=None)
async def token(
    request: Request,
    grant_type: str | None = Form(None),
    code: str | None = Form(None),
    redirect_uri: str | None = Form(None),
    client_id: str | None = Form(None),
    client_secret: str | None = Form(None),
    code_verifier: str | None = Form(None),
    refresh_token: str | None = Form(None),
) -> JSONResponse | dict[str, Any]:
    """Exchange an authorization code or rotate a refresh token."""
    ip = client_ip(request)
    if not deps.token_limiter(request).allow(f"token:{ip}"):
        return _token_error("temporarily_unavailable", "Too many requests", status_code=429)

    client_or_err = await _authenticate_client(request, client_id, client_secret)
    if isinstance(client_or_err, JSONResponse):
        return client_or_err
    client = client_or_err

    if grant_type == "authorization_code":
        return await _authorization_code_grant(
            request,
            client=client,
            code=code,
            redirect_uri=redirect_uri,
            code_verifier=code_verifier,
        )
    if grant_type == "refresh_token":
        return await _refresh_grant(request, client=client, refresh_token=refresh_token)
    return _token_error("unsupported_grant_type", "Supported: authorization_code, refresh_token")


async def _authorization_code_grant(
    request: Request,
    *,
    client: Client,
    code: str | None,
    redirect_uri: str | None,
    code_verifier: str | None,
) -> JSONResponse | dict[str, Any]:
    if not code or not redirect_uri or not code_verifier:
        return _token_error("invalid_request", "code, redirect_uri, and code_verifier are required")
    if not _VERIFIER_RE.fullmatch(code_verifier):
        return _token_error("invalid_request", "code_verifier must be 43-128 unreserved ASCII characters")

    stored: AuthorizationCode | None = await deps.auth_codes(request).consume_code(sha256_hex(code))
    if stored is None:
        return _token_error("invalid_grant", "Invalid or expired authorization code")
    if stored.client_id != client.client_id:
        return _token_error("invalid_grant", "Code was not issued to this client")
    if stored.redirect_uri != redirect_uri:
        return _token_error("invalid_grant", "redirect_uri mismatch")
    if stored.code_challenge_method != "S256" or not verify_s256(stored.code_challenge, code_verifier):
        return _token_error("invalid_grant", "PKCE verification failed")

    return await _issue_tokens(
        request,
        client=client,
        sub=stored.sub,
        scopes=stored.scopes,
        nonce=stored.nonce,
        issue_refresh="offline_access" in stored.scopes,
    )


async def _issue_tokens(
    request: Request,
    *,
    client: Client,
    sub: str,
    scopes: frozenset[str],
    nonce: str | None,
    issue_refresh: bool,
    refresh_raw: str | None = None,
) -> dict[str, Any]:
    config = deps.config(request)
    keys = deps.jwt_keys(request)
    user: User | None = await deps.users(request).get_user(sub)
    if user is None:
        raise RuntimeError("user missing for token issue")

    access = sign_access_token(
        keys,
        issuer=config.issuer_url,
        sub=sub,
        client_id=client.client_id,
        scope=_scope_string(scopes),
        ttl_seconds=config.access_token_ttl_seconds,
    )
    extra = profile_claims(user, scopes)
    extra.pop("sub", None)
    id_token = sign_id_token(
        keys,
        issuer=config.issuer_url,
        sub=sub,
        client_id=client.client_id,
        ttl_seconds=config.id_token_ttl_seconds,
        nonce=nonce,
        access_token=access,
        extra_claims=extra,
    )
    body: dict[str, Any] = {
        "access_token": access,
        "token_type": "Bearer",
        "expires_in": config.access_token_ttl_seconds,
        "id_token": id_token,
        "scope": _scope_string(scopes),
    }
    if issue_refresh:
        raw = refresh_raw or secrets.token_urlsafe(32)
        if refresh_raw is None:
            now = datetime.now(UTC)
            await deps.refresh_tokens(request).store_refresh(
                RefreshToken(
                    token_hash=sha256_hex(raw),
                    family_id=secrets.token_urlsafe(16),
                    client_id=client.client_id,
                    sub=sub,
                    scopes=scopes,
                    expires_at=now + timedelta(seconds=config.refresh_token_ttl_seconds),
                    created_at=now,
                    revoked_at=None,
                )
            )
        body["refresh_token"] = raw
    return body


async def _refresh_grant(
    request: Request,
    *,
    client: Client,
    refresh_token: str | None,
) -> JSONResponse | dict[str, Any]:
    if not refresh_token:
        return _token_error("invalid_request", "refresh_token is required")

    old_hash = sha256_hex(refresh_token)
    existing = await deps.refresh_tokens(request).get_refresh(old_hash)
    if existing is None:
        return _token_error("invalid_grant", "Invalid refresh token")
    if existing.client_id != client.client_id:
        return _token_error("invalid_grant", "Refresh token was not issued to this client")

    now = datetime.now(UTC)
    new_raw = secrets.token_urlsafe(32)
    new_token = RefreshToken(
        token_hash=sha256_hex(new_raw),
        family_id=existing.family_id,
        client_id=existing.client_id,
        sub=existing.sub,
        scopes=existing.scopes,
        expires_at=existing.expires_at,
        created_at=now,
        revoked_at=None,
    )
    rotated = await deps.refresh_tokens(request).rotate_refresh(old_hash, new_token)
    if rotated is None:
        return _token_error("invalid_grant", "Invalid or reused refresh token")

    return await _issue_tokens(
        request,
        client=client,
        sub=existing.sub,
        scopes=existing.scopes,
        nonce=None,
        issue_refresh=True,
        refresh_raw=new_raw,
    )
