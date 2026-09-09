"""Helpers to pack/unpack vault plaintext (password + Academy session)."""

from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

from src.academy.models import AcademySession

CURRENT_VAULT_KEY_VERSION = 1


@dataclass(frozen=True)
class VaultPlaintext:
    """Material sealed into the vault after delegated consent."""

    username: str
    password: str
    session: AcademySession


def pack_vault_plaintext(payload: VaultPlaintext) -> bytes:
    """Serialize vault plaintext to UTF-8 JSON bytes."""
    session = payload.session
    body: dict[str, Any] = {
        "username": payload.username,
        "password": payload.password,
        "session": {
            "token": session.token,
            "access_token": session.access_token,
            "user_id": session.user_id,
            "expires_at": session.expires_at.isoformat() if session.expires_at is not None else None,
        },
    }
    return json.dumps(body, separators=(",", ":")).encode("utf-8")


def unpack_vault_plaintext(raw: bytes) -> VaultPlaintext:
    """Deserialize vault plaintext from UTF-8 JSON bytes."""
    data = json.loads(raw.decode("utf-8"))
    sess = data["session"]
    expires_raw = sess.get("expires_at")
    expires_at: datetime | None = None
    if expires_raw:
        expires_at = datetime.fromisoformat(str(expires_raw))
        if expires_at.tzinfo is None:
            expires_at = expires_at.replace(tzinfo=UTC)
    return VaultPlaintext(
        username=str(data["username"]),
        password=str(data["password"]),
        session=AcademySession(
            token=str(sess["token"]),
            access_token=sess.get("access_token"),
            user_id=sess.get("user_id"),
            expires_at=expires_at,
        ),
    )


def session_is_valid(session: AcademySession, *, now: datetime | None = None) -> bool:
    """Return True when the stored Academy session has a future expiry.

    Missing ``expires_at`` fails closed so exchange always re-authenticates
    rather than treating an unknown lifetime as valid forever.
    """
    if session.expires_at is None:
        return False
    clock = now if now is not None else datetime.now(UTC)
    expires = session.expires_at
    if expires.tzinfo is None:
        expires = expires.replace(tzinfo=UTC)
    return expires > clock
