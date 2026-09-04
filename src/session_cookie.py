"""Signed browser session cookie for the OIDC login/consent flow."""

from __future__ import annotations

from dataclasses import asdict, dataclass

from itsdangerous import BadData, URLSafeTimedSerializer

from src.config import SESSION_COOKIE_TTL_SECONDS
from src.models.consent import ConsentMode

_SALT = "oauth2-login-pending"


@dataclass(frozen=True)
class LoginPendingState:
    """Authorization request + optional authenticated subject held in the cookie."""

    client_id: str
    redirect_uri: str
    scopes: frozenset[str]
    code_challenge: str
    mode: ConsentMode
    authenticated_sub: str | None = None
    state: str | None = None
    nonce: str | None = None


class SessionStore:
    """Dump/load ``LoginPendingState`` via ``URLSafeTimedSerializer``."""

    def __init__(self, secret: str, max_age: int = SESSION_COOKIE_TTL_SECONDS) -> None:
        self._serializer = URLSafeTimedSerializer(secret, salt=_SALT)
        self.max_age = max_age

    def dump(self, pending: LoginPendingState) -> str:
        """Serialize pending login state to a signed cookie value."""
        payload = asdict(pending)
        payload["scopes"] = sorted(pending.scopes)
        payload["mode"] = pending.mode.value
        return self._serializer.dumps(payload)

    def load(self, token: str) -> LoginPendingState | None:
        """Deserialize a cookie value, or return None if invalid/expired."""
        try:
            payload = self._serializer.loads(token, max_age=self.max_age)
            return LoginPendingState(
                client_id=payload["client_id"],
                redirect_uri=payload["redirect_uri"],
                scopes=frozenset(payload["scopes"]),
                code_challenge=payload["code_challenge"],
                mode=ConsentMode(payload["mode"]),
                authenticated_sub=payload.get("authenticated_sub"),
                state=payload.get("state"),
                nonce=payload.get("nonce"),
            )
        except (BadData, KeyError, TypeError, ValueError):
            return None
