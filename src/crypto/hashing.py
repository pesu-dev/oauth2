"""Hashing helpers for auth codes, refresh tokens, and client secrets."""

from __future__ import annotations

import hashlib

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError, VerifyMismatchError

# OWASP interactive Argon2id baseline; client secrets are high-entropy.
_CLIENT_SECRET_HASHER = PasswordHasher(time_cost=2, memory_cost=19456, parallelism=1)


def sha256_hex(value: str) -> str:
    """Return the lowercase hex SHA-256 digest of ``value`` (UTF-8)."""
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def hash_client_secret(secret: str) -> str:
    """Hash a client secret with Argon2id for storage."""
    return _CLIENT_SECRET_HASHER.hash(secret)


def verify_client_secret(secret: str, stored_hash: str) -> bool:
    """Verify ``secret`` against an Argon2id stored hash."""
    try:
        return _CLIENT_SECRET_HASHER.verify(stored_hash, secret)
    except (VerifyMismatchError, VerificationError, InvalidHashError):
        return False
