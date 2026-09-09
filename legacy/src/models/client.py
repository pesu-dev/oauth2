"""Domain model for OAuth clients."""

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from datetime import datetime


class PublishingStatus(StrEnum):
    """Client publishing gate (Testing allowlist vs Production)."""

    TESTING = "testing"
    PENDING_PRODUCTION = "pending_production"
    PRODUCTION = "production"


@dataclass(frozen=True)
class Client:
    """Registered OAuth / OIDC client application."""

    client_id: str
    client_secret_hash: str | None
    name: str
    owner_sub: str
    redirect_uris: tuple[str, ...]
    token_endpoint_auth_method: str
    publishing_status: PublishingStatus
    delegated_allowed: bool
    created_at: datetime
    updated_at: datetime
