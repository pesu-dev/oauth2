"""Production-request queue repository protocol and Mongo implementation."""

from __future__ import annotations

from typing import TYPE_CHECKING, Protocol

from pymongo import ReturnDocument

from src.models.production_request import ProductionRequest, ProductionRequestStatus

if TYPE_CHECKING:
    from pymongo.asynchronous.database import AsyncDatabase


def _request_from_doc(doc: dict[str, object]) -> ProductionRequest:
    return ProductionRequest(
        request_id=str(doc["request_id"]),
        client_id=str(doc["client_id"]),
        requested_by_sub=str(doc["requested_by_sub"]),
        status=ProductionRequestStatus(str(doc["status"])),
        delegated_requested=bool(doc["delegated_requested"]),
        created_at=doc["created_at"],  # type: ignore[arg-type]
        resolved_at=doc.get("resolved_at"),  # type: ignore[arg-type]
        resolved_by_sub=None if doc.get("resolved_by_sub") is None else str(doc["resolved_by_sub"]),
    )


class ProductionRequestRepo(Protocol):
    """Persistence for the admin Production queue."""

    async def create_request(self, request: ProductionRequest) -> ProductionRequest:
        """Insert a new queue row."""
        ...

    async def get_request(self, request_id: str) -> ProductionRequest | None:
        """Load by ``request_id``."""
        ...

    async def list_pending(self) -> list[ProductionRequest]:
        """Return pending requests, oldest first."""
        ...

    async def resolve_request(
        self,
        request_id: str,
        *,
        status: ProductionRequestStatus,
        resolved_by_sub: str,
        resolved_at: object,
    ) -> ProductionRequest | None:
        """Mark a pending request approved or rejected; return updated row or None."""
        ...

    async def delete_request(self, request_id: str) -> bool:
        """Delete a pending request by id (compensation); return True if deleted."""
        ...


class MongoProductionRequestRepo:
    """MongoDB-backed ProductionRequestRepo (`production_requests` collection)."""

    def __init__(self, db: AsyncDatabase) -> None:
        self._requests = db.production_requests

    async def create_request(self, request: ProductionRequest) -> ProductionRequest:
        """Insert ``request``."""
        await self._requests.insert_one(
            {
                "request_id": request.request_id,
                "client_id": request.client_id,
                "requested_by_sub": request.requested_by_sub,
                "status": str(request.status),
                "delegated_requested": request.delegated_requested,
                "created_at": request.created_at,
                "resolved_at": request.resolved_at,
                "resolved_by_sub": request.resolved_by_sub,
            }
        )
        return request

    async def get_request(self, request_id: str) -> ProductionRequest | None:
        """Load by ``request_id``."""
        doc = await self._requests.find_one({"request_id": request_id})
        if doc is None:
            return None
        return _request_from_doc(doc)

    async def list_pending(self) -> list[ProductionRequest]:
        """Pending queue, oldest first."""
        cursor = self._requests.find({"status": ProductionRequestStatus.PENDING.value}).sort("created_at", 1)
        return [_request_from_doc(doc) async for doc in cursor]

    async def resolve_request(
        self,
        request_id: str,
        *,
        status: ProductionRequestStatus,
        resolved_by_sub: str,
        resolved_at: object,
    ) -> ProductionRequest | None:
        """CAS-resolve a pending request."""
        if status not in {ProductionRequestStatus.APPROVED, ProductionRequestStatus.REJECTED}:
            msg = "resolve status must be approved or rejected"
            raise ValueError(msg)
        doc = await self._requests.find_one_and_update(
            {"request_id": request_id, "status": ProductionRequestStatus.PENDING.value},
            {
                "$set": {
                    "status": str(status),
                    "resolved_by_sub": resolved_by_sub,
                    "resolved_at": resolved_at,
                }
            },
            return_document=ReturnDocument.AFTER,
        )
        if doc is None:
            return None
        return _request_from_doc(doc)

    async def delete_request(self, request_id: str) -> bool:
        """Delete a pending request (orphan compensation)."""
        result = await self._requests.delete_one(
            {"request_id": request_id, "status": ProductionRequestStatus.PENDING.value}
        )
        return result.deleted_count == 1
