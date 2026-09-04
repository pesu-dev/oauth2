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
