"""Internal token exchange — Academy session material for first-party callers."""

from __future__ import annotations

import hmac
import json
from typing import Any

import jwt
from fastapi import APIRouter, Form, Request
from fastapi.responses import JSONResponse

from src.academy.models import AcademyAuthError
from src.crypto.tokens import verify_access_token
from src.crypto.vault_crypto import VaultCryptoError, master_key_from_secret, seal
from src.crypto.vault_crypto import open as open_blob
from src.crypto.vault_payload import (
    CURRENT_VAULT_KEY_VERSION,
    VaultPlaintext,
    pack_vault_plaintext,
    session_is_valid,
    unpack_vault_plaintext,
)
from src.models.consent import ConsentMode
from src.models.vault import VaultEntry
from src.oidc import deps

router = APIRouter(tags=["internal"])


def _exchange_secret_ok(request: Request, configured: str | None) -> bool:
    if configured is None or configured == "":
        return False
    header = request.headers.get("x-token-exchange-secret")
    if header is not None:
        try:
            if hmac.compare_digest(header, configured):
                return True
        except (TypeError, ValueError):
            return False
    auth = request.headers.get("authorization")
    if auth is None:
        return False
    parts = auth.split(" ", 1)
    if len(parts) != 2 or parts[0].lower() != "bearer":
        return False
    try:
        return hmac.compare_digest(parts[1], configured)
    except (TypeError, ValueError):
        return False


def _unauthorized(description: str) -> JSONResponse:
    return JSONResponse(
        status_code=401,
        content={"error": "unauthorized", "error_description": description},
    )


def _forbidden(description: str) -> JSONResponse:
    return JSONResponse(
        status_code=403,
        content={"error": "forbidden", "error_description": description},
    )


def _session_response(token: str, *, access_token: str | None, user_id: str | None) -> dict[str, Any]:
    body: dict[str, Any] = {"token": token}
    if access_token is not None:
        body["access_token"] = access_token
    if user_id is not None:
        body["user_id"] = user_id
    return body


def _open_vault_plaintext(master_key: bytes, entry: VaultEntry) -> VaultPlaintext | JSONResponse:
    try:
        return unpack_vault_plaintext(open_blob(master_key, entry.blob))
    except (VaultCryptoError, ValueError, KeyError, TypeError, json.JSONDecodeError, UnicodeDecodeError):
        return _forbidden("Vault credentials unreadable")


def _require_first_party_client(config_client_id: str, token_client_id: str) -> JSONResponse | None:
    """Return an error response when the JWT client is not the configured first-party API."""
    try:
        if not hmac.compare_digest(token_client_id, config_client_id):
            return _forbidden("Token client is not the first-party API client")
    except (TypeError, ValueError):
        return _forbidden("Token client is not the first-party API client")
    return None


def _subject_and_allowed_client(
    *,
    access_token: str,
    request: Request,
) -> tuple[str, str] | JSONResponse:
    """Validate access JWT and first-party allowlist; return ``(sub, client_id)``."""
    config = deps.config(request)
    keys = deps.jwt_keys(request)
    try:
        claims = verify_access_token(access_token, keys, issuer=config.issuer_url)
    except jwt.PyJWTError:
        return _unauthorized("Invalid or expired access token")

    sub = str(claims["sub"])
    client_id = str(claims.get("client_id") or claims.get("aud") or "")
    if not client_id:
        return _unauthorized("Access token missing client audience")

    allowed = config.first_party_api_client_id
    allow_err = _require_first_party_client(allowed, client_id)
    if allow_err is not None:
        return allow_err
    return sub, allowed


async def _refresh_vault_session(
    request: Request,
    *,
    plaintext: VaultPlaintext,
    master: bytes,
    sub: str,
) -> JSONResponse | dict[str, Any]:
    academy = deps.academy(request)
    try:
        result = await academy.login(plaintext.username, plaintext.password)
    except AcademyAuthError:
        return JSONResponse(
            status_code=502,
            content={
                "error": "academy_unavailable",
                "error_description": "Could not refresh Academy session",
            },
        )

    refreshed = VaultPlaintext(
        username=plaintext.username,
        password=plaintext.password,
        session=result.session,
    )
    blob = seal(master, pack_vault_plaintext(refreshed), key_version=CURRENT_VAULT_KEY_VERSION)
    await deps.vault(request).upsert_vault(
        VaultEntry(
            sub=sub,
            blob=blob,
            session_expires_at=result.session.expires_at,
        ),
    )
    return _session_response(
        result.session.token,
        access_token=result.session.access_token,
        user_id=result.session.user_id,
    )


@router.post("/oauth/token-exchange", response_model=None)
async def token_exchange(
    request: Request,
    access_token: str | None = Form(None),
) -> JSONResponse | dict[str, Any]:
    """Return Academy session material for a delegated subject (never the password)."""
    config = deps.config(request)
    if not _exchange_secret_ok(request, config.token_exchange_secret):
        return _unauthorized("Valid token exchange secret required")

    if not access_token:
        return JSONResponse(
            status_code=400,
            content={"error": "invalid_request", "error_description": "access_token is required"},
        )

    parsed = _subject_and_allowed_client(access_token=access_token, request=request)
    if isinstance(parsed, JSONResponse):
        return parsed
    sub, allowed = parsed

    consent = await deps.consents(request).get_consent(sub, allowed)
    if consent is None or consent.mode != ConsentMode.DELEGATED:
        return _forbidden("Delegated consent required")

    if config.vault_master_key is None:
        return JSONResponse(
            status_code=503,
            content={"error": "misconfigured", "error_description": "Vault master key unavailable"},
        )

    entry = await deps.vault(request).get_vault(sub)
    if entry is None:
        return _forbidden("No vault credentials for subject")

    master = master_key_from_secret(config.vault_master_key)
    opened = _open_vault_plaintext(master, entry)
    if isinstance(opened, JSONResponse):
        return opened

    if session_is_valid(opened.session):
        return _session_response(
            opened.session.token,
            access_token=opened.session.access_token,
            user_id=opened.session.user_id,
        )

    return await _refresh_vault_session(request, plaintext=opened, master=master, sub=sub)
