"""In-memory repository fakes for unit tests."""

from __future__ import annotations

import asyncio
from datetime import UTC, datetime
from typing import TYPE_CHECKING

from pymongo.errors import DuplicateKeyError

from src.crypto.ids import new_sub
from src.models.refresh_token import RefreshToken
from src.models.user import User

if TYPE_CHECKING:
    from src.academy.models import AcademyProfile
    from src.models.authorization_code import AuthorizationCode
    from src.models.client import Client
    from src.models.consent import Consent


class FakeUserRepo:
    """In-memory UserRepo with optional tombstone helper for tests."""

    def __init__(self) -> None:
        self._by_sub: dict[str, User] = {}

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
