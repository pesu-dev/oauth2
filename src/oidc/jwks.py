"""JWKS endpoint for RS256 public verification keys."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Request

from src.oidc import deps

router = APIRouter(tags=["oidc"])


@router.get("/jwks.json")
async def jwks(request: Request) -> dict[str, Any]:
    """Return the public JWK set for token signature verification."""
    return deps.jwt_keys(request).public_jwks()
