"""Unit tests for ephemeral pending-credential store (delegated login window)."""

from __future__ import annotations

import time

import pytest

from src.academy.models import AcademySession
from src.oidc.pending_credentials import PendingCredentials, PendingCredentialStore


def _creds() -> PendingCredentials:
    return PendingCredentials(
        username="owner",
        password="secret-pass",
        session=AcademySession(token="tok"),
    )


@pytest.mark.unit
def test_put_get_pop_round_trip() -> None:
    store = PendingCredentialStore(ttl_seconds=60)
    cred_id = store.put(_creds())
    assert store.get(cred_id) is not None
    assert store.get(cred_id).password == "secret-pass"  # type: ignore[union-attr]
    popped = store.pop(cred_id)
    assert popped is not None
    assert popped.password == "secret-pass"
    assert store.get(cred_id) is None
    assert store.pop(cred_id) is None


@pytest.mark.unit
def test_expired_credentials_are_unavailable(monkeypatch: pytest.MonkeyPatch) -> None:
    store = PendingCredentialStore(ttl_seconds=10)
    start = time.monotonic()
    monkeypatch.setattr(time, "monotonic", lambda: start)
    cred_id = store.put(_creds())
    monkeypatch.setattr(time, "monotonic", lambda: start + 11)
    assert store.get(cred_id) is None
