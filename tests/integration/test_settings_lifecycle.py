"""Integration: revoke refresh, delete credentials, delete account (AC-008)."""

from __future__ import annotations

import base64
import hashlib
from dataclasses import replace
from datetime import UTC, datetime, timedelta
from typing import TYPE_CHECKING
from urllib.parse import parse_qs, urlparse

import pytest
from httpx import ASGITransport, AsyncClient

from src.academy.fake import FakeAcademyClient
from src.academy.models import AcademyAuthResult, AcademyProfile, AcademySession
from src.app import create_app
from src.config import load_config
from src.crypto.hashing import sha256_hex
from src.crypto.vault_crypto import master_key_from_secret, seal
from src.db.indexes import ensure_indexes
from src.models.client import Client, PublishingStatus
from src.models.consent import Consent, ConsentMode
from src.models.refresh_token import RefreshToken
from src.models.vault import VaultEntry
from src.repos.auth_codes import MongoAuthCodeRepo
from src.repos.clients import MongoClientRepo
from src.repos.consents import MongoConsentRepo
from src.repos.refresh_tokens import MongoRefreshTokenRepo
from src.repos.testers import MongoTesterRepo
from src.repos.users import MongoUserRepo
from src.repos.vault import MongoVaultRepo

if TYPE_CHECKING:
    from collections.abc import AsyncIterator

    from fastapi import FastAPI
    from pymongo.asynchronous.database import AsyncDatabase


SETTINGS_COOKIE = "oauth2_settings"
REDIRECT_URI = "https://club.example/callback"
CLIENT_ID = "cli_settings"
OWNER_SUB = "usr_settings_owner"
OWNER_PRN = "PES2202588888"
PASSWORD = "good-pass"
VAULT_MASTER = "integration-vault-master-key-32b!"
SESSION_SECRET = "integration-session-secret"


def _s256_challenge(verifier: str) -> str:
    digest = hashlib.sha256(verifier.encode("ascii")).digest()
    return base64.urlsafe_b64encode(digest).rstrip(b"=").decode("ascii")


async def _seed_and_app(mongo_db: AsyncDatabase, rsa_pem: str) -> FastAPI:
    await ensure_indexes(mongo_db)
    now = datetime.now(UTC)
    await mongo_db.users.insert_one(
        {
            "sub": OWNER_SUB,
            "name": "SETTINGS OWNER",
            "prn": OWNER_PRN,
            "srn": "PES2UG25CS888",
            "program": "B.Tech.",
            "branch": "CSE",
            "semester": "1",
            "section": "A",
            "campus": "RR",
            "email": "settings@example.com",
            "phone": "9888888888",
            "created_at": now,
            "last_login_at": now,
            "deleted_at": None,
        }
    )
    clients = MongoClientRepo(mongo_db)
    await clients.create_client(
        Client(
            client_id=CLIENT_ID,
            client_secret_hash=None,
            name="Settings Club",
            owner_sub=OWNER_SUB,
            redirect_uris=(REDIRECT_URI,),
            token_endpoint_auth_method="none",
            publishing_status=PublishingStatus.TESTING,
            delegated_allowed=True,
            created_at=now,
            updated_at=now,
        )
    )
    academy = FakeAcademyClient(
        {
            ("owner", PASSWORD): AcademyAuthResult(
                profile=AcademyProfile(
                    name="SETTINGS OWNER",
                    prn=OWNER_PRN,
                    srn="PES2UG25CS888",
                    program="B.Tech.",
                    branch="CSE",
                    semester="1",
                    section="A",
                    campus="RR",
                    email="settings@example.com",
                    phone="9888888888",
                ),
                session=AcademySession(token="academy-settings-sess", user_id="uid-settings"),
            ),
        }
    )
    config = replace(
        load_config(),
        token_signing_key_pem=rsa_pem,
        session_secret=SESSION_SECRET,
        vault_master_key=VAULT_MASTER,
    )
    return create_app(
        config,
        academy=academy,
        users=MongoUserRepo(mongo_db),
        clients=clients,
        testers=MongoTesterRepo(mongo_db),
        auth_codes=MongoAuthCodeRepo(mongo_db),
        refresh_tokens=MongoRefreshTokenRepo(mongo_db),
        consents=MongoConsentRepo(mongo_db),
        vault=MongoVaultRepo(mongo_db),
    )


@pytest.fixture
async def settings_client(mongo_db: AsyncDatabase, rsa_pem: str) -> AsyncIterator[AsyncClient]:
    application = await _seed_and_app(mongo_db, rsa_pem)
    transport = ASGITransport(app=application)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        yield client


async def _issue_refresh(client: AsyncClient) -> str:
    verifier = "s" * 43
    params = {
        "response_type": "code",
        "client_id": CLIENT_ID,
        "redirect_uri": REDIRECT_URI,
        "scope": "openid profile email offline_access",
        "state": "st-settings",
        "nonce": "n-settings",
        "code_challenge": _s256_challenge(verifier),
        "code_challenge_method": "S256",
    }
    auth = await client.get("/authorize", params=params, follow_redirects=False)
    assert auth.status_code == 302

    login = await client.post(
        "/login",
        data={"username": "owner", "password": PASSWORD},
        follow_redirects=False,
    )
    assert login.status_code in {302, 303}

    allow = await client.post("/consent", data={"decision": "allow"}, follow_redirects=False)
    assert allow.status_code in {302, 303}
    code = parse_qs(urlparse(allow.headers["location"]).query)["code"][0]

    token = await client.post(
        "/token",
        data={
            "grant_type": "authorization_code",
            "code": code,
            "redirect_uri": REDIRECT_URI,
            "client_id": CLIENT_ID,
            "code_verifier": verifier,
        },
    )
    assert token.status_code == 200
    return str(token.json()["refresh_token"])


def _csrf(client: AsyncClient, data: dict[str, object] | None = None) -> dict[str, object]:
    from tests.csrf_helpers import form_with_csrf

    return form_with_csrf(client, SESSION_SECRET, data)  # type: ignore[return-value]


async def _settings_login(client: AsyncClient) -> None:
    page = await client.get("/settings/login")
    assert page.status_code == 200
    login = await client.post(
        "/settings/login",
        data=_csrf(client, {"username": "owner", "password": PASSWORD}),
        follow_redirects=False,
    )
    assert login.status_code in {302, 303}
    assert SETTINGS_COOKIE in client.cookies


@pytest.mark.integration
@pytest.mark.asyncio
async def test_revoke_refresh_makes_subsequent_refresh_fail(
    settings_client: AsyncClient,
) -> None:
    refresh = await _issue_refresh(settings_client)

    revoked = await settings_client.post(
        "/revoke",
        data={
            "token": refresh,
            "token_type_hint": "refresh_token",
            "client_id": CLIENT_ID,
        },
    )
    assert revoked.status_code == 200

    again = await settings_client.post(
        "/token",
        data={
            "grant_type": "refresh_token",
            "refresh_token": refresh,
            "client_id": CLIENT_ID,
        },
    )
    assert again.status_code == 400
    assert again.json()["error"] == "invalid_grant"


@pytest.mark.integration
@pytest.mark.asyncio
async def test_delete_credentials_drops_vault_identity_consents_remain(
    settings_client: AsyncClient,
    mongo_db: AsyncDatabase,
) -> None:
    now = datetime.now(UTC)
    consents = MongoConsentRepo(mongo_db)
    await consents.upsert_consent(
        Consent(
            sub=OWNER_SUB,
            client_id=CLIENT_ID,
            scopes=frozenset({"openid", "profile"}),
            mode=ConsentMode.IDENTITY,
            granted_at=now,
        )
    )
    master = master_key_from_secret(VAULT_MASTER)
    blob = seal(master, b'{"username":"owner","password":"x"}', 1)
    vault = MongoVaultRepo(mongo_db)
    await vault.upsert_vault(VaultEntry(sub=OWNER_SUB, blob=blob, session_expires_at=now + timedelta(hours=1)))
    assert await vault.get_vault(OWNER_SUB) is not None

    await _settings_login(settings_client)
    resp = await settings_client.post(
        "/settings/credentials/delete",
        data=_csrf(settings_client),
        follow_redirects=False,
    )
    assert resp.status_code in {302, 303}

    assert await vault.get_vault(OWNER_SUB) is None
    remaining = await consents.get_consent(OWNER_SUB, CLIENT_ID)
    assert remaining is not None
    assert remaining.mode == ConsentMode.IDENTITY


@pytest.mark.integration
@pytest.mark.asyncio
async def test_delete_account_tombstones_sub_and_rejects_reuse(
    settings_client: AsyncClient,
    mongo_db: AsyncDatabase,
) -> None:
    now = datetime.now(UTC)
    consents = MongoConsentRepo(mongo_db)
    await consents.upsert_consent(
        Consent(
            sub=OWNER_SUB,
            client_id=CLIENT_ID,
            scopes=frozenset({"openid", "profile"}),
            mode=ConsentMode.DELEGATED,
            granted_at=now,
        )
    )
    master = master_key_from_secret(VAULT_MASTER)
    blob = seal(master, b'{"username":"owner","password":"x"}', 1)
    vault = MongoVaultRepo(mongo_db)
    await vault.upsert_vault(VaultEntry(sub=OWNER_SUB, blob=blob, session_expires_at=None))

    raw_refresh = "integration-refresh-raw-token-value"
    refresh_repo = MongoRefreshTokenRepo(mongo_db)
    await refresh_repo.store_refresh(
        RefreshToken(
            token_hash=sha256_hex(raw_refresh),
            family_id="fam_settings",
            client_id=CLIENT_ID,
            sub=OWNER_SUB,
            scopes=frozenset({"openid", "offline_access"}),
            expires_at=now + timedelta(days=14),
            created_at=now,
            revoked_at=None,
        )
    )

    await _settings_login(settings_client)
    resp = await settings_client.post(
        "/settings/account/delete",
        data=_csrf(settings_client, {"confirm": "DELETE"}),
        follow_redirects=False,
    )
    assert resp.status_code in {302, 303}

    users = MongoUserRepo(mongo_db)
    assert await users.get_user(OWNER_SUB) is None
    tomb = await mongo_db.users.find_one({"sub": OWNER_SUB})
    assert tomb is not None
    assert tomb.get("deleted_at") is not None

    assert await vault.get_vault(OWNER_SUB) is None
    assert await consents.get_consent(OWNER_SUB, CLIENT_ID) is None
    stored = await refresh_repo.get_refresh(sha256_hex(raw_refresh))
    assert stored is not None
    assert stored.revoked_at is not None

    # Same PRN logs in again → new sub; tombstoned sub never reused
    reauth = await users.upsert_user_from_profile(
        AcademyProfile(
            name="SETTINGS OWNER",
            prn=OWNER_PRN,
            srn="PES2UG25CS888",
            program="B.Tech.",
            branch="CSE",
            semester="1",
            section="A",
            campus="RR",
            email="settings@example.com",
            phone="9888888888",
        )
    )
    assert reauth.sub != OWNER_SUB

    page = await settings_client.get("/settings/login")
    assert page.status_code == 200
    login = await settings_client.post(
        "/settings/login",
        data=_csrf(settings_client, {"username": "owner", "password": PASSWORD}),
        follow_redirects=False,
    )
    assert login.status_code in {302, 303}
    home = await settings_client.get("/settings")
    assert home.status_code == 200
    assert OWNER_SUB not in home.text
    assert reauth.sub in home.text
