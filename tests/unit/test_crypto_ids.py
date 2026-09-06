"""Unit tests for opaque ID generation."""

from __future__ import annotations

import pytest


@pytest.mark.unit
def test_new_sub_has_prefix() -> None:
    from src.crypto.ids import new_sub

    s = new_sub()
    assert s.startswith("usr_")
    assert s != new_sub()


@pytest.mark.unit
def test_new_client_and_request_ids() -> None:
    from src.crypto.ids import new_client_id, new_request_id

    assert new_client_id().startswith("cli_")
    assert new_request_id().startswith("req_")


@pytest.mark.unit
def test_sha256_hex_is_deterministic() -> None:
    from src.crypto.hashing import sha256_hex

    digest = sha256_hex("refresh-token-value")
    assert digest == sha256_hex("refresh-token-value")
    assert len(digest) == 64
    assert digest != sha256_hex("other-value")


@pytest.mark.unit
def test_hash_client_secret_argon2_round_trip() -> None:
    from src.crypto.hashing import hash_client_secret, verify_client_secret

    secret = "top-secret-client-value"
    digest = hash_client_secret(secret)
    assert digest.startswith("$argon2")
    assert verify_client_secret(secret, digest) is True
    assert verify_client_secret("wrong", digest) is False
    assert verify_client_secret(secret, "not-an-argon2-hash") is False
