"""Integration: full identity OIDC code+PKCE flow with Mongo + FakeAcademy."""

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

if TYPE_CHECKING:
    from collections.abc import AsyncIterator

    from fastapi import FastAPI
    from pymongo.asynchronous.database import AsyncDatabase


SESSION_COOKIE = "oauth2_login"
REDIRECT_URI = "https://club.example/callback"
CLIENT_ID = "cli_integration"
OWNER_SUB = "usr_owner_int"
OWNER_PRN = "PES2202511111"


def _s256_challenge(verifier: str) -> str:
    digest = hashlib.sha256(verifier.encode("ascii")).digest()
    return base64.urlsafe_b64encode(digest).rstrip(b"=").decode("ascii")


async def _seed_and_app(mongo_db: AsyncDatabase, rsa_pem: str) -> FastAPI:
    await ensure_indexes(mongo_db)
    now = datetime.now(UTC)
    await mongo_db.users.insert_one(
        {
            "sub": OWNER_SUB,
            "name": "INT OWNER",
            "prn": OWNER_PRN,
            "srn": "PES2UG25CS111",
            "program": "B.Tech.",
            "branch": "CSE",
            "semester": "1",
            "section": "A",
            "campus": "RR",
            "email": "owner@example.com",
            "phone": "9111111111",
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
            name="Integration Club",
            owner_sub=OWNER_SUB,
            redirect_uris=(REDIRECT_URI,),
            token_endpoint_auth_method="none",
            publishing_status=PublishingStatus.TESTING,
            delegated_allowed=False,
            created_at=now,
            updated_at=now,
        )
    )
    academy = FakeAcademyClient(
        {
            ("owner", "good-pass"): AcademyAuthResult(
                profile=AcademyProfile(
                    name="INT OWNER",
                    prn=OWNER_PRN,
                    srn="PES2UG25CS111",
                    program="B.Tech.",
                    branch="CSE",
                    semester="1",
                    section="A",
                    campus="RR",
                    email="owner@example.com",
                    phone="9111111111",
                ),
                session=AcademySession(token="academy-sess"),
            ),
            ("stranger", "good-pass"): AcademyAuthResult(
                profile=AcademyProfile(
                    name="STRANGER",
                    prn="PES2202500000",
                    srn="PES2UG25CS000",
                    program="B.Tech.",
                    branch="ECE",
                    semester="1",
                    section="B",
                    campus="EC",
                    email="stranger@example.com",
                    phone="9000000000",
                ),
                session=AcademySession(token="academy-stranger"),
            ),
        }
    )
    config = replace(
        load_config(),
        token_signing_key_pem=rsa_pem,
        session_secret="integration-session-secret",
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
    )


@pytest.fixture
async def oidc_client(mongo_db: AsyncDatabase, rsa_pem: str) -> AsyncIterator[AsyncClient]:
    """Async HTTP client sharing the pytest-asyncio loop with Mongo."""
    application = await _seed_and_app(mongo_db, rsa_pem)
    transport = ASGITransport(app=application)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        yield client


@pytest.mark.integration
@pytest.mark.asyncio
async def test_identity_code_flow_issues_tokens_without_vault(
    oidc_client: AsyncClient,
    mongo_db: AsyncDatabase,
) -> None:
    verifier = "i" * 43
    params = {
        "response_type": "code",
        "client_id": CLIENT_ID,
        "redirect_uri": REDIRECT_URI,
        "scope": "openid profile email offline_access",
        "state": "st1",
        "nonce": "n1",
        "code_challenge": _s256_challenge(verifier),
        "code_challenge_method": "S256",
    }
    auth = await oidc_client.get("/authorize", params=params, follow_redirects=False)
    assert auth.status_code == 302
    assert SESSION_COOKIE in oidc_client.cookies

    login = await oidc_client.post(
        "/login",
        data={"username": "owner", "password": "good-pass"},
        follow_redirects=False,
    )
    assert login.status_code in {302, 303}
    assert "/consent" in login.headers["location"]

    allow = await oidc_client.post("/consent", data={"decision": "allow"}, follow_redirects=False)
    assert allow.status_code in {302, 303}
    loc = allow.headers["location"]
    assert loc.startswith(REDIRECT_URI)
    code = parse_qs(urlparse(loc).query)["code"][0]

    token = await oidc_client.post(
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
    body = token.json()
    assert body["access_token"]
    assert body["id_token"]
    assert body["refresh_token"]

    userinfo = await oidc_client.get(
        "/userinfo",
        headers={"Authorization": f"Bearer {body['access_token']}"},
    )
    assert userinfo.status_code == 200
    claims = userinfo.json()
    assert claims["sub"] == OWNER_SUB
    assert claims["name"] == "INT OWNER"
    assert claims["email"] == "owner@example.com"

    assert await mongo_db.vault.count_documents({}) == 0


@pytest.mark.integration
@pytest.mark.asyncio
async def test_testing_deny_non_tester_integration(oidc_client: AsyncClient) -> None:
    verifier = "k" * 43
    await oidc_client.get(
        "/authorize",
        params={
            "response_type": "code",
            "client_id": CLIENT_ID,
            "redirect_uri": REDIRECT_URI,
            "scope": "openid",
            "code_challenge": _s256_challenge(verifier),
            "code_challenge_method": "S256",
        },
        follow_redirects=False,
    )
    resp = await oidc_client.post(
        "/login",
        data={"username": "stranger", "password": "good-pass"},
    )
    assert resp.status_code == 200
    assert "not authorized" in resp.text.lower() or "testing" in resp.text.lower()


@pytest.mark.integration
@pytest.mark.asyncio
async def test_bad_password_noop_integration(
    oidc_client: AsyncClient,
    mongo_db: AsyncDatabase,
) -> None:
    before = await mongo_db.users.count_documents({})
    verifier = "l" * 43
    await oidc_client.get(
        "/authorize",
        params={
            "response_type": "code",
            "client_id": CLIENT_ID,
            "redirect_uri": REDIRECT_URI,
            "scope": "openid",
            "code_challenge": _s256_challenge(verifier),
            "code_challenge_method": "S256",
        },
        follow_redirects=False,
    )
    resp = await oidc_client.post(
        "/login",
        data={"username": "owner", "password": "bad-pass"},
    )
    assert resp.status_code == 200
    assert "invalid" in resp.text.lower() or "incorrect" in resp.text.lower()
    assert await mongo_db.users.count_documents({}) == before
    assert await mongo_db.authorization_codes.count_documents({}) == 0


@pytest.mark.integration
@pytest.mark.asyncio
async def test_missing_pkce_integration(oidc_client: AsyncClient) -> None:
    resp = await oidc_client.get(
        "/authorize",
        params={
            "response_type": "code",
            "client_id": CLIENT_ID,
            "redirect_uri": REDIRECT_URI,
            "scope": "openid",
        },
    )
    assert resp.status_code == 400
