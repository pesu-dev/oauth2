"""Domain model for delegated credential vault rows."""

from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from datetime import datetime

    from src.crypto.vault_crypto import SealedBlob


@dataclass(frozen=True)
class VaultEntry:
    """Per-subject sealed password + Academy session material."""

    sub: str
    blob: SealedBlob
    session_expires_at: datetime | None
