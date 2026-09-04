"""OIDC UserInfo endpoint (Bearer access JWT)."""

from __future__ import annotations

from typing import Any

import jwt
from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from src.crypto.tokens import verify_access_token
from src.oidc import deps
from src.oidc.claims import profile_claims

router = APIRouter(tags=["oidc"])


def _bearer_token(request: Request) -> str | None:
    header = request.headers.get("authorization")
    if header is None:
        return None
    parts = header.split(" ", 1)
    if len(parts) != 2 or parts[0].lower() != "bearer" or not parts[1]:
        return None
    return parts[1]


async def _userinfo_response(request: Request) -> JSONResponse | dict[str, Any]:
    token = _bearer_token(request)
    if token is None:
        return JSONResponse(
            status_code=401,
            content={"error": "invalid_token", "error_description": "Bearer access token required"},
            headers={"WWW-Authenticate": "Bearer"},
        )

    config = deps.config(request)
    keys = deps.jwt_keys(request)
    try:
        claims = verify_access_token(token, keys, issuer=config.issuer_url)
    except jwt.PyJWTError:
        return JSONResponse(
            status_code=401,
            content={"error": "invalid_token", "error_description": "Invalid or expired access token"},
            headers={"WWW-Authenticate": "Bearer"},
        )

    sub = str(claims["sub"])
    scope_raw = claims.get("scope", "")
    scopes = frozenset(str(scope_raw).split()) if scope_raw else frozenset()

    user = await deps.users(request).get_user(sub)
    if user is None:
        return JSONResponse(
            status_code=401,
            content={"error": "invalid_token", "error_description": "Subject no longer exists"},
            headers={"WWW-Authenticate": "Bearer"},
        )
    return profile_claims(user, scopes)


@router.get("/userinfo", response_model=None)
async def userinfo_get(request: Request) -> JSONResponse | dict[str, Any]:
    """Return claims for the access-token subject."""
    return await _userinfo_response(request)


@router.post("/userinfo", response_model=None)
async def userinfo_post(request: Request) -> JSONResponse | dict[str, Any]:
    """Return claims for the access-token subject (POST form of UserInfo)."""
    return await _userinfo_response(request)
