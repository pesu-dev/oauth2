"""Unit tests for FastAPI app factory and lifespan Mongo wiring."""

from __future__ import annotations

from typing import TYPE_CHECKING
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi.testclient import TestClient

if TYPE_CHECKING:
    from pymongo.asynchronous.database import AsyncDatabase

    from src.config import AppConfig


@pytest.mark.unit
def test_create_app_defaults_to_httpx_academy() -> None:
    from src.academy.client import HttpxAcademyClient
    from src.app import create_app
    from tests.conftest import config_for_tests

    application = create_app(config_for_tests())
    assert isinstance(application.state.academy, HttpxAcademyClient)
    with TestClient(application):
        assert isinstance(application.state.academy, HttpxAcademyClient)


@pytest.mark.unit
def test_create_app_leaves_db_none_without_mongo() -> None:
    from src.app import create_app
    from tests.conftest import config_for_tests

    application = create_app(config_for_tests())
    with TestClient(application) as client:
        assert application.state.db is None
        response = client.get("/health")
        assert response.status_code == 200
        assert response.json() == {"status": "ok"}


@pytest.mark.unit
def test_lifespan_connects_when_mongo_uri_override_set(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from src.app import create_app
    from tests.conftest import config_for_tests

    fake_db = MagicMock()
    fake_db.client = MagicMock()
    fake_db.client.close = AsyncMock()

    get_database = AsyncMock(return_value=fake_db)
    ensure_indexes = AsyncMock()
    monkeypatch.setattr("src.app.get_database", get_database)
    monkeypatch.setattr("src.app.ensure_indexes", ensure_indexes)

    application = create_app(
        config_for_tests(),
        mongo_uri_override="mongodb://localhost:27017",
    )
    with TestClient(application):
        assert application.state.db is fake_db
        get_database.assert_awaited_once()
        ensure_indexes.assert_awaited_once_with(fake_db)

    fake_db.client.close.assert_awaited_once()


@pytest.mark.unit
def test_lifespan_connects_when_connect_mongo_true(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from src.app import create_app
    from tests.conftest import config_for_tests

    fake_db = MagicMock()
    fake_db.client = MagicMock()
    fake_db.client.close = AsyncMock()

    async def fake_get_database(
        config: AppConfig,
        mongo_uri_override: str | None = None,
    ) -> AsyncDatabase:
        assert mongo_uri_override is None
        return fake_db

    ensure_indexes = AsyncMock()
    monkeypatch.setattr("src.app.get_database", fake_get_database)
    monkeypatch.setattr("src.app.ensure_indexes", ensure_indexes)

    application = create_app(config_for_tests(), connect_mongo=True)
    with TestClient(application):
        assert application.state.db is fake_db
        ensure_indexes.assert_awaited_once_with(fake_db)


@pytest.mark.unit
def test_wire_mongo_repos_skips_when_already_set() -> None:
    """Both branches: None→Mongo* assignment and already-set skip."""
    from src.app import _wire_mongo_repos, create_app
    from src.repos.fakes import (
        FakeAdminRepo,
        FakeAuthCodeRepo,
        FakeClientRepo,
        FakeConsentRepo,
        FakeProductionRequestRepo,
        FakeRefreshTokenRepo,
        FakeTesterRepo,
        FakeUserRepo,
        FakeVaultRepo,
    )
    from tests.conftest import config_for_tests

    users = FakeUserRepo()
    clients = FakeClientRepo()
    testers = FakeTesterRepo()
    auth_codes = FakeAuthCodeRepo()
    refresh_tokens = FakeRefreshTokenRepo()
    consents = FakeConsentRepo()
    admins = FakeAdminRepo()
    production_requests = FakeProductionRequestRepo()
    vault = FakeVaultRepo()

    application = create_app(
        config_for_tests(),
        users=users,
        clients=clients,
        testers=testers,
        auth_codes=auth_codes,
        refresh_tokens=refresh_tokens,
        consents=consents,
        admins=admins,
        production_requests=production_requests,
        vault=vault,
    )
    application.state.db = MagicMock()
    _wire_mongo_repos(application)
    assert application.state.users is users
    assert application.state.clients is clients
    assert application.state.testers is testers
    assert application.state.auth_codes is auth_codes
    assert application.state.refresh_tokens is refresh_tokens
    assert application.state.consents is consents
    assert application.state.admins is admins
    assert application.state.production_requests is production_requests
    assert application.state.vault is vault


@pytest.mark.unit
def test_wire_mongo_repos_assigns_when_none() -> None:
    from src.app import _wire_mongo_repos, create_app
    from src.repos.admins import MongoAdminRepo
    from src.repos.auth_codes import MongoAuthCodeRepo
    from src.repos.clients import MongoClientRepo
    from src.repos.consents import MongoConsentRepo
    from src.repos.production_requests import MongoProductionRequestRepo
    from src.repos.refresh_tokens import MongoRefreshTokenRepo
    from src.repos.testers import MongoTesterRepo
    from src.repos.users import MongoUserRepo
    from src.repos.vault import MongoVaultRepo
    from tests.conftest import config_for_tests

    application = create_app(config_for_tests())
    fake_db = MagicMock()
    application.state.db = fake_db
    assert application.state.users is None
    _wire_mongo_repos(application)
    assert isinstance(application.state.users, MongoUserRepo)
    assert isinstance(application.state.clients, MongoClientRepo)
    assert isinstance(application.state.testers, MongoTesterRepo)
    assert isinstance(application.state.auth_codes, MongoAuthCodeRepo)
    assert isinstance(application.state.refresh_tokens, MongoRefreshTokenRepo)
    assert isinstance(application.state.consents, MongoConsentRepo)
    assert isinstance(application.state.admins, MongoAdminRepo)
    assert isinstance(application.state.production_requests, MongoProductionRequestRepo)
    assert isinstance(application.state.vault, MongoVaultRepo)


@pytest.mark.unit
def test_create_app_requires_session_secret(rsa_pem: str) -> None:
    from dataclasses import replace

    from src.app import create_app
    from src.config import load_config

    with pytest.raises(ValueError, match="SESSION_SECRET is required"):
        create_app(replace(load_config(), token_signing_key_pem=rsa_pem, session_secret=None))


@pytest.mark.unit
def test_create_app_loads_config_when_none(monkeypatch: pytest.MonkeyPatch) -> None:
    from src.app import create_app
    from tests.conftest import config_for_tests

    cfg = config_for_tests()
    monkeypatch.setattr("src.app.load_config", lambda: cfg)
    application = create_app(None)
    assert application.state.config is cfg


@pytest.mark.unit
def test_build_app_requests_mongo(monkeypatch: pytest.MonkeyPatch) -> None:
    from src import app as app_mod

    calls: list[bool] = []

    def fake_create_app(*_a: object, connect_mongo: bool = False, **_kw: object) -> object:
        calls.append(connect_mongo)
        return MagicMock()

    monkeypatch.setattr(app_mod, "create_app", fake_create_app)
    app_mod.build_app()
    assert calls == [True]
