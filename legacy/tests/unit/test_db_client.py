"""Unit tests for async Mongo client factory and index helpers."""

from __future__ import annotations

from typing import TYPE_CHECKING
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from src.config import load_config
from src.db.client import get_database
from src.db.indexes import ensure_indexes

if TYPE_CHECKING:
    from collections.abc import Mapping


@pytest.mark.unit
@pytest.mark.asyncio
async def test_get_database_override_skips_x509() -> None:
    config = load_config()
    mock_client = MagicMock()
    mock_db = MagicMock()
    mock_client.__getitem__.return_value = mock_db

    with patch("src.db.client.AsyncMongoClient", return_value=mock_client) as mongo_cls:
        db = await get_database(config, mongo_uri_override="mongodb://localhost:27017")

    mongo_cls.assert_called_once_with("mongodb://localhost:27017")
    mock_client.__getitem__.assert_called_once_with(config.db_name)
    assert db is mock_db


@pytest.mark.unit
@pytest.mark.asyncio
async def test_get_database_uses_x509_when_no_override() -> None:
    config = load_config()
    mock_client = MagicMock()
    mock_db = MagicMock()
    mock_client.__getitem__.return_value = mock_db

    with patch("src.db.client.AsyncMongoClient", return_value=mock_client) as mongo_cls:
        db = await get_database(config)

    mongo_cls.assert_called_once_with(
        config.mongo_uri,
        tls=True,
        tlsCertificateKeyFile=config.mongo_x509_cert_path,
        authSource="$external",
        authMechanism="MONGODB-X509",
    )
    assert db is mock_db


@pytest.mark.unit
@pytest.mark.asyncio
async def test_ensure_indexes_creates_required_keys() -> None:
    created: list[tuple[object, Mapping[str, object]]] = []

    async def _capture(keys: object, **kwargs: object) -> str:
        created.append((keys, kwargs))
        return "idx"

    db = MagicMock()
    for name in (
        "users",
        "clients",
        "client_testers",
        "consents",
        "vault",
        "authorization_codes",
        "refresh_tokens",
        "admins",
        "production_requests",
    ):
        getattr(db, name).create_index = AsyncMock(side_effect=_capture)

    await ensure_indexes(db)

    assert ("sub", {"unique": True}) in created
    assert ("client_id", {"unique": True}) in created
    assert ("token_hash", {"unique": True}) in created
    assert ("expires_at", {"expireAfterSeconds": 0}) in created
    assert ([("client_id", 1), ("sub", 1)], {"unique": True}) in created
    assert ([("sub", 1), ("client_id", 1)], {"unique": True}) in created
