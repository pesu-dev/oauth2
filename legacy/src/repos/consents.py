"""Consent repository protocol and Mongo implementation."""

from __future__ import annotations

from typing import TYPE_CHECKING, Protocol

from src.models.consent import Consent, ConsentMode

if TYPE_CHECKING:
    from pymongo.asynchronous.database import AsyncDatabase


def _consent_from_doc(doc: dict[str, object]) -> Consent:
    scopes_raw = doc.get("scopes") or ()
    scopes = frozenset(str(s) for s in scopes_raw)  # type: ignore[union-attr]
    return Consent(
        sub=str(doc["sub"]),
        client_id=str(doc["client_id"]),
        scopes=scopes,
        mode=ConsentMode(str(doc["mode"])),
        granted_at=doc["granted_at"],  # type: ignore[arg-type]
    )


class ConsentRepo(Protocol):
    """Per-(sub, client) consent grants."""

    async def get_consent(self, sub: str, client_id: str) -> Consent | None:
        """Return the stored grant or None."""
        ...

    async def upsert_consent(self, consent: Consent) -> Consent:
        """Create or replace the grant for (sub, client_id)."""
        ...

    async def list_consents_for_sub(self, sub: str) -> list[Consent]:
        """Return all grants for ``sub``."""
        ...

    async def delete_consent(self, sub: str, client_id: str) -> bool:
        """Delete the grant for the pair; return True if one existed."""
        ...

    async def delete_all_for_sub(self, sub: str) -> int:
        """Delete every grant for ``sub``; return how many were removed."""
        ...


class MongoConsentRepo:
    """MongoDB-backed ConsentRepo (`consents` collection)."""

    def __init__(self, db: AsyncDatabase) -> None:
        self._consents = db.consents

    async def get_consent(self, sub: str, client_id: str) -> Consent | None:
        """Load consent by compound key."""
        doc = await self._consents.find_one({"sub": sub, "client_id": client_id})
        if doc is None:
            return None
        return _consent_from_doc(doc)

    async def upsert_consent(self, consent: Consent) -> Consent:
        """Upsert scopes/mode/granted_at for the pair."""
        doc = await self._consents.find_one_and_update(
            {"sub": consent.sub, "client_id": consent.client_id},
            {
                "$set": {
                    "scopes": list(consent.scopes),
                    "mode": str(consent.mode),
                    "granted_at": consent.granted_at,
                },
                "$setOnInsert": {
                    "sub": consent.sub,
                    "client_id": consent.client_id,
                },
            },
            upsert=True,
            return_document=True,
        )
        assert doc is not None
        return _consent_from_doc(doc)

    async def list_consents_for_sub(self, sub: str) -> list[Consent]:
        """List all consents for a subject."""
        cursor = self._consents.find({"sub": sub})
        return [_consent_from_doc(doc) async for doc in cursor]

    async def delete_consent(self, sub: str, client_id: str) -> bool:
        """Remove one consent row."""
        result = await self._consents.delete_one({"sub": sub, "client_id": client_id})
        return result.deleted_count > 0

    async def delete_all_for_sub(self, sub: str) -> int:
        """Remove all consents for ``sub``."""
        result = await self._consents.delete_many({"sub": sub})
        return int(result.deleted_count)
