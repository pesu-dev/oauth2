"""Integration tests for Mongo index creation and optional Atlas X.509 smoke."""

from __future__ import annotations

import os
from pathlib import Path
from typing import TYPE_CHECKING

import pytest

if TYPE_CHECKING:
    from pymongo.asynchronous.database import AsyncDatabase


@pytest.mark.integration
@pytest.mark.asyncio
async def test_ensure_indexes_creates_users_sub_unique(mongo_db: AsyncDatabase) -> None:
    from src.db.indexes import ensure_indexes

    await ensure_indexes(mongo_db)
    indexes = await mongo_db.users.index_information()
    assert any("sub" in str(v.get("key")) for v in indexes.values())


def _atlas_smoke_ready() -> bool:
    cert_path = os.environ.get("MONGO_X509_CERT_PATH")
    if not cert_path or not Path(cert_path).is_file():
        return False
    return os.environ.get("RUN_ATLAS_SMOKE") == "1"


@pytest.mark.integration
@pytest.mark.atlas_smoke
@pytest.mark.asyncio
@pytest.mark.skipif(
    not _atlas_smoke_ready(),
    reason="Set RUN_ATLAS_SMOKE=1 and MONGO_X509_CERT_PATH to an existing PEM",
)
async def test_atlas_x509_ping() -> None:
    from src.config import load_config
    from src.db.client import get_database

    db = await get_database(load_config())
    result = await db.client.admin.command("ping")
    assert result["ok"] == 1.0
