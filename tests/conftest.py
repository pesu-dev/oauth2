"""Shared pytest fixtures."""

from __future__ import annotations

from dataclasses import replace
from typing import TYPE_CHECKING

import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi.testclient import TestClient

from src.app import create_app
from src.config import load_config

if TYPE_CHECKING:
    from collections.abc import Iterator


@pytest.fixture(scope="session")
def rsa_pem() -> str:
    """Ephemeral RSA private key PEM for unit tests (no secrets file)."""
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    return key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption(),
    ).decode("utf-8")


@pytest.fixture
def client(rsa_pem: str) -> Iterator[TestClient]:
    """ASGI test client without Mongo; injects ephemeral signing key."""
    config = replace(load_config(), token_signing_key_pem=rsa_pem)
    with TestClient(create_app(config)) as test_client:
        yield test_client
