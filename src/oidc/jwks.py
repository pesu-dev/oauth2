"""JWKS endpoint for RS256 public verification keys."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException, Request

router = APIRouter(tags=["oidc"])


@router.get("/jwks.json")
async def jwks(request: Request) -> dict[str, Any]:
    """Return the public JWK set for token signature verification."""
    jwt_keys = getattr(request.app.state, "jwt_keys", None)
    if jwt_keys is None:
        raise HTTPException(status_code=503, detail="Signing key not configured")
    return jwt_keys.public_jwks()
