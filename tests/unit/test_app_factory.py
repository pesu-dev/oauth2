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
def test_create_app_exposes_config() -> None:
    from src.app import create_app
    from src.config import load_config

    application = create_app(load_config())
    assert application.state.config.issuer_url == "http://localhost:8080"


@pytest.mark.unit
def test_create_app_leaves_db_none_without_mongo() -> None:
    from src.app import create_app
    from src.config import load_config

    application = create_app(load_config())
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
    from src.config import load_config

    fake_db = MagicMock()
    fake_db.client = MagicMock()
    fake_db.client.close = AsyncMock()

    get_database = AsyncMock(return_value=fake_db)
    ensure_indexes = AsyncMock()
    monkeypatch.setattr("src.app.get_database", get_database)
    monkeypatch.setattr("src.app.ensure_indexes", ensure_indexes)

    application = create_app(
        load_config(),
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
    from src.config import load_config

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

    application = create_app(load_config(), connect_mongo=True)
    with TestClient(application):
        assert application.state.db is fake_db
        ensure_indexes.assert_awaited_once_with(fake_db)
