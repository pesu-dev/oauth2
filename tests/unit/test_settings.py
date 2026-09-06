"""Unit tests for student settings: revoke app, delete credentials, delete account."""

from __future__ import annotations

from dataclasses import replace
from datetime import UTC, datetime, timedelta
from typing import TYPE_CHECKING

import pytest
from fastapi.testclient import TestClient

from src.academy.fake import FakeAcademyClient
from src.academy.models import AcademyAuthResult, AcademyProfile, AcademySession
from src.app import create_app
from src.config import load_config
from src.crypto.hashing import sha256_hex
from src.crypto.vault_crypto import master_key_from_secret, seal
from src.models.client import Client, PublishingStatus
from src.models.consent import Consent, ConsentMode
from src.models.refresh_token import RefreshToken
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
from tests.csrf_helpers import form_with_csrf, install_auto_csrf

if TYPE_CHECKING:
    from collections.abc import Iterator

SETTINGS_COOKIE = "oauth2_settings"
CLIENT_ID = "cli_settings_unit"
SUB = "usr_settings_unit"
PRN = "PES2202507777"
PASSWORD = "correct-password"
VAULT_MASTER = "unit-vault-master-key-32bytes!!"
SETTINGS_SESSION_SECRET = "unit-settings-session"


def _csrf(client: TestClient, data: dict[str, object] | None = None) -> dict[str, object]:
    return form_with_csrf(client, SETTINGS_SESSION_SECRET, data)  # type: ignore[return-value]


def _install_auto_csrf(client: TestClient) -> TestClient:
    return install_auto_csrf(
        client,
        SETTINGS_SESSION_SECRET,
        login_path="/settings/login",
        home_path="/settings",
    )


def _profile(**overrides: object) -> AcademyProfile:
    base: dict[str, object] = {
        "name": "SETTINGS USER",
        "prn": PRN,
        "srn": "PES2UG25CS777",
        "program": "B.Tech.",
        "branch": "CSE",
        "semester": "1",
        "section": "A",
        "campus": "RR",
        "email": "settings@example.com",
        "phone": "9777777777",
    }
    base.update(overrides)
    return AcademyProfile(**base)  # type: ignore[arg-type]


def _seed_user(users: FakeUserRepo) -> User:
    now = datetime.now(UTC)
    user = User(
        sub=SUB,
        name="SETTINGS USER",
        prn=PRN,
        srn="PES2UG25CS777",
        program="B.Tech.",
        branch="CSE",
        semester="1",
        section="A",
        campus="RR",
        email="settings@example.com",
        phone="9777777777",
        created_at=now,
        last_login_at=now,
        deleted_at=None,
    )
    users._by_sub[SUB] = user
    return user


@pytest.fixture
def settings_env(rsa_pem: str) -> dict[str, object]:
    now = datetime.now(UTC)
    users = FakeUserRepo()
    _seed_user(users)
    clients = FakeClientRepo()
    clients._by_id[CLIENT_ID] = Client(
        client_id=CLIENT_ID,
        client_secret_hash=None,
        name="Settings Unit Club",
        owner_sub="usr_owner",
        redirect_uris=("https://club.example/cb",),
        token_endpoint_auth_method="none",
        publishing_status=PublishingStatus.TESTING,
        delegated_allowed=True,
        created_at=now,
        updated_at=now,
    )
    academy = FakeAcademyClient(
        {
            ("student", PASSWORD): AcademyAuthResult(
                profile=_profile(),
                session=AcademySession(token="settings-sess", user_id="uid-s"),
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
            session_secret=SETTINGS_SESSION_SECRET,
            vault_master_key=VAULT_MASTER,
        ),
    }


@pytest.fixture
def settings_client(settings_env: dict[str, object]) -> Iterator[TestClient]:
    app = create_app(
        settings_env["config"],  # type: ignore[arg-type]
        academy=settings_env["academy"],  # type: ignore[arg-type]
        users=settings_env["users"],  # type: ignore[arg-type]
        clients=settings_env["clients"],  # type: ignore[arg-type]
        testers=settings_env["testers"],  # type: ignore[arg-type]
        auth_codes=settings_env["auth_codes"],  # type: ignore[arg-type]
        refresh_tokens=settings_env["refresh_tokens"],  # type: ignore[arg-type]
        consents=settings_env["consents"],  # type: ignore[arg-type]
        vault=settings_env["vault"],  # type: ignore[arg-type]
    )
    with TestClient(app) as client:
        yield _install_auto_csrf(client)


def _login(client: TestClient) -> None:
    client.get("/settings/login")
    resp = client.post(
        "/settings/login",
        data=_csrf(client, {"username": "student", "password": PASSWORD}),
        follow_redirects=False,
    )
    assert resp.status_code in {302, 303}
    assert SETTINGS_COOKIE in client.cookies


@pytest.mark.unit
def test_settings_requires_login(settings_client: TestClient) -> None:
    resp = settings_client.get("/settings", follow_redirects=False)
    assert resp.status_code in {302, 303}
    assert "/settings/login" in resp.headers["location"]


@pytest.mark.unit
def test_settings_login_page_has_no_meta_description(settings_client: TestClient) -> None:
    resp = settings_client.get("/settings/login")
    assert resp.status_code == 200
    assert "PESU OAuth2" in resp.text
    assert 'name="description"' not in resp.text


@pytest.mark.unit
def test_revoke_app_removes_consent_and_refresh(
    settings_client: TestClient,
    settings_env: dict[str, object],
) -> None:
    now = datetime.now(UTC)
    consents: FakeConsentRepo = settings_env["consents"]  # type: ignore[assignment]
    refresh: FakeRefreshTokenRepo = settings_env["refresh_tokens"]  # type: ignore[assignment]
    consent = Consent(
        sub=SUB,
        client_id=CLIENT_ID,
        scopes=frozenset({"openid", "profile"}),
        mode=ConsentMode.IDENTITY,
        granted_at=now,
    )
    consents._by_pair[(SUB, CLIENT_ID)] = consent
    token_hash = sha256_hex("settings-refresh")
    refresh._by_hash[token_hash] = RefreshToken(
        token_hash=token_hash,
        family_id="fam_s",
        client_id=CLIENT_ID,
        sub=SUB,
        scopes=frozenset({"openid", "offline_access"}),
        expires_at=now + timedelta(days=7),
        created_at=now,
        revoked_at=None,
    )

    _login(settings_client)
    home = settings_client.get("/settings")
    assert home.status_code == 200
    assert "Settings Unit Club" in home.text

    resp = settings_client.post(
        f"/settings/apps/{CLIENT_ID}/revoke",
        follow_redirects=False,
    )
    assert resp.status_code in {302, 303}

    assert (SUB, CLIENT_ID) not in consents._by_pair
    stored = refresh._by_hash[token_hash]
    assert stored.revoked_at is not None


@pytest.mark.unit
def test_delete_credentials_drops_vault_keeps_consent(
    settings_client: TestClient,
    settings_env: dict[str, object],
) -> None:
    now = datetime.now(UTC)
    consents: FakeConsentRepo = settings_env["consents"]  # type: ignore[assignment]
    vault: FakeVaultRepo = settings_env["vault"]  # type: ignore[assignment]
    consents._by_pair[(SUB, CLIENT_ID)] = Consent(
        sub=SUB,
        client_id=CLIENT_ID,
        scopes=frozenset({"openid"}),
        mode=ConsentMode.IDENTITY,
        granted_at=now,
    )
    master = master_key_from_secret(VAULT_MASTER)
    blob = seal(master, b'{"username":"student","password":"x"}', 1)
    vault._by_sub[SUB] = VaultEntry(sub=SUB, blob=blob, session_expires_at=None)

    _login(settings_client)
    resp = settings_client.post("/settings/credentials/delete", follow_redirects=False)
    assert resp.status_code in {302, 303}

    assert SUB not in vault._by_sub
    assert (SUB, CLIENT_ID) in consents._by_pair


@pytest.mark.unit
def test_delete_account_tombstones_and_rejects_sub_reuse(
    settings_client: TestClient,
    settings_env: dict[str, object],
) -> None:
    import asyncio

    now = datetime.now(UTC)
    users: FakeUserRepo = settings_env["users"]  # type: ignore[assignment]
    consents: FakeConsentRepo = settings_env["consents"]  # type: ignore[assignment]
    vault: FakeVaultRepo = settings_env["vault"]  # type: ignore[assignment]
    refresh: FakeRefreshTokenRepo = settings_env["refresh_tokens"]  # type: ignore[assignment]

    consents._by_pair[(SUB, CLIENT_ID)] = Consent(
        sub=SUB,
        client_id=CLIENT_ID,
        scopes=frozenset({"openid"}),
        mode=ConsentMode.DELEGATED,
        granted_at=now,
    )
    master = master_key_from_secret(VAULT_MASTER)
    blob = seal(master, b'{"username":"student","password":"x"}', 1)
    vault._by_sub[SUB] = VaultEntry(sub=SUB, blob=blob, session_expires_at=None)
    token_hash = sha256_hex("acct-refresh")
    refresh._by_hash[token_hash] = RefreshToken(
        token_hash=token_hash,
        family_id="fam_acct",
        client_id=CLIENT_ID,
        sub=SUB,
        scopes=frozenset({"openid", "offline_access"}),
        expires_at=now + timedelta(days=7),
        created_at=now,
        revoked_at=None,
    )

    _login(settings_client)
    resp = settings_client.post(
        "/settings/account/delete",
        data={"confirm": "DELETE"},
        follow_redirects=False,
    )
    assert resp.status_code in {302, 303}

    assert users._by_sub[SUB].deleted_at is not None
    assert SUB not in vault._by_sub
    assert (SUB, CLIENT_ID) not in consents._by_pair
    assert refresh._by_hash[token_hash].revoked_at is not None

    again = asyncio.run(users.upsert_user_from_profile(_profile()))
    assert again.sub != SUB


@pytest.mark.unit
def test_settings_logout_clears_cookie(settings_client: TestClient) -> None:
    _login(settings_client)
    resp = settings_client.post("/settings/logout", follow_redirects=False)
    assert resp.status_code in {302, 303}
    assert "/settings/login" in resp.headers["location"]


@pytest.mark.unit
def test_settings_bad_password(settings_client: TestClient) -> None:
    resp = settings_client.post(
        "/settings/login",
        data={"username": "student", "password": "wrong"},
        follow_redirects=False,
    )
    assert resp.status_code == 401
    assert "Incorrect" in resp.text


@pytest.mark.unit
def test_settings_delete_account_requires_confirm(
    settings_client: TestClient,
    settings_env: dict[str, object],
) -> None:
    users: FakeUserRepo = settings_env["users"]  # type: ignore[assignment]
    _login(settings_client)
    resp = settings_client.post(
        "/settings/account/delete",
        data={"confirm": "nope"},
        follow_redirects=False,
    )
    assert resp.status_code == 400
    assert "DELETE" in resp.text
    assert users._by_sub[SUB].deleted_at is None


@pytest.mark.unit
def test_revoke_last_delegated_app_drops_vault(
    settings_client: TestClient,
    settings_env: dict[str, object],
) -> None:
    now = datetime.now(UTC)
    consents: FakeConsentRepo = settings_env["consents"]  # type: ignore[assignment]
    vault: FakeVaultRepo = settings_env["vault"]  # type: ignore[assignment]
    consents._by_pair[(SUB, CLIENT_ID)] = Consent(
        sub=SUB,
        client_id=CLIENT_ID,
        scopes=frozenset({"openid"}),
        mode=ConsentMode.DELEGATED,
        granted_at=now,
    )
    master = master_key_from_secret(VAULT_MASTER)
    blob = seal(master, b'{"username":"student","password":"x"}', 1)
    vault._by_sub[SUB] = VaultEntry(sub=SUB, blob=blob, session_expires_at=None)

    _login(settings_client)
    resp = settings_client.post(f"/settings/apps/{CLIENT_ID}/revoke", follow_redirects=False)
    assert resp.status_code in {302, 303}
    assert SUB not in vault._by_sub


@pytest.mark.unit
def test_revoke_identity_app_keeps_vault_when_delegated_remains(
    settings_client: TestClient,
    settings_env: dict[str, object],
) -> None:
    now = datetime.now(UTC)
    clients: FakeClientRepo = settings_env["clients"]  # type: ignore[assignment]
    consents: FakeConsentRepo = settings_env["consents"]  # type: ignore[assignment]
    vault: FakeVaultRepo = settings_env["vault"]  # type: ignore[assignment]
    other_id = "cli_delegated_keep"
    clients._by_id[other_id] = Client(
        client_id=other_id,
        client_secret_hash=None,
        name="Keep Delegated",
        owner_sub="usr_owner",
        redirect_uris=("https://club.example/cb2",),
        token_endpoint_auth_method="none",
        publishing_status=PublishingStatus.TESTING,
        delegated_allowed=True,
        created_at=now,
        updated_at=now,
    )
    consents._by_pair[(SUB, CLIENT_ID)] = Consent(
        sub=SUB,
        client_id=CLIENT_ID,
        scopes=frozenset({"openid"}),
        mode=ConsentMode.IDENTITY,
        granted_at=now,
    )
    consents._by_pair[(SUB, other_id)] = Consent(
        sub=SUB,
        client_id=other_id,
        scopes=frozenset({"openid"}),
        mode=ConsentMode.DELEGATED,
        granted_at=now,
    )
    master = master_key_from_secret(VAULT_MASTER)
    blob = seal(master, b'{"username":"student","password":"x"}', 1)
    vault._by_sub[SUB] = VaultEntry(sub=SUB, blob=blob, session_expires_at=None)

    _login(settings_client)
    resp = settings_client.post(f"/settings/apps/{CLIENT_ID}/revoke", follow_redirects=False)
    assert resp.status_code in {302, 303}
    assert SUB in vault._by_sub
    assert (SUB, other_id) in consents._by_pair


@pytest.mark.unit
def test_settings_post_requires_login(settings_client: TestClient) -> None:
    for path in (
        f"/settings/apps/{CLIENT_ID}/revoke",
        "/settings/credentials/delete",
        "/settings/credentials/update",
        "/settings/account/delete",
    ):
        resp = settings_client.post(path, data={"confirm": "DELETE"}, follow_redirects=False)
        assert resp.status_code in {302, 303}
        assert "/settings/login" in resp.headers["location"]


@pytest.mark.unit
def test_settings_login_redirects_when_already_signed_in(settings_client: TestClient) -> None:
    _login(settings_client)
    resp = settings_client.get("/settings/login", follow_redirects=False)
    assert resp.status_code in {302, 303}
    assert resp.headers["location"].endswith("/settings")


@pytest.mark.unit
def test_settings_home_clears_cookie_if_user_tombstoned(
    settings_client: TestClient,
    settings_env: dict[str, object],
) -> None:
    import asyncio

    users: FakeUserRepo = settings_env["users"]  # type: ignore[assignment]
    _login(settings_client)
    asyncio.run(users.tombstone(SUB))
    resp = settings_client.get("/settings", follow_redirects=False)
    assert resp.status_code in {302, 303}
    assert "/settings/login" in resp.headers["location"]


@pytest.mark.unit
def test_settings_shows_client_id_when_client_missing(
    settings_client: TestClient,
    settings_env: dict[str, object],
) -> None:
    now = datetime.now(UTC)
    consents: FakeConsentRepo = settings_env["consents"]  # type: ignore[assignment]
    consents._by_pair[(SUB, "cli_gone")] = Consent(
        sub=SUB,
        client_id="cli_gone",
        scopes=frozenset({"openid"}),
        mode=ConsentMode.IDENTITY,
        granted_at=now,
    )
    _login(settings_client)
    home = settings_client.get("/settings")
    assert home.status_code == 200
    assert "cli_gone" in home.text


@pytest.mark.unit
def test_settings_login_rate_limited(settings_client: TestClient) -> None:
    for _ in range(10):
        settings_client.post(
            "/settings/login",
            data={"username": "nope", "password": "nope"},
        )
    resp = settings_client.post(
        "/settings/login",
        data={"username": "nope", "password": "nope"},
    )
    assert resp.status_code == 429
    assert "Too many" in resp.text


@pytest.mark.unit
def test_settings_login_rate_limit_uses_xff(settings_client: TestClient) -> None:
    """X-Forwarded-For must bucket settings login like authorize/portal."""
    for _ in range(10):
        settings_client.post(
            "/settings/login",
            data={"username": "nope", "password": "nope"},
            headers={"X-Forwarded-For": "198.51.100.50"},
        )
    # Exhausted that forwarded IP — a different XFF should still be allowed.
    other = settings_client.post(
        "/settings/login",
        data={"username": "student", "password": PASSWORD},
        headers={"X-Forwarded-For": "198.51.100.99"},
        follow_redirects=False,
    )
    assert other.status_code in {302, 303}
    blocked = settings_client.post(
        "/settings/login",
        data={"username": "nope", "password": "nope"},
        headers={"X-Forwarded-For": "198.51.100.50"},
    )
    assert blocked.status_code == 429


@pytest.mark.unit
def test_update_credentials_overwrites_vault(
    settings_client: TestClient,
    settings_env: dict[str, object],
) -> None:
    from src.crypto.vault_crypto import open as open_blob
    from src.crypto.vault_payload import VaultPlaintext, pack_vault_plaintext, unpack_vault_plaintext

    now = datetime.now(UTC)
    vault: FakeVaultRepo = settings_env["vault"]  # type: ignore[assignment]
    academy: FakeAcademyClient = settings_env["academy"]  # type: ignore[assignment]
    master = master_key_from_secret(VAULT_MASTER)
    old = pack_vault_plaintext(
        VaultPlaintext(
            username="student",
            password="old-password",
            session=AcademySession(token="old-sess", user_id="uid-s"),
        )
    )
    vault._by_sub[SUB] = VaultEntry(sub=SUB, blob=seal(master, old, 1), session_expires_at=None)
    academy._users[("student", "new-password")] = AcademyAuthResult(
        profile=_profile(),
        session=AcademySession(token="new-sess", user_id="uid-s", expires_at=now + timedelta(hours=1)),
    )

    _login(settings_client)
    home = settings_client.get("/settings")
    assert home.status_code == 200
    assert 'action="/settings/credentials/update"' in home.text

    resp = settings_client.post(
        "/settings/credentials/update",
        data={"username": "student", "password": "new-password"},
        follow_redirects=False,
    )
    assert resp.status_code in {302, 303}

    entry = vault._by_sub[SUB]
    plain = unpack_vault_plaintext(open_blob(master, entry.blob))
    assert plain.password == "new-password"
    assert plain.session.token == "new-sess"


@pytest.mark.unit
def test_update_credentials_rejects_wrong_account(
    settings_client: TestClient,
    settings_env: dict[str, object],
) -> None:
    from src.crypto.vault_payload import VaultPlaintext, pack_vault_plaintext

    vault: FakeVaultRepo = settings_env["vault"]  # type: ignore[assignment]
    academy: FakeAcademyClient = settings_env["academy"]  # type: ignore[assignment]
    master = master_key_from_secret(VAULT_MASTER)
    vault._by_sub[SUB] = VaultEntry(
        sub=SUB,
        blob=seal(
            master,
            pack_vault_plaintext(
                VaultPlaintext(
                    username="student",
                    password=PASSWORD,
                    session=AcademySession(token="s", user_id="uid-s"),
                )
            ),
            1,
        ),
        session_expires_at=None,
    )
    academy._users[("other", PASSWORD)] = AcademyAuthResult(
        profile=_profile(prn="PES2202599999", name="OTHER"),
        session=AcademySession(token="other-sess", user_id="uid-o"),
    )

    _login(settings_client)
    before = vault._by_sub[SUB].blob
    resp = settings_client.post(
        "/settings/credentials/update",
        data={"username": "other", "password": PASSWORD},
    )
    assert resp.status_code == 400
    assert "different account" in resp.text.lower()
    assert vault._by_sub[SUB].blob == before


@pytest.mark.unit
def test_update_credentials_requires_existing_vault(
    settings_client: TestClient,
) -> None:
    _login(settings_client)
    resp = settings_client.post(
        "/settings/credentials/update",
        data={"username": "student", "password": PASSWORD},
    )
    assert resp.status_code == 400
    assert "No saved credentials" in resp.text


@pytest.mark.unit
def test_update_credentials_bad_password(
    settings_client: TestClient,
    settings_env: dict[str, object],
) -> None:
    from src.crypto.vault_payload import VaultPlaintext, pack_vault_plaintext

    vault: FakeVaultRepo = settings_env["vault"]  # type: ignore[assignment]
    master = master_key_from_secret(VAULT_MASTER)
    vault._by_sub[SUB] = VaultEntry(
        sub=SUB,
        blob=seal(
            master,
            pack_vault_plaintext(
                VaultPlaintext(
                    username="student",
                    password=PASSWORD,
                    session=AcademySession(token="s", user_id="uid-s"),
                )
            ),
            1,
        ),
        session_expires_at=None,
    )
    _login(settings_client)
    resp = settings_client.post(
        "/settings/credentials/update",
        data={"username": "student", "password": "wrong"},
    )
    assert resp.status_code == 401
    assert "Incorrect" in resp.text


@pytest.mark.unit
def test_update_credentials_without_vault_master_key(
    settings_env: dict[str, object],
    rsa_pem: str,
) -> None:
    from src.crypto.vault_payload import VaultPlaintext, pack_vault_plaintext

    vault: FakeVaultRepo = settings_env["vault"]  # type: ignore[assignment]
    master = master_key_from_secret(VAULT_MASTER)
    vault._by_sub[SUB] = VaultEntry(
        sub=SUB,
        blob=seal(
            master,
            pack_vault_plaintext(
                VaultPlaintext(
                    username="student",
                    password=PASSWORD,
                    session=AcademySession(token="s", user_id="uid-s"),
                )
            ),
            1,
        ),
        session_expires_at=None,
    )
    config = replace(settings_env["config"], vault_master_key=None)  # type: ignore[arg-type]
    app = create_app(
        config,
        academy=settings_env["academy"],  # type: ignore[arg-type]
        users=settings_env["users"],  # type: ignore[arg-type]
        clients=settings_env["clients"],  # type: ignore[arg-type]
        testers=settings_env["testers"],  # type: ignore[arg-type]
        auth_codes=settings_env["auth_codes"],  # type: ignore[arg-type]
        refresh_tokens=settings_env["refresh_tokens"],  # type: ignore[arg-type]
        consents=settings_env["consents"],  # type: ignore[arg-type]
        vault=vault,
    )
    with TestClient(app) as client:
        _install_auto_csrf(client)
        # settings session was created with original secret — reuse same secret
        login = client.post(
            "/settings/login",
            data={"username": "student", "password": PASSWORD},
            follow_redirects=False,
        )
        assert login.status_code in {302, 303}
        resp = client.post(
            "/settings/credentials/update",
            data={"username": "student", "password": PASSWORD},
        )
        assert resp.status_code == 503
        assert "not configured" in resp.text.lower()


@pytest.mark.unit
def test_revoke_survives_notify_raise(
    settings_client: TestClient,
    settings_env: dict[str, object],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    now = datetime.now(UTC)
    consents: FakeConsentRepo = settings_env["consents"]  # type: ignore[assignment]
    consents._by_pair[(SUB, CLIENT_ID)] = Consent(
        sub=SUB,
        client_id=CLIENT_ID,
        scopes=frozenset({"openid"}),
        mode=ConsentMode.IDENTITY,
        granted_at=now,
    )

    def _boom(*_a: object, **_k: object) -> None:
        raise RuntimeError("notify boom")

    monkeypatch.setattr("src.settings_ui.router.notify_sub_quietly", _boom)
    _login(settings_client)
    resp = settings_client.post(
        f"/settings/apps/{CLIENT_ID}/revoke",
        follow_redirects=False,
    )
    assert resp.status_code in {302, 303}
    assert (SUB, CLIENT_ID) not in consents._by_pair
