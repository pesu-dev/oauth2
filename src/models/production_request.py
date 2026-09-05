"""Domain model for Production publishing requests."""

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from datetime import datetime


class ProductionRequestStatus(StrEnum):
    """Lifecycle of an admin Production review request."""

    PENDING = "pending"
    APPROVED = "approved"
    REJECTED = "rejected"


@dataclass(frozen=True)
class ProductionRequest:
    """Admin-queue row for Testing → Production."""

    request_id: str
    client_id: str
    requested_by_sub: str
    status: ProductionRequestStatus
    delegated_requested: bool
    created_at: datetime
    resolved_at: datetime | None
    resolved_by_sub: str | None
