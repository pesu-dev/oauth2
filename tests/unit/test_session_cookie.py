"""Unit tests for signed browser session cookies."""

from __future__ import annotations

import itsdangerous.timed as timed_mod
import pytest

from src.config import SESSION_COOKIE_TTL_SECONDS
from src.models.consent import ConsentMode
from src.session_cookie import LoginPendingState, SessionStore


def _sample_state(**overrides: object) -> LoginPendingState:
    base: dict[str, object] = {
        "client_id": "cli_test",
        "redirect_uri": "https://app.example/callback",
        "scopes": frozenset({"openid", "profile"}),
        "code_challenge": "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
        "mode": ConsentMode.IDENTITY,
        "authenticated_sub": None,
        "state": "client-state-xyz",
        "nonce": "nonce-abc",
    }
    base.update(overrides)
    return LoginPendingState(**base)  # type: ignore[arg-type]


@pytest.mark.unit
def test_dump_and_load_round_trip() -> None:
    store = SessionStore(secret="test-session-secret", max_age=SESSION_COOKIE_TTL_SECONDS)
    pending = _sample_state(authenticated_sub="usr_abc123")
    token = store.dump(pending)
    loaded = store.load(token)
    assert loaded == pending
    assert isinstance(loaded.scopes, frozenset)
    assert loaded.mode is ConsentMode.IDENTITY


@pytest.mark.unit
def test_load_rejects_tampered_token() -> None:
    store = SessionStore(secret="test-session-secret", max_age=SESSION_COOKIE_TTL_SECONDS)
    token = store.dump(_sample_state())
    tampered = token[:-4] + ("AAAA" if token[-4:] != "AAAA" else "BBBB")
    assert store.load(tampered) is None


@pytest.mark.unit
def test_load_rejects_wrong_secret() -> None:
    a = SessionStore(secret="secret-a", max_age=SESSION_COOKIE_TTL_SECONDS)
    b = SessionStore(secret="secret-b", max_age=SESSION_COOKIE_TTL_SECONDS)
    token = a.dump(_sample_state())
    assert b.load(token) is None


@pytest.mark.unit
def test_load_rejects_expired_token(monkeypatch: pytest.MonkeyPatch) -> None:
    store = SessionStore(secret="test-session-secret", max_age=SESSION_COOKIE_TTL_SECONDS)
    token = store.dump(_sample_state())
    now = timed_mod.time.time()
    monkeypatch.setattr(timed_mod.time, "time", lambda: now + SESSION_COOKIE_TTL_SECONDS + 1)
    assert store.load(token) is None


@pytest.mark.unit
def test_default_max_age_is_thirty_minutes() -> None:
    store = SessionStore(secret="test-session-secret")
    assert store.max_age == 1800
    assert store.max_age == SESSION_COOKIE_TTL_SECONDS


@pytest.mark.unit
def test_dump_preserves_pending_cred_id() -> None:
    store = SessionStore(secret="test-session-secret")
    pending = _sample_state(
        mode=ConsentMode.DELEGATED,
        authenticated_sub="usr_x",
        pending_cred_id="cred_opaque_id",
    )
    loaded = store.load(store.dump(pending))
    assert loaded == pending
    assert loaded is not None
    assert loaded.pending_cred_id == "cred_opaque_id"
    # Cookie payload must never carry password fields.
    from itsdangerous import URLSafeTimedSerializer

    raw = URLSafeTimedSerializer("test-session-secret", salt="oauth2-login-pending").loads(store.dump(pending))
    assert "pending_password" not in raw
    assert "pending_username" not in raw
    assert raw.get("pending_cred_id") == "cred_opaque_id"


def _sign_raw_payload(secret: str, payload: dict[str, object]) -> str:
    from itsdangerous import URLSafeTimedSerializer

    return URLSafeTimedSerializer(secret, salt="oauth2-login-pending").dumps(payload)


@pytest.mark.unit
def test_load_returns_none_for_missing_required_field() -> None:
    store = SessionStore(secret="test-session-secret")
    token = _sign_raw_payload(
        "test-session-secret",
        {
            "client_id": "cli_test",
            "redirect_uri": "https://app.example/callback",
            "scopes": ["openid"],
            # code_challenge missing
            "mode": "identity",
        },
    )
    assert store.load(token) is None


@pytest.mark.unit
def test_load_returns_none_for_bad_mode() -> None:
    store = SessionStore(secret="test-session-secret")
    token = _sign_raw_payload(
        "test-session-secret",
        {
            "client_id": "cli_test",
            "redirect_uri": "https://app.example/callback",
            "scopes": ["openid"],
            "code_challenge": "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
            "mode": "not-a-valid-mode",
        },
    )
    assert store.load(token) is None


@pytest.mark.unit
def test_load_returns_none_for_bad_scopes_shape() -> None:
    store = SessionStore(secret="test-session-secret")
    token = _sign_raw_payload(
        "test-session-secret",
        {
            "client_id": "cli_test",
            "redirect_uri": "https://app.example/callback",
            "scopes": 123,
            "code_challenge": "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
            "mode": "identity",
        },
    )
    assert store.load(token) is None


@pytest.mark.unit
def test_portal_session_and_flash_round_trip() -> None:
    from src.session_cookie import PortalFlash, PortalSession, PortalSessionStore

    store = PortalSessionStore(secret="portal-secret")
    session_token = store.dump_session(PortalSession(sub="usr_abc"))
    assert store.load_session(session_token) == PortalSession(sub="usr_abc")
    flash_token = store.dump_flash(PortalFlash(client_id="cli_bound", client_secret="sec-once"))
    assert store.load_flash(flash_token) == PortalFlash(
        client_id="cli_bound",
        client_secret="sec-once",
    )
    assert store.load_session("tampered") is None
    assert store.load_flash("tampered") is None
