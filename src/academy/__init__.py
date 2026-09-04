"""PESU Academy authentication adapter."""

from __future__ import annotations

from src.academy.client import HttpxAcademyClient
from src.academy.fake import FakeAcademyClient
from src.academy.models import (
    AcademyAuthError,
    AcademyAuthResult,
    AcademyProfile,
    AcademySession,
)
from src.academy.port import AcademyClient

__all__ = [
    "AcademyAuthError",
    "AcademyAuthResult",
    "AcademyClient",
    "AcademyProfile",
    "AcademySession",
    "FakeAcademyClient",
    "HttpxAcademyClient",
]
