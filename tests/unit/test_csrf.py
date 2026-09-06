"""Unit tests for synchronizer CSRF helpers."""

from __future__ import annotations

from dataclasses import replace

import pytest
from fastapi.testclient import TestClient

from src.app import create_app
from src.config import load_config
from src.csrf import CSRF_COOKIE, CsrfStore
from tests.csrf_helpers import form_with_csrf


@pytest.mark.unit
def test_csrf_store_round_trip() -> None:
    store = CsrfStore("csrf-unit-secret")
    token = store.new_token()
    assert store.load(store.dump(token)) == token
    assert store.load("not-a-valid-cookie") is None


@pytest.mark.unit
def test_portal_post_rejects_missing_csrf(rsa_pem: str) -> None:
    config = replace(
        load_config(),
        token_signing_key_pem=rsa_pem,
        session_secret="portal-csrf-missing",
    )
    with TestClient(create_app(config)) as client:
        page = client.get("/portal/login")
        assert page.status_code == 200
        assert CSRF_COOKIE in client.cookies
        assert 'name="csrf_token"' in page.text
        resp = client.post(
            "/portal/login",
            data={"username": "x", "password": "y"},
            follow_redirects=False,
        )
        assert resp.status_code == 403


@pytest.mark.unit
def test_portal_post_accepts_matching_csrf(rsa_pem: str) -> None:
    secret = "portal-csrf-ok"
    config = replace(load_config(), token_signing_key_pem=rsa_pem, session_secret=secret)
    with TestClient(create_app(config)) as client:
        client.get("/portal/login")
        resp = client.post(
            "/portal/login",
            data=form_with_csrf(client, secret, {"username": "x", "password": "y"}),
            follow_redirects=False,
        )
        # Invalid credentials, but CSRF accepted (not 403).
        assert resp.status_code != 403
