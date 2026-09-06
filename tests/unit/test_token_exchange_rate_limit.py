"""Unit tests for /token and token-exchange rate limits."""

from __future__ import annotations

from dataclasses import replace

import pytest
from fastapi.testclient import TestClient

from src.app import create_app
from src.config import load_config
from src.oidc.rate_limit import SlidingWindowRateLimiter


@pytest.mark.unit
def test_token_endpoint_rate_limited(rsa_pem: str) -> None:
    config = replace(
        load_config(),
        token_signing_key_pem=rsa_pem,
        session_secret="token-rl-secret",
    )
    app = create_app(config)
    app.state.token_limiter = SlidingWindowRateLimiter(limit=2, window_seconds=60)
    with TestClient(app) as client:
        for _ in range(2):
            resp = client.post("/token", data={"grant_type": "authorization_code"})
            assert resp.status_code != 429
        blocked = client.post("/token", data={"grant_type": "authorization_code"})
        assert blocked.status_code == 429
        assert blocked.json()["error"] == "temporarily_unavailable"


@pytest.mark.unit
def test_exchange_endpoint_rate_limited(rsa_pem: str) -> None:
    config = replace(
        load_config(),
        token_signing_key_pem=rsa_pem,
        session_secret="exchange-rl-secret",
        token_exchange_secret="exchange-secret",
    )
    app = create_app(config)
    app.state.exchange_limiter = SlidingWindowRateLimiter(limit=1, window_seconds=60)
    with TestClient(app) as client:
        first = client.post(
            "/oauth/token-exchange",
            headers={"X-Token-Exchange-Secret": "exchange-secret"},
            data={"access_token": "x"},
        )
        assert first.status_code != 429
        second = client.post(
            "/oauth/token-exchange",
            headers={"X-Token-Exchange-Secret": "exchange-secret"},
            data={"access_token": "x"},
        )
        assert second.status_code == 429
        assert second.json()["error"] == "temporarily_unavailable"
