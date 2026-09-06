"""Unit tests for APP_ENV config loading."""

from __future__ import annotations

from typing import TYPE_CHECKING

import pytest

from src.config import ENVIRONMENTS, FIRST_PARTY_API_CLIENT_ID, load_config

if TYPE_CHECKING:
    from pathlib import Path


@pytest.mark.unit
def test_default_app_env_is_local(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("APP_ENV", raising=False)
    cfg = load_config()
    assert cfg.app_env == "local"
    assert cfg.issuer_url == "http://localhost:8080"
    assert cfg.db_name == "oauth2"
    assert cfg.access_token_ttl_seconds == 3600
    assert cfg.refresh_token_ttl_seconds == 14 * 24 * 3600
    assert cfg.first_party_api_client_id == FIRST_PARTY_API_CLIENT_ID


@pytest.mark.unit
def test_local_allows_missing_secrets(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    monkeypatch.setenv("APP_ENV", "local")
    missing_key = tmp_path / "missing-token-signing.pem"
    monkeypatch.setenv("TOKEN_SIGNING_KEY_PATH", str(missing_key))
    for name in (
        "VAULT_MASTER_KEY",
        "TOKEN_EXCHANGE_SECRET",
        "SESSION_SECRET",
        "GMAIL_SMTP_USER",
        "GMAIL_SMTP_APP_PASSWORD",
        "MONGO_X509_CERT_PATH",
    ):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.delenv("TOKEN_SIGNING_KEY", raising=False)

    cfg = load_config()
    assert cfg.mongo_uri == ENVIRONMENTS["local"]["mongo_uri"]
    assert cfg.id_token_ttl_seconds == 3600
    assert cfg.authorization_code_ttl_seconds == 600
    assert cfg.session_cookie_ttl_seconds == 1800
    assert cfg.token_signing_key_pem is None
    assert cfg.token_signing_key_path == str(missing_key)
    assert cfg.vault_master_key is None
    assert cfg.token_exchange_secret is None
    assert cfg.first_party_api_client_id == FIRST_PARTY_API_CLIENT_ID
    assert cfg.session_secret is None
    assert cfg.gmail_smtp_user is None
    assert cfg.gmail_smtp_app_password is None
    assert cfg.mongo_x509_cert_path == "scratch/mongo-dev.pem"


@pytest.mark.unit
def test_token_signing_key_loaded_from_path(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    pem_path = tmp_path / "token-signing.pem"
    pem_path.write_text("-----BEGIN PRIVATE KEY-----\npem-data\n-----END PRIVATE KEY-----\n")
    monkeypatch.setenv("APP_ENV", "local")
    monkeypatch.setenv("TOKEN_SIGNING_KEY_PATH", str(pem_path))

    cfg = load_config()
    assert cfg.token_signing_key_path == str(pem_path)
    assert cfg.token_signing_key_pem == pem_path.read_text()


@pytest.mark.unit
def test_staging_loads_secrets_and_issuer(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    pem_path = tmp_path / "staging.pem"
    pem_path.write_text("pem-data\n")
    monkeypatch.setenv("APP_ENV", "staging")
    monkeypatch.setenv("TOKEN_SIGNING_KEY_PATH", str(pem_path))
    monkeypatch.setenv("VAULT_MASTER_KEY", "vault-key")
    monkeypatch.setenv("TOKEN_EXCHANGE_SECRET", "exchange-secret")
    monkeypatch.setenv("SESSION_SECRET", "session-secret")
    monkeypatch.setenv("MONGO_X509_CERT_PATH", "/run/secrets/mongo.pem")
    monkeypatch.setenv("GMAIL_SMTP_USER", "noreply@gmail.com")
    monkeypatch.setenv("GMAIL_SMTP_APP_PASSWORD", "app-pass")

    cfg = load_config()
    assert cfg.app_env == "staging"
    assert cfg.mongo_uri == ENVIRONMENTS["staging"]["mongo_uri"]
    assert cfg.issuer_url == ENVIRONMENTS["staging"]["issuer_url"]
    assert cfg.token_signing_key_pem == "pem-data\n"
    assert cfg.token_signing_key_path == str(pem_path)
    assert cfg.vault_master_key == "vault-key"
    assert cfg.token_exchange_secret == "exchange-secret"
    assert cfg.first_party_api_client_id == FIRST_PARTY_API_CLIENT_ID
    assert cfg.session_secret == "session-secret"
    assert cfg.mongo_x509_cert_path == "/run/secrets/mongo.pem"
    assert cfg.gmail_smtp_user == "noreply@gmail.com"
    assert cfg.gmail_smtp_app_password == "app-pass"


@pytest.mark.unit
def test_prod_environment_uris(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    pem_path = tmp_path / "prod.pem"
    pem_path.write_text("pem\n")
    monkeypatch.setenv("APP_ENV", "prod")
    monkeypatch.setenv("TOKEN_SIGNING_KEY_PATH", str(pem_path))
    monkeypatch.setenv("VAULT_MASTER_KEY", "vault")
    monkeypatch.setenv("TOKEN_EXCHANGE_SECRET", "exchange")
    monkeypatch.setenv("SESSION_SECRET", "session")

    cfg = load_config()
    assert cfg.app_env == "prod"
    assert cfg.mongo_uri == ENVIRONMENTS["prod"]["mongo_uri"]
    assert cfg.issuer_url == ENVIRONMENTS["prod"]["issuer_url"]


@pytest.mark.unit
def test_unknown_app_env_rejected(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("APP_ENV", "dev")
    with pytest.raises(ValueError, match="Unknown APP_ENV"):
        load_config()


@pytest.mark.unit
def test_staging_requires_secrets(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    monkeypatch.setenv("APP_ENV", "staging")
    monkeypatch.setenv("TOKEN_SIGNING_KEY_PATH", str(tmp_path / "missing.pem"))
    for name in (
        "VAULT_MASTER_KEY",
        "TOKEN_EXCHANGE_SECRET",
        "SESSION_SECRET",
    ):
        monkeypatch.delenv(name, raising=False)

    with pytest.raises(ValueError, match="Missing required secrets"):
        load_config()


@pytest.mark.unit
def test_default_token_signing_key_path_when_unset(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    monkeypatch.setenv("APP_ENV", "local")
    monkeypatch.delenv("TOKEN_SIGNING_KEY_PATH", raising=False)
    monkeypatch.chdir(tmp_path)
    cfg = load_config()
    assert cfg.token_signing_key_path == "scratch/token-signing.pem"
    assert cfg.token_signing_key_pem is None


@pytest.mark.unit
def test_empty_token_signing_file_treated_as_missing(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    empty = tmp_path / "empty.pem"
    empty.write_text("  \n")
    monkeypatch.setenv("APP_ENV", "local")
    monkeypatch.setenv("TOKEN_SIGNING_KEY_PATH", str(empty))
    cfg = load_config()
    assert cfg.token_signing_key_pem is None


@pytest.mark.unit
def test_load_dotenv_runs_when_not_skipped(monkeypatch: pytest.MonkeyPatch) -> None:
    import sys

    import src.config as config_mod

    monkeypatch.delenv("PESU_OAUTH2_SKIP_DOTENV", raising=False)
    calls: list[int] = []

    class _FakeDotenv:
        @staticmethod
        def load_dotenv() -> None:
            calls.append(1)

    monkeypatch.setitem(sys.modules, "dotenv", _FakeDotenv)  # type: ignore[arg-type]
    config_mod._load_dotenv()
    assert calls == [1]


@pytest.mark.unit
def test_load_dotenv_tolerates_missing_package(monkeypatch: pytest.MonkeyPatch) -> None:
    import builtins

    import src.config as config_mod

    monkeypatch.delenv("PESU_OAUTH2_SKIP_DOTENV", raising=False)
    real_import = builtins.__import__

    def _import(name: str, *args: object, **kwargs: object) -> object:
        if name == "dotenv":
            raise ImportError("simulated")
        return real_import(name, *args, **kwargs)  # type: ignore[arg-type]

    monkeypatch.setattr(builtins, "__import__", _import)
    config_mod._load_dotenv()
