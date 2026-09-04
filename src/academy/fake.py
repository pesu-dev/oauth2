"""In-memory Academy client for unit and integration tests."""

from __future__ import annotations

from src.academy.models import AcademyAuthError, AcademyAuthResult


class FakeAcademyClient:
    """Maps username/password pairs to canned results; unknown creds fail auth."""

    def __init__(self, users: dict[tuple[str, str], AcademyAuthResult]) -> None:
        self._users = dict(users)

    async def login(self, username: str, password: str) -> AcademyAuthResult:
        """Return the canned result or raise AcademyAuthError."""
        result = self._users.get((username, password))
        if result is None:
            raise AcademyAuthError("Invalid username or password")
        return result
