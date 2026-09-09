"""Vault repository protocol and Mongo implementation."""

from __future__ import annotations

from typing import TYPE_CHECKING, Protocol

from src.crypto.vault_crypto import SealedBlob
from src.models.vault import VaultEntry

if TYPE_CHECKING:
    from pymongo.asynchronous.database import AsyncDatabase


def _entry_from_doc(doc: dict[str, object]) -> VaultEntry:
    return VaultEntry(
        sub=str(doc["sub"]),
        blob=SealedBlob(
            nonce=bytes(doc["nonce"]),  # type: ignore[arg-type]
            ciphertext=bytes(doc["ciphertext"]),  # type: ignore[arg-type]
            wrap_nonce=bytes(doc["wrap_nonce"]),  # type: ignore[arg-type]
            wrapped_dek=bytes(doc["wrapped_dek"]),  # type: ignore[arg-type]
            key_version=int(doc["key_version"]),  # type: ignore[arg-type]
        ),
        session_expires_at=doc.get("session_expires_at"),  # type: ignore[arg-type]
    )


class VaultRepo(Protocol):
    """Encrypted credential vault keyed by ``sub``."""

    async def get_vault(self, sub: str) -> VaultEntry | None:
        """Return the vault row for ``sub``, or None."""
        ...

    async def upsert_vault(self, entry: VaultEntry) -> VaultEntry:
        """Create or replace the vault row for ``entry.sub``."""
        ...

    async def delete_vault(self, sub: str) -> bool:
        """Delete the vault row; return True if one existed."""
        ...


class MongoVaultRepo:
    """MongoDB-backed VaultRepo (``vault`` collection)."""

    def __init__(self, db: AsyncDatabase) -> None:
        self._vault = db.vault

    async def get_vault(self, sub: str) -> VaultEntry | None:
        """Load vault by subject."""
        doc = await self._vault.find_one({"sub": sub})
        if doc is None:
            return None
        return _entry_from_doc(doc)

    async def upsert_vault(self, entry: VaultEntry) -> VaultEntry:
        """Upsert sealed blob and session expiry for ``sub``."""
        blob = entry.blob
        doc = await self._vault.find_one_and_update(
            {"sub": entry.sub},
            {
                "$set": {
                    "nonce": blob.nonce,
                    "ciphertext": blob.ciphertext,
                    "wrap_nonce": blob.wrap_nonce,
                    "wrapped_dek": blob.wrapped_dek,
                    "key_version": blob.key_version,
                    "session_expires_at": entry.session_expires_at,
                },
                "$setOnInsert": {"sub": entry.sub},
            },
            upsert=True,
            return_document=True,
        )
        assert doc is not None
        return _entry_from_doc(doc)

    async def delete_vault(self, sub: str) -> bool:
        """Remove vault row if present."""
        result = await self._vault.delete_one({"sub": sub})
        return result.deleted_count > 0
