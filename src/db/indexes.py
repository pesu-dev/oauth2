"""MongoDB index definitions for the oauth2 database."""

from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from pymongo.asynchronous.database import AsyncDatabase


async def ensure_indexes(db: AsyncDatabase) -> None:
    """Create required unique / TTL indexes (idempotent).

    Authorization code TTL is enforced by ``expires_at`` on each document
    (``expireAfterSeconds=0``); writers set expiry to now + ~10 minutes.
    """
    await db.users.create_index("sub", unique=True)
    await db.clients.create_index("client_id", unique=True)
    await db.client_testers.create_index([("client_id", 1), ("sub", 1)], unique=True)
    await db.consents.create_index([("sub", 1), ("client_id", 1)], unique=True)
    await db.vault.create_index("sub", unique=True)
    await db.authorization_codes.create_index("expires_at", expireAfterSeconds=0)
    await db.refresh_tokens.create_index("token_hash", unique=True)
    await db.admins.create_index("sub", unique=True)
