"""Integration: admin Production approval unlocks non-tester authorize (AC-005)."""

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
from src.models.client import PublishingStatus
from src.repos.admins import MongoAdminRepo
from src.repos.auth_codes import MongoAuthCodeRepo
from src.repos.clients import MongoClientRepo
from src.repos.consents import MongoConsentRepo
from src.repos.production_requests import MongoProductionRequestRepo
from src.repos.refresh_tokens import MongoRefreshTokenRepo
from src.repos.testers import MongoTesterRepo
from src.repos.users import MongoUserRepo

if TYPE_CHECKING:
    from collections.abc import AsyncIterator

    from fastapi import FastAPI
    from pymongo.asynchronous.database import AsyncDatabase

PORTAL_COOKIE = "oauth2_portal"
REDIRECT_URI = "https://gate.example/cb"
OWNER_SUB = "usr_gate_owner"
OWNER_PRN = "PES2202520001"
ADMIN_SUB = "usr_gate_admin"
ADMIN_PRN = "PES2202520002"
STRANGER_PRN = "PES2202520999"
SESSION_SECRET = "integration-portal-session"


def _s256_challenge(verifier: str) -> str:
    digest = hashlib.sha256(verifier.encode("ascii")).digest()
    return base64.urlsafe_b64encode(digest).rstrip(b"=").decode("ascii")


async def _build_app(mongo_db: AsyncDatabase, rsa_pem: str) -> FastAPI:
    await ensure_indexes(mongo_db)
    now = datetime.now(UTC)
    await mongo_db.users.insert_many(
        [
            {
                "sub": OWNER_SUB,
                "name": "GATE OWNER",
                "prn": OWNER_PRN,
                "srn": "PES2UG25CS201",
                "program": "B.Tech.",
                "branch": "CSE",
                "semester": "1",
                "section": "A",
                "campus": "RR",
                "email": "owner@gate.example",
                "phone": "9220000001",
                "created_at": now,
                "last_login_at": now,
                "deleted_at": None,
            },
            {
                "sub": ADMIN_SUB,
                "name": "GATE ADMIN",
                "prn": ADMIN_PRN,
                "srn": "PES2UG25CS202",
                "program": "B.Tech.",
                "branch": "CSE",
                "semester": "1",
                "section": "B",
                "campus": "RR",
                "email": "admin@gate.example",
                "phone": "9220000002",
                "created_at": now,
                "last_login_at": now,
                "deleted_at": None,
            },
        ]
    )
    await MongoAdminRepo(mongo_db).add_admin(ADMIN_SUB)
    academy = FakeAcademyClient(
        {
            ("owner", "good-pass"): AcademyAuthResult(
                profile=AcademyProfile(
                    name="GATE OWNER",
                    prn=OWNER_PRN,
                    srn="PES2UG25CS201",
                    program="B.Tech.",
                    branch="CSE",
                    semester="1",
                    section="A",
                    campus="RR",
                    email="owner@gate.example",
                    phone="9220000001",
                ),
                session=AcademySession(token="gate-owner"),
            ),
            ("admin", "good-pass"): AcademyAuthResult(
                profile=AcademyProfile(
                    name="GATE ADMIN",
                    prn=ADMIN_PRN,
                    srn="PES2UG25CS202",
                    program="B.Tech.",
                    branch="CSE",
                    semester="1",
                    section="B",
                    campus="RR",
                    email="admin@gate.example",
                    phone="9220000002",
                ),
                session=AcademySession(token="gate-admin"),
            ),
            ("stranger", "good-pass"): AcademyAuthResult(
                profile=AcademyProfile(
                    name="GATE STRANGER",
                    prn=STRANGER_PRN,
                    srn="PES2UG25CS999",
                    program="B.Tech.",
                    branch="ECE",
                    semester="1",
                    section="C",
                    campus="EC",
                    email="stranger@gate.example",
                    phone="9220000999",
                ),
                session=AcademySession(token="gate-stranger"),
            ),
        }
    )
    config = replace(
        load_config(),
        token_signing_key_pem=rsa_pem,
        session_secret=SESSION_SECRET,
    )
    return create_app(
        config,
        academy=academy,
        users=MongoUserRepo(mongo_db),
        clients=MongoClientRepo(mongo_db),
        testers=MongoTesterRepo(mongo_db),
        auth_codes=MongoAuthCodeRepo(mongo_db),
        refresh_tokens=MongoRefreshTokenRepo(mongo_db),
        consents=MongoConsentRepo(mongo_db),
        admins=MongoAdminRepo(mongo_db),
        production_requests=MongoProductionRequestRepo(mongo_db),
    )


@pytest.fixture
async def gate_client(mongo_db: AsyncDatabase, rsa_pem: str) -> AsyncIterator[AsyncClient]:
    application = await _build_app(mongo_db, rsa_pem)
    transport = ASGITransport(app=application)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        yield client


async def _portal_login(client: AsyncClient, *, username: str, password: str = "good-pass") -> None:
    from tests.csrf_helpers import form_with_csrf

    page = await client.get("/portal/login")
    assert page.status_code == 200
    resp = await client.post(
        "/portal/login",
        data=form_with_csrf(
            client,
            SESSION_SECRET,
            {"username": username, "password": password},
        ),
        follow_redirects=False,
    )
    assert resp.status_code in {302, 303}
    assert PORTAL_COOKIE in resp.cookies or PORTAL_COOKIE in client.cookies


def _csrf(client: AsyncClient, data: dict[str, object] | None = None) -> dict[str, object]:
    from tests.csrf_helpers import form_with_csrf

    return form_with_csrf(client, SESSION_SECRET, data)  # type: ignore[return-value]


async def _authorize_as_stranger(client: AsyncClient, client_id: str) -> object:
    verifier = "g" * 43
    await client.get(
        "/authorize",
        params={
            "response_type": "code",
            "client_id": client_id,
            "redirect_uri": REDIRECT_URI,
            "scope": "openid",
            "code_challenge": _s256_challenge(verifier),
            "code_challenge_method": "S256",
        },
        follow_redirects=False,
    )
    return await client.post(
        "/login",
        data={"username": "stranger", "password": "good-pass"},
        follow_redirects=False,
    )


@pytest.mark.integration
@pytest.mark.asyncio
async def test_admin_approve_unlocks_non_tester_authorize(
    gate_client: AsyncClient,
    mongo_db: AsyncDatabase,
) -> None:
    await _portal_login(gate_client, username="owner")
    create = await gate_client.post(
        "/portal/clients",
        data=_csrf(gate_client, {"name": "Gate Club", "redirect_uri": REDIRECT_URI}),
        follow_redirects=False,
    )
    assert create.status_code in {302, 303}
    location = create.headers["location"]
    client_id = location.rstrip("/").split("/")[-1].split("?")[0]

    doc = await mongo_db.clients.find_one({"client_id": client_id})
    assert doc is not None
    assert doc["publishing_status"] == PublishingStatus.TESTING.value

    # Non-tester refused while Testing
    gate_client.cookies.clear()
    deny = await _authorize_as_stranger(gate_client, client_id)
    assert deny.status_code == 200
    assert "not authorized" in deny.text.lower() or "testing" in deny.text.lower()

    # Owner requests Production
    gate_client.cookies.clear()
    await _portal_login(gate_client, username="owner")
    req = await gate_client.post(
        f"/portal/clients/{client_id}/request-production",
        data=_csrf(gate_client),
        follow_redirects=False,
    )
    assert req.status_code in {302, 303}
    pending = await mongo_db.clients.find_one({"client_id": client_id})
    assert pending is not None
    assert pending["publishing_status"] == PublishingStatus.PENDING_PRODUCTION.value
    request_doc = await mongo_db.production_requests.find_one({"client_id": client_id})
    assert request_doc is not None
    request_id = request_doc["request_id"]

    # Still gated while pending
    gate_client.cookies.clear()
    still_deny = await _authorize_as_stranger(gate_client, client_id)
    assert still_deny.status_code == 200
    assert "not authorized" in still_deny.text.lower() or "testing" in still_deny.text.lower()

    # Admin approves
    gate_client.cookies.clear()
    await _portal_login(gate_client, username="admin")
    approve = await gate_client.post(
        f"/admin/requests/{request_id}/approve",
        data=_csrf(gate_client, {"delegated_allowed": "false"}),
        follow_redirects=False,
    )
    assert approve.status_code in {302, 303}
    produced = await mongo_db.clients.find_one({"client_id": client_id})
    assert produced is not None
    assert produced["publishing_status"] == PublishingStatus.PRODUCTION.value

    # Non-tester can complete authorize → consent
    gate_client.cookies.clear()
    allow = await _authorize_as_stranger(gate_client, client_id)
    assert allow.status_code in {302, 303}
    assert "/consent" in allow.headers["location"]
    consent = await gate_client.post("/consent", data={"decision": "allow"}, follow_redirects=False)
    assert consent.status_code in {302, 303}
    qs = parse_qs(urlparse(consent.headers["location"]).query)
    assert "code" in qs
