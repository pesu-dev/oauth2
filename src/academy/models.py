"""Domain models for PESU Academy authentication."""

from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from datetime import datetime


class AcademyAuthError(Exception):
    """Raised when Academy login fails (bad credentials or server/transport errors)."""


@dataclass(frozen=True)
class AcademyProfile:
    """Mapped student profile fields used by the authorization server."""

    name: str
    prn: str | None
    srn: str | None
    program: str | None
    branch: str | None
    semester: str | None
    section: str | None
    campus: str | None
    email: str | None = None
    phone: str | None = None


@dataclass(frozen=True)
class AcademySession:
    """Mobile session material retained for delegated vault / token exchange."""

    token: str
    access_token: str | None = None
    user_id: str | None = None
    expires_at: datetime | None = None


@dataclass(frozen=True)
class AcademyAuthResult:
    """Successful Academy authentication outcome."""

    profile: AcademyProfile
    session: AcademySession
