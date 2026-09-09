"""Domain model for refresh tokens."""

from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from datetime import datetime


@dataclass(frozen=True)
class RefreshToken:
    """Opaque refresh token row (SHA-256 hash only; rotation family)."""

    token_hash: str
    family_id: str
    client_id: str
    sub: str
    scopes: frozenset[str]
    expires_at: datetime
    created_at: datetime
    revoked_at: datetime | None = None
