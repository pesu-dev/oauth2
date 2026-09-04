"""Client repository protocol and Mongo implementation."""

from __future__ import annotations

from typing import TYPE_CHECKING, Protocol

from src.models.client import Client, PublishingStatus

if TYPE_CHECKING:
    from pymongo.asynchronous.database import AsyncDatabase


def _client_from_doc(doc: dict[str, object]) -> Client:
    uris = doc.get("redirect_uris") or ()
    if isinstance(uris, list):
        redirect_uris = tuple(str(u) for u in uris)
    else:
        redirect_uris = tuple(uris)  # type: ignore[arg-type]
    secret = doc.get("client_secret_hash")
    return Client(
        client_id=str(doc["client_id"]),
        client_secret_hash=None if secret is None else str(secret),
        name=str(doc["name"]),
        owner_sub=str(doc["owner_sub"]),
        redirect_uris=redirect_uris,
        token_endpoint_auth_method=str(doc["token_endpoint_auth_method"]),
        publishing_status=PublishingStatus(str(doc["publishing_status"])),
        delegated_allowed=bool(doc["delegated_allowed"]),
        created_at=doc["created_at"],  # type: ignore[arg-type]
        updated_at=doc["updated_at"],  # type: ignore[arg-type]
    )


class ClientRepo(Protocol):
    """Persistence for registered OAuth clients."""

    async def get_client(self, client_id: str) -> Client | None:
        """Return the client or None if unknown."""
        ...

    async def create_client(self, client: Client) -> Client:
        """Insert a new client document."""
        ...


class MongoClientRepo:
    """MongoDB-backed ClientRepo (`clients` collection)."""

    def __init__(self, db: AsyncDatabase) -> None:
        self._clients = db.clients

    async def get_client(self, client_id: str) -> Client | None:
        """Load a client by ``client_id``."""
        doc = await self._clients.find_one({"client_id": client_id})
        if doc is None:
            return None
        return _client_from_doc(doc)

    async def create_client(self, client: Client) -> Client:
        """Insert ``client``; relies on unique index on ``client_id``."""
        await self._clients.insert_one(
            {
                "client_id": client.client_id,
                "client_secret_hash": client.client_secret_hash,
                "name": client.name,
                "owner_sub": client.owner_sub,
                "redirect_uris": list(client.redirect_uris),
                "token_endpoint_auth_method": client.token_endpoint_auth_method,
                "publishing_status": str(client.publishing_status),
                "delegated_allowed": client.delegated_allowed,
                "created_at": client.created_at,
                "updated_at": client.updated_at,
            }
        )
        return client
