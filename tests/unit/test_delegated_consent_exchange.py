"""Unit tests for delegated consent + internal token exchange."""

from __future__ import annotations

import base64
import hashlib
from dataclasses import replace
from datetime import UTC, datetime, timedelta
from typing import TYPE_CHECKING
from urllib.parse import parse_qs, urlparse

import pytest
from fastapi.testclient import TestClient

from src.academy.fake import FakeAcademyClient
from src.academy.models import AcademyAuthResult, AcademyProfile, AcademySession
from src.app import create_app
from src.config import load_config
from src.crypto.vault_crypto import master_key_from_secret, seal
from src.crypto.vault_crypto import open as open_blob
from src.crypto.vault_payload import (
    CURRENT_VAULT_KEY_VERSION,
    VaultPlaintext,
    pack_vault_plaintext,
    unpack_vault_plaintext,
)
from src.models.client import Client, PublishingStatus
from src.models.consent import Consent, ConsentMode
from src.models.user import User
from src.models.vault import VaultEntry
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


SESSION_COOKIE = "oauth2_login"
REDIRECT_URI = "https://app.example/cb"
CLIENT_ID = "cli_deleg_unit"
OWNER_SUB = "usr_deleg_owner"
OWNER_PRN = "PES2202512345"
PASSWORD = "correct-password"
EXCHANGE_SECRET = "unit-exchange-secret"
VAULT_MASTER = "unit-vault-master-key"


def _s256_challenge(verifier: str) -> str:
    digest = hashlib.sha256(verifier.encode("ascii")).digest()
    return base64.urlsafe_b64encode(digest).rstrip(b"=").decode("ascii")


def _profile() -> AcademyProfile:
    return AcademyProfile(
        name="DELEG USER",
        prn=OWNER_PRN,
        srn="PES2UG25CS111",
        program="B.Tech.",
        branch="CSE",
        semester="2",
        section="A",
        campus="RR",
        email="deleg@example.com",
        phone="9000000011",
    )


@pytest.fixture
def deleg_deps(rsa_pem: str) -> dict[str, object]:
    users = FakeUserRepo()
    now = datetime.now(UTC)
    users._by_sub[OWNER_SUB] = User(
        sub=OWNER_SUB,
        name="DELEG USER",
        prn=OWNER_PRN,
        srn="PES2UG25CS111",
        program="B.Tech.",
        branch="CSE",
        semester="2",
        section="A",
        campus="RR",
        email="deleg@example.com",
        phone="9000000011",
        created_at=now,
        last_login_at=now,
        deleted_at=None,
    )
    clients = FakeClientRepo()
    clients._by_id[CLIENT_ID] = Client(
        client_id=CLIENT_ID,
        client_secret_hash=None,
        name="Deleg Unit Club",
        owner_sub=OWNER_SUB,
        redirect_uris=(REDIRECT_URI,),
        token_endpoint_auth_method="none",
        publishing_status=PublishingStatus.TESTING,
        delegated_allowed=True,
        created_at=now,
        updated_at=now,
    )
    academy = FakeAcademyClient(
        {
            ("owner", PASSWORD): AcademyAuthResult(
                profile=_profile(),
                session=AcademySession(token="academy-tok", user_id="uid-1"),
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
        "vault": FakeVaultRepo(),
        "academy": academy,
        "config": replace(
            load_config(),
            token_signing_key_pem=rsa_pem,
            session_secret="unit-session-secret-for-tests",
            vault_master_key=VAULT_MASTER,
            token_exchange_secret=EXCHANGE_SECRET,
            first_party_api_client_id=CLIENT_ID,
        ),
    }


@pytest.fixture
def deleg_client(deleg_deps: dict[str, object]) -> Iterator[TestClient]:
    application = create_app(
        deleg_deps["config"],  # type: ignore[arg-type]
        academy=deleg_deps["academy"],  # type: ignore[arg-type]
        users=deleg_deps["users"],  # type: ignore[arg-type]
        clients=deleg_deps["clients"],  # type: ignore[arg-type]
        testers=deleg_deps["testers"],  # type: ignore[arg-type]
        auth_codes=deleg_deps["auth_codes"],  # type: ignore[arg-type]
        refresh_tokens=deleg_deps["refresh_tokens"],  # type: ignore[arg-type]
        consents=deleg_deps["consents"],  # type: ignore[arg-type]
        vault=deleg_deps["vault"],  # type: ignore[arg-type]
    )
    with TestClient(application) as client:
        yield client


def _authorize_login_consent(client: TestClient, verifier: str = "v" * 43) -> str:
    client.get(
        "/authorize",
        params={
            "response_type": "code",
            "client_id": CLIENT_ID,
            "redirect_uri": REDIRECT_URI,
            "scope": "openid profile",
            "code_challenge": _s256_challenge(verifier),
            "code_challenge_method": "S256",
        },
        follow_redirects=False,
    )
    login = client.post(
        "/login",
        data={"username": "owner", "password": PASSWORD},
        follow_redirects=False,
    )
    assert login.status_code in {302, 303}
    consent = client.get("/consent")
    assert consent.status_code == 200
    assert "will store" in consent.text.lower()
    assert 'data-mode="delegated"' in consent.text
    allow = client.post("/consent", data={"decision": "allow"}, follow_redirects=False)
    assert allow.status_code in {302, 303}
    return parse_qs(urlparse(allow.headers["location"]).query)["code"][0]


@pytest.mark.unit
def test_delegated_consent_seals_vault(deleg_client: TestClient, deleg_deps: dict[str, object]) -> None:
    code = _authorize_login_consent(deleg_client)
    assert code
    vault: FakeVaultRepo = deleg_deps["vault"]  # type: ignore[assignment]
    entry = vault._by_sub.get(OWNER_SUB)
    assert entry is not None
    master = master_key_from_secret(VAULT_MASTER)
    plain = unpack_vault_plaintext(open_blob(master, entry.blob))
    assert plain.password == PASSWORD
    assert plain.session.token == "academy-tok"
    consents: FakeConsentRepo = deleg_deps["consents"]  # type: ignore[assignment]
    grant = consents._by_pair[(OWNER_SUB, CLIENT_ID)]
    assert grant.mode is ConsentMode.DELEGATED


@pytest.mark.unit
def test_token_exchange_rejects_non_first_party_client(
    deleg_client: TestClient,
    deleg_deps: dict[str, object],
    rsa_pem: str,
) -> None:
    """Club-site tokens must not exchange even with a valid secret + delegated consent."""
    from src.crypto.jwt_keys import JwtKeySet
    from src.crypto.tokens import sign_access_token

    other_id = "cli_club_third_party"
    now = datetime.now(UTC)
    clients: FakeClientRepo = deleg_deps["clients"]  # type: ignore[assignment]
    consents: FakeConsentRepo = deleg_deps["consents"]  # type: ignore[assignment]
    vault: FakeVaultRepo = deleg_deps["vault"]  # type: ignore[assignment]
    clients._by_id[other_id] = Client(
        client_id=other_id,
        client_secret_hash=None,
        name="Third Party Club",
        owner_sub=OWNER_SUB,
        redirect_uris=(REDIRECT_URI,),
        token_endpoint_auth_method="none",
        publishing_status=PublishingStatus.PRODUCTION,
        delegated_allowed=True,
        created_at=now,
        updated_at=now,
    )
    consents._by_pair[(OWNER_SUB, other_id)] = Consent(
        sub=OWNER_SUB,
        client_id=other_id,
        scopes=frozenset({"openid", "profile"}),
        mode=ConsentMode.DELEGATED,
        granted_at=now,
    )
    master = master_key_from_secret(VAULT_MASTER)
    vault._by_sub[OWNER_SUB] = VaultEntry(
        sub=OWNER_SUB,
        blob=seal(
            master,
            pack_vault_plaintext(
                VaultPlaintext(
                    username="owner",
                    password=PASSWORD,
                    session=AcademySession(token="academy-tok", user_id="uid-1"),
                )
            ),
            CURRENT_VAULT_KEY_VERSION,
        ),
        session_expires_at=None,
    )
    keys = JwtKeySet.from_pem(rsa_pem, kid="unit-test")
    access = sign_access_token(
        keys,
        sub=OWNER_SUB,
        client_id=other_id,
        scope="openid",
        issuer="http://localhost:8080",
        ttl_seconds=3600,
    )

    exchange = deleg_client.post(
        "/oauth/token-exchange",
        headers={"X-Token-Exchange-Secret": EXCHANGE_SECRET},
        data={"access_token": access},
    )
    assert exchange.status_code == 403
    assert exchange.json()["error"] == "forbidden"


@pytest.mark.unit
def test_token_exchange_returns_session_not_password(
    deleg_client: TestClient,
    deleg_deps: dict[str, object],
) -> None:
    verifier = "x" * 43
    code = _authorize_login_consent(deleg_client, verifier=verifier)
    token = deleg_client.post(
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
    access = token.json()["access_token"]

    exchange = deleg_client.post(
        "/oauth/token-exchange",
        headers={"X-Token-Exchange-Secret": EXCHANGE_SECRET},
        data={"access_token": access},
    )
    assert exchange.status_code == 200
    body = exchange.json()
    assert body["token"] == "academy-tok"
    assert "password" not in body
    assert PASSWORD not in exchange.text


@pytest.mark.unit
def test_token_exchange_accepts_bearer_secret(
    deleg_client: TestClient,
) -> None:
    verifier = "y" * 43
    code = _authorize_login_consent(deleg_client, verifier=verifier)
    access = deleg_client.post(
        "/token",
        data={
            "grant_type": "authorization_code",
            "code": code,
            "redirect_uri": REDIRECT_URI,
            "client_id": CLIENT_ID,
            "code_verifier": verifier,
        },
    ).json()["access_token"]

    exchange = deleg_client.post(
        "/oauth/token-exchange",
        headers={"Authorization": f"Bearer {EXCHANGE_SECRET}"},
        data={"access_token": access},
    )
    assert exchange.status_code == 200
    assert exchange.json()["token"] == "academy-tok"


@pytest.mark.unit
def test_token_exchange_rejects_bad_secret(deleg_client: TestClient) -> None:
    verifier = "z" * 43
    code = _authorize_login_consent(deleg_client, verifier=verifier)
    access = deleg_client.post(
        "/token",
        data={
            "grant_type": "authorization_code",
            "code": code,
            "redirect_uri": REDIRECT_URI,
            "client_id": CLIENT_ID,
            "code_verifier": verifier,
        },
    ).json()["access_token"]
    resp = deleg_client.post(
        "/oauth/token-exchange",
        headers={"X-Token-Exchange-Secret": "wrong"},
        data={"access_token": access},
    )
    assert resp.status_code == 401


@pytest.mark.unit
def test_token_exchange_requires_delegated_consent(
    deleg_client: TestClient,
    deleg_deps: dict[str, object],
) -> None:
    verifier = "w" * 43
    code = _authorize_login_consent(deleg_client, verifier=verifier)
    access = deleg_client.post(
        "/token",
        data={
            "grant_type": "authorization_code",
            "code": code,
            "redirect_uri": REDIRECT_URI,
            "client_id": CLIENT_ID,
            "code_verifier": verifier,
        },
    ).json()["access_token"]

    consents: FakeConsentRepo = deleg_deps["consents"]  # type: ignore[assignment]
    consents._by_pair[(OWNER_SUB, CLIENT_ID)] = Consent(
        sub=OWNER_SUB,
        client_id=CLIENT_ID,
        scopes=frozenset({"openid", "profile"}),
        mode=ConsentMode.IDENTITY,
        granted_at=datetime.now(UTC),
    )
    resp = deleg_client.post(
        "/oauth/token-exchange",
        headers={"X-Token-Exchange-Secret": EXCHANGE_SECRET},
        data={"access_token": access},
    )
    assert resp.status_code == 403


@pytest.mark.unit
def test_token_exchange_refreshes_expired_session(
    deleg_client: TestClient,
    deleg_deps: dict[str, object],
) -> None:
    verifier = "r" * 43
    code = _authorize_login_consent(deleg_client, verifier=verifier)
    access = deleg_client.post(
        "/token",
        data={
            "grant_type": "authorization_code",
            "code": code,
            "redirect_uri": REDIRECT_URI,
            "client_id": CLIENT_ID,
            "code_verifier": verifier,
        },
    ).json()["access_token"]

    vault: FakeVaultRepo = deleg_deps["vault"]  # type: ignore[assignment]
    academy: FakeAcademyClient = deleg_deps["academy"]  # type: ignore[assignment]
    # Overwrite vault with expired session; FakeAcademy returns a new token on re-login.
    academy._users[("owner", PASSWORD)] = AcademyAuthResult(
        profile=_profile(),
        session=AcademySession(token="refreshed-tok", user_id="uid-1"),
    )
    master = master_key_from_secret(VAULT_MASTER)
    expired = VaultPlaintext(
        username="owner",
        password=PASSWORD,
        session=AcademySession(
            token="old-tok",
            expires_at=datetime.now(UTC) - timedelta(minutes=1),
        ),
    )
    blob = seal(master, pack_vault_plaintext(expired), key_version=CURRENT_VAULT_KEY_VERSION)
    vault._by_sub[OWNER_SUB] = VaultEntry(
        sub=OWNER_SUB,
        blob=blob,
        session_expires_at=expired.session.expires_at,
    )

    exchange = deleg_client.post(
        "/oauth/token-exchange",
        headers={"X-Token-Exchange-Secret": EXCHANGE_SECRET},
        data={"access_token": access},
    )
    assert exchange.status_code == 200
    assert exchange.json()["token"] == "refreshed-tok"
    assert PASSWORD not in exchange.text


@pytest.mark.unit
def test_token_exchange_missing_access_token(deleg_client: TestClient) -> None:
    resp = deleg_client.post(
        "/oauth/token-exchange",
        headers={"X-Token-Exchange-Secret": EXCHANGE_SECRET},
        data={},
    )
    assert resp.status_code == 400


@pytest.mark.unit
def test_token_exchange_invalid_jwt(deleg_client: TestClient) -> None:
    resp = deleg_client.post(
        "/oauth/token-exchange",
        headers={"X-Token-Exchange-Secret": EXCHANGE_SECRET},
        data={"access_token": "not-a-jwt"},
    )
    assert resp.status_code == 401


@pytest.mark.unit
def test_token_exchange_no_vault_row(
    deleg_client: TestClient,
    deleg_deps: dict[str, object],
) -> None:
    verifier = "n" * 43
    code = _authorize_login_consent(deleg_client, verifier=verifier)
    access = deleg_client.post(
        "/token",
        data={
            "grant_type": "authorization_code",
            "code": code,
            "redirect_uri": REDIRECT_URI,
            "client_id": CLIENT_ID,
            "code_verifier": verifier,
        },
    ).json()["access_token"]
    vault: FakeVaultRepo = deleg_deps["vault"]  # type: ignore[assignment]
    vault._by_sub.clear()
    resp = deleg_client.post(
        "/oauth/token-exchange",
        headers={"X-Token-Exchange-Secret": EXCHANGE_SECRET},
        data={"access_token": access},
    )
    assert resp.status_code == 403


@pytest.mark.unit
def test_token_exchange_academy_refresh_failure(
    deleg_client: TestClient,
    deleg_deps: dict[str, object],
) -> None:
    verifier = "f" * 43
    code = _authorize_login_consent(deleg_client, verifier=verifier)
    access = deleg_client.post(
        "/token",
        data={
            "grant_type": "authorization_code",
            "code": code,
            "redirect_uri": REDIRECT_URI,
            "client_id": CLIENT_ID,
            "code_verifier": verifier,
        },
    ).json()["access_token"]

    vault: FakeVaultRepo = deleg_deps["vault"]  # type: ignore[assignment]
    academy: FakeAcademyClient = deleg_deps["academy"]  # type: ignore[assignment]
    academy._users.clear()
    master = master_key_from_secret(VAULT_MASTER)
    expired = VaultPlaintext(
        username="owner",
        password=PASSWORD,
        session=AcademySession(
            token="old",
            expires_at=datetime.now(UTC) - timedelta(minutes=1),
        ),
    )
    vault._by_sub[OWNER_SUB] = VaultEntry(
        sub=OWNER_SUB,
        blob=seal(master, pack_vault_plaintext(expired), key_version=CURRENT_VAULT_KEY_VERSION),
        session_expires_at=expired.session.expires_at,
    )
    resp = deleg_client.post(
        "/oauth/token-exchange",
        headers={"X-Token-Exchange-Secret": EXCHANGE_SECRET},
        data={"access_token": access},
    )
    assert resp.status_code == 502


@pytest.mark.unit
def test_delegated_consent_deny_clears_session(deleg_client: TestClient, deleg_deps: dict[str, object]) -> None:
    verifier = "q" * 43
    deleg_client.get(
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
    deleg_client.post(
        "/login",
        data={"username": "owner", "password": PASSWORD},
        follow_redirects=False,
    )
    deny = deleg_client.post("/consent", data={"decision": "deny"}, follow_redirects=False)
    assert deny.status_code in {302, 303}
    assert "error=access_denied" in deny.headers["location"]
    vault: FakeVaultRepo = deleg_deps["vault"]  # type: ignore[assignment]
    assert OWNER_SUB not in vault._by_sub


@pytest.mark.unit
def test_session_response_includes_optional_fields(
    deleg_client: TestClient,
    deleg_deps: dict[str, object],
) -> None:
    """Exchange returns access_token/user_id when present on Academy session."""
    academy: FakeAcademyClient = deleg_deps["academy"]  # type: ignore[assignment]
    academy._users[("owner", PASSWORD)] = AcademyAuthResult(
        profile=_profile(),
        session=AcademySession(token="t1", access_token="at1", user_id="u1"),
    )
    verifier = "o" * 43
    code = _authorize_login_consent(deleg_client, verifier=verifier)
    access = deleg_client.post(
        "/token",
        data={
            "grant_type": "authorization_code",
            "code": code,
            "redirect_uri": REDIRECT_URI,
            "client_id": CLIENT_ID,
            "code_verifier": verifier,
        },
    ).json()["access_token"]
    body = deleg_client.post(
        "/oauth/token-exchange",
        headers={"X-Token-Exchange-Secret": EXCHANGE_SECRET},
        data={"access_token": access},
    ).json()
    assert body["token"] == "t1"
    assert body["access_token"] == "at1"
    assert body["user_id"] == "u1"


@pytest.mark.unit
async def test_fake_vault_repo_crud() -> None:
    repo = FakeVaultRepo()
    master = master_key_from_secret("k")
    blob = seal(master, b"payload", key_version=1)
    entry = VaultEntry(sub="usr_1", blob=blob, session_expires_at=None)
    assert await repo.get_vault("usr_1") is None
    assert await repo.upsert_vault(entry) == entry
    assert await repo.get_vault("usr_1") == entry
    assert await repo.delete_vault("usr_1") is True
    assert await repo.delete_vault("usr_1") is False


@pytest.mark.unit
def test_delegated_login_cookie_has_cred_id_not_password(
    deleg_client: TestClient,
    deleg_deps: dict[str, object],
) -> None:
    from itsdangerous import URLSafeTimedSerializer

    verifier = "c" * 43
    deleg_client.get(
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
    login = deleg_client.post(
        "/login",
        data={"username": "owner", "password": PASSWORD},
        follow_redirects=False,
    )
    assert login.status_code in {302, 303}
    raw_cookie = deleg_client.cookies.get(SESSION_COOKIE)
    assert raw_cookie
    assert PASSWORD not in raw_cookie
    payload = URLSafeTimedSerializer(
        "unit-session-secret-for-tests",
        salt="oauth2-login-pending",
    ).loads(raw_cookie)
    assert payload.get("pending_cred_id")
    assert "pending_password" not in payload
    assert PASSWORD not in str(payload)
    # Server-side store holds the secret material.
    app = deleg_client.app
    store = app.state.pending_credentials
    creds = store.get(payload["pending_cred_id"])
    assert creds is not None
    assert creds.password == PASSWORD


@pytest.mark.unit
def test_seal_failure_does_not_write_delegated_consent(
    rsa_pem: str,
) -> None:
    class BoomVault(FakeVaultRepo):
        async def upsert_vault(self, entry: VaultEntry) -> VaultEntry:
            raise RuntimeError("seal/upsert failed")

    users = FakeUserRepo()
    now = datetime.now(UTC)
    users._by_sub[OWNER_SUB] = User(
        sub=OWNER_SUB,
        name="DELEG USER",
        prn=OWNER_PRN,
        srn="PES2UG25CS111",
        program="B.Tech.",
        branch="CSE",
        semester="2",
        section="A",
        campus="RR",
        email="deleg@example.com",
        phone="9000000011",
        created_at=now,
        last_login_at=now,
        deleted_at=None,
    )
    clients = FakeClientRepo()
    clients._by_id[CLIENT_ID] = Client(
        client_id=CLIENT_ID,
        client_secret_hash=None,
        name="Deleg Unit Club",
        owner_sub=OWNER_SUB,
        redirect_uris=(REDIRECT_URI,),
        token_endpoint_auth_method="none",
        publishing_status=PublishingStatus.TESTING,
        delegated_allowed=True,
        created_at=now,
        updated_at=now,
    )
    consents = FakeConsentRepo()
    application = create_app(
        replace(
            load_config(),
            token_signing_key_pem=rsa_pem,
            session_secret="unit-session-secret-for-tests",
            vault_master_key=VAULT_MASTER,
            token_exchange_secret=EXCHANGE_SECRET,
            first_party_api_client_id=CLIENT_ID,
        ),
        academy=FakeAcademyClient(
            {
                ("owner", PASSWORD): AcademyAuthResult(
                    profile=_profile(),
                    session=AcademySession(token="academy-tok"),
                ),
            }
        ),
        users=users,
        clients=clients,
        testers=FakeTesterRepo(),
        auth_codes=FakeAuthCodeRepo(),
        refresh_tokens=FakeRefreshTokenRepo(),
        consents=consents,
        vault=BoomVault(),
    )
    verifier = "b" * 43
    with TestClient(application) as client:
        client.get(
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
        client.post(
            "/login",
            data={"username": "owner", "password": PASSWORD},
            follow_redirects=False,
        )
        resp = client.post("/consent", data={"decision": "allow"})
        assert resp.status_code == 503
        assert (OWNER_SUB, CLIENT_ID) not in consents._by_pair


@pytest.mark.unit
def test_token_exchange_wrong_length_secret_returns_401(deleg_client: TestClient) -> None:
    verifier = "s" * 43
    code = _authorize_login_consent(deleg_client, verifier=verifier)
    access = deleg_client.post(
        "/token",
        data={
            "grant_type": "authorization_code",
            "code": code,
            "redirect_uri": REDIRECT_URI,
            "client_id": CLIENT_ID,
            "code_verifier": verifier,
        },
    ).json()["access_token"]
    resp = deleg_client.post(
        "/oauth/token-exchange",
        headers={"X-Token-Exchange-Secret": "x"},  # different length than configured
        data={"access_token": access},
    )
    assert resp.status_code == 401


@pytest.mark.unit
def test_token_exchange_compare_digest_value_error_returns_401(
    deleg_client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def _raise(a: str, b: str) -> bool:
        raise ValueError("length mismatch")

    monkeypatch.setattr("src.exchange.router.hmac.compare_digest", _raise)
    resp = deleg_client.post(
        "/oauth/token-exchange",
        headers={"X-Token-Exchange-Secret": EXCHANGE_SECRET},
        data={"access_token": "ignored"},
    )
    assert resp.status_code == 401


@pytest.mark.unit
def test_token_exchange_corrupt_vault_returns_non_500(
    deleg_client: TestClient,
    deleg_deps: dict[str, object],
) -> None:
    from src.crypto.vault_crypto import SealedBlob

    verifier = "u" * 43
    code = _authorize_login_consent(deleg_client, verifier=verifier)
    access = deleg_client.post(
        "/token",
        data={
            "grant_type": "authorization_code",
            "code": code,
            "redirect_uri": REDIRECT_URI,
            "client_id": CLIENT_ID,
            "code_verifier": verifier,
        },
    ).json()["access_token"]
    vault: FakeVaultRepo = deleg_deps["vault"]  # type: ignore[assignment]
    vault._by_sub[OWNER_SUB] = VaultEntry(
        sub=OWNER_SUB,
        blob=SealedBlob(
            nonce=b"0" * 12,
            ciphertext=b"not-valid-gcm-ciphertext!!!!",
            wrap_nonce=b"1" * 12,
            wrapped_dek=b"also-invalid-wrapped-dek!!",
            key_version=1,
        ),
        session_expires_at=None,
    )
    resp = deleg_client.post(
        "/oauth/token-exchange",
        headers={"X-Token-Exchange-Secret": EXCHANGE_SECRET},
        data={"access_token": access},
    )
    assert resp.status_code in {403, 502}
    assert resp.status_code != 500


@pytest.mark.unit
def test_exchange_secret_empty_configured_returns_401(rsa_pem: str) -> None:
    from starlette.requests import Request

    from src.exchange.router import _exchange_secret_ok

    scope = {"type": "http", "headers": [], "method": "POST", "path": "/"}
    request = Request(scope)
    assert _exchange_secret_ok(request, None) is False
    assert _exchange_secret_ok(request, "") is False


@pytest.mark.unit
def test_exchange_secret_non_bearer_auth_returns_false() -> None:
    from starlette.requests import Request

    from src.exchange.router import _exchange_secret_ok

    scope = {
        "type": "http",
        "headers": [(b"authorization", b"Basic abc")],
        "method": "POST",
        "path": "/",
    }
    assert _exchange_secret_ok(Request(scope), "secret") is False
    scope2 = {
        "type": "http",
        "headers": [(b"authorization", b"Bearer")],
        "method": "POST",
        "path": "/",
    }
    assert _exchange_secret_ok(Request(scope2), "secret") is False


@pytest.mark.unit
def test_exchange_bearer_compare_digest_error(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from starlette.requests import Request

    from src.exchange.router import _exchange_secret_ok

    def _raise(a: str, b: str) -> bool:
        raise TypeError("bad")

    monkeypatch.setattr("src.exchange.router.hmac.compare_digest", _raise)
    scope = {
        "type": "http",
        "headers": [(b"authorization", b"Bearer secret")],
        "method": "POST",
        "path": "/",
    }
    assert _exchange_secret_ok(Request(scope), "secret") is False


@pytest.mark.unit
def test_session_response_optional_fields() -> None:
    from src.exchange.router import _session_response

    only_token = _session_response("tok", access_token=None, user_id=None)
    assert only_token == {"token": "tok"}
    with_uid = _session_response("tok", access_token=None, user_id="u1")
    assert with_uid == {"token": "tok", "user_id": "u1"}
    with_at = _session_response("tok", access_token="at", user_id=None)
    assert with_at == {"token": "tok", "access_token": "at"}


@pytest.mark.unit
def test_require_first_party_compare_digest_error(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from src.exchange.router import _require_first_party_client

    def _raise(a: str, b: str) -> bool:
        raise ValueError("bad")

    monkeypatch.setattr("src.exchange.router.hmac.compare_digest", _raise)
    err = _require_first_party_client("cli_a", "cli_b")
    assert err is not None
    assert err.status_code == 403


@pytest.mark.unit
def test_token_exchange_missing_client_audience(
    deleg_client: TestClient,
    rsa_pem: str,
) -> None:
    import jwt as pyjwt

    from src.crypto.jwt_keys import JwtKeySet
    from src.crypto.tokens import sign_access_token

    keys = JwtKeySet.from_pem(rsa_pem, kid="default")
    access = sign_access_token(
        keys,
        issuer=deleg_client.app.state.config.issuer_url,
        sub=OWNER_SUB,
        client_id=CLIENT_ID,
        scope="openid",
        ttl_seconds=300,
    )
    # aud is required by verify_access_token; empty aud + no client_id hits line 109
    claims = pyjwt.decode(access, options={"verify_signature": False})
    claims.pop("client_id", None)
    claims["aud"] = ""
    rebuilt = pyjwt.encode(
        claims,
        keys.private_key,
        algorithm="RS256",
        headers={"kid": keys.kid},
    )
    resp = deleg_client.post(
        "/oauth/token-exchange",
        headers={"X-Token-Exchange-Secret": EXCHANGE_SECRET},
        data={"access_token": rebuilt},
    )
    assert resp.status_code == 401
    assert "client audience" in resp.json()["error_description"].lower()


@pytest.mark.unit
def test_token_exchange_vault_master_key_none(
    rsa_pem: str,
    deleg_deps: dict[str, object],
) -> None:
    from src.models.consent import Consent, ConsentMode

    config = replace(
        deleg_deps["config"],  # type: ignore[arg-type]
        vault_master_key=None,
    )
    consents: FakeConsentRepo = deleg_deps["consents"]  # type: ignore[assignment]
    consents._by_pair[(OWNER_SUB, CLIENT_ID)] = Consent(
        sub=OWNER_SUB,
        client_id=CLIENT_ID,
        scopes=frozenset({"openid"}),
        mode=ConsentMode.DELEGATED,
        granted_at=datetime.now(UTC),
    )
    application = create_app(
        config,
        academy=deleg_deps["academy"],  # type: ignore[arg-type]
        users=deleg_deps["users"],  # type: ignore[arg-type]
        clients=deleg_deps["clients"],  # type: ignore[arg-type]
        testers=deleg_deps["testers"],  # type: ignore[arg-type]
        auth_codes=deleg_deps["auth_codes"],  # type: ignore[arg-type]
        refresh_tokens=deleg_deps["refresh_tokens"],  # type: ignore[arg-type]
        consents=consents,
        vault=deleg_deps["vault"],  # type: ignore[arg-type]
    )
    from src.crypto.jwt_keys import JwtKeySet
    from src.crypto.tokens import sign_access_token

    with TestClient(application) as client:
        keys = JwtKeySet.from_pem(rsa_pem, kid="default")
        access = sign_access_token(
            keys,
            issuer=config.issuer_url,
            sub=OWNER_SUB,
            client_id=CLIENT_ID,
            scope="openid",
            ttl_seconds=300,
        )
        resp = client.post(
            "/oauth/token-exchange",
            headers={"X-Token-Exchange-Secret": EXCHANGE_SECRET},
            data={"access_token": access},
        )
        assert resp.status_code == 503
        assert "Vault master key" in resp.json()["error_description"]


@pytest.mark.unit
def test_delegated_consent_skip_reseals_vault(
    deleg_client: TestClient,
    deleg_deps: dict[str, object],
) -> None:
    """Prior delegated consent skips consent page and reseals vault (433-446)."""
    from src.models.consent import Consent, ConsentMode

    consents: FakeConsentRepo = deleg_deps["consents"]  # type: ignore[assignment]
    consents._by_pair[(OWNER_SUB, CLIENT_ID)] = Consent(
        sub=OWNER_SUB,
        client_id=CLIENT_ID,
        scopes=frozenset({"openid", "profile", "email"}),
        mode=ConsentMode.DELEGATED,
        granted_at=datetime.now(UTC),
    )
    verifier = "d" * 43
    deleg_client.get(
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
    login = deleg_client.post(
        "/login",
        data={"username": "owner", "password": PASSWORD},
        follow_redirects=False,
    )
    assert login.status_code in {302, 303}
    assert "code=" in login.headers["location"]
    vault: FakeVaultRepo = deleg_deps["vault"]  # type: ignore[assignment]
    assert OWNER_SUB in vault._by_sub


@pytest.mark.unit
def test_delegated_allow_without_pending_cred_id(
    deleg_client: TestClient,
) -> None:
    """Mutate session cookie to drop pending_cred_id before Allow (line 520)."""
    from src.session_cookie import LoginPendingState

    verifier = "e" * 43
    deleg_client.get(
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
    login = deleg_client.post(
        "/login",
        data={"username": "owner", "password": PASSWORD},
        follow_redirects=False,
    )
    assert "/consent" in login.headers["location"]
    store = deleg_client.app.state.session_store
    raw = deleg_client.cookies.get(SESSION_COOKIE)
    assert raw is not None
    pending = store.load(raw)
    assert pending is not None
    stripped = LoginPendingState(
        client_id=pending.client_id,
        redirect_uri=pending.redirect_uri,
        scopes=pending.scopes,
        code_challenge=pending.code_challenge,
        mode=pending.mode,
        state=pending.state,
        nonce=pending.nonce,
        authenticated_sub=pending.authenticated_sub,
        pending_cred_id=None,
    )
    deleg_client.cookies.set(SESSION_COOKIE, store.dump(stripped))
    resp = deleg_client.post("/consent", data={"decision": "allow"})
    assert resp.status_code == 400
    assert "Session expired" in resp.text or "Start again" in resp.text
