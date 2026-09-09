"""Envelope encryption for the delegated credential vault."""

from __future__ import annotations

import hashlib
import os
from dataclasses import dataclass

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

_DEK_LEN = 32
_NONCE_LEN = 12


class VaultCryptoError(Exception):
    """Raised when vault ciphertext cannot be opened."""


@dataclass(frozen=True)
class SealedBlob:
    """AES-GCM ciphertext plus master-key-wrapped DEK."""

    nonce: bytes
    ciphertext: bytes
    wrap_nonce: bytes
    wrapped_dek: bytes
    key_version: int


def seal(master_key: bytes, plaintext: bytes, key_version: int) -> SealedBlob:
    """Encrypt ``plaintext`` under a fresh DEK; wrap the DEK with ``master_key``."""
    if len(master_key) != _DEK_LEN:
        msg = "master_key must be 32 bytes"
        raise ValueError(msg)
    dek = os.urandom(_DEK_LEN)
    nonce = os.urandom(_NONCE_LEN)
    ciphertext = AESGCM(dek).encrypt(nonce, plaintext, None)
    wrap_nonce = os.urandom(_NONCE_LEN)
    wrapped_dek = AESGCM(master_key).encrypt(wrap_nonce, dek, None)
    return SealedBlob(
        nonce=nonce,
        ciphertext=ciphertext,
        wrap_nonce=wrap_nonce,
        wrapped_dek=wrapped_dek,
        key_version=key_version,
    )


def open(master_key: bytes, blob: SealedBlob) -> bytes:  # noqa: A001 — matches plan API
    """Decrypt a sealed blob; raises ``VaultCryptoError`` on auth failure."""
    if len(master_key) != _DEK_LEN:
        msg = "master_key must be 32 bytes"
        raise ValueError(msg)
    try:
        dek = AESGCM(master_key).decrypt(blob.wrap_nonce, blob.wrapped_dek, None)
        return AESGCM(dek).decrypt(blob.nonce, blob.ciphertext, None)
    except InvalidTag as exc:
        raise VaultCryptoError("failed to open sealed blob") from exc


def master_key_from_secret(secret: str) -> bytes:
    """Derive a 32-byte AES key from the configured vault secret string."""
    return hashlib.sha256(secret.encode("utf-8")).digest()
