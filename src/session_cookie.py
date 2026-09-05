"""Signed browser session cookie for the OIDC login/consent flow and portal."""

from __future__ import annotations

from dataclasses import asdict, dataclass

from itsdangerous import BadData, URLSafeTimedSerializer

from src.config import SESSION_COOKIE_TTL_SECONDS
from src.models.consent import ConsentMode

_SALT = "oauth2-login-pending"
_PORTAL_SALT = "oauth2-portal-session"
_FLASH_SALT = "oauth2-portal-flash"


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


@dataclass(frozen=True)
class PortalSession:
    """Authenticated developer/admin subject for portal and admin HTML."""

    sub: str


@dataclass(frozen=True)
class PortalFlash:
    """One-time flash payload (e.g. newly created client secret)."""

    client_id: str
    client_secret: str


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


class PortalSessionStore:
    """Dump/load portal auth + one-time flash cookies (distinct from OIDC pending)."""

    def __init__(self, secret: str, max_age: int = SESSION_COOKIE_TTL_SECONDS) -> None:
        self._session = URLSafeTimedSerializer(secret, salt=_PORTAL_SALT)
        self._flash = URLSafeTimedSerializer(secret, salt=_FLASH_SALT)
        self.max_age = max_age

    def dump_session(self, session: PortalSession) -> str:
        """Serialize portal session."""
        return self._session.dumps({"sub": session.sub})

    def load_session(self, token: str) -> PortalSession | None:
        """Deserialize portal session, or None if invalid/expired."""
        try:
            payload = self._session.loads(token, max_age=self.max_age)
            return PortalSession(sub=str(payload["sub"]))
        except (BadData, KeyError, TypeError, ValueError):
            return None

    def dump_flash(self, flash: PortalFlash) -> str:
        """Serialize one-time flash."""
        return self._flash.dumps({"client_id": flash.client_id, "client_secret": flash.client_secret})

    def load_flash(self, token: str) -> PortalFlash | None:
        """Deserialize flash, or None if invalid/expired."""
        try:
            payload = self._flash.loads(token, max_age=self.max_age)
            return PortalFlash(
                client_id=str(payload["client_id"]),
                client_secret=str(payload["client_secret"]),
            )
        except (BadData, KeyError, TypeError, ValueError):
            return None
