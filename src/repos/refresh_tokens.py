"""Refresh token repository protocol and Mongo implementation."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import TYPE_CHECKING, Protocol

from pymongo import ReturnDocument
from pymongo.errors import DuplicateKeyError

if TYPE_CHECKING:
    from pymongo.asynchronous.database import AsyncDatabase

    from src.models.refresh_token import RefreshToken


class RefreshTokenRepo(Protocol):
    """Opaque refresh tokens with rotation and reuse detection."""

    async def store_refresh(self, token: RefreshToken) -> None:
        """Insert a new refresh token hash row."""
        ...

    async def rotate_refresh(self, old_token_hash: str, new_token: RefreshToken) -> RefreshToken | None:
        """Rotate a valid token; on reuse of a revoked hash, revoke the family and return None."""
        ...


class MongoRefreshTokenRepo:
    """MongoDB-backed RefreshTokenRepo (`refresh_tokens` collection)."""

    def __init__(self, db: AsyncDatabase) -> None:
        self._tokens = db.refresh_tokens

    async def store_refresh(self, token: RefreshToken) -> None:
        """Insert the refresh token document."""
        await self._tokens.insert_one(_token_doc(token))

    async def rotate_refresh(self, old_token_hash: str, new_token: RefreshToken) -> RefreshToken | None:
        """Atomically claim the presented token, then insert its successor.

        Concurrent rotates of the same hash: only one ``find_one_and_update`` wins.
        Presenting a hash whose successor is already live revokes the whole family.
        """
        now = datetime.now(UTC)
        claimed = await self._tokens.find_one_and_update(
            {
                "token_hash": old_token_hash,
                "revoked_at": None,
                "expires_at": {"$gt": now},
            },
            {
                "$set": {
                    "revoked_at": now,
                    "successor_hash": new_token.token_hash,
                }
            },
            return_document=ReturnDocument.BEFORE,
        )
        if claimed is None:
            await self._handle_failed_claim(old_token_hash, now)
            return None

        family_id = str(claimed["family_id"])
        try:
            await self.store_refresh(new_token)
        except DuplicateKeyError:
            await self._revoke_family(family_id, now)
            return None

        live = await self._tokens.count_documents(
            {
                "family_id": family_id,
                "revoked_at": None,
                "expires_at": {"$gt": now},
            }
        )
        if live != 1:
            await self._revoke_family(family_id, now)
            return None
        return new_token

    async def _handle_failed_claim(self, old_token_hash: str, now: datetime) -> None:
        """Reuse detection when the presented hash is already revoked with a live successor."""
        existing = await self._tokens.find_one({"token_hash": old_token_hash})
        if existing is None or existing.get("revoked_at") is None:
            return
        family_id = str(existing["family_id"])
        successor = existing.get("successor_hash")
        if successor is None:
            await self._revoke_family(family_id, now)
            return
        succ_doc = await self._tokens.find_one(
            {
                "token_hash": successor,
                "revoked_at": None,
                "expires_at": {"$gt": now},
            }
        )
        if succ_doc is not None:
            await self._revoke_family(family_id, now)

    async def _revoke_family(self, family_id: str, now: datetime) -> None:
        await self._tokens.update_many(
            {"family_id": family_id, "revoked_at": None},
            {"$set": {"revoked_at": now}},
        )


def _token_doc(token: RefreshToken) -> dict[str, object]:
    return {
        "token_hash": token.token_hash,
        "family_id": token.family_id,
        "client_id": token.client_id,
        "sub": token.sub,
        "scopes": list(token.scopes),
        "expires_at": token.expires_at,
        "created_at": token.created_at,
        "revoked_at": token.revoked_at,
    }
