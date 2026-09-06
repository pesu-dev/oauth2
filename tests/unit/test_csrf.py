"""Unit tests for synchronizer CSRF helpers."""

from __future__ import annotations

from dataclasses import replace
from unittest.mock import MagicMock

import pytest
from fastapi.testclient import TestClient

from src.app import create_app
from src.config import load_config
from src.csrf import CSRF_COOKIE, CsrfStore, issue_csrf, set_csrf_cookie, verify_csrf
from tests.csrf_helpers import form_with_csrf


@pytest.mark.unit
def test_csrf_store_round_trip() -> None:
    store = CsrfStore("csrf-unit-secret")
    token = store.new_token()
    assert store.load(store.dump(token)) == token
    assert store.load("not-a-valid-cookie") is None


@pytest.mark.unit
def test_issue_csrf_sets_cookie_and_returns_token() -> None:
    store = CsrfStore("issue-csrf-secret")
    config = replace(load_config(), session_secret="issue-csrf-secret", app_env="local")
    response = MagicMock()
    token = issue_csrf(response, config, store)
    assert isinstance(token, str) and len(token) > 10
    response.set_cookie.assert_called_once()
    kwargs = response.set_cookie.call_args.kwargs
    assert kwargs["key"] == CSRF_COOKIE
    assert store.load(kwargs["value"]) == token


@pytest.mark.unit
def test_verify_csrf_rejects_missing_and_invalid_cookie() -> None:
    store = CsrfStore("verify-csrf-secret")
    token = store.new_token()

    missing = MagicMock()
    missing.cookies.get.return_value = None
    assert verify_csrf(missing, store, token) is False

    bad = MagicMock()
    bad.cookies.get.return_value = "not-signed"
    assert verify_csrf(bad, store, token) is False

    good = MagicMock()
    good.cookies.get.return_value = store.dump(token)
    assert verify_csrf(good, store, token) is True
    assert verify_csrf(good, store, "") is False
    assert verify_csrf(good, store, None) is False


@pytest.mark.unit
def test_set_csrf_cookie_secure_outside_local() -> None:
    config = replace(load_config(), app_env="staging", session_secret="s")
    response = MagicMock()
    set_csrf_cookie(response, config, "signed-value")
    assert response.set_cookie.call_args.kwargs["secure"] is True


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
