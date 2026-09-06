"""Helpers for CSRF-protected HTML form posts in unit tests."""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from src.csrf import CSRF_COOKIE, CSRF_FIELD, CsrfStore

if TYPE_CHECKING:
    from fastapi.testclient import TestClient


def form_with_csrf(client: TestClient, session_secret: str, data: dict[str, Any] | None = None) -> dict[str, Any]:
    """Merge ``data`` with the CSRF token from the client's signed cookie."""
    raw = client.cookies.get(CSRF_COOKIE)
    if raw is None:
        msg = f"missing {CSRF_COOKIE} cookie; GET a form page first"
        raise AssertionError(msg)
    token = CsrfStore(session_secret).load(raw)
    if token is None:
        msg = "CSRF cookie present but could not be loaded"
        raise AssertionError(msg)
    payload = dict(data or {})
    payload[CSRF_FIELD] = token
    return payload


def install_auto_csrf(
    client: TestClient,
    session_secret: str,
    *,
    login_path: str,
    home_path: str = "",  # noqa: ARG001 — kept for call-site clarity
) -> TestClient:
    """Wrap ``client.post`` to attach synchronizer tokens for HTML form posts."""
    original_post = client.post

    def _ensure_csrf_cookie() -> None:
        if CSRF_COOKIE not in client.cookies:
            # Login pages always mint CSRF; home may redirect without a form cookie.
            client.get(login_path)

    def post_with_csrf(url: str, data: object = None, **kwargs: object) -> object:
        payload = data
        if isinstance(payload, dict) and CSRF_FIELD not in payload:
            _ensure_csrf_cookie()
            payload = form_with_csrf(client, session_secret, payload)
        elif payload is None and "json" not in kwargs:
            _ensure_csrf_cookie()
            if CSRF_COOKIE in client.cookies:
                payload = form_with_csrf(client, session_secret)
        return original_post(url, data=payload, **kwargs)  # type: ignore[arg-type]

    client.post = post_with_csrf  # type: ignore[method-assign]
    return client
