"""Unit tests for POST /revoke (RFC 7009) and refresh invalidation."""

from __future__ import annotations

from dataclasses import replace
from datetime import UTC, datetime, timedelta
from typing import TYPE_CHECKING

import pytest
from fastapi.testclient import TestClient

from src.app import create_app
from src.config import load_config
from src.crypto.hashing import sha256_hex
from src.models.client import Client, PublishingStatus
from src.models.refresh_token import RefreshToken
from src.repos.fakes import (
    FakeAuthCodeRepo,
    FakeClientRepo,
    FakeConsentRepo,
    FakeRefreshTokenRepo,
    FakeTesterRepo,
    FakeUserRepo,
    FakeVaultRepo,
)

if TYPE_CHECKING:
    from collections.abc import Iterator

CLIENT_ID = "cli_revoke"
OTHER_CLIENT = "cli_other"
SUB = "usr_revoke"
RAW_REFRESH = "raw-refresh-token-for-revoke-tests"


@pytest.fixture
def revoke_env(rsa_pem: str) -> dict[str, object]:
    now = datetime.now(UTC)
    clients = FakeClientRepo()
    clients._by_id[CLIENT_ID] = Client(
        client_id=CLIENT_ID,
        client_secret_hash=None,
        name="Revoke Club",
        owner_sub=SUB,
        redirect_uris=("https://club.example/cb",),
        token_endpoint_auth_method="none",
        publishing_status=PublishingStatus.TESTING,
        delegated_allowed=False,
        created_at=now,
        updated_at=now,
    )
    clients._by_id[OTHER_CLIENT] = Client(
        client_id=OTHER_CLIENT,
        client_secret_hash=None,
        name="Other Club",
        owner_sub=SUB,
        redirect_uris=("https://other.example/cb",),
        token_endpoint_auth_method="none",
        publishing_status=PublishingStatus.TESTING,
        delegated_allowed=False,
        created_at=now,
        updated_at=now,
    )
    refresh = FakeRefreshTokenRepo()
    return {
        "clients": clients,
        "refresh_tokens": refresh,
        "users": FakeUserRepo(),
        "testers": FakeTesterRepo(),
        "auth_codes": FakeAuthCodeRepo(),
        "consents": FakeConsentRepo(),
        "vault": FakeVaultRepo(),
        "config": replace(
            load_config(),
            token_signing_key_pem=rsa_pem,
            session_secret="unit-session-secret",
        ),
    }


@pytest.fixture
def revoke_client(revoke_env: dict[str, object]) -> Iterator[TestClient]:
    app = create_app(
        revoke_env["config"],  # type: ignore[arg-type]
        users=revoke_env["users"],  # type: ignore[arg-type]
        clients=revoke_env["clients"],  # type: ignore[arg-type]
        testers=revoke_env["testers"],  # type: ignore[arg-type]
        auth_codes=revoke_env["auth_codes"],  # type: ignore[arg-type]
        refresh_tokens=revoke_env["refresh_tokens"],  # type: ignore[arg-type]
        consents=revoke_env["consents"],  # type: ignore[arg-type]
        vault=revoke_env["vault"],  # type: ignore[arg-type]
    )
    with TestClient(app) as client:
        yield client


def _seed_refresh(repo: FakeRefreshTokenRepo) -> RefreshToken:
    now = datetime.now(UTC)
    token = RefreshToken(
        token_hash=sha256_hex(RAW_REFRESH),
        family_id="fam_revoke",
        client_id=CLIENT_ID,
        sub=SUB,
        scopes=frozenset({"openid", "offline_access"}),
        expires_at=now + timedelta(days=14),
        created_at=now,
        revoked_at=None,
    )
    repo._by_hash[token.token_hash] = token
    return token


@pytest.mark.unit
def test_revoke_refresh_invalidates_token(
    revoke_client: TestClient,
    revoke_env: dict[str, object],
) -> None:
    refresh_repo: FakeRefreshTokenRepo = revoke_env["refresh_tokens"]  # type: ignore[assignment]
    _seed_refresh(refresh_repo)

    resp = revoke_client.post(
        "/revoke",
        data={
            "token": RAW_REFRESH,
            "token_type_hint": "refresh_token",
            "client_id": CLIENT_ID,
        },
    )
    assert resp.status_code == 200
    assert resp.content in {b"", b"{}"} or resp.text in {"", "{}"}

    stored = refresh_repo._by_hash[sha256_hex(RAW_REFRESH)]
    assert stored.revoked_at is not None

    refresh = revoke_client.post(
        "/token",
        data={
            "grant_type": "refresh_token",
            "refresh_token": RAW_REFRESH,
            "client_id": CLIENT_ID,
        },
    )
    assert refresh.status_code == 400
    assert refresh.json()["error"] == "invalid_grant"


@pytest.mark.unit
def test_revoke_unknown_token_still_returns_200(revoke_client: TestClient) -> None:
    resp = revoke_client.post(
        "/revoke",
        data={
            "token": "totally-unknown-token",
            "client_id": CLIENT_ID,
        },
    )
    assert resp.status_code == 200


@pytest.mark.unit
def test_revoke_wrong_client_does_not_revoke(
    revoke_client: TestClient,
    revoke_env: dict[str, object],
) -> None:
    refresh_repo: FakeRefreshTokenRepo = revoke_env["refresh_tokens"]  # type: ignore[assignment]
    _seed_refresh(refresh_repo)

    resp = revoke_client.post(
        "/revoke",
        data={
            "token": RAW_REFRESH,
            "client_id": OTHER_CLIENT,
        },
    )
    # RFC 7009: do not leak whether token exists — 200, but must not revoke for other client
    assert resp.status_code == 200
    stored = refresh_repo._by_hash[sha256_hex(RAW_REFRESH)]
    assert stored.revoked_at is None


@pytest.mark.unit
def test_revoke_access_token_hint_is_noop_200(revoke_client: TestClient) -> None:
    resp = revoke_client.post(
        "/revoke",
        data={
            "token": "eyJhbGciOiJSUzI1NiJ9.access.fake",
            "token_type_hint": "access_token",
            "client_id": CLIENT_ID,
        },
    )
    assert resp.status_code == 200


@pytest.mark.unit
def test_revoke_requires_client(revoke_client: TestClient) -> None:
    resp = revoke_client.post("/revoke", data={"token": RAW_REFRESH})
    assert resp.status_code == 401
    assert resp.json()["error"] == "invalid_client"


@pytest.mark.unit
def test_revoke_missing_token_is_invalid_request(revoke_client: TestClient) -> None:
    resp = revoke_client.post("/revoke", data={"client_id": CLIENT_ID})
    assert resp.status_code == 400
    assert resp.json()["error"] == "invalid_request"


@pytest.mark.unit
def test_revoke_unknown_client(revoke_client: TestClient) -> None:
    resp = revoke_client.post(
        "/revoke",
        data={"token": RAW_REFRESH, "client_id": "cli_missing"},
    )
    assert resp.status_code == 401
    assert resp.json()["error"] == "invalid_client"


@pytest.mark.unit
def test_revoke_with_client_secret_auth(rsa_pem: str) -> None:
    now = datetime.now(UTC)
    secret = "client-secret-value"
    clients = FakeClientRepo()
    clients._by_id[CLIENT_ID] = Client(
        client_id=CLIENT_ID,
        client_secret_hash=sha256_hex(secret),
        name="Secret Club",
        owner_sub=SUB,
        redirect_uris=("https://club.example/cb",),
        token_endpoint_auth_method="client_secret_post",
        publishing_status=PublishingStatus.TESTING,
        delegated_allowed=False,
        created_at=now,
        updated_at=now,
    )
    refresh = FakeRefreshTokenRepo()
    _seed_refresh(refresh)
    config = replace(
        load_config(),
        token_signing_key_pem=rsa_pem,
        session_secret="unit-session-secret",
    )
    app = create_app(
        config,
        users=FakeUserRepo(),
        clients=clients,
        testers=FakeTesterRepo(),
        auth_codes=FakeAuthCodeRepo(),
        refresh_tokens=refresh,
        consents=FakeConsentRepo(),
        vault=FakeVaultRepo(),
    )
    with TestClient(app) as client:
        bad = client.post(
            "/revoke",
            data={"token": RAW_REFRESH, "client_id": CLIENT_ID, "client_secret": "wrong"},
        )
        assert bad.status_code == 401

        missing = client.post(
            "/revoke",
            data={"token": RAW_REFRESH, "client_id": CLIENT_ID},
        )
        assert missing.status_code == 401

        ok = client.post(
            "/revoke",
            data={
                "token": RAW_REFRESH,
                "client_id": CLIENT_ID,
                "client_secret": secret,
            },
        )
        assert ok.status_code == 200
        assert refresh._by_hash[sha256_hex(RAW_REFRESH)].revoked_at is not None


@pytest.mark.unit
def test_revoke_secret_client_without_hash(rsa_pem: str) -> None:
    now = datetime.now(UTC)
    clients = FakeClientRepo()
    clients._by_id[CLIENT_ID] = Client(
        client_id=CLIENT_ID,
        client_secret_hash=None,
        name="Misconfigured",
        owner_sub=SUB,
        redirect_uris=("https://club.example/cb",),
        token_endpoint_auth_method="client_secret_post",
        publishing_status=PublishingStatus.TESTING,
        delegated_allowed=False,
        created_at=now,
        updated_at=now,
    )
    config = replace(
        load_config(),
        token_signing_key_pem=rsa_pem,
        session_secret="unit-session-secret",
    )
    app = create_app(
        config,
        users=FakeUserRepo(),
        clients=clients,
        testers=FakeTesterRepo(),
        auth_codes=FakeAuthCodeRepo(),
        refresh_tokens=FakeRefreshTokenRepo(),
        consents=FakeConsentRepo(),
        vault=FakeVaultRepo(),
    )
    with TestClient(app) as client:
        resp = client.post(
            "/revoke",
            data={"token": RAW_REFRESH, "client_id": CLIENT_ID, "client_secret": "x"},
        )
        assert resp.status_code == 401
