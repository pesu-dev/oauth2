"""Hashing helpers for auth codes, refresh tokens, and secrets."""

from __future__ import annotations

import hashlib


def sha256_hex(value: str) -> str:
    """Return the lowercase hex SHA-256 digest of ``value`` (UTF-8)."""
    return hashlib.sha256(value.encode("utf-8")).hexdigest()
