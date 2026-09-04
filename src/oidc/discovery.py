"""OIDC discovery document (OpenID Provider Metadata)."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Request

router = APIRouter(tags=["oidc"])


def build_openid_configuration(issuer_url: str) -> dict[str, Any]:
    """Build discovery metadata from the configured issuer base URL only."""
    issuer = issuer_url.rstrip("/")
    return {
        "issuer": issuer,
        "authorization_endpoint": f"{issuer}/authorize",
        "token_endpoint": f"{issuer}/token",
        "userinfo_endpoint": f"{issuer}/userinfo",
        "jwks_uri": f"{issuer}/jwks.json",
        "revocation_endpoint": f"{issuer}/revoke",
        "response_types_supported": ["code"],
        "subject_types_supported": ["public"],
        "id_token_signing_alg_values_supported": ["RS256"],
        "code_challenge_methods_supported": ["S256"],
        "scopes_supported": ["openid", "profile", "email", "phone", "offline_access"],
        "grant_types_supported": ["authorization_code", "refresh_token"],
        "token_endpoint_auth_methods_supported": ["client_secret_post", "none"],
    }


@router.get("/.well-known/openid-configuration")
async def openid_configuration(request: Request) -> dict[str, Any]:
    """Return OpenID Provider Metadata derived from ``config.issuer_url``."""
    return build_openid_configuration(request.app.state.config.issuer_url)
