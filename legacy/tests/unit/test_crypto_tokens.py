"""Unit tests for RS256 JWT signing and JWKS."""

from __future__ import annotations

import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa


@pytest.fixture
def rsa_pem() -> str:
    """Ephemeral RSA private key PEM for unit tests."""
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    return key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption(),
    ).decode("utf-8")


@pytest.mark.unit
def test_access_token_round_trip(rsa_pem: str) -> None:
    from src.crypto.jwt_keys import JwtKeySet
    from src.crypto.tokens import sign_access_token, verify_access_token

    keys = JwtKeySet.from_pem(rsa_pem, kid="test-1")
    token = sign_access_token(
        keys,
        issuer="http://localhost:8080",
        sub="usr_abc",
        client_id="cli_1",
        scope="openid profile",
        ttl_seconds=3600,
    )
    claims = verify_access_token(token, keys, issuer="http://localhost:8080")
    assert claims["sub"] == "usr_abc"
    assert claims["aud"] == "cli_1"
    assert claims["client_id"] == "cli_1"
    assert "jti" in claims


@pytest.mark.unit
def test_public_jwks_includes_kid_and_rsa(rsa_pem: str) -> None:
    from src.crypto.jwt_keys import JwtKeySet

    keys = JwtKeySet.from_pem(rsa_pem, kid="test-1")
    jwks = keys.public_jwks()
    assert "keys" in jwks
    assert len(jwks["keys"]) == 1
    jwk = jwks["keys"][0]
    assert jwk["kid"] == "test-1"
    assert jwk["kty"] == "RSA"
    assert jwk["alg"] == "RS256"
    assert jwk["use"] == "sig"
    assert "n" in jwk
    assert "e" in jwk


@pytest.mark.unit
def test_id_token_round_trip(rsa_pem: str) -> None:
    from src.crypto.jwt_keys import JwtKeySet
    from src.crypto.tokens import sign_access_token, sign_id_token, verify_access_token

    keys = JwtKeySet.from_pem(rsa_pem, kid="test-1")
    access = sign_access_token(
        keys,
        issuer="http://localhost:8080",
        sub="usr_abc",
        client_id="cli_1",
        scope="openid profile",
        ttl_seconds=3600,
    )
    id_token = sign_id_token(
        keys,
        issuer="http://localhost:8080",
        sub="usr_abc",
        client_id="cli_1",
        ttl_seconds=3600,
        nonce="n-1",
        access_token=access,
        extra_claims={"name": "Ada"},
    )
    claims = verify_access_token(id_token, keys, issuer="http://localhost:8080")
    assert claims["sub"] == "usr_abc"
    assert claims["aud"] == "cli_1"
    assert claims["nonce"] == "n-1"
    assert claims["name"] == "Ada"
    assert "at_hash" in claims


@pytest.mark.unit
def test_verify_access_token_rejects_wrong_issuer(rsa_pem: str) -> None:
    import jwt

    from src.crypto.jwt_keys import JwtKeySet
    from src.crypto.tokens import sign_access_token, verify_access_token

    keys = JwtKeySet.from_pem(rsa_pem, kid="test-1")
    token = sign_access_token(
        keys,
        issuer="http://localhost:8080",
        sub="usr_abc",
        client_id="cli_1",
        scope="openid",
        ttl_seconds=3600,
    )
    with pytest.raises(jwt.InvalidTokenError):
        verify_access_token(token, keys, issuer="https://evil.example")


@pytest.mark.unit
def test_id_token_without_optional_claims(rsa_pem: str) -> None:
    from src.crypto.jwt_keys import JwtKeySet
    from src.crypto.tokens import sign_id_token, verify_access_token

    keys = JwtKeySet.from_pem(rsa_pem, kid="test-1")
    id_token = sign_id_token(
        keys,
        issuer="http://localhost:8080",
        sub="usr_abc",
        client_id="cli_1",
        ttl_seconds=3600,
    )
    claims = verify_access_token(id_token, keys, issuer="http://localhost:8080")
    assert claims["sub"] == "usr_abc"
    assert "nonce" not in claims
    assert "at_hash" not in claims


@pytest.mark.unit
def test_from_pem_rejects_non_rsa_key() -> None:
    from cryptography.hazmat.primitives import serialization
    from cryptography.hazmat.primitives.asymmetric import ec

    from src.crypto.jwt_keys import JwtKeySet

    key = ec.generate_private_key(ec.SECP256R1())
    pem = key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption(),
    ).decode("utf-8")
    with pytest.raises(TypeError, match="RSA private key"):
        JwtKeySet.from_pem(pem, kid="bad")
