"""Integration fixtures — Testcontainers MongoDB for real index/query checks."""

from __future__ import annotations

import os
from pathlib import Path
from typing import TYPE_CHECKING

import pytest
from pymongo import AsyncMongoClient
from testcontainers.community.mongodb import MongoDbContainer

if TYPE_CHECKING:
    from collections.abc import AsyncIterator, Iterator

    from pymongo.asynchronous.database import AsyncDatabase


def _configure_testcontainers_for_colima() -> None:
    """Point Testcontainers at Colima's in-VM docker.sock so Ryuk can start."""
    colima_sock = Path.home() / ".colima" / "default" / "docker.sock"
    if not colima_sock.exists():
        return
    os.environ.setdefault("DOCKER_HOST", f"unix://{colima_sock}")
    os.environ.setdefault("TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE", "/var/run/docker.sock")


_configure_testcontainers_for_colima()


@pytest.fixture(scope="session")
def mongo_container() -> Iterator[MongoDbContainer]:
    container = MongoDbContainer("mongo:7")
    container.start()
    try:
        yield container
    finally:
        container.stop()


@pytest.fixture
async def mongo_db(mongo_container: MongoDbContainer) -> AsyncIterator[AsyncDatabase]:
    uri = mongo_container.get_connection_url()
    client: AsyncMongoClient = AsyncMongoClient(uri)
    try:
        db = client["oauth2"]
        yield db
    finally:
        await client.drop_database("oauth2")
        await client.close()
