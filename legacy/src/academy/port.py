"""Academy authentication port (Protocol)."""

from __future__ import annotations

from typing import TYPE_CHECKING, Protocol

if TYPE_CHECKING:
    from src.academy.models import AcademyAuthResult


class AcademyClient(Protocol):
    """Async port for PESU Academy mobile login."""

    async def login(self, username: str, password: str) -> AcademyAuthResult:
        """Authenticate with Academy credentials and return profile + session."""
        ...
