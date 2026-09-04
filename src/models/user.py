"""Domain model for persisted OIDC users."""

from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from datetime import datetime


@dataclass(frozen=True)
class User:
    """Opaque subject with Academy profile claims and lifecycle timestamps."""

    sub: str
    name: str
    prn: str | None
    srn: str | None
    program: str | None
    branch: str | None
    semester: str | None
    section: str | None
    campus: str | None
    email: str | None
    phone: str | None
    created_at: datetime
    last_login_at: datetime
    deleted_at: datetime | None = None
