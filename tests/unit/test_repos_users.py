"""Unit tests for OIDC persistence repos (in-memory fakes + mocked Mongo)."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock, MagicMock

import pytest
from pymongo.errors import DuplicateKeyError

from src.academy.models import AcademyProfile
from src.crypto.hashing import sha256_hex
from src.crypto.ids import new_sub
from src.models.authorization_code import AuthorizationCode
from src.models.client import Client, PublishingStatus
from src.models.consent import Consent, ConsentMode
from src.models.refresh_token import RefreshToken
from src.models.user import User
from src.repos.auth_codes import MongoAuthCodeRepo
from src.repos.clients import MongoClientRepo
from src.repos.consents import MongoConsentRepo
from src.repos.fakes import (
    FakeAuthCodeRepo,
    FakeClientRepo,
    FakeConsentRepo,
    FakeRefreshTokenRepo,
    FakeTesterRepo,
    FakeUserRepo,
)
from src.repos.refresh_tokens import MongoRefreshTokenRepo
from src.repos.testers import MongoTesterRepo
from src.repos.users import MongoUserRepo


def _profile(**overrides: object) -> AcademyProfile:
    base: dict[str, object] = {
        "name": "JOHN DOE",
        "prn": "PES2202501872",
        "srn": "PES2UG25CS026",
        "program": "B.Tech.",
        "branch": "CSE",
        "semester": "2",
        "section": "A",
        "campus": "RR",
        "email": "john@example.com",
        "phone": "9876543210",
    }
    base.update(overrides)
    return AcademyProfile(**base)  # type: ignore[arg-type]


def _client(**overrides: object) -> Client:
    now = datetime.now(UTC)
    base: dict[str, object] = {
        "client_id": "cli_test",
        "client_secret_hash": sha256_hex("secret"),
        "name": "Test App",
        "owner_sub": "usr_owner",
        "redirect_uris": ("https://app.example/cb",),
        "token_endpoint_auth_method": "client_secret_post",
        "publishing_status": PublishingStatus.TESTING,
        "delegated_allowed": False,
        "created_at": now,
        "updated_at": now,
    }
    base.update(overrides)
    return Client(**base)  # type: ignore[arg-type]


def _auth_code(**overrides: object) -> AuthorizationCode:
    now = datetime.now(UTC)
    base: dict[str, object] = {
        "code_hash": sha256_hex("raw-code"),
        "client_id": "cli_test",
        "sub": "usr_abc",
        "redirect_uri": "https://app.example/cb",
        "scopes": frozenset({"openid", "profile"}),
        "code_challenge": "challenge",
        "code_challenge_method": "S256",
        "mode": ConsentMode.IDENTITY,
        "expires_at": now + timedelta(minutes=10),
        "created_at": now,
    }
    base.update(overrides)
    return AuthorizationCode(**base)  # type: ignore[arg-type]


def _refresh(**overrides: object) -> RefreshToken:
    now = datetime.now(UTC)
    base: dict[str, object] = {
        "token_hash": sha256_hex("refresh-1"),
        "family_id": "fam_1",
        "client_id": "cli_test",
        "sub": "usr_abc",
        "scopes": frozenset({"openid", "offline_access"}),
        "expires_at": now + timedelta(days=14),
        "created_at": now,
        "revoked_at": None,
    }
    base.update(overrides)
    return RefreshToken(**base)  # type: ignore[arg-type]


def _consent(**overrides: object) -> Consent:
    base: dict[str, object] = {
        "sub": "usr_abc",
        "client_id": "cli_test",
        "scopes": frozenset({"openid", "profile"}),
        "mode": ConsentMode.IDENTITY,
        "granted_at": datetime.now(UTC),
    }
    base.update(overrides)
    return Consent(**base)  # type: ignore[arg-type]


# ---------------------------------------------------------------------------
# Fake repos (unit)
# ---------------------------------------------------------------------------


@pytest.mark.unit
@pytest.mark.asyncio
async def test_fake_upsert_user_creates_then_updates_same_sub() -> None:
    repo = FakeUserRepo()
    first = await repo.upsert_user_from_profile(_profile())
    assert first.sub.startswith("usr_")
    assert first.name == "JOHN DOE"
    assert first.deleted_at is None

    second = await repo.upsert_user_from_profile(_profile(name="JANE DOE", email="jane@example.com"))
    assert second.sub == first.sub
    assert second.name == "JANE DOE"
    assert second.email == "jane@example.com"
    assert second.last_login_at >= first.last_login_at


@pytest.mark.unit
@pytest.mark.asyncio
async def test_fake_upsert_ignores_tombstoned_prn_and_allocates_new_sub() -> None:
    repo = FakeUserRepo()
    user = await repo.upsert_user_from_profile(_profile())
    await repo.tombstone(user.sub)

    again = await repo.upsert_user_from_profile(_profile())
    assert again.sub != user.sub


@pytest.mark.unit
@pytest.mark.asyncio
async def test_fake_get_client_and_create() -> None:
    repo = FakeClientRepo()
    assert await repo.get_client("missing") is None
    created = await repo.create_client(_client())
    loaded = await repo.get_client("cli_test")
    assert loaded == created
    assert loaded is not None
    assert loaded.publishing_status == PublishingStatus.TESTING


@pytest.mark.unit
@pytest.mark.asyncio
async def test_fake_is_tester() -> None:
    repo = FakeTesterRepo()
    assert await repo.is_tester("cli_test", "usr_a") is False
    await repo.add_tester("cli_test", "usr_a")
    assert await repo.is_tester("cli_test", "usr_a") is True
    assert await repo.is_tester("cli_other", "usr_a") is False


@pytest.mark.unit
@pytest.mark.asyncio
async def test_fake_store_and_consume_code_once() -> None:
    repo = FakeAuthCodeRepo()
    code = _auth_code()
    await repo.store_code(code)
    consumed = await repo.consume_code(code.code_hash)
    assert consumed == code
    assert await repo.consume_code(code.code_hash) is None


@pytest.mark.unit
@pytest.mark.asyncio
async def test_fake_consume_expired_code_returns_none() -> None:
    repo = FakeAuthCodeRepo()
    expired = _auth_code(expires_at=datetime.now(UTC) - timedelta(seconds=1))
    await repo.store_code(expired)
    assert await repo.consume_code(expired.code_hash) is None


@pytest.mark.unit
@pytest.mark.asyncio
async def test_fake_rotate_refresh_success() -> None:
    repo = FakeRefreshTokenRepo()
    old = _refresh()
    await repo.store_refresh(old)
    new = _refresh(token_hash=sha256_hex("refresh-2"), created_at=datetime.now(UTC))
    rotated = await repo.rotate_refresh(old.token_hash, new)
    assert rotated == new
    # Old hash no longer usable
    assert await repo.rotate_refresh(old.token_hash, _refresh(token_hash=sha256_hex("x"))) is None


@pytest.mark.unit
@pytest.mark.asyncio
async def test_fake_rotate_refresh_reuse_revokes_family() -> None:
    repo = FakeRefreshTokenRepo()
    old = _refresh()
    await repo.store_refresh(old)
    new = _refresh(token_hash=sha256_hex("refresh-2"))
    await repo.rotate_refresh(old.token_hash, new)
    # Presenting the already-rotated (revoked) token triggers family revoke
    assert await repo.rotate_refresh(old.token_hash, _refresh(token_hash=sha256_hex("x"))) is None
    assert await repo.rotate_refresh(new.token_hash, _refresh(token_hash=sha256_hex("y"))) is None


@pytest.mark.unit
@pytest.mark.asyncio
async def test_fake_get_and_upsert_consent() -> None:
    repo = FakeConsentRepo()
    assert await repo.get_consent("usr_abc", "cli_test") is None
    granted = await repo.upsert_consent(_consent())
    assert await repo.get_consent("usr_abc", "cli_test") == granted
    widened = await repo.upsert_consent(
        _consent(scopes=frozenset({"openid", "profile", "email"}), mode=ConsentMode.DELEGATED)
    )
    assert widened.mode == ConsentMode.DELEGATED
    assert "email" in widened.scopes


# ---------------------------------------------------------------------------
# Mongo repos with mocked AsyncDatabase (unit coverage)
# ---------------------------------------------------------------------------


def _mock_db() -> MagicMock:
    db = MagicMock()
    for name in (
        "users",
        "clients",
        "client_testers",
        "authorization_codes",
        "refresh_tokens",
        "consents",
    ):
        coll = AsyncMock()
        setattr(db, name, coll)
    return db


@pytest.mark.unit
@pytest.mark.asyncio
async def test_mongo_upsert_user_inserts_when_missing() -> None:
    db = _mock_db()
    db.users.find_one = AsyncMock(return_value=None)
    db.users.insert_one = AsyncMock()
    repo = MongoUserRepo(db)
    user = await repo.upsert_user_from_profile(_profile())
    assert user.sub.startswith("usr_")
    db.users.insert_one.assert_awaited_once()
    doc = db.users.insert_one.await_args.args[0]
    assert doc["prn"] == "PES2202501872"
    assert doc["deleted_at"] is None


@pytest.mark.unit
@pytest.mark.asyncio
async def test_mongo_upsert_user_updates_existing() -> None:
    db = _mock_db()
    now = datetime.now(UTC)
    existing = {
        "sub": "usr_existing",
        "name": "OLD",
        "prn": "PES2202501872",
        "srn": None,
        "program": None,
        "branch": None,
        "semester": None,
        "section": None,
        "campus": None,
        "email": None,
        "phone": None,
        "created_at": now - timedelta(days=1),
        "last_login_at": now - timedelta(days=1),
        "deleted_at": None,
    }
    db.users.find_one = AsyncMock(return_value=existing)
    db.users.find_one_and_update = AsyncMock(
        return_value={
            **existing,
            "name": "JOHN DOE",
            "email": "john@example.com",
            "last_login_at": now,
        }
    )
    repo = MongoUserRepo(db)
    user = await repo.upsert_user_from_profile(_profile())
    assert user.sub == "usr_existing"
    assert user.name == "JOHN DOE"
    db.users.find_one_and_update.assert_awaited_once()


@pytest.mark.unit
@pytest.mark.asyncio
async def test_mongo_get_client_none_and_found() -> None:
    db = _mock_db()
    db.clients.find_one = AsyncMock(return_value=None)
    repo = MongoClientRepo(db)
    assert await repo.get_client("x") is None

    now = datetime.now(UTC)
    db.clients.find_one = AsyncMock(
        return_value={
            "client_id": "cli_test",
            "client_secret_hash": "abc",
            "name": "Test App",
            "owner_sub": "usr_owner",
            "redirect_uris": ["https://app.example/cb"],
            "token_endpoint_auth_method": "client_secret_post",
            "publishing_status": "testing",
            "delegated_allowed": False,
            "created_at": now,
            "updated_at": now,
        }
    )
    client = await repo.get_client("cli_test")
    assert client is not None
    assert client.redirect_uris == ("https://app.example/cb",)


@pytest.mark.unit
@pytest.mark.asyncio
async def test_mongo_create_client() -> None:
    db = _mock_db()
    db.clients.insert_one = AsyncMock()
    repo = MongoClientRepo(db)
    created = await repo.create_client(_client())
    assert created.client_id == "cli_test"
    db.clients.insert_one.assert_awaited_once()


@pytest.mark.unit
@pytest.mark.asyncio
async def test_mongo_is_tester() -> None:
    db = _mock_db()
    db.client_testers.find_one = AsyncMock(return_value={"client_id": "cli", "sub": "usr"})
    repo = MongoTesterRepo(db)
    assert await repo.is_tester("cli", "usr") is True
    db.client_testers.find_one = AsyncMock(return_value=None)
    assert await repo.is_tester("cli", "usr") is False


@pytest.mark.unit
@pytest.mark.asyncio
async def test_mongo_add_tester() -> None:
    db = _mock_db()
    db.client_testers.update_one = AsyncMock()
    repo = MongoTesterRepo(db)
    await repo.add_tester("cli", "usr")
    db.client_testers.update_one.assert_awaited_once()


@pytest.mark.unit
@pytest.mark.asyncio
async def test_mongo_store_and_consume_code() -> None:
    db = _mock_db()
    db.authorization_codes.insert_one = AsyncMock()
    code = _auth_code()
    repo = MongoAuthCodeRepo(db)
    await repo.store_code(code)
    db.authorization_codes.insert_one.assert_awaited_once()

    now = datetime.now(UTC)
    db.authorization_codes.find_one_and_delete = AsyncMock(
        return_value={
            "code_hash": code.code_hash,
            "client_id": code.client_id,
            "sub": code.sub,
            "redirect_uri": code.redirect_uri,
            "scopes": list(code.scopes),
            "code_challenge": code.code_challenge,
            "code_challenge_method": code.code_challenge_method,
            "mode": "identity",
            "expires_at": now + timedelta(minutes=5),
            "created_at": now,
        }
    )
    consumed = await repo.consume_code(code.code_hash)
    assert consumed is not None
    assert consumed.code_hash == code.code_hash


@pytest.mark.unit
@pytest.mark.asyncio
async def test_mongo_consume_expired_or_missing() -> None:
    db = _mock_db()
    repo = MongoAuthCodeRepo(db)
    db.authorization_codes.find_one_and_delete = AsyncMock(return_value=None)
    assert await repo.consume_code("missing") is None

    past = datetime.now(UTC) - timedelta(minutes=1)
    db.authorization_codes.find_one_and_delete = AsyncMock(
        return_value={
            "code_hash": "h",
            "client_id": "c",
            "sub": "s",
            "redirect_uri": "https://x",
            "scopes": ["openid"],
            "code_challenge": "ch",
            "code_challenge_method": "S256",
            "mode": "identity",
            "expires_at": past,
            "created_at": past,
        }
    )
    assert await repo.consume_code("h") is None


@pytest.mark.unit
@pytest.mark.asyncio
async def test_mongo_store_and_rotate_refresh() -> None:
    db = _mock_db()
    db.refresh_tokens.insert_one = AsyncMock()
    repo = MongoRefreshTokenRepo(db)
    old = _refresh()
    await repo.store_refresh(old)

    now = datetime.now(UTC)
    claimed = {
        "token_hash": old.token_hash,
        "family_id": old.family_id,
        "client_id": old.client_id,
        "sub": old.sub,
        "scopes": list(old.scopes),
        "expires_at": now + timedelta(days=7),
        "created_at": now,
        "revoked_at": None,
    }
    db.refresh_tokens.find_one_and_update = AsyncMock(return_value=claimed)
    db.refresh_tokens.count_documents = AsyncMock(return_value=1)
    new = _refresh(token_hash=sha256_hex("refresh-2"))
    result = await repo.rotate_refresh(old.token_hash, new)
    assert result == new
    db.refresh_tokens.find_one_and_update.assert_awaited_once()
    filter_doc = db.refresh_tokens.find_one_and_update.await_args.args[0]
    assert filter_doc["revoked_at"] is None
    assert "expires_at" in filter_doc
    db.refresh_tokens.insert_one.assert_awaited()


@pytest.mark.unit
@pytest.mark.asyncio
async def test_mongo_rotate_reuse_revokes_family() -> None:
    db = _mock_db()
    repo = MongoRefreshTokenRepo(db)
    now = datetime.now(UTC)
    db.refresh_tokens.find_one_and_update = AsyncMock(return_value=None)
    db.refresh_tokens.find_one = AsyncMock(
        side_effect=[
            {
                "token_hash": "old",
                "family_id": "fam_1",
                "client_id": "cli",
                "sub": "usr",
                "scopes": ["openid"],
                "expires_at": now + timedelta(days=7),
                "created_at": now,
                "revoked_at": now,
                "successor_hash": "live-successor",
            },
            {
                "token_hash": "live-successor",
                "family_id": "fam_1",
                "revoked_at": None,
            },
        ]
    )
    db.refresh_tokens.update_many = AsyncMock()
    assert await repo.rotate_refresh("old", _refresh(token_hash="new")) is None
    db.refresh_tokens.update_many.assert_awaited_once()


@pytest.mark.unit
@pytest.mark.asyncio
async def test_mongo_rotate_missing_or_expired() -> None:
    db = _mock_db()
    repo = MongoRefreshTokenRepo(db)
    db.refresh_tokens.find_one_and_update = AsyncMock(return_value=None)
    db.refresh_tokens.find_one = AsyncMock(return_value=None)
    assert await repo.rotate_refresh("missing", _refresh()) is None

    past = datetime.now(UTC) - timedelta(days=1)
    db.refresh_tokens.find_one_and_update = AsyncMock(return_value=None)
    db.refresh_tokens.find_one = AsyncMock(
        return_value={
            "token_hash": "old",
            "family_id": "fam_1",
            "client_id": "cli",
            "sub": "usr",
            "scopes": ["openid"],
            "expires_at": past,
            "created_at": past,
            "revoked_at": None,
        }
    )
    db.refresh_tokens.update_many = AsyncMock()
    assert await repo.rotate_refresh("old", _refresh()) is None
    db.refresh_tokens.update_many.assert_not_awaited()


@pytest.mark.unit
@pytest.mark.asyncio
async def test_mongo_rotate_rejects_when_live_count_not_one() -> None:
    db = _mock_db()
    repo = MongoRefreshTokenRepo(db)
    now = datetime.now(UTC)
    db.refresh_tokens.find_one_and_update = AsyncMock(
        return_value={
            "token_hash": "old",
            "family_id": "fam_1",
            "client_id": "cli",
            "sub": "usr",
            "scopes": ["openid"],
            "expires_at": now + timedelta(days=7),
            "created_at": now,
            "revoked_at": None,
        }
    )
    db.refresh_tokens.insert_one = AsyncMock()
    db.refresh_tokens.count_documents = AsyncMock(return_value=2)
    db.refresh_tokens.update_many = AsyncMock()
    assert await repo.rotate_refresh("old", _refresh(token_hash="new")) is None
    db.refresh_tokens.update_many.assert_awaited_once()


@pytest.mark.unit
@pytest.mark.asyncio
async def test_mongo_rotate_duplicate_insert_revokes_family() -> None:
    db = _mock_db()
    repo = MongoRefreshTokenRepo(db)
    now = datetime.now(UTC)
    db.refresh_tokens.find_one_and_update = AsyncMock(
        return_value={
            "token_hash": "old",
            "family_id": "fam_1",
            "client_id": "cli",
            "sub": "usr",
            "scopes": ["openid"],
            "expires_at": now + timedelta(days=7),
            "created_at": now,
            "revoked_at": None,
        }
    )
    db.refresh_tokens.insert_one = AsyncMock(side_effect=DuplicateKeyError("token_hash"))
    db.refresh_tokens.update_many = AsyncMock()
    assert await repo.rotate_refresh("old", _refresh(token_hash="new")) is None
    db.refresh_tokens.update_many.assert_awaited_once()


@pytest.mark.unit
@pytest.mark.asyncio
async def test_mongo_consent_get_and_upsert() -> None:
    db = _mock_db()
    repo = MongoConsentRepo(db)
    db.consents.find_one = AsyncMock(return_value=None)
    assert await repo.get_consent("usr", "cli") is None

    now = datetime.now(UTC)
    db.consents.find_one_and_update = AsyncMock(
        return_value={
            "sub": "usr_abc",
            "client_id": "cli_test",
            "scopes": ["openid", "profile"],
            "mode": "identity",
            "granted_at": now,
        }
    )
    result = await repo.upsert_consent(_consent())
    assert result.sub == "usr_abc"
    assert result.mode == ConsentMode.IDENTITY


@pytest.mark.unit
def test_new_sub_and_user_model_roundtrip_fields() -> None:
    sub = new_sub()
    assert sub.startswith("usr_")
    now = datetime.now(UTC)
    user = User(
        sub=sub,
        name="A",
        prn="P",
        srn=None,
        program=None,
        branch=None,
        semester=None,
        section=None,
        campus=None,
        email=None,
        phone=None,
        created_at=now,
        last_login_at=now,
        deleted_at=None,
    )
    assert user.prn == "P"


@pytest.mark.unit
@pytest.mark.asyncio
async def test_fake_create_client_duplicate_raises() -> None:
    repo = FakeClientRepo()
    await repo.create_client(_client())
    with pytest.raises(DuplicateKeyError):
        await repo.create_client(_client())


@pytest.mark.unit
@pytest.mark.asyncio
async def test_fake_upsert_without_prn_always_creates() -> None:
    repo = FakeUserRepo()
    a = await repo.upsert_user_from_profile(_profile(prn=None))
    b = await repo.upsert_user_from_profile(_profile(prn=None))
    assert a.sub != b.sub


@pytest.mark.unit
@pytest.mark.asyncio
async def test_fake_consume_naive_expires_and_rotate_edge_cases() -> None:
    codes = FakeAuthCodeRepo()
    naive_exp = datetime.now(UTC).replace(tzinfo=None) + timedelta(minutes=5)
    code = _auth_code(expires_at=naive_exp)
    await codes.store_code(code)
    assert await codes.consume_code(code.code_hash) is not None

    tokens = FakeRefreshTokenRepo()
    assert await tokens.rotate_refresh("missing", _refresh()) is None
    expired = _refresh(expires_at=datetime.now(UTC) - timedelta(seconds=1))
    await tokens.store_refresh(expired)
    assert await tokens.rotate_refresh(expired.token_hash, _refresh(token_hash=sha256_hex("n"))) is None

    naive_ok = _refresh(
        token_hash=sha256_hex("naive-ok"),
        expires_at=datetime.now(UTC).replace(tzinfo=None) + timedelta(days=1),
    )
    await tokens.store_refresh(naive_ok)
    rotated = await tokens.rotate_refresh(
        naive_ok.token_hash,
        _refresh(token_hash=sha256_hex("after-naive")),
    )
    assert rotated is not None


@pytest.mark.unit
@pytest.mark.asyncio
async def test_mongo_upsert_without_prn_skips_lookup() -> None:
    db = _mock_db()
    db.users.find_one = AsyncMock()
    db.users.insert_one = AsyncMock()
    user = await MongoUserRepo(db).upsert_user_from_profile(_profile(prn=None))
    assert user.prn is None
    db.users.find_one.assert_not_called()
    db.users.insert_one.assert_awaited_once()


@pytest.mark.unit
@pytest.mark.asyncio
async def test_mongo_get_consent_found_and_client_uris_tuple() -> None:
    db = _mock_db()
    now = datetime.now(UTC)
    db.consents.find_one = AsyncMock(
        return_value={
            "sub": "usr_abc",
            "client_id": "cli_test",
            "scopes": ["openid"],
            "mode": "identity",
            "granted_at": now,
        }
    )
    consent = await MongoConsentRepo(db).get_consent("usr_abc", "cli_test")
    assert consent is not None
    assert consent.scopes == frozenset({"openid"})

    db.clients.find_one = AsyncMock(
        return_value={
            "client_id": "cli_test",
            "client_secret_hash": None,
            "name": "Test App",
            "owner_sub": "usr_owner",
            "redirect_uris": ("https://app.example/cb",),
            "token_endpoint_auth_method": "none",
            "publishing_status": "production",
            "delegated_allowed": True,
            "created_at": now,
            "updated_at": now,
        }
    )
    client = await MongoClientRepo(db).get_client("cli_test")
    assert client is not None
    assert client.client_secret_hash is None
    assert client.publishing_status == PublishingStatus.PRODUCTION


@pytest.mark.unit
@pytest.mark.asyncio
async def test_mongo_consume_naive_expires_and_refresh_naive() -> None:
    db = _mock_db()
    naive_future = datetime.now(UTC).replace(tzinfo=None) + timedelta(minutes=5)
    db.authorization_codes.find_one_and_delete = AsyncMock(
        return_value={
            "code_hash": "h",
            "client_id": "c",
            "sub": "s",
            "redirect_uri": "https://x",
            "scopes": ["openid"],
            "code_challenge": "ch",
            "code_challenge_method": "S256",
            "mode": "identity",
            "expires_at": naive_future,
            "created_at": naive_future,
        }
    )
    consumed = await MongoAuthCodeRepo(db).consume_code("h")
    assert consumed is not None

    naive_exp = datetime.now(UTC).replace(tzinfo=None) + timedelta(days=1)
    db.refresh_tokens.find_one_and_update = AsyncMock(
        return_value={
            "token_hash": "old",
            "family_id": "fam_1",
            "client_id": "cli",
            "sub": "usr",
            "scopes": ["openid"],
            "expires_at": naive_exp,
            "created_at": naive_exp,
            "revoked_at": None,
        }
    )
    db.refresh_tokens.insert_one = AsyncMock()
    db.refresh_tokens.count_documents = AsyncMock(return_value=1)
    result = await MongoRefreshTokenRepo(db).rotate_refresh("old", _refresh(token_hash="new"))
    assert result is not None


@pytest.mark.unit
@pytest.mark.asyncio
async def test_fake_concurrent_rotates_leave_at_most_one_live() -> None:
    import asyncio

    repo = FakeRefreshTokenRepo()
    old = _refresh()
    await repo.store_refresh(old)
    results = await asyncio.gather(
        repo.rotate_refresh(old.token_hash, _refresh(token_hash=sha256_hex("a"))),
        repo.rotate_refresh(old.token_hash, _refresh(token_hash=sha256_hex("b"))),
    )
    successes = [r for r in results if r is not None]
    assert len(successes) <= 1
    live = [
        t
        for t in repo._by_hash.values()
        if t.revoked_at is None and FakeRefreshTokenRepo._not_expired(t, datetime.now(UTC))
    ]
    assert len(live) <= 1
    if len(successes) == 1 and len(live) == 1:
        assert live[0].token_hash == successes[0].token_hash


@pytest.mark.unit
@pytest.mark.asyncio
async def test_fake_store_duplicate_and_rotate_edge_paths() -> None:
    repo = FakeRefreshTokenRepo()
    token = _refresh()
    await repo.store_refresh(token)
    with pytest.raises(DuplicateKeyError):
        await repo.store_refresh(token)

    # Revoked without successor → family revoke on reuse
    orphan = _refresh(token_hash=sha256_hex("orphan"), family_id="fam_orphan")
    await repo.store_refresh(orphan)
    repo._by_hash[orphan.token_hash] = RefreshToken(
        token_hash=orphan.token_hash,
        family_id=orphan.family_id,
        client_id=orphan.client_id,
        sub=orphan.sub,
        scopes=orphan.scopes,
        expires_at=orphan.expires_at,
        created_at=orphan.created_at,
        revoked_at=datetime.now(UTC),
    )
    assert await repo.rotate_refresh(orphan.token_hash, _refresh(token_hash=sha256_hex("x"))) is None

    # Claim then duplicate new hash → family revoke
    base = _refresh(token_hash=sha256_hex("base2"), family_id="fam_dup")
    clash = _refresh(token_hash=sha256_hex("clash"), family_id="fam_dup")
    await repo.store_refresh(base)
    await repo.store_refresh(clash)
    assert await repo.rotate_refresh(base.token_hash, clash) is None


@pytest.mark.unit
@pytest.mark.asyncio
async def test_mongo_failed_claim_without_successor_revokes_family() -> None:
    db = _mock_db()
    repo = MongoRefreshTokenRepo(db)
    now = datetime.now(UTC)
    db.refresh_tokens.find_one_and_update = AsyncMock(return_value=None)
    db.refresh_tokens.find_one = AsyncMock(
        return_value={
            "token_hash": "old",
            "family_id": "fam_1",
            "revoked_at": now,
        }
    )
    db.refresh_tokens.update_many = AsyncMock()
    assert await repo.rotate_refresh("old", _refresh(token_hash="new")) is None
    db.refresh_tokens.update_many.assert_awaited_once()


@pytest.mark.unit
@pytest.mark.asyncio
async def test_mongo_failed_claim_successor_not_live_skips_revoke() -> None:
    db = _mock_db()
    repo = MongoRefreshTokenRepo(db)
    now = datetime.now(UTC)
    db.refresh_tokens.find_one_and_update = AsyncMock(return_value=None)
    db.refresh_tokens.find_one = AsyncMock(
        side_effect=[
            {
                "token_hash": "old",
                "family_id": "fam_1",
                "revoked_at": now,
                "successor_hash": "gone",
            },
            None,
        ]
    )
    db.refresh_tokens.update_many = AsyncMock()
    assert await repo.rotate_refresh("old", _refresh(token_hash="new")) is None
    db.refresh_tokens.update_many.assert_not_awaited()
