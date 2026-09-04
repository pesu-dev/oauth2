"""Integration tests for Mongo repos: unique constraints, TTL field, flows."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import TYPE_CHECKING

import pytest
from pymongo.errors import DuplicateKeyError

from src.academy.models import AcademyProfile
from src.crypto.hashing import sha256_hex
from src.db.indexes import ensure_indexes
from src.models.authorization_code import AuthorizationCode
from src.models.client import Client, PublishingStatus
from src.models.consent import Consent, ConsentMode
from src.models.refresh_token import RefreshToken
from src.repos.auth_codes import MongoAuthCodeRepo
from src.repos.clients import MongoClientRepo
from src.repos.consents import MongoConsentRepo
from src.repos.refresh_tokens import MongoRefreshTokenRepo
from src.repos.testers import MongoTesterRepo
from src.repos.users import MongoUserRepo

if TYPE_CHECKING:
    from pymongo.asynchronous.database import AsyncDatabase


def _profile(*, name: str = "JOHN DOE", prn: str = "PES2202501872") -> AcademyProfile:
    return AcademyProfile(
        name=name,
        prn=prn,
        srn="PES2UG25CS026",
        program="B.Tech.",
        branch="CSE",
        semester="2",
        section="A",
        campus="RR",
        email="john@example.com",
        phone="9876543210",
    )


def _client(client_id: str = "cli_test") -> Client:
    now = datetime.now(UTC)
    return Client(
        client_id=client_id,
        client_secret_hash=sha256_hex("secret"),
        name="Test App",
        owner_sub="usr_owner",
        redirect_uris=("https://app.example/cb",),
        token_endpoint_auth_method="client_secret_post",
        publishing_status=PublishingStatus.TESTING,
        delegated_allowed=False,
        created_at=now,
        updated_at=now,
    )


@pytest.mark.integration
@pytest.mark.asyncio
async def test_users_upsert_and_sub_unique(mongo_db: AsyncDatabase) -> None:
    await ensure_indexes(mongo_db)
    repo = MongoUserRepo(mongo_db)
    first = await repo.upsert_user_from_profile(_profile())
    second = await repo.upsert_user_from_profile(_profile(name="JANE DOE"))
    assert first.sub == second.sub
    assert second.name == "JANE DOE"

    await mongo_db.users.insert_one(
        {
            "sub": "usr_collision",
            "name": "X",
            "prn": "OTHER",
            "srn": None,
            "program": None,
            "branch": None,
            "semester": None,
            "section": None,
            "campus": None,
            "email": None,
            "phone": None,
            "created_at": datetime.now(UTC),
            "last_login_at": datetime.now(UTC),
            "deleted_at": None,
        }
    )
    with pytest.raises(DuplicateKeyError):
        await mongo_db.users.insert_one(
            {
                "sub": "usr_collision",
                "name": "Y",
                "prn": "OTHER2",
                "srn": None,
                "program": None,
                "branch": None,
                "semester": None,
                "section": None,
                "campus": None,
                "email": None,
                "phone": None,
                "created_at": datetime.now(UTC),
                "last_login_at": datetime.now(UTC),
                "deleted_at": None,
            }
        )


@pytest.mark.integration
@pytest.mark.asyncio
async def test_clients_and_testers_unique(mongo_db: AsyncDatabase) -> None:
    await ensure_indexes(mongo_db)
    clients = MongoClientRepo(mongo_db)
    testers = MongoTesterRepo(mongo_db)
    await clients.create_client(_client())
    with pytest.raises(DuplicateKeyError):
        await clients.create_client(_client())

    await testers.add_tester("cli_test", "usr_a")
    assert await testers.is_tester("cli_test", "usr_a") is True
    # second add is idempotent via upsert
    await testers.add_tester("cli_test", "usr_a")
    with pytest.raises(DuplicateKeyError):
        await mongo_db.client_testers.insert_one({"client_id": "cli_test", "sub": "usr_a"})


@pytest.mark.integration
@pytest.mark.asyncio
async def test_auth_code_ttl_field_and_consume(mongo_db: AsyncDatabase) -> None:
    await ensure_indexes(mongo_db)
    indexes = await mongo_db.authorization_codes.index_information()
    ttl = [
        v
        for v in indexes.values()
        if v.get("expireAfterSeconds") == 0 and any(k[0] == "expires_at" for k in v.get("key", []))
    ]
    assert ttl, "expected TTL index on authorization_codes.expires_at"

    repo = MongoAuthCodeRepo(mongo_db)
    now = datetime.now(UTC)
    code = AuthorizationCode(
        code_hash=sha256_hex("raw-code"),
        client_id="cli_test",
        sub="usr_abc",
        redirect_uri="https://app.example/cb",
        scopes=frozenset({"openid"}),
        code_challenge="challenge",
        code_challenge_method="S256",
        mode=ConsentMode.IDENTITY,
        expires_at=now + timedelta(minutes=10),
        created_at=now,
    )
    await repo.store_code(code)
    stored = await mongo_db.authorization_codes.find_one({"code_hash": code.code_hash})
    assert stored is not None
    assert "expires_at" in stored

    consumed = await repo.consume_code(code.code_hash)
    assert consumed is not None
    assert await repo.consume_code(code.code_hash) is None


@pytest.mark.integration
@pytest.mark.asyncio
async def test_refresh_unique_and_rotate(mongo_db: AsyncDatabase) -> None:
    await ensure_indexes(mongo_db)
    repo = MongoRefreshTokenRepo(mongo_db)
    now = datetime.now(UTC)
    old = RefreshToken(
        token_hash=sha256_hex("refresh-1"),
        family_id="fam_1",
        client_id="cli_test",
        sub="usr_abc",
        scopes=frozenset({"openid", "offline_access"}),
        expires_at=now + timedelta(days=14),
        created_at=now,
        revoked_at=None,
    )
    await repo.store_refresh(old)
    with pytest.raises(DuplicateKeyError):
        await repo.store_refresh(old)

    new = RefreshToken(
        token_hash=sha256_hex("refresh-2"),
        family_id="fam_1",
        client_id="cli_test",
        sub="usr_abc",
        scopes=frozenset({"openid", "offline_access"}),
        expires_at=now + timedelta(days=14),
        created_at=now,
        revoked_at=None,
    )
    rotated = await repo.rotate_refresh(old.token_hash, new)
    assert rotated == new
    assert await repo.rotate_refresh(old.token_hash, new) is None
    live = await mongo_db.refresh_tokens.count_documents({"family_id": "fam_1", "revoked_at": None})
    assert live == 0


@pytest.mark.integration
@pytest.mark.asyncio
async def test_refresh_concurrent_rotates_at_most_one_live(mongo_db: AsyncDatabase) -> None:
    import asyncio

    await ensure_indexes(mongo_db)
    repo = MongoRefreshTokenRepo(mongo_db)
    now = datetime.now(UTC)
    old = RefreshToken(
        token_hash=sha256_hex("refresh-concurrent"),
        family_id="fam_concurrent",
        client_id="cli_test",
        sub="usr_abc",
        scopes=frozenset({"openid", "offline_access"}),
        expires_at=now + timedelta(days=14),
        created_at=now,
        revoked_at=None,
    )
    await repo.store_refresh(old)
    results = await asyncio.gather(
        repo.rotate_refresh(
            old.token_hash,
            RefreshToken(
                token_hash=sha256_hex("refresh-concurrent-a"),
                family_id="fam_concurrent",
                client_id="cli_test",
                sub="usr_abc",
                scopes=frozenset({"openid", "offline_access"}),
                expires_at=now + timedelta(days=14),
                created_at=now,
                revoked_at=None,
            ),
        ),
        repo.rotate_refresh(
            old.token_hash,
            RefreshToken(
                token_hash=sha256_hex("refresh-concurrent-b"),
                family_id="fam_concurrent",
                client_id="cli_test",
                sub="usr_abc",
                scopes=frozenset({"openid", "offline_access"}),
                expires_at=now + timedelta(days=14),
                created_at=now,
                revoked_at=None,
            ),
        ),
    )
    successes = [r for r in results if r is not None]
    assert len(successes) <= 1
    live = await mongo_db.refresh_tokens.count_documents(
        {
            "family_id": "fam_concurrent",
            "revoked_at": None,
            "expires_at": {"$gt": datetime.now(UTC)},
        }
    )
    assert live <= 1
    if len(successes) == 1 and live == 1:
        doc = await mongo_db.refresh_tokens.find_one({"family_id": "fam_concurrent", "revoked_at": None})
        assert doc is not None
        assert successes[0].token_hash == doc["token_hash"]


@pytest.mark.integration
@pytest.mark.asyncio
async def test_consent_unique_upsert(mongo_db: AsyncDatabase) -> None:
    await ensure_indexes(mongo_db)
    repo = MongoConsentRepo(mongo_db)
    now = datetime.now(UTC)
    first = await repo.upsert_consent(
        Consent(
            sub="usr_abc",
            client_id="cli_test",
            scopes=frozenset({"openid"}),
            mode=ConsentMode.IDENTITY,
            granted_at=now,
        )
    )
    second = await repo.upsert_consent(
        Consent(
            sub="usr_abc",
            client_id="cli_test",
            scopes=frozenset({"openid", "profile"}),
            mode=ConsentMode.IDENTITY,
            granted_at=now,
        )
    )
    assert first.sub == second.sub
    assert "profile" in second.scopes
    loaded = await repo.get_consent("usr_abc", "cli_test")
    assert loaded == second
    assert await mongo_db.consents.count_documents({"sub": "usr_abc", "client_id": "cli_test"}) == 1
