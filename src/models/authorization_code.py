"""Domain model for authorization codes."""

from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from datetime import datetime

    from src.models.consent import ConsentMode


@dataclass(frozen=True)
class AuthorizationCode:
    """One-time authorization code (stored by SHA-256 hash only)."""

    code_hash: str
    client_id: str
    sub: str
    redirect_uri: str
    scopes: frozenset[str]
    code_challenge: str
    code_challenge_method: str
    mode: ConsentMode
    expires_at: datetime
    created_at: datetime
