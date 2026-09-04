"""Unit tests for OIDC discovery metadata."""

from __future__ import annotations

from typing import TYPE_CHECKING

import pytest

if TYPE_CHECKING:
    from fastapi.testclient import TestClient


@pytest.mark.unit
def test_discovery_issuer_from_config(client: TestClient) -> None:
    r = client.get("/.well-known/openid-configuration")
    assert r.status_code == 200
    body = r.json()
    assert body["issuer"] == "http://localhost:8080"
    assert body["authorization_endpoint"] == "http://localhost:8080/authorize"
    assert "S256" in body["code_challenge_methods_supported"]
    assert "RS256" in body["id_token_signing_alg_values_supported"]


@pytest.mark.unit
def test_discovery_ignores_request_host_header(client: TestClient) -> None:
    r = client.get(
        "/.well-known/openid-configuration",
        headers={"Host": "evil.example"},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["issuer"] == "http://localhost:8080"
    assert body["jwks_uri"] == "http://localhost:8080/jwks.json"
    assert body["token_endpoint"] == "http://localhost:8080/token"
