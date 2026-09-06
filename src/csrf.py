"""Synchronizer CSRF tokens for browser HTML form POSTs."""

from __future__ import annotations

import hmac
import secrets
from typing import TYPE_CHECKING

from itsdangerous import BadData, URLSafeTimedSerializer

from src.session_cookie import SESSION_COOKIE_TTL_SECONDS

if TYPE_CHECKING:
    from fastapi.responses import Response
    from starlette.requests import Request

    from src.config import AppConfig

CSRF_COOKIE = "oauth2_csrf"
CSRF_FIELD = "csrf_token"
_CSRF_SALT = "oauth2-csrf-v1"


class CsrfStore:
    """Issue and verify CSRF tokens bound to a signed cookie."""

    def __init__(self, secret: str, max_age: int = SESSION_COOKIE_TTL_SECONDS) -> None:
        self._serializer = URLSafeTimedSerializer(secret, salt=_CSRF_SALT)
        self.max_age = max_age

    def new_token(self) -> str:
        """Return a fresh high-entropy CSRF token (plaintext for the form field)."""
        return secrets.token_urlsafe(32)

    def dump(self, token: str) -> str:
        """Serialize ``token`` into the CSRF cookie value."""
        return self._serializer.dumps({"t": token})

    def load(self, cookie: str) -> str | None:
        """Deserialize the CSRF cookie, or None if invalid/expired."""
        try:
            payload = self._serializer.loads(cookie, max_age=self.max_age)
            return str(payload["t"])
        except (BadData, KeyError, TypeError, ValueError):
            return None


def set_csrf_cookie(response: Response, config: AppConfig, signed: str) -> None:
    """Attach the signed CSRF cookie to ``response``."""
    response.set_cookie(
        key=CSRF_COOKIE,
        value=signed,
        httponly=True,
        secure=config.app_env != "local",
        samesite="lax",
        max_age=config.session_cookie_ttl_seconds,
        path="/",
    )


def clear_csrf_cookie(response: Response, config: AppConfig) -> None:
    """Clear the CSRF cookie (e.g. on logout)."""
    response.delete_cookie(
        key=CSRF_COOKIE,
        path="/",
        secure=config.app_env != "local",
        httponly=True,
        samesite="lax",
    )


def issue_csrf(response: Response, config: AppConfig, store: CsrfStore) -> str:
    """Mint a token, set the cookie, and return plaintext for the form field."""
    token = store.new_token()
    set_csrf_cookie(response, config, store.dump(token))
    return token


def verify_csrf(request: Request, store: CsrfStore, form_token: str | None) -> bool:
    """Return True when the form token matches the CSRF cookie (constant-time)."""
    if form_token is None or form_token == "":
        return False
    raw = request.cookies.get(CSRF_COOKIE)
    if raw is None:
        return False
    expected = store.load(raw)
    if expected is None:
        return False
    return hmac.compare_digest(expected, form_token)
