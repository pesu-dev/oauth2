"""In-memory repository fakes for unit tests."""

from __future__ import annotations

import asyncio
from datetime import UTC, datetime
from typing import TYPE_CHECKING

from pymongo.errors import DuplicateKeyError

from src.crypto.ids import new_sub
from src.models.production_request import ProductionRequest, ProductionRequestStatus
from src.models.refresh_token import RefreshToken
from src.models.user import User

if TYPE_CHECKING:
    from src.academy.models import AcademyProfile
    from src.models.authorization_code import AuthorizationCode
    from src.models.client import Client
    from src.models.consent import Consent
    from src.models.vault import VaultEntry


class FakeUserRepo:
    """In-memory UserRepo with optional tombstone helper for tests."""

    def __init__(self) -> None:
        self._by_sub: dict[str, User] = {}

    async def get_user(self, sub: str) -> User | None:
        """Return a non-deleted user by ``sub``, or None."""
        user = self._by_sub.get(sub)
        if user is None or user.deleted_at is not None:
            return None
        return user

    async def upsert_user_from_profile(self, profile: AcademyProfile) -> User:
        """Match active users by PRN; allocate ``new_sub`` otherwise."""
        now = datetime.now(UTC)
        if profile.prn is not None:
            for user in self._by_sub.values():
                if user.prn == profile.prn and user.deleted_at is None:
                    updated = User(
                        sub=user.sub,
                        name=profile.name,
                        prn=profile.prn,
                        srn=profile.srn,
                        program=profile.program,
                        branch=profile.branch,
                        semester=profile.semester,
                        section=profile.section,
                        campus=profile.campus,
                        email=profile.email,
                        phone=profile.phone,
                        created_at=user.created_at,
                        last_login_at=now,
                        deleted_at=None,
                    )
                    self._by_sub[user.sub] = updated
                    return updated

        sub = new_sub()
        created = User(
            sub=sub,
            name=profile.name,
            prn=profile.prn,
            srn=profile.srn,
            program=profile.program,
            branch=profile.branch,
            semester=profile.semester,
            section=profile.section,
            campus=profile.campus,
            email=profile.email,
            phone=profile.phone,
            created_at=now,
            last_login_at=now,
            deleted_at=None,
        )
        self._by_sub[sub] = created
        return created

    async def tombstone(self, sub: str) -> None:
        """Mark a user deleted so their ``sub`` is never reused."""
        user = self._by_sub[sub]
        self._by_sub[sub] = User(
            sub=user.sub,
            name=user.name,
            prn=user.prn,
            srn=user.srn,
            program=user.program,
            branch=user.branch,
            semester=user.semester,
            section=user.section,
            campus=user.campus,
            email=user.email,
            phone=user.phone,
            created_at=user.created_at,
            last_login_at=user.last_login_at,
            deleted_at=datetime.now(UTC),
        )


class FakeClientRepo:
    """In-memory ClientRepo."""

    def __init__(self) -> None:
        self._by_id: dict[str, Client] = {}

    async def get_client(self, client_id: str) -> Client | None:
        """Return the client or None."""
        return self._by_id.get(client_id)

    async def create_client(self, client: Client) -> Client:
        """Insert or raise DuplicateKeyError if ``client_id`` exists."""
        if client.client_id in self._by_id:
            raise DuplicateKeyError("client_id")
        self._by_id[client.client_id] = client
        return client

    async def list_clients_by_owner(self, owner_sub: str) -> list[Client]:
        """Clients for owner, newest first."""
        owned = [c for c in self._by_id.values() if c.owner_sub == owner_sub]
        return sorted(owned, key=lambda c: c.created_at, reverse=True)

    async def update_client(self, client: Client) -> Client:
        """Replace an existing client row."""
        if client.client_id not in self._by_id:
            raise KeyError(client.client_id)
        self._by_id[client.client_id] = client
        return client


class FakeTesterRepo:
    """In-memory TesterRepo."""

    def __init__(self) -> None:
        self._pairs: set[tuple[str, str]] = set()

    async def is_tester(self, client_id: str, sub: str) -> bool:
        """Allowlist membership."""
        return (client_id, sub) in self._pairs

    async def add_tester(self, client_id: str, sub: str) -> None:
        """Idempotent add."""
        self._pairs.add((client_id, sub))

    async def list_testers(self, client_id: str) -> list[str]:
        """Tester subjects for ``client_id``."""
        return sorted(sub for cid, sub in self._pairs if cid == client_id)


class FakeAdminRepo:
    """In-memory AdminRepo."""

    def __init__(self) -> None:
        self._subs: set[str] = set()

    async def is_admin(self, sub: str) -> bool:
        """Admin membership."""
        return sub in self._subs

    async def add_admin(self, sub: str) -> None:
        """Idempotent add."""
        self._subs.add(sub)


class FakeProductionRequestRepo:
    """In-memory ProductionRequestRepo."""

    def __init__(self) -> None:
        self._by_id: dict[str, ProductionRequest] = {}

    async def create_request(self, request: ProductionRequest) -> ProductionRequest:
        """Insert or raise DuplicateKeyError."""
        if request.request_id in self._by_id:
            raise DuplicateKeyError("request_id")
        self._by_id[request.request_id] = request
        return request

    async def get_request(self, request_id: str) -> ProductionRequest | None:
        """Lookup by id."""
        return self._by_id.get(request_id)

    async def list_pending(self) -> list[ProductionRequest]:
        """Pending queue, oldest first."""
        pending = [r for r in self._by_id.values() if r.status == ProductionRequestStatus.PENDING]
        return sorted(pending, key=lambda r: r.created_at)

    async def resolve_request(
        self,
        request_id: str,
        *,
        status: ProductionRequestStatus,
        resolved_by_sub: str,
        resolved_at: object,
    ) -> ProductionRequest | None:
        """Resolve a pending request."""
        current = self._by_id.get(request_id)
        if current is None or current.status != ProductionRequestStatus.PENDING:
            return None
        updated = ProductionRequest(
            request_id=current.request_id,
            client_id=current.client_id,
            requested_by_sub=current.requested_by_sub,
            status=status,
            delegated_requested=current.delegated_requested,
            created_at=current.created_at,
            resolved_at=resolved_at,  # type: ignore[arg-type]
            resolved_by_sub=resolved_by_sub,
        )
        self._by_id[request_id] = updated
        return updated

    async def delete_request(self, request_id: str) -> bool:
        """Delete a pending request (orphan compensation)."""
        current = self._by_id.get(request_id)
        if current is None or current.status != ProductionRequestStatus.PENDING:
            return False
        del self._by_id[request_id]
        return True


class FakeAuthCodeRepo:
    """In-memory AuthCodeRepo."""

    def __init__(self) -> None:
        self._by_hash: dict[str, AuthorizationCode] = {}

    async def store_code(self, code: AuthorizationCode) -> None:
        """Store by code hash."""
        self._by_hash[code.code_hash] = code

    async def consume_code(self, code_hash: str) -> AuthorizationCode | None:
        """One-time consume; reject expired."""
        code = self._by_hash.pop(code_hash, None)
        if code is None:
            return None
        expires = code.expires_at
        if expires.tzinfo is None:
            expires = expires.replace(tzinfo=UTC)
        if expires <= datetime.now(UTC):
            return None
        return code


class FakeRefreshTokenRepo:
    """In-memory RefreshTokenRepo with family revoke on reuse.

    An ``asyncio.Lock`` serializes rotates so concurrent callers cannot leave
    two live tokens in the same family (mirrors Mongo CAS claim semantics).
    """

    def __init__(self) -> None:
        self._by_hash: dict[str, RefreshToken] = {}
        self._successors: dict[str, str] = {}
        self._lock = asyncio.Lock()

    async def store_refresh(self, token: RefreshToken) -> None:
        """Insert token row."""
        async with self._lock:
            if token.token_hash in self._by_hash:
                raise DuplicateKeyError("token_hash")
            self._by_hash[token.token_hash] = token

    async def get_refresh(self, token_hash: str) -> RefreshToken | None:
        """Return the token row for ``token_hash``, or None."""
        return self._by_hash.get(token_hash)

    async def rotate_refresh(self, old_token_hash: str, new_token: RefreshToken) -> RefreshToken | None:
        """Rotate or revoke family on reuse of a revoked token (lock-atomic)."""
        async with self._lock:
            now = datetime.now(UTC)
            old = self._by_hash.get(old_token_hash)
            if old is None:
                return None

            if old.revoked_at is not None:
                successor = self._successors.get(old_token_hash)
                if successor is None:
                    self._revoke_family_unlocked(old.family_id, now)
                else:
                    succ = self._by_hash.get(successor)
                    if succ is not None and succ.revoked_at is None and self._not_expired(succ, now):
                        self._revoke_family_unlocked(old.family_id, now)
                return None

            if not self._not_expired(old, now):
                return None

            self._by_hash[old_token_hash] = RefreshToken(
                token_hash=old.token_hash,
                family_id=old.family_id,
                client_id=old.client_id,
                sub=old.sub,
                scopes=old.scopes,
                expires_at=old.expires_at,
                created_at=old.created_at,
                revoked_at=now,
            )
            self._successors[old_token_hash] = new_token.token_hash

            if new_token.token_hash in self._by_hash:
                self._revoke_family_unlocked(old.family_id, now)
                return None
            self._by_hash[new_token.token_hash] = new_token

            live = sum(
                1
                for tok in self._by_hash.values()
                if tok.family_id == old.family_id and tok.revoked_at is None and self._not_expired(tok, now)
            )
            if live != 1:
                self._revoke_family_unlocked(old.family_id, now)
                return None
            return new_token

    @staticmethod
    def _not_expired(token: RefreshToken, now: datetime) -> bool:
        expires = token.expires_at
        if expires.tzinfo is None:
            expires = expires.replace(tzinfo=UTC)
        return expires > now

    def _revoke_family_unlocked(self, family_id: str, now: datetime) -> None:
        for h, tok in list(self._by_hash.items()):
            if tok.family_id == family_id and tok.revoked_at is None:
                self._by_hash[h] = RefreshToken(
                    token_hash=tok.token_hash,
                    family_id=tok.family_id,
                    client_id=tok.client_id,
                    sub=tok.sub,
                    scopes=tok.scopes,
                    expires_at=tok.expires_at,
                    created_at=tok.created_at,
                    revoked_at=now,
                )

    async def revoke_by_hash(self, token_hash: str) -> bool:
        """Revoke a single live token by hash."""
        async with self._lock:
            tok = self._by_hash.get(token_hash)
            if tok is None or tok.revoked_at is not None:
                return False
            now = datetime.now(UTC)
            self._by_hash[token_hash] = RefreshToken(
                token_hash=tok.token_hash,
                family_id=tok.family_id,
                client_id=tok.client_id,
                sub=tok.sub,
                scopes=tok.scopes,
                expires_at=tok.expires_at,
                created_at=tok.created_at,
                revoked_at=now,
            )
            return True

    async def revoke_for_subject_client(self, sub: str, client_id: str) -> int:
        """Revoke live tokens for one app grant."""
        async with self._lock:
            now = datetime.now(UTC)
            count = 0
            for h, tok in list(self._by_hash.items()):
                if tok.sub == sub and tok.client_id == client_id and tok.revoked_at is None:
                    self._by_hash[h] = RefreshToken(
                        token_hash=tok.token_hash,
                        family_id=tok.family_id,
                        client_id=tok.client_id,
                        sub=tok.sub,
                        scopes=tok.scopes,
                        expires_at=tok.expires_at,
                        created_at=tok.created_at,
                        revoked_at=now,
                    )
                    count += 1
            return count

    async def revoke_all_for_subject(self, sub: str) -> int:
        """Revoke every live refresh token for the subject."""
        async with self._lock:
            now = datetime.now(UTC)
            count = 0
            for h, tok in list(self._by_hash.items()):
                if tok.sub == sub and tok.revoked_at is None:
                    self._by_hash[h] = RefreshToken(
                        token_hash=tok.token_hash,
                        family_id=tok.family_id,
                        client_id=tok.client_id,
                        sub=tok.sub,
                        scopes=tok.scopes,
                        expires_at=tok.expires_at,
                        created_at=tok.created_at,
                        revoked_at=now,
                    )
                    count += 1
            return count


class FakeConsentRepo:
    """In-memory ConsentRepo."""

    def __init__(self) -> None:
        self._by_pair: dict[tuple[str, str], Consent] = {}

    async def get_consent(self, sub: str, client_id: str) -> Consent | None:
        """Lookup by pair."""
        return self._by_pair.get((sub, client_id))

    async def upsert_consent(self, consent: Consent) -> Consent:
        """Replace grant for the pair."""
        self._by_pair[(consent.sub, consent.client_id)] = consent
        return consent

    async def list_consents_for_sub(self, sub: str) -> list[Consent]:
        """Return all grants for ``sub``."""
        return [c for (s, _), c in self._by_pair.items() if s == sub]

    async def delete_consent(self, sub: str, client_id: str) -> bool:
        """Delete one grant."""
        return self._by_pair.pop((sub, client_id), None) is not None

    async def delete_all_for_sub(self, sub: str) -> int:
        """Delete all grants for ``sub``."""
        keys = [k for k in self._by_pair if k[0] == sub]
        for key in keys:
            del self._by_pair[key]
        return len(keys)


class FakeVaultRepo:
    """In-memory VaultRepo."""

    def __init__(self) -> None:
        self._by_sub: dict[str, VaultEntry] = {}

    async def get_vault(self, sub: str) -> VaultEntry | None:
        """Lookup by subject."""
        return self._by_sub.get(sub)

    async def upsert_vault(self, entry: VaultEntry) -> VaultEntry:
        """Replace vault row for subject."""
        self._by_sub[entry.sub] = entry
        return entry

    async def delete_vault(self, sub: str) -> bool:
        """Remove vault row if present."""
        if sub not in self._by_sub:
            return False
        del self._by_sub[sub]
        return True
