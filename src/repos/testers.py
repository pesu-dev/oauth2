"""Tester allowlist repository protocol and Mongo implementation."""

from __future__ import annotations

from typing import TYPE_CHECKING, Protocol

if TYPE_CHECKING:
    from pymongo.asynchronous.database import AsyncDatabase


class TesterRepo(Protocol):
    """Testing-mode allowlist for (client_id, sub) pairs."""

    async def is_tester(self, client_id: str, sub: str) -> bool:
        """Return True if ``sub`` is on the tester list for ``client_id``."""
        ...

    async def add_tester(self, client_id: str, sub: str) -> None:
        """Idempotently add a tester row."""
        ...


class MongoTesterRepo:
    """MongoDB-backed TesterRepo (`client_testers` collection)."""

    def __init__(self, db: AsyncDatabase) -> None:
        self._testers = db.client_testers

    async def is_tester(self, client_id: str, sub: str) -> bool:
        """Check allowlist membership."""
        doc = await self._testers.find_one({"client_id": client_id, "sub": sub})
        return doc is not None

    async def add_tester(self, client_id: str, sub: str) -> None:
        """Upsert a tester row (unique on client_id + sub)."""
        await self._testers.update_one(
            {"client_id": client_id, "sub": sub},
            {"$setOnInsert": {"client_id": client_id, "sub": sub}},
            upsert=True,
        )
