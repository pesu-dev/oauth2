"""Domain model for consent grants."""

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from datetime import datetime


class ConsentMode(StrEnum):
    """Whether the grant stores Academy credentials (delegated) or not."""

    IDENTITY = "identity"
    DELEGATED = "delegated"


@dataclass(frozen=True)
class Consent:
    """Per-(sub, client) consent grant with scopes and mode."""

    sub: str
    client_id: str
    scopes: frozenset[str]
    mode: ConsentMode
    granted_at: datetime
