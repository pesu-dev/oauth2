"""Unit tests for JWKS endpoint."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from src.app import create_app
from src.config import load_config


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
def test_jwks_unavailable_without_signing_key() -> None:
    with TestClient(create_app(load_config())) as test_client:
        r = test_client.get("/jwks.json")
        assert r.status_code == 503
