"""Application configuration loaded from APP_ENV and optional secrets."""

from __future__ import annotations

import os
from dataclasses import dataclass

DB_NAME = "oauth2"

ACCESS_TOKEN_TTL_SECONDS = 3600
ID_TOKEN_TTL_SECONDS = 3600
REFRESH_TOKEN_TTL_SECONDS = 14 * 24 * 3600
AUTHORIZATION_CODE_TTL_SECONDS = 10 * 60
SESSION_COOKIE_TTL_SECONDS = 30 * 60

DEFAULT_MONGO_X509_CERT_PATH = "scratch/mongo-dev.pem"

ENVIRONMENTS: dict[str, dict[str, str]] = {
    "prod": {
        "mongo_uri": "mongodb+srv://pesudev.nkzgere.mongodb.net/",
        "issuer_url": "https://oauth2-prod-66snrlj46a-uc.a.run.app",
    },
    "staging": {
        "mongo_uri": "mongodb+srv://pesudev.andmjbp.mongodb.net/",
        "issuer_url": "https://oauth2-staging-66snrlj46a-uc.a.run.app",
    },
    "local": {
        "mongo_uri": "mongodb+srv://pesudev.andmjbp.mongodb.net/",
        "issuer_url": "http://localhost:8080",
    },
}


@dataclass(frozen=True)
class AppConfig:
    """Runtime settings selected by APP_ENV plus secrets from the environment."""

    app_env: str
    mongo_uri: str
    issuer_url: str
    db_name: str
    access_token_ttl_seconds: int
    id_token_ttl_seconds: int
    refresh_token_ttl_seconds: int
    authorization_code_ttl_seconds: int
    session_cookie_ttl_seconds: int
    token_signing_key_pem: str | None
    vault_master_key: str | None
    token_exchange_secret: str | None
    session_secret: str | None
    mongo_x509_cert_path: str
    gmail_smtp_user: str | None
    gmail_smtp_app_password: str | None


def _optional_env(name: str) -> str | None:
    value = os.environ.get(name)
    if value is None or value == "":
        return None
    return value


def load_config() -> AppConfig:
    """Load config for the current process. Secrets may be omitted only in local."""
    app_env = os.environ.get("APP_ENV", "local")
    if app_env not in ENVIRONMENTS:
        known = ", ".join(sorted(ENVIRONMENTS))
        msg = f"Unknown APP_ENV={app_env!r}; expected one of: {known}"
        raise ValueError(msg)

    env = ENVIRONMENTS[app_env]
    token_signing_key_pem = _optional_env("TOKEN_SIGNING_KEY")
    vault_master_key = _optional_env("VAULT_MASTER_KEY")
    token_exchange_secret = _optional_env("TOKEN_EXCHANGE_SECRET")
    session_secret = _optional_env("SESSION_SECRET")

    if app_env != "local":
        missing = [
            name
            for name, value in (
                ("TOKEN_SIGNING_KEY", token_signing_key_pem),
                ("VAULT_MASTER_KEY", vault_master_key),
                ("TOKEN_EXCHANGE_SECRET", token_exchange_secret),
                ("SESSION_SECRET", session_secret),
            )
            if value is None
        ]
        if missing:
            msg = f"Missing required secrets for APP_ENV={app_env!r}: {', '.join(missing)}"
            raise ValueError(msg)

    return AppConfig(
        app_env=app_env,
        mongo_uri=env["mongo_uri"],
        issuer_url=env["issuer_url"],
        db_name=DB_NAME,
        access_token_ttl_seconds=ACCESS_TOKEN_TTL_SECONDS,
        id_token_ttl_seconds=ID_TOKEN_TTL_SECONDS,
        refresh_token_ttl_seconds=REFRESH_TOKEN_TTL_SECONDS,
        authorization_code_ttl_seconds=AUTHORIZATION_CODE_TTL_SECONDS,
        session_cookie_ttl_seconds=SESSION_COOKIE_TTL_SECONDS,
        token_signing_key_pem=token_signing_key_pem,
        vault_master_key=vault_master_key,
        token_exchange_secret=token_exchange_secret,
        session_secret=session_secret,
        mongo_x509_cert_path=os.environ.get("MONGO_X509_CERT_PATH", DEFAULT_MONGO_X509_CERT_PATH),
        gmail_smtp_user=_optional_env("GMAIL_SMTP_USER"),
        gmail_smtp_app_password=_optional_env("GMAIL_SMTP_APP_PASSWORD"),
    )
