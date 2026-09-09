"""Shared pytest fixtures."""

from __future__ import annotations

import os

# Isolate tests from the developer's local ``.env``.
os.environ["PESU_OAUTH2_SKIP_DOTENV"] = "1"

from dataclasses import replace
from typing import TYPE_CHECKING

import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi.testclient import TestClient

from src.app import create_app
from src.config import AppConfig, load_config

if TYPE_CHECKING:
    from collections.abc import Iterator


def config_for_tests(**overrides: object) -> AppConfig:
    """``load_config()`` plus a session secret (required by ``create_app``)."""
    values: dict[str, object] = {"session_secret": "unit-test-session-secret"}
    values.update(overrides)
    return replace(load_config(), **values)  # type: ignore[arg-type]


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
def app_config(rsa_pem: str) -> AppConfig:
    """Minimal config for ``create_app`` in unit tests (signing key + session)."""
    return config_for_tests(token_signing_key_pem=rsa_pem)


@pytest.fixture
def client(app_config: AppConfig) -> Iterator[TestClient]:
    """ASGI test client without Mongo; injects ephemeral signing key."""
    with TestClient(create_app(app_config)) as test_client:
        yield test_client
