"""Shared pytest fixtures."""

from __future__ import annotations

from typing import TYPE_CHECKING

import pytest
from fastapi.testclient import TestClient

from src.app import create_app

if TYPE_CHECKING:
    from collections.abc import Iterator


@pytest.fixture
def client() -> Iterator[TestClient]:
    """ASGI test client without Mongo (no Docker required for unit tests)."""
    with TestClient(create_app()) as test_client:
        yield test_client
