"""Extra unit coverage for OIDC edge paths (deps, token errors, gates)."""

from __future__ import annotations

from dataclasses import replace
from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from src.academy.fake import FakeAcademyClient
from src.academy.models import AcademyAuthResult, AcademyProfile, AcademySession
from src.app import create_app
from src.config import load_config
from src.crypto.hashing import sha256_hex
from src.models.client import Client, PublishingStatus
from src.models.refresh_token import RefreshToken
from src.models.user import User
from src.oidc import deps
from src.oidc.rate_limit import SlidingWindowRateLimiter
from src.repos.fakes import (
    FakeAuthCodeRepo,
    FakeClientRepo,
    FakeConsentRepo,
    FakeRefreshTokenRepo,
    FakeTesterRepo,
    FakeUserRepo,
)
from src.repos.refresh_tokens import MongoRefreshTokenRepo, _token_from_doc
from src.repos.users import MongoUserRepo

OWNER_SUB = "usr_edge_owner"
CLIENT_ID = "cli_edge"
REDIRECT = "https://edge.example/cb"


def _app_with_fakes(rsa_pem: str, **overrides: object) -> tuple[TestClient, dict[str, object]]:
    users = FakeUserRepo()
    now = datetime.now(UTC)
    users._by_sub[OWNER_SUB] = User(
        sub=OWNER_SUB,
        name="EDGE",
        prn="PES2202588888",
        srn=None,
        program=None,
        branch=None,
        semester=None,
        section=None,
        campus=None,
        email="e@example.com",
        phone=None,
        created_at=now,
        last_login_at=now,
    )
    clients = FakeClientRepo()
    clients._by_id[CLIENT_ID] = Client(
        client_id=CLIENT_ID,
        client_secret_hash=None,
        name="Edge App",
        owner_sub=OWNER_SUB,
        redirect_uris=(REDIRECT,),
        token_endpoint_auth_method="none",
        publishing_status=PublishingStatus.PRODUCTION,
        delegated_allowed=False,
        created_at=now,
        updated_at=now,
    )
    academy = FakeAcademyClient(
        {
            ("edge", "ok"): AcademyAuthResult(
                profile=AcademyProfile(
                    name="EDGE",
                    prn="PES2202588888",
                    srn=None,
                    program=None,
                    branch=None,
                    semester=None,
                    section=None,
                    campus=None,
                    email="e@example.com",
                    phone=None,
                ),
                session=AcademySession(token="t"),
            ),
            ("other", "ok"): AcademyAuthResult(
                profile=AcademyProfile(
                    name="OTHER",
                    prn="PES2202577777",
                    srn=None,
                    program=None,
                    branch=None,
                    semester=None,
                    section=None,
                    campus=None,
                    email="o@example.com",
                    phone=None,
                ),
                session=AcademySession(token="t2"),
            ),
        }
    )
    deps_map: dict[str, object] = {
        "users": users,
        "clients": clients,
        "testers": FakeTesterRepo(),
        "auth_codes": FakeAuthCodeRepo(),
        "refresh_tokens": FakeRefreshTokenRepo(),
        "consents": FakeConsentRepo(),
        "academy": academy,
        **overrides,
    }
    application = create_app(
        replace(load_config(), token_signing_key_pem=rsa_pem, session_secret="edge-secret"),
        academy=deps_map["academy"],  # type: ignore[arg-type]
        users=deps_map["users"],  # type: ignore[arg-type]
        clients=deps_map["clients"],  # type: ignore[arg-type]
        testers=deps_map["testers"],  # type: ignore[arg-type]
        auth_codes=deps_map["auth_codes"],  # type: ignore[arg-type]
        refresh_tokens=deps_map["refresh_tokens"],  # type: ignore[arg-type]
        consents=deps_map["consents"],  # type: ignore[arg-type]
    )
    return TestClient(application), deps_map


@pytest.mark.unit
def test_production_client_allows_non_owner(rsa_pem: str) -> None:
    import base64
    import hashlib
    from urllib.parse import parse_qs, urlparse

    with _app_with_fakes(rsa_pem)[0] as client:
        verifier = "u" * 43
        challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
        client.get(
            "/authorize",
            params={
                "response_type": "code",
                "client_id": CLIENT_ID,
                "redirect_uri": REDIRECT,
                "scope": "openid",
                "code_challenge": challenge,
                "code_challenge_method": "S256",
            },
            follow_redirects=False,
        )
        login = client.post(
            "/login",
            data={"username": "other", "password": "ok"},
            follow_redirects=False,
        )
        assert login.status_code in {302, 303}
        assert "/consent" in login.headers["location"]
        allow = client.post("/consent", data={"decision": "allow"}, follow_redirects=False)
        assert "code=" in allow.headers["location"]
        _ = parse_qs(urlparse(allow.headers["location"]).query)


@pytest.mark.unit
def test_tester_allowlist_passes_testing_gate(rsa_pem: str) -> None:
    import base64
    import hashlib

    client_http, deps_map = _app_with_fakes(rsa_pem)
    clients = deps_map["clients"]
    assert isinstance(clients, FakeClientRepo)
    now = datetime.now(UTC)
    clients._by_id[CLIENT_ID] = Client(
        client_id=CLIENT_ID,
        client_secret_hash=None,
        name="Edge App",
        owner_sub=OWNER_SUB,
        redirect_uris=(REDIRECT,),
        token_endpoint_auth_method="none",
        publishing_status=PublishingStatus.TESTING,
        delegated_allowed=False,
        created_at=now,
        updated_at=now,
    )
    # Pre-seed stranger with known sub and mark as tester
    users = deps_map["users"]
    assert isinstance(users, FakeUserRepo)
    stranger_sub = "usr_tester_edge"
    users._by_sub[stranger_sub] = User(
        sub=stranger_sub,
        name="OTHER",
        prn="PES2202577777",
        srn=None,
        program=None,
        branch=None,
        semester=None,
        section=None,
        campus=None,
        email="o@example.com",
        phone=None,
        created_at=now,
        last_login_at=now,
    )
    testers = deps_map["testers"]
    assert isinstance(testers, FakeTesterRepo)
    testers._pairs.add((CLIENT_ID, stranger_sub))

    with client_http as client:
        verifier = "v" * 43
        challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
        client.get(
            "/authorize",
            params={
                "response_type": "code",
                "client_id": CLIENT_ID,
                "redirect_uri": REDIRECT,
                "scope": "openid",
                "code_challenge": challenge,
                "code_challenge_method": "S256",
            },
            follow_redirects=False,
        )
        login = client.post(
            "/login",
            data={"username": "other", "password": "ok"},
            follow_redirects=False,
        )
        assert login.status_code in {302, 303}
        assert "/consent" in login.headers["location"]


@pytest.mark.unit
def test_authorize_missing_client_id_and_bad_response_type(rsa_pem: str) -> None:
    with _app_with_fakes(rsa_pem)[0] as client:
        missing = client.get("/authorize", params={"redirect_uri": REDIRECT})
        assert missing.status_code == 400
        bad_rt = client.get(
            "/authorize",
            params={
                "response_type": "token",
                "client_id": CLIENT_ID,
                "redirect_uri": REDIRECT,
                "scope": "openid",
                "code_challenge": "abc",
                "code_challenge_method": "S256",
            },
        )
        assert bad_rt.status_code == 400
        bad_scope = client.get(
            "/authorize",
            params={
                "response_type": "code",
                "client_id": CLIENT_ID,
                "redirect_uri": REDIRECT,
                "scope": "email",
                "code_challenge": "abc",
                "code_challenge_method": "S256",
            },
        )
        assert bad_scope.status_code == 400


@pytest.mark.unit
def test_login_consent_without_session(rsa_pem: str) -> None:
    with _app_with_fakes(rsa_pem)[0] as client:
        assert client.get("/login").status_code == 400
        assert client.get("/consent").status_code == 400
        assert client.post("/consent", data={"decision": "allow"}).status_code == 400
        assert client.post("/login", data={"username": "a", "password": "b"}).status_code == 400


@pytest.mark.unit
def test_token_error_paths(rsa_pem: str) -> None:
    with _app_with_fakes(rsa_pem)[0] as client:
        assert client.post("/token", data={"grant_type": "authorization_code"}).status_code == 401
        assert (
            client.post(
                "/token",
                data={"grant_type": "authorization_code", "client_id": "missing"},
            ).status_code
            == 401
        )
        assert (
            client.post(
                "/token",
                data={
                    "grant_type": "authorization_code",
                    "client_id": CLIENT_ID,
                    "code": "x",
                    "redirect_uri": REDIRECT,
                    "code_verifier": "a" * 43,
                },
            ).status_code
            == 400
        )
        assert (
            client.post(
                "/token",
                data={"grant_type": "refresh_token", "client_id": CLIENT_ID},
            ).status_code
            == 400
        )
        assert (
            client.post(
                "/token",
                data={
                    "grant_type": "refresh_token",
                    "client_id": CLIENT_ID,
                    "refresh_token": "nope",
                },
            ).status_code
            == 400
        )


@pytest.mark.unit
def test_userinfo_invalid_token(rsa_pem: str) -> None:
    with _app_with_fakes(rsa_pem)[0] as client:
        bad = client.get("/userinfo", headers={"Authorization": "Bearer not-a-jwt"})
        assert bad.status_code == 401
        malformed = client.get("/userinfo", headers={"Authorization": "Token abc"})
        assert malformed.status_code == 401


@pytest.mark.unit
def test_deps_raise_when_unwired() -> None:
    application = FastAPI()
    application.state.config = load_config()
    application.state.jwt_keys = None
    application.state.session_store = None
    application.state.academy = None
    application.state.users = None

    request = MagicMock()
    request.app = application

    with pytest.raises(HTTPException) as keys_exc:
        deps.jwt_keys(request)
    assert keys_exc.value.status_code == 503

    with pytest.raises(HTTPException):
        deps.session_store(request)
    with pytest.raises(HTTPException):
        deps.academy(request)
    with pytest.raises(HTTPException):
        deps.users(request)


@pytest.mark.unit
def test_rate_limiter_expires_old_hits() -> None:
    limiter = SlidingWindowRateLimiter(limit=2, window_seconds=0.01)
    assert limiter.allow("ip") is True
    assert limiter.allow("ip") is True
    assert limiter.allow("ip") is False
    import time

    time.sleep(0.02)
    assert limiter.allow("ip") is True


@pytest.mark.unit
@pytest.mark.asyncio
async def test_fake_and_mongo_get_user() -> None:
    fake = FakeUserRepo()
    now = datetime.now(UTC)
    fake._by_sub["usr_a"] = User(
        sub="usr_a",
        name="A",
        prn="P1",
        srn=None,
        program=None,
        branch=None,
        semester=None,
        section=None,
        campus=None,
        email=None,
        phone=None,
        created_at=now,
        last_login_at=now,
        deleted_at=now,
    )
    assert await fake.get_user("usr_a") is None
    assert await fake.get_user("missing") is None

    coll = MagicMock()
    coll.find_one = AsyncMock(return_value=None)
    db = MagicMock()
    db.users = coll
    repo = MongoUserRepo(db)
    assert await repo.get_user("usr_x") is None

    coll.find_one = AsyncMock(
        return_value={
            "sub": "usr_x",
            "name": "X",
            "prn": None,
            "srn": None,
            "program": None,
            "branch": None,
            "semester": None,
            "section": None,
            "campus": None,
            "email": None,
            "phone": None,
            "created_at": now,
            "last_login_at": now,
            "deleted_at": None,
        }
    )
    user = await repo.get_user("usr_x")
    assert user is not None
    assert user.sub == "usr_x"


@pytest.mark.unit
@pytest.mark.asyncio
async def test_mongo_get_refresh_and_token_from_doc() -> None:
    now = datetime.now(UTC)
    doc = {
        "token_hash": "abc",
        "family_id": "fam",
        "client_id": "cli",
        "sub": "usr",
        "scopes": ["openid"],
        "expires_at": now + timedelta(days=1),
        "created_at": now,
        "revoked_at": None,
    }
    token = _token_from_doc(doc)
    assert token.token_hash == "abc"

    coll = MagicMock()
    coll.find_one = AsyncMock(return_value=None)
    db = MagicMock()
    db.refresh_tokens = coll
    repo = MongoRefreshTokenRepo(db)
    assert await repo.get_refresh("missing") is None
    coll.find_one = AsyncMock(return_value=doc)
    found = await repo.get_refresh("abc")
    assert found is not None
    assert found.family_id == "fam"


@pytest.mark.unit
def test_refresh_wrong_client(rsa_pem: str) -> None:
    client_http, deps_map = _app_with_fakes(rsa_pem)
    refresh = deps_map["refresh_tokens"]
    assert isinstance(refresh, FakeRefreshTokenRepo)
    now = datetime.now(UTC)
    raw = "refresh-raw-value-for-edge-test-xx"
    refresh._by_hash[sha256_hex(raw)] = RefreshToken(
        token_hash=sha256_hex(raw),
        family_id="fam1",
        client_id="other_cli",
        sub=OWNER_SUB,
        scopes=frozenset({"openid", "offline_access"}),
        expires_at=now + timedelta(days=1),
        created_at=now,
    )
    with client_http as client:
        resp = client.post(
            "/token",
            data={
                "grant_type": "refresh_token",
                "client_id": CLIENT_ID,
                "refresh_token": raw,
            },
        )
        assert resp.status_code == 400
