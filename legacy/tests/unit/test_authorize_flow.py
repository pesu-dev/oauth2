"""Unit tests for OIDC authorize → login → consent → token → userinfo (identity)."""

from __future__ import annotations

import base64
import hashlib
import re
from dataclasses import replace
from datetime import UTC, datetime
from typing import TYPE_CHECKING
from urllib.parse import parse_qs, urlparse

import pytest
from fastapi.testclient import TestClient

from src.academy.fake import FakeAcademyClient
from src.academy.models import AcademyAuthResult, AcademyProfile, AcademySession
from src.app import create_app
from src.config import load_config
from src.models.client import Client, PublishingStatus
from src.models.user import User
from src.repos.fakes import (
    FakeAuthCodeRepo,
    FakeClientRepo,
    FakeConsentRepo,
    FakeRefreshTokenRepo,
    FakeTesterRepo,
    FakeUserRepo,
)

if TYPE_CHECKING:
    from collections.abc import Iterator

    from src.config import AppConfig


SESSION_COOKIE = "oauth2_login"
REDIRECT_URI = "https://app.example/cb"
CLIENT_ID = "cli_unit"
OWNER_SUB = "usr_owner_unit"
OWNER_PRN = "PES2202500001"


def _s256_challenge(verifier: str) -> str:
    digest = hashlib.sha256(verifier.encode("ascii")).digest()
    return base64.urlsafe_b64encode(digest).rstrip(b"=").decode("ascii")


def _profile(**overrides: object) -> AcademyProfile:
    base: dict[str, object] = {
        "name": "UNIT USER",
        "prn": OWNER_PRN,
        "srn": "PES2UG25CS001",
        "program": "B.Tech.",
        "branch": "CSE",
        "semester": "2",
        "section": "A",
        "campus": "RR",
        "email": "unit@example.com",
        "phone": "9000000001",
    }
    base.update(overrides)
    return AcademyProfile(**base)  # type: ignore[arg-type]


def _seed_owner(users: FakeUserRepo) -> User:
    now = datetime.now(UTC)
    user = User(
        sub=OWNER_SUB,
        name="UNIT USER",
        prn=OWNER_PRN,
        srn="PES2UG25CS001",
        program="B.Tech.",
        branch="CSE",
        semester="2",
        section="A",
        campus="RR",
        email="unit@example.com",
        phone="9000000001",
        created_at=now,
        last_login_at=now,
        deleted_at=None,
    )
    users._by_sub[OWNER_SUB] = user
    return user


def _public_client(**overrides: object) -> Client:
    now = datetime.now(UTC)
    base: dict[str, object] = {
        "client_id": CLIENT_ID,
        "client_secret_hash": None,
        "name": "Unit Club",
        "owner_sub": OWNER_SUB,
        "redirect_uris": (REDIRECT_URI,),
        "token_endpoint_auth_method": "none",
        "publishing_status": PublishingStatus.TESTING,
        "delegated_allowed": False,
        "created_at": now,
        "updated_at": now,
    }
    base.update(overrides)
    return Client(**base)  # type: ignore[arg-type]


@pytest.fixture
def flow_deps(rsa_pem: str) -> dict[str, object]:
    users = FakeUserRepo()
    _seed_owner(users)
    clients = FakeClientRepo()
    clients._by_id[CLIENT_ID] = _public_client()
    academy = FakeAcademyClient(
        {
            ("owner", "correct-password"): AcademyAuthResult(
                profile=_profile(),
                session=AcademySession(token="sess-token"),
            ),
            ("outsider", "correct-password"): AcademyAuthResult(
                profile=_profile(prn="PES2202599999", name="OUTSIDER", email="out@example.com"),
                session=AcademySession(token="sess-out"),
            ),
        }
    )
    return {
        "users": users,
        "clients": clients,
        "testers": FakeTesterRepo(),
        "auth_codes": FakeAuthCodeRepo(),
        "refresh_tokens": FakeRefreshTokenRepo(),
        "consents": FakeConsentRepo(),
        "academy": academy,
        "config": replace(
            load_config(),
            token_signing_key_pem=rsa_pem,
            session_secret="unit-session-secret-for-tests",
        ),
    }


@pytest.fixture
def flow_client(flow_deps: dict[str, object]) -> Iterator[TestClient]:
    config = flow_deps["config"]
    assert isinstance(config, object)
    application = create_app(
        flow_deps["config"],  # type: ignore[arg-type]
        academy=flow_deps["academy"],  # type: ignore[arg-type]
        users=flow_deps["users"],  # type: ignore[arg-type]
        clients=flow_deps["clients"],  # type: ignore[arg-type]
        testers=flow_deps["testers"],  # type: ignore[arg-type]
        auth_codes=flow_deps["auth_codes"],  # type: ignore[arg-type]
        refresh_tokens=flow_deps["refresh_tokens"],  # type: ignore[arg-type]
        consents=flow_deps["consents"],  # type: ignore[arg-type]
    )
    with TestClient(application) as client:
        yield client


def _authorize_params(verifier: str, **extra: str) -> dict[str, str]:
    params = {
        "response_type": "code",
        "client_id": CLIENT_ID,
        "redirect_uri": REDIRECT_URI,
        "scope": "openid profile email",
        "state": "state-xyz",
        "nonce": "nonce-abc",
        "code_challenge": _s256_challenge(verifier),
        "code_challenge_method": "S256",
    }
    params.update(extra)
    return params


def _complete_identity_flow(
    client: TestClient,
    *,
    username: str = "owner",
    password: str = "correct-password",
) -> tuple[str, str]:
    verifier = "a" * 43
    resp = client.get("/authorize", params=_authorize_params(verifier), follow_redirects=False)
    assert resp.status_code == 302
    assert resp.headers["location"].startswith("/login")
    assert SESSION_COOKIE in client.cookies

    login_page = client.get("/login")
    assert login_page.status_code == 200
    assert "Sign in" in login_page.text or "Login" in login_page.text

    login_post = client.post(
        "/login",
        data={"username": username, "password": password},
        follow_redirects=False,
    )
    assert login_post.status_code in {302, 303}
    assert "/consent" in login_post.headers["location"]

    consent_page = client.get("/consent")
    assert consent_page.status_code == 200
    assert "do not store" in consent_page.text.lower() or "not store" in consent_page.text.lower()
    assert REDIRECT_URI in consent_page.text
    assert "Unit Club" in consent_page.text

    allow = client.post("/consent", data={"decision": "allow"}, follow_redirects=False)
    assert allow.status_code in {302, 303}
    location = allow.headers["location"]
    assert location.startswith(REDIRECT_URI)
    qs = parse_qs(urlparse(location).query)
    assert "code" in qs
    assert qs.get("state") == ["state-xyz"]
    return qs["code"][0], verifier


@pytest.mark.unit
def test_identity_code_flow_issues_tokens_and_userinfo(flow_client: TestClient, flow_deps: dict[str, object]) -> None:
    code, verifier = _complete_identity_flow(flow_client)

    token_resp = flow_client.post(
        "/token",
        data={
            "grant_type": "authorization_code",
            "code": code,
            "redirect_uri": REDIRECT_URI,
            "client_id": CLIENT_ID,
            "code_verifier": verifier,
        },
    )
    assert token_resp.status_code == 200
    body = token_resp.json()
    assert body["token_type"] == "Bearer"
    assert "access_token" in body
    assert "id_token" in body
    assert "refresh_token" not in body  # no offline_access

    consents = flow_deps["consents"]
    assert isinstance(consents, FakeConsentRepo)
    assert consents._by_pair  # consent stored

    userinfo = flow_client.get(
        "/userinfo",
        headers={"Authorization": f"Bearer {body['access_token']}"},
    )
    assert userinfo.status_code == 200
    claims = userinfo.json()
    assert claims["sub"] == OWNER_SUB
    assert claims["name"] == "UNIT USER"
    assert claims["email"] == "unit@example.com"
    assert "phone_number" not in claims  # phone scope not granted


@pytest.mark.unit
def test_testing_deny_for_non_tester(flow_client: TestClient, flow_deps: dict[str, object]) -> None:
    verifier = "b" * 43
    flow_client.get("/authorize", params=_authorize_params(verifier), follow_redirects=False)
    deny = flow_client.post(
        "/login",
        data={"username": "outsider", "password": "correct-password"},
        follow_redirects=False,
    )
    # Either HTML error or redirect with error — must not issue a code to redirect_uri
    if deny.status_code in {302, 303}:
        loc = deny.headers["location"]
        assert not loc.startswith(REDIRECT_URI) or "error=" in loc
        if loc.startswith(REDIRECT_URI):
            qs = parse_qs(urlparse(loc).query)
            assert "code" not in qs
    else:
        assert deny.status_code == 200
        assert "not authorized" in deny.text.lower() or "testing" in deny.text.lower()

    users = flow_deps["users"]
    assert isinstance(users, FakeUserRepo)
    # Outsider may be upserted before gate; owner still present; no auth code issued
    codes = flow_deps["auth_codes"]
    assert isinstance(codes, FakeAuthCodeRepo)
    assert codes._by_hash == {}


@pytest.mark.unit
def test_bad_password_does_not_upsert_user(flow_client: TestClient, flow_deps: dict[str, object]) -> None:
    users = flow_deps["users"]
    assert isinstance(users, FakeUserRepo)
    before = dict(users._by_sub)

    verifier = "c" * 43
    flow_client.get("/authorize", params=_authorize_params(verifier), follow_redirects=False)
    failed = flow_client.post(
        "/login",
        data={"username": "owner", "password": "wrong-password"},
    )
    assert failed.status_code == 200
    assert "invalid" in failed.text.lower() or "incorrect" in failed.text.lower()
    # Generic message — do not echo credential details
    assert "wrong-password" not in failed.text
    assert users._by_sub == before


@pytest.mark.unit
def test_missing_pkce_rejected_at_authorize(flow_client: TestClient) -> None:
    params = _authorize_params("d" * 43)
    del params["code_challenge"]
    del params["code_challenge_method"]
    resp = flow_client.get("/authorize", params=params)
    assert resp.status_code == 400
    assert "pkce" in resp.text.lower() or "code_challenge" in resp.text.lower()


@pytest.mark.unit
def test_plain_pkce_method_rejected(flow_client: TestClient) -> None:
    params = _authorize_params("e" * 43, code_challenge_method="plain")
    resp = flow_client.get("/authorize", params=params)
    assert resp.status_code == 400


@pytest.mark.unit
def test_non_ascii_code_challenge_rejected(flow_client: TestClient) -> None:
    params = _authorize_params("f" * 43, code_challenge="abcé")
    resp = flow_client.get("/authorize", params=params)
    assert resp.status_code == 400


@pytest.mark.unit
def test_login_and_consent_footers_and_titles(flow_client: TestClient) -> None:
    verifier = "g" * 43
    flow_client.get("/authorize", params=_authorize_params(verifier), follow_redirects=False)
    login = flow_client.get("/login")
    assert "<title>" in login.text
    assert re.search(r"<title>[^<]+</title>", login.text)
    assert "/privacy" in login.text
    assert "/faq" in login.text
    assert "https://github.com/pesu-dev/oauth2" in login.text
    assert "open source" in login.text.lower() or "open-source" in login.text.lower()

    flow_client.post(
        "/login",
        data={"username": "owner", "password": "correct-password"},
        follow_redirects=False,
    )
    consent = flow_client.get("/consent")
    login_title = re.search(r"<title>([^<]+)</title>", login.text)
    consent_title = re.search(r"<title>([^<]+)</title>", consent.text)
    assert login_title and consent_title
    assert login_title.group(1) != consent_title.group(1)
    assert "/privacy" in consent.text
    assert "https://github.com/pesu-dev/oauth2" in consent.text


@pytest.mark.unit
def test_pending_production_uses_testing_gate(flow_deps: dict[str, object], rsa_pem: str) -> None:
    clients = flow_deps["clients"]
    assert isinstance(clients, FakeClientRepo)
    clients._by_id[CLIENT_ID] = _public_client(publishing_status=PublishingStatus.PENDING_PRODUCTION)
    config: AppConfig = replace(  # type: ignore[assignment]
        flow_deps["config"],  # type: ignore[arg-type]
        token_signing_key_pem=rsa_pem,
    )
    application = create_app(
        config,
        academy=flow_deps["academy"],  # type: ignore[arg-type]
        users=flow_deps["users"],  # type: ignore[arg-type]
        clients=clients,
        testers=flow_deps["testers"],  # type: ignore[arg-type]
        auth_codes=flow_deps["auth_codes"],  # type: ignore[arg-type]
        refresh_tokens=flow_deps["refresh_tokens"],  # type: ignore[arg-type]
        consents=flow_deps["consents"],  # type: ignore[arg-type]
    )
    with TestClient(application) as client:
        verifier = "h" * 43
        client.get("/authorize", params=_authorize_params(verifier), follow_redirects=False)
        deny = client.post(
            "/login",
            data={"username": "outsider", "password": "correct-password"},
        )
        assert deny.status_code == 200
        assert "code" not in deny.text or "authorization code" not in deny.text.lower()
        assert "not authorized" in deny.text.lower() or "testing" in deny.text.lower()


@pytest.mark.unit
def test_consent_deny_redirects_with_error(flow_client: TestClient) -> None:
    verifier = "m" * 43
    flow_client.get("/authorize", params=_authorize_params(verifier), follow_redirects=False)
    flow_client.post(
        "/login",
        data={"username": "owner", "password": "correct-password"},
        follow_redirects=False,
    )
    deny = flow_client.post("/consent", data={"decision": "deny"}, follow_redirects=False)
    assert deny.status_code in {302, 303}
    loc = deny.headers["location"]
    assert loc.startswith(REDIRECT_URI)
    qs = parse_qs(urlparse(loc).query)
    assert qs["error"] == ["access_denied"]
    assert qs["state"] == ["state-xyz"]


@pytest.mark.unit
def test_consent_html_shows_plain_language_scopes(flow_client: TestClient) -> None:
    verifier = "w" * 43
    params = _authorize_params(verifier, scope="openid profile phone offline_access")
    flow_client.get("/authorize", params=params, follow_redirects=False)
    flow_client.post(
        "/login",
        data={"username": "owner", "password": "correct-password"},
        follow_redirects=False,
    )
    consent = flow_client.get("/consent")
    assert consent.status_code == 200
    body = consent.text.lower()
    assert "stay signed in" in body
    assert "sensitive" in body
    # Must not be only a raw join of protocol scope tokens
    assert "openid, profile, phone, offline_access" not in body
    assert "openid, profile" not in body or "stay signed in" in body


@pytest.mark.unit
def test_redirect_uri_with_existing_query_appends_with_ampersand(
    flow_deps: dict[str, object],
    rsa_pem: str,
) -> None:
    redirect_with_query = "https://app.example/cb?foo=1"
    clients = flow_deps["clients"]
    assert isinstance(clients, FakeClientRepo)
    clients._by_id[CLIENT_ID] = _public_client(redirect_uris=(redirect_with_query,))

    application = create_app(
        replace(load_config(), token_signing_key_pem=rsa_pem, session_secret="q-secret"),
        academy=flow_deps["academy"],  # type: ignore[arg-type]
        users=flow_deps["users"],  # type: ignore[arg-type]
        clients=clients,
        testers=flow_deps["testers"],  # type: ignore[arg-type]
        auth_codes=flow_deps["auth_codes"],  # type: ignore[arg-type]
        refresh_tokens=flow_deps["refresh_tokens"],  # type: ignore[arg-type]
        consents=flow_deps["consents"],  # type: ignore[arg-type]
    )
    with TestClient(application) as client:
        verifier = "x" * 43
        params = {
            "response_type": "code",
            "client_id": CLIENT_ID,
            "redirect_uri": redirect_with_query,
            "scope": "openid profile",
            "state": "st-q",
            "code_challenge": _s256_challenge(verifier),
            "code_challenge_method": "S256",
        }
        client.get("/authorize", params=params, follow_redirects=False)
        client.post(
            "/login",
            data={"username": "owner", "password": "correct-password"},
            follow_redirects=False,
        )
        allow = client.post("/consent", data={"decision": "allow"}, follow_redirects=False)
        loc = allow.headers["location"]
        assert loc.startswith("https://app.example/cb?")
        assert "foo=1" in loc
        assert "&code=" in loc or loc.count("?") == 1 and "code=" in loc
        assert loc.count("?") == 1
        qs = parse_qs(urlparse(loc).query)
        assert qs["foo"] == ["1"]
        assert "code" in qs
        assert qs["state"] == ["st-q"]

        consents = flow_deps["consents"]
        assert isinstance(consents, FakeConsentRepo)
        consents._by_pair.clear()

        # Deny path also appends with &
        client.get("/authorize", params=params, follow_redirects=False)
        client.post(
            "/login",
            data={"username": "owner", "password": "correct-password"},
            follow_redirects=False,
        )
        deny = client.post("/consent", data={"decision": "deny"}, follow_redirects=False)
        deny_loc = deny.headers["location"]
        assert deny_loc.count("?") == 1
        assert "foo=1" in deny_loc
        deny_qs = parse_qs(urlparse(deny_loc).query)
        assert deny_qs["foo"] == ["1"]
        assert deny_qs["error"] == ["access_denied"]


@pytest.mark.unit
def test_refresh_token_rotation(flow_client: TestClient) -> None:
    verifier = "n" * 43
    params = _authorize_params(verifier, scope="openid profile offline_access")
    flow_client.get("/authorize", params=params, follow_redirects=False)
    flow_client.post(
        "/login",
        data={"username": "owner", "password": "correct-password"},
        follow_redirects=False,
    )
    allow = flow_client.post("/consent", data={"decision": "allow"}, follow_redirects=False)
    code = parse_qs(urlparse(allow.headers["location"]).query)["code"][0]
    first = flow_client.post(
        "/token",
        data={
            "grant_type": "authorization_code",
            "code": code,
            "redirect_uri": REDIRECT_URI,
            "client_id": CLIENT_ID,
            "code_verifier": verifier,
        },
    ).json()
    assert "refresh_token" in first

    second = flow_client.post(
        "/token",
        data={
            "grant_type": "refresh_token",
            "refresh_token": first["refresh_token"],
            "client_id": CLIENT_ID,
        },
    )
    assert second.status_code == 200
    body = second.json()
    assert body["refresh_token"] != first["refresh_token"]
    assert body["access_token"]

    reuse = flow_client.post(
        "/token",
        data={
            "grant_type": "refresh_token",
            "refresh_token": first["refresh_token"],
            "client_id": CLIENT_ID,
        },
    )
    assert reuse.status_code == 400
    assert reuse.json()["error"] == "invalid_grant"


@pytest.mark.unit
def test_token_rejects_bad_verifier_and_unsupported_grant(flow_client: TestClient) -> None:
    code, verifier = _complete_identity_flow(flow_client)
    bad = flow_client.post(
        "/token",
        data={
            "grant_type": "authorization_code",
            "code": code,
            "redirect_uri": REDIRECT_URI,
            "client_id": CLIENT_ID,
            "code_verifier": "short",
        },
    )
    assert bad.status_code == 400

    # code already consumed? use a fresh flow for unsupported grant
    unsupported = flow_client.post(
        "/token",
        data={"grant_type": "password", "client_id": CLIENT_ID},
    )
    assert unsupported.status_code == 400
    assert unsupported.json()["error"] == "unsupported_grant_type"
    _ = verifier


@pytest.mark.unit
def test_confidential_client_requires_secret(flow_deps: dict[str, object], rsa_pem: str) -> None:
    from src.crypto.hashing import hash_client_secret

    clients = flow_deps["clients"]
    assert isinstance(clients, FakeClientRepo)
    clients._by_id[CLIENT_ID] = _public_client(
        client_secret_hash=hash_client_secret("top-secret"),
        token_endpoint_auth_method="client_secret_post",
    )
    application = create_app(
        replace(load_config(), token_signing_key_pem=rsa_pem, session_secret="s"),
        academy=flow_deps["academy"],  # type: ignore[arg-type]
        users=flow_deps["users"],  # type: ignore[arg-type]
        clients=clients,
        testers=flow_deps["testers"],  # type: ignore[arg-type]
        auth_codes=flow_deps["auth_codes"],  # type: ignore[arg-type]
        refresh_tokens=flow_deps["refresh_tokens"],  # type: ignore[arg-type]
        consents=flow_deps["consents"],  # type: ignore[arg-type]
    )
    with TestClient(application) as client:
        code, verifier = _complete_identity_flow(client)
        missing = client.post(
            "/token",
            data={
                "grant_type": "authorization_code",
                "code": code,
                "redirect_uri": REDIRECT_URI,
                "client_id": CLIENT_ID,
                "code_verifier": verifier,
            },
        )
        assert missing.status_code == 401

        # Need a new code after failed attempt did not consume... actually code wasn't consumed
        # because auth failed before consume? Wait - auth happens first, then consume. So code still valid.
        ok = client.post(
            "/token",
            data={
                "grant_type": "authorization_code",
                "code": code,
                "redirect_uri": REDIRECT_URI,
                "client_id": CLIENT_ID,
                "client_secret": "top-secret",
                "code_verifier": verifier,
            },
        )
        assert ok.status_code == 200


@pytest.mark.unit
def test_userinfo_requires_bearer_and_supports_post(flow_client: TestClient) -> None:
    code, verifier = _complete_identity_flow(flow_client)
    tokens = flow_client.post(
        "/token",
        data={
            "grant_type": "authorization_code",
            "code": code,
            "redirect_uri": REDIRECT_URI,
            "client_id": CLIENT_ID,
            "code_verifier": verifier,
        },
    ).json()

    missing = flow_client.get("/userinfo")
    assert missing.status_code == 401

    posted = flow_client.post(
        "/userinfo",
        headers={"Authorization": f"Bearer {tokens['access_token']}"},
    )
    assert posted.status_code == 200
    assert posted.json()["sub"] == OWNER_SUB


@pytest.mark.unit
def test_phone_scope_in_userinfo(flow_client: TestClient) -> None:
    verifier = "p" * 43
    params = _authorize_params(verifier, scope="openid phone")
    flow_client.get("/authorize", params=params, follow_redirects=False)
    flow_client.post(
        "/login",
        data={"username": "owner", "password": "correct-password"},
        follow_redirects=False,
    )
    allow = flow_client.post("/consent", data={"decision": "allow"}, follow_redirects=False)
    code = parse_qs(urlparse(allow.headers["location"]).query)["code"][0]
    tokens = flow_client.post(
        "/token",
        data={
            "grant_type": "authorization_code",
            "code": code,
            "redirect_uri": REDIRECT_URI,
            "client_id": CLIENT_ID,
            "code_verifier": verifier,
        },
    ).json()
    claims = flow_client.get(
        "/userinfo",
        headers={"Authorization": f"Bearer {tokens['access_token']}"},
    ).json()
    assert claims["phone_number"] == "9000000001"
    assert "email" not in claims


@pytest.mark.unit
def test_login_rate_limit(flow_client: TestClient) -> None:
    verifier = "q" * 43
    flow_client.get("/authorize", params=_authorize_params(verifier), follow_redirects=False)
    for _ in range(10):
        resp = flow_client.post(
            "/login",
            data={"username": "owner", "password": "wrong-password"},
        )
        assert resp.status_code == 200
    limited = flow_client.post(
        "/login",
        data={"username": "owner", "password": "wrong-password"},
    )
    assert limited.status_code == 429


@pytest.mark.unit
def test_authorize_unknown_client_and_bad_redirect(flow_client: TestClient) -> None:
    unknown = flow_client.get(
        "/authorize",
        params=_authorize_params("r" * 43, client_id="cli_missing"),
    )
    assert unknown.status_code == 400

    bad_redirect = flow_client.get(
        "/authorize",
        params=_authorize_params("s" * 43, redirect_uri="https://evil.example/cb"),
    )
    assert bad_redirect.status_code == 400


@pytest.mark.unit
def test_existing_consent_skips_consent_page(flow_client: TestClient, flow_deps: dict[str, object]) -> None:
    from datetime import UTC, datetime

    from src.models.consent import Consent, ConsentMode

    consents = flow_deps["consents"]
    assert isinstance(consents, FakeConsentRepo)
    consents._by_pair[(OWNER_SUB, CLIENT_ID)] = Consent(
        sub=OWNER_SUB,
        client_id=CLIENT_ID,
        scopes=frozenset({"openid", "profile", "email"}),
        mode=ConsentMode.IDENTITY,
        granted_at=datetime.now(UTC),
    )

    verifier = "t" * 43
    flow_client.get("/authorize", params=_authorize_params(verifier), follow_redirects=False)
    login = flow_client.post(
        "/login",
        data={"username": "owner", "password": "correct-password"},
        follow_redirects=False,
    )
    assert login.status_code in {302, 303}
    loc = login.headers["location"]
    assert loc.startswith(REDIRECT_URI)
    assert "code=" in loc


@pytest.mark.unit
def test_static_auth_assets_served(flow_client: TestClient) -> None:
    css = flow_client.get("/static/css/auth.css")
    assert css.status_code == 200
    assert "prefers-reduced-motion" in css.text
    js = flow_client.get("/static/js/auth.js")
    assert js.status_code == 200
