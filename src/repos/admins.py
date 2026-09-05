"""Admin roster repository protocol and Mongo implementation."""

from __future__ import annotations

from typing import TYPE_CHECKING, Protocol

if TYPE_CHECKING:
    from pymongo.asynchronous.database import AsyncDatabase


class AdminRepo(Protocol):
    """Persistence for authorization-server admins (by ``sub``)."""

    async def is_admin(self, sub: str) -> bool:
        """Return True if ``sub`` is in the ``admins`` collection."""
        ...

    async def add_admin(self, sub: str) -> None:
        """Idempotently insert an admin row for ``sub``."""
        ...


class MongoAdminRepo:
    """MongoDB-backed AdminRepo (`admins` collection)."""

    def __init__(self, db: AsyncDatabase) -> None:
        self._admins = db.admins

    async def is_admin(self, sub: str) -> bool:
        """Check admin membership."""
        doc = await self._admins.find_one({"sub": sub})
        return doc is not None

    async def add_admin(self, sub: str) -> None:
        """Upsert an admin row (unique on ``sub``)."""
        await self._admins.update_one(
            {"sub": sub},
            {"$setOnInsert": {"sub": sub}},
            upsert=True,
        )
