"""Unit tests for JWKS endpoint."""

from __future__ import annotations

from typing import TYPE_CHECKING

import pytest
from fastapi.testclient import TestClient

from src.app import create_app
from tests.conftest import config_for_tests

if TYPE_CHECKING:
    from pathlib import Path


@pytest.mark.unit
def test_jwks_returns_rsa_public_key(client: TestClient) -> None:
    r = client.get("/jwks.json")
    assert r.status_code == 200
    body = r.json()
    assert "keys" in body
    assert len(body["keys"]) == 1
    jwk = body["keys"][0]
    assert jwk["kty"] == "RSA"
    assert jwk["alg"] == "RS256"
    assert jwk["use"] == "sig"
    assert "kid" in jwk
    assert "n" in jwk
    assert "e" in jwk


@pytest.mark.unit
def test_jwks_unavailable_without_signing_key(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    monkeypatch.setenv("TOKEN_SIGNING_KEY_PATH", str(tmp_path / "missing.pem"))
    with TestClient(create_app(config_for_tests(token_signing_key_pem=None))) as test_client:
        r = test_client.get("/jwks.json")
        assert r.status_code == 503
