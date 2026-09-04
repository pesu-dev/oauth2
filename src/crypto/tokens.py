"""Sign and verify RS256 access and ID tokens."""

from __future__ import annotations

import base64
import hashlib
import time
from typing import TYPE_CHECKING, Any

import jwt
from nanoid import generate

if TYPE_CHECKING:
    from src.crypto.jwt_keys import JwtKeySet


def _at_hash(access_token: str) -> str:
    digest = hashlib.sha256(access_token.encode("ascii")).digest()
    left_half = digest[: len(digest) // 2]
    return base64.urlsafe_b64encode(left_half).rstrip(b"=").decode("ascii")


def _encode(keys: JwtKeySet, claims: dict[str, Any]) -> str:
    return jwt.encode(
        claims,
        keys.private_key,
        algorithm=keys.alg,
        headers={"kid": keys.kid},
    )


def sign_access_token(
    keys: JwtKeySet,
    *,
    issuer: str,
    sub: str,
    client_id: str,
    scope: str,
    ttl_seconds: int,
) -> str:
    """Sign an access JWT with ``aud`` / ``client_id`` set to the client."""
    now = int(time.time())
    claims: dict[str, Any] = {
        "iss": issuer,
        "sub": sub,
        "aud": client_id,
        "client_id": client_id,
        "scope": scope,
        "iat": now,
        "exp": now + ttl_seconds,
        "jti": generate(),
    }
    return _encode(keys, claims)


def sign_id_token(
    keys: JwtKeySet,
    *,
    issuer: str,
    sub: str,
    client_id: str,
    ttl_seconds: int,
    nonce: str | None = None,
    access_token: str | None = None,
    extra_claims: dict[str, Any] | None = None,
) -> str:
    """Sign an OIDC ID token; include ``at_hash`` when ``access_token`` is set."""
    now = int(time.time())
    claims: dict[str, Any] = {
        "iss": issuer,
        "sub": sub,
        "aud": client_id,
        "iat": now,
        "exp": now + ttl_seconds,
        "jti": generate(),
    }
    if nonce is not None:
        claims["nonce"] = nonce
    if access_token is not None:
        claims["at_hash"] = _at_hash(access_token)
    if extra_claims:
        claims.update(extra_claims)
    return _encode(keys, claims)


def verify_access_token(token: str, keys: JwtKeySet, *, issuer: str) -> dict[str, Any]:
    """Verify an RS256 JWT and return its claims dict.

    Audience is not filtered here (``aud`` is ``client_id``); callers compare
    ``claims["aud"]`` when a specific client is expected.
    """
    return jwt.decode(
        token,
        keys.private_key.public_key(),
        algorithms=[keys.alg],
        issuer=issuer,
        options={
            "require": ["exp", "iat", "iss", "sub", "aud"],
            "verify_aud": False,
        },
    )
