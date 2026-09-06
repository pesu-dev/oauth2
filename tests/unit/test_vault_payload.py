"""Unit tests for vault plaintext pack/unpack helpers."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest

from src.academy.models import AcademySession
from src.crypto.vault_payload import (
    VaultPlaintext,
    pack_vault_plaintext,
    session_is_valid,
    unpack_vault_plaintext,
)


@pytest.mark.unit
def test_pack_unpack_round_trip() -> None:
    expires = datetime.now(UTC) + timedelta(hours=1)
    original = VaultPlaintext(
        username="owner",
        password="secret-pass",
        session=AcademySession(
            token="tok",
            access_token="at",
            user_id="uid",
            expires_at=expires,
        ),
    )
    restored = unpack_vault_plaintext(pack_vault_plaintext(original))
    assert restored.username == "owner"
    assert restored.password == "secret-pass"
    assert restored.session.token == "tok"
    assert restored.session.access_token == "at"
    assert restored.session.user_id == "uid"
    assert restored.session.expires_at == expires


@pytest.mark.unit
def test_pack_unpack_without_expiry() -> None:
    original = VaultPlaintext(
        username="u",
        password="p",
        session=AcademySession(token="t"),
    )
    restored = unpack_vault_plaintext(pack_vault_plaintext(original))
    assert restored.session.expires_at is None
    assert session_is_valid(restored.session) is False


@pytest.mark.unit
def test_session_is_valid_respects_expiry() -> None:
    past = AcademySession(token="t", expires_at=datetime.now(UTC) - timedelta(seconds=1))
    future = AcademySession(token="t", expires_at=datetime.now(UTC) + timedelta(hours=1))
    assert session_is_valid(past) is False
    assert session_is_valid(future) is True


@pytest.mark.unit
def test_session_is_valid_none_expiry_fails_closed() -> None:
    assert session_is_valid(AcademySession(token="t", expires_at=None)) is False


@pytest.mark.unit
def test_unpack_naive_expires_gets_utc() -> None:
    import json

    naive = datetime(2099, 1, 1, 12, 0, 0)
    packed = pack_vault_plaintext(
        VaultPlaintext(
            username="u",
            password="p",
            session=AcademySession(token="t", expires_at=naive.replace(tzinfo=UTC)),
        )
    )
    data = json.loads(packed.decode())
    data["session"]["expires_at"] = naive.isoformat()
    restored = unpack_vault_plaintext(json.dumps(data).encode())
    assert restored.session.expires_at is not None
    assert restored.session.expires_at.tzinfo is not None


@pytest.mark.unit
def test_session_is_valid_naive_expiry_assumes_utc() -> None:
    naive_future = datetime(2099, 6, 1, 12, 0, 0)  # no tzinfo
    assert session_is_valid(AcademySession(token="t", expires_at=naive_future)) is True
