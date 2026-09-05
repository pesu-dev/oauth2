"""Unit tests for vault envelope encryption (seal / open)."""

from __future__ import annotations

import os

import pytest

from src.crypto.vault_crypto import SealedBlob, VaultCryptoError, master_key_from_secret, open, seal


@pytest.mark.unit
def test_seal_open_round_trip() -> None:
    master_key = os.urandom(32)
    plaintext = b'{"username":"u","password":"p","session":{"token":"t"}}'
    blob = seal(master_key, plaintext, key_version=1)
    assert isinstance(blob, SealedBlob)
    assert blob.key_version == 1
    assert blob.ciphertext != plaintext
    assert open(master_key, blob) == plaintext


@pytest.mark.unit
def test_seal_uses_fresh_dek_each_call() -> None:
    master_key = os.urandom(32)
    plaintext = b"same-payload"
    a = seal(master_key, plaintext, key_version=1)
    b = seal(master_key, plaintext, key_version=1)
    assert a.ciphertext != b.ciphertext
    assert a.wrapped_dek != b.wrapped_dek
    assert open(master_key, a) == plaintext
    assert open(master_key, b) == plaintext


@pytest.mark.unit
def test_open_rejects_wrong_master_key() -> None:
    master_key = os.urandom(32)
    blob = seal(master_key, b"secret", key_version=1)
    with pytest.raises(VaultCryptoError):
        open(os.urandom(32), blob)


@pytest.mark.unit
def test_open_rejects_tampered_ciphertext() -> None:
    master_key = os.urandom(32)
    blob = seal(master_key, b"secret", key_version=2)
    tampered = SealedBlob(
        nonce=blob.nonce,
        ciphertext=blob.ciphertext[:-1] + bytes([(blob.ciphertext[-1] ^ 0x01)]),
        wrapped_dek=blob.wrapped_dek,
        wrap_nonce=blob.wrap_nonce,
        key_version=blob.key_version,
    )
    with pytest.raises(VaultCryptoError):
        open(master_key, tampered)


@pytest.mark.unit
def test_seal_rejects_bad_master_key_length() -> None:
    with pytest.raises(ValueError, match="32 bytes"):
        seal(b"short", b"x", key_version=1)


@pytest.mark.unit
def test_open_rejects_bad_master_key_length() -> None:
    master_key = os.urandom(32)
    blob = seal(master_key, b"secret", key_version=1)
    with pytest.raises(ValueError, match="32 bytes"):
        open(b"short", blob)


@pytest.mark.unit
def test_master_key_from_secret_is_32_bytes_deterministic() -> None:
    a = master_key_from_secret("vault-secret")
    b = master_key_from_secret("vault-secret")
    assert len(a) == 32
    assert a == b
    assert a != master_key_from_secret("other")
