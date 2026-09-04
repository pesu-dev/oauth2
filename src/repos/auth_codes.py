"""Authorization code repository protocol and Mongo implementation."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import TYPE_CHECKING, Protocol

from src.models.authorization_code import AuthorizationCode
from src.models.consent import ConsentMode

if TYPE_CHECKING:
    from pymongo.asynchronous.database import AsyncDatabase


def _code_from_doc(doc: dict[str, object]) -> AuthorizationCode:
    scopes_raw = doc.get("scopes") or ()
    scopes = frozenset(str(s) for s in scopes_raw)  # type: ignore[union-attr]
    nonce_raw = doc.get("nonce")
    return AuthorizationCode(
        code_hash=str(doc["code_hash"]),
        client_id=str(doc["client_id"]),
        sub=str(doc["sub"]),
        redirect_uri=str(doc["redirect_uri"]),
        scopes=scopes,
        code_challenge=str(doc["code_challenge"]),
        code_challenge_method=str(doc["code_challenge_method"]),
        mode=ConsentMode(str(doc["mode"])),
        expires_at=doc["expires_at"],  # type: ignore[arg-type]
        created_at=doc["created_at"],  # type: ignore[arg-type]
        nonce=None if nonce_raw is None else str(nonce_raw),
    )


class AuthCodeRepo(Protocol):
    """One-time authorization code store (hashed)."""

    async def store_code(self, code: AuthorizationCode) -> None:
        """Persist a new authorization code document."""
        ...

    async def consume_code(self, code_hash: str) -> AuthorizationCode | None:
        """Atomically delete and return a non-expired code, or None."""
        ...


class MongoAuthCodeRepo:
    """MongoDB-backed AuthCodeRepo (`authorization_codes` collection)."""

    def __init__(self, db: AsyncDatabase) -> None:
        self._codes = db.authorization_codes

    async def store_code(self, code: AuthorizationCode) -> None:
        """Insert the code document (TTL via ``expires_at`` index)."""
        await self._codes.insert_one(
            {
                "code_hash": code.code_hash,
                "client_id": code.client_id,
                "sub": code.sub,
                "redirect_uri": code.redirect_uri,
                "scopes": list(code.scopes),
                "code_challenge": code.code_challenge,
                "code_challenge_method": code.code_challenge_method,
                "mode": str(code.mode),
                "expires_at": code.expires_at,
                "created_at": code.created_at,
                "nonce": code.nonce,
            }
        )

    async def consume_code(self, code_hash: str) -> AuthorizationCode | None:
        """Find-and-delete; reject if missing or past ``expires_at``."""
        doc = await self._codes.find_one_and_delete({"code_hash": code_hash})
        if doc is None:
            return None
        code = _code_from_doc(doc)
        expires = code.expires_at
        if expires.tzinfo is None:
            expires = expires.replace(tzinfo=UTC)
        if expires <= datetime.now(UTC):
            return None
        return code
