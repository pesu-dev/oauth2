"""Integration: delegated consent seals vault; token exchange; identity stays empty."""

from __future__ import annotations

import base64
import hashlib
from dataclasses import replace
from datetime import UTC, datetime
from typing import TYPE_CHECKING
from urllib.parse import parse_qs, urlparse

import pytest
from httpx import ASGITransport, AsyncClient

from src.academy.fake import FakeAcademyClient
from src.academy.models import AcademyAuthResult, AcademyProfile, AcademySession
from src.app import create_app
from src.config import load_config
from src.db.indexes import ensure_indexes
from src.models.client import Client, PublishingStatus
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


SESSION_COOKIE = "oauth2_login"
REDIRECT_URI = "https://club.example/callback"
IDENTITY_CLIENT = "cli_identity"
DELEGATED_CLIENT = "cli_delegated"
OWNER_SUB = "usr_owner_deleg"
OWNER_PRN = "PES2202599999"
EXCHANGE_SECRET = "integration-exchange-secret"
VAULT_MASTER = "integration-vault-master-key-32b!"
DELEGATED_SENTENCE = "will store"
IDENTITY_SENTENCE = "do not store"
PASSWORD = "good-pass"
ACADEMY_TOKEN = "academy-sess-deleg"


def _s256_challenge(verifier: str) -> str:
    digest = hashlib.sha256(verifier.encode("ascii")).digest()
    return base64.urlsafe_b64encode(digest).rstrip(b"=").decode("ascii")


async def _seed_and_app(mongo_db: AsyncDatabase, rsa_pem: str) -> FastAPI:
    await ensure_indexes(mongo_db)
    now = datetime.now(UTC)
    await mongo_db.users.insert_one(
        {
            "sub": OWNER_SUB,
            "name": "DELEG OWNER",
            "prn": OWNER_PRN,
            "srn": "PES2UG25CS999",
            "program": "B.Tech.",
            "branch": "CSE",
            "semester": "1",
            "section": "A",
            "campus": "RR",
            "email": "deleg@example.com",
            "phone": "9999999999",
            "created_at": now,
            "last_login_at": now,
            "deleted_at": None,
        }
    )
    clients = MongoClientRepo(mongo_db)
    await clients.create_client(
        Client(
            client_id=IDENTITY_CLIENT,
            client_secret_hash=None,
            name="Identity Club",
            owner_sub=OWNER_SUB,
            redirect_uris=(REDIRECT_URI,),
            token_endpoint_auth_method="none",
            publishing_status=PublishingStatus.TESTING,
            delegated_allowed=False,
            created_at=now,
            updated_at=now,
        )
    )
    await clients.create_client(
        Client(
            client_id=DELEGATED_CLIENT,
            client_secret_hash=None,
            name="Delegated Club",
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
                    name="DELEG OWNER",
                    prn=OWNER_PRN,
                    srn="PES2UG25CS999",
                    program="B.Tech.",
                    branch="CSE",
                    semester="1",
                    section="A",
                    campus="RR",
                    email="deleg@example.com",
                    phone="9999999999",
                ),
                session=AcademySession(token=ACADEMY_TOKEN, user_id="uid-deleg"),
            ),
        }
    )
    config = replace(
        load_config(),
        token_signing_key_pem=rsa_pem,
        session_secret="integration-session-secret",
        vault_master_key=VAULT_MASTER,
        token_exchange_secret=EXCHANGE_SECRET,
        first_party_api_client_id=DELEGATED_CLIENT,
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
async def deleg_client(mongo_db: AsyncDatabase, rsa_pem: str) -> AsyncIterator[AsyncClient]:
    application = await _seed_and_app(mongo_db, rsa_pem)
    transport = ASGITransport(app=application)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        yield client


async def _complete_code_flow(
    http: AsyncClient,
    *,
    client_id: str,
    verifier: str,
) -> str:
    """Authorize → login → consent allow → return authorization code."""
    auth = await http.get(
        "/authorize",
        params={
            "response_type": "code",
            "client_id": client_id,
            "redirect_uri": REDIRECT_URI,
            "scope": "openid profile",
            "state": "st",
            "nonce": "n",
            "code_challenge": _s256_challenge(verifier),
            "code_challenge_method": "S256",
        },
        follow_redirects=False,
    )
    assert auth.status_code == 302
    assert SESSION_COOKIE in http.cookies

    login = await http.post(
        "/login",
        data={"username": "owner", "password": PASSWORD},
        follow_redirects=False,
    )
    assert login.status_code in {302, 303}
    assert "/consent" in login.headers["location"]

    consent_page = await http.get("/consent")
    assert consent_page.status_code == 200

    allow = await http.post("/consent", data={"decision": "allow"}, follow_redirects=False)
    assert allow.status_code in {302, 303}
    loc = allow.headers["location"]
    assert loc.startswith(REDIRECT_URI)
    return parse_qs(urlparse(loc).query)["code"][0]


@pytest.mark.integration
@pytest.mark.asyncio
async def test_delegated_allow_writes_vault_and_exchange_returns_session(
    deleg_client: AsyncClient,
    mongo_db: AsyncDatabase,
) -> None:
    verifier = "d" * 43

    auth = await deleg_client.get(
        "/authorize",
        params={
            "response_type": "code",
            "client_id": DELEGATED_CLIENT,
            "redirect_uri": REDIRECT_URI,
            "scope": "openid profile",
            "code_challenge": _s256_challenge(verifier),
            "code_challenge_method": "S256",
        },
        follow_redirects=False,
    )
    assert auth.status_code == 302

    login = await deleg_client.post(
        "/login",
        data={"username": "owner", "password": PASSWORD},
        follow_redirects=False,
    )
    assert login.status_code in {302, 303}

    consent_page = await deleg_client.get("/consent")
    assert consent_page.status_code == 200
    assert DELEGATED_SENTENCE in consent_page.text.lower()
    assert "password" in consent_page.text.lower()
    assert "academy session" in consent_page.text.lower()

    allow = await deleg_client.post("/consent", data={"decision": "allow"}, follow_redirects=False)
    assert allow.status_code in {302, 303}
    code = parse_qs(urlparse(allow.headers["location"]).query)["code"][0]

    assert await mongo_db.vault.count_documents({"sub": OWNER_SUB}) == 1
    vault_doc = await mongo_db.vault.find_one({"sub": OWNER_SUB})
    assert vault_doc is not None
    assert "key_version" in vault_doc
    assert "ciphertext" in vault_doc or "wrapped_dek" in vault_doc

    token = await deleg_client.post(
        "/token",
        data={
            "grant_type": "authorization_code",
            "code": code,
            "redirect_uri": REDIRECT_URI,
            "client_id": DELEGATED_CLIENT,
            "code_verifier": verifier,
        },
    )
    assert token.status_code == 200
    access = token.json()["access_token"]

    exchange = await deleg_client.post(
        "/oauth/token-exchange",
        headers={"X-Token-Exchange-Secret": EXCHANGE_SECRET},
        data={"access_token": access},
    )
    assert exchange.status_code == 200
    body = exchange.json()
    assert body.get("token") == ACADEMY_TOKEN or body.get("session_token") == ACADEMY_TOKEN
    blob = exchange.text.lower()
    assert PASSWORD not in exchange.text
    assert "password" not in body
    assert PASSWORD.lower() not in blob


@pytest.mark.integration
@pytest.mark.asyncio
async def test_identity_flow_still_leaves_vault_empty(
    deleg_client: AsyncClient,
    mongo_db: AsyncDatabase,
) -> None:
    # Clear any prior vault from other tests in this module (fresh mongo_db per test).
    assert await mongo_db.vault.count_documents({}) == 0

    verifier = "i" * 43
    auth = await deleg_client.get(
        "/authorize",
        params={
            "response_type": "code",
            "client_id": IDENTITY_CLIENT,
            "redirect_uri": REDIRECT_URI,
            "scope": "openid",
            "code_challenge": _s256_challenge(verifier),
            "code_challenge_method": "S256",
        },
        follow_redirects=False,
    )
    assert auth.status_code == 302

    await deleg_client.post(
        "/login",
        data={"username": "owner", "password": PASSWORD},
        follow_redirects=False,
    )
    consent_page = await deleg_client.get("/consent")
    assert IDENTITY_SENTENCE in consent_page.text.lower()
    assert DELEGATED_SENTENCE not in consent_page.text.lower()

    allow = await deleg_client.post("/consent", data={"decision": "allow"}, follow_redirects=False)
    assert allow.status_code in {302, 303}
    assert await mongo_db.vault.count_documents({}) == 0


@pytest.mark.integration
@pytest.mark.asyncio
async def test_token_exchange_rejects_missing_secret(
    deleg_client: AsyncClient,
    mongo_db: AsyncDatabase,
) -> None:
    verifier = "e" * 43
    code = await _complete_code_flow(deleg_client, client_id=DELEGATED_CLIENT, verifier=verifier)
    token = await deleg_client.post(
        "/token",
        data={
            "grant_type": "authorization_code",
            "code": code,
            "redirect_uri": REDIRECT_URI,
            "client_id": DELEGATED_CLIENT,
            "code_verifier": verifier,
        },
    )
    access = token.json()["access_token"]
    resp = await deleg_client.post(
        "/oauth/token-exchange",
        data={"access_token": access},
    )
    assert resp.status_code in {401, 403}
