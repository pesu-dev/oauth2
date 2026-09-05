"""In-memory ephemeral store for delegated credentials between login and consent."""

from __future__ import annotations

import secrets
import time
from dataclasses import dataclass
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from src.academy.models import AcademySession


@dataclass(frozen=True)
class PendingCredentials:
    """Academy login material held only until consent Allow seals the vault."""

    username: str
    password: str
    session: AcademySession


class PendingCredentialStore:
    """Process-local TTL map keyed by opaque id (never put password in the cookie).

    Cloud Run caveat: this store does not share state across instances — same
    limitation as ``SlidingWindowRateLimiter``. A login on instance A and consent
    on instance B will miss the pending row; prefer sticky sessions or a shared
    store if that becomes common.
    """

    def __init__(self, *, ttl_seconds: float) -> None:
        self._ttl = ttl_seconds
        self._items: dict[str, tuple[float, PendingCredentials]] = {}

    def put(self, creds: PendingCredentials) -> str:
        """Store credentials and return a random opaque id."""
        self._purge_expired()
        cred_id = secrets.token_urlsafe(24)
        self._items[cred_id] = (time.monotonic() + self._ttl, creds)
        return cred_id

    def get(self, cred_id: str) -> PendingCredentials | None:
        """Return credentials if present and not expired."""
        self._purge_expired()
        item = self._items.get(cred_id)
        if item is None:
            return None
        return item[1]

    def pop(self, cred_id: str) -> PendingCredentials | None:
        """Remove and return credentials (or None if missing/expired)."""
        self._purge_expired()
        item = self._items.pop(cred_id, None)
        if item is None:
            return None
        return item[1]

    def _purge_expired(self) -> None:
        now = time.monotonic()
        expired = [key for key, (exp, _) in self._items.items() if exp <= now]
        for key in expired:
            del self._items[key]
