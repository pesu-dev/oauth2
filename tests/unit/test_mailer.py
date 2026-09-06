"""Unit tests for mailer port, log/SMTP backends, and fail-open hooks."""

from __future__ import annotations

import base64
import hashlib
from dataclasses import replace
from datetime import UTC, datetime
from typing import TYPE_CHECKING
from unittest.mock import MagicMock, patch

import pytest
from fastapi.testclient import TestClient

from src.academy.fake import FakeAcademyClient
from src.academy.models import AcademyAuthResult, AcademyProfile, AcademySession
from src.app import create_app
from src.config import load_config
from src.crypto.hashing import sha256_hex
from src.crypto.ids import new_client_id
from src.crypto.vault_crypto import master_key_from_secret, seal
from src.mailer.log import LogMailer
from src.mailer.port import build_mailer, send_quietly
from src.mailer.smtp import SmtpMailer
from src.models.client import Client, PublishingStatus
from src.models.consent import Consent, ConsentMode
from src.models.user import User
from src.models.vault import VaultEntry
from src.repos.fakes import (
    FakeAdminRepo,
    FakeAuthCodeRepo,
    FakeClientRepo,
    FakeConsentRepo,
    FakeProductionRequestRepo,
    FakeRefreshTokenRepo,
    FakeTesterRepo,
    FakeUserRepo,
    FakeVaultRepo,
)

if TYPE_CHECKING:
    from collections.abc import Iterator

SETTINGS_COOKIE = "oauth2_settings"
PORTAL_COOKIE = "oauth2_portal"
CLIENT_ID = "cli_mailer_unit"
SUB = "usr_mailer_unit"
OWNER_SUB = "usr_mailer_owner"
PRN = "PES2202508888"
PASSWORD = "mailer-password"
VAULT_MASTER = "unit-vault-master-key-32bytes!!"
SESSION_SECRET = "unit-mailer-session-secret"


def _s256_challenge(verifier: str) -> str:
    digest = hashlib.sha256(verifier.encode("ascii")).digest()
    return base64.urlsafe_b64encode(digest).rstrip(b"=").decode("ascii")


class RaisingMailer:
    """Mailer that always fails — used to prove fail-open hooks."""

    async def send(self, *, to: str, subject: str, body: str) -> None:
        raise RuntimeError(f"smtp boom: {to} {subject} {body}")


def _profile(**overrides: object) -> AcademyProfile:
    base: dict[str, object] = {
        "name": "MAILER USER",
        "prn": PRN,
        "srn": "PES2UG25CS888",
        "program": "B.Tech.",
        "branch": "CSE",
        "semester": "1",
        "section": "A",
        "campus": "RR",
        "email": "student@example.com",
        "phone": "9888888888",
    }
    base.update(overrides)
    return AcademyProfile(**base)  # type: ignore[arg-type]


def _seed_user(
    users: FakeUserRepo,
    *,
    sub: str = SUB,
    email: str | None = "student@example.com",
    prn: str = PRN,
) -> User:
    now = datetime.now(UTC)
    user = User(
        sub=sub,
        name="MAILER USER",
        prn=prn,
        srn="PES2UG25CS888",
        program="B.Tech.",
        branch="CSE",
        semester="1",
        section="A",
        campus="RR",
        email=email,
        phone="9888888888",
        created_at=now,
        last_login_at=now,
        deleted_at=None,
    )
    users._by_sub[sub] = user
    return user


@pytest.mark.unit
@pytest.mark.asyncio
async def test_log_mailer_records_message() -> None:
    mailer = LogMailer()
    await mailer.send(to="a@example.com", subject="Hello", body="World")
    assert len(mailer.messages) == 1
    msg = mailer.messages[0]
    assert msg.to == "a@example.com"
    assert msg.subject == "Hello"
    assert msg.body == "World"


@pytest.mark.unit
def test_build_mailer_defaults_to_log_without_smtp() -> None:
    cfg = replace(load_config(), gmail_smtp_user=None, gmail_smtp_app_password=None)
    mailer = build_mailer(cfg)
    assert isinstance(mailer, LogMailer)


@pytest.mark.unit
def test_build_mailer_selects_smtp_when_env_present() -> None:
    cfg = replace(
        load_config(),
        gmail_smtp_user="noreply@gmail.com",
        gmail_smtp_app_password="app-pass",
    )
    mailer = build_mailer(cfg)
    assert isinstance(mailer, SmtpMailer)


@pytest.mark.unit
def test_build_mailer_requires_both_smtp_fields() -> None:
    only_user = replace(
        load_config(),
        gmail_smtp_user="noreply@gmail.com",
        gmail_smtp_app_password=None,
    )
    only_pass = replace(
        load_config(),
        gmail_smtp_user=None,
        gmail_smtp_app_password="app-pass",
    )
    assert isinstance(build_mailer(only_user), LogMailer)
    assert isinstance(build_mailer(only_pass), LogMailer)


@pytest.mark.unit
@pytest.mark.asyncio
async def test_send_quietly_swallows_mailer_errors() -> None:
    await send_quietly(
        RaisingMailer(),
        to="a@example.com",
        subject="x",
        body="y",
    )


@pytest.mark.unit
@pytest.mark.asyncio
async def test_notify_sub_quietly_skips_missing_email() -> None:
    from src.mailer.port import notify_sub_quietly

    users = FakeUserRepo()
    _seed_user(users, email=None)
    mailer = LogMailer()
    await notify_sub_quietly(
        mailer,
        users,
        sub=SUB,
        subject="Nope",
        body="Should not send",
    )
    assert mailer.messages == []


@pytest.mark.unit
@pytest.mark.asyncio
async def test_notify_sub_quietly_swallows_user_lookup_errors() -> None:
    from src.mailer.port import notify_sub_quietly

    class BoomUsers:
        async def get_user(self, sub: str) -> User | None:
            raise RuntimeError(f"db down for {sub}")

    mailer = LogMailer()
    await notify_sub_quietly(
        mailer,
        BoomUsers(),  # type: ignore[arg-type]
        sub=SUB,
        subject="Nope",
        body="Should not send",
    )
    assert mailer.messages == []


@pytest.mark.unit
@pytest.mark.asyncio
async def test_smtp_mailer_sends_via_smtplib() -> None:
    mailer = SmtpMailer(username="noreply@gmail.com", password="app-pass")
    smtp_instance = MagicMock()
    with patch("src.mailer.smtp.smtplib.SMTP_SSL") as smtp_cls:
        smtp_cls.return_value.__enter__.return_value = smtp_instance
        await mailer.send(to="dest@example.com", subject="Subj", body="Body text")

    smtp_cls.assert_called_once()
    smtp_instance.login.assert_called_once_with("noreply@gmail.com", "app-pass")
    smtp_instance.send_message.assert_called_once()
    sent = smtp_instance.send_message.call_args.args[0]
    assert sent["To"] == "dest@example.com"
    assert sent["From"] == "noreply@gmail.com"
    assert sent["Subject"] == "Subj"


@pytest.mark.unit
def test_create_app_wires_default_log_mailer() -> None:
    cfg = replace(load_config(), gmail_smtp_user=None, gmail_smtp_app_password=None)
    app = create_app(cfg)
    assert isinstance(app.state.mailer, LogMailer)


@pytest.mark.unit
def test_create_app_wires_smtp_mailer_when_configured() -> None:
    cfg = replace(
        load_config(),
        gmail_smtp_user="noreply@gmail.com",
        gmail_smtp_app_password="app-pass",
    )
    app = create_app(cfg)
    assert isinstance(app.state.mailer, SmtpMailer)


@pytest.mark.unit
def test_create_app_accepts_injected_mailer() -> None:
    injected = LogMailer()
    app = create_app(load_config(), mailer=injected)
    assert app.state.mailer is injected


# --- Fail-open hook tests ---


@pytest.fixture
def mailer_settings_env(rsa_pem: str) -> dict[str, object]:
    users = FakeUserRepo()
    _seed_user(users)
    now = datetime.now(UTC)
    clients = FakeClientRepo()
    clients._by_id[CLIENT_ID] = Client(
        client_id=CLIENT_ID,
        client_secret_hash=None,
        name="Mailer Club",
        owner_sub=OWNER_SUB,
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
                session=AcademySession(token="mailer-sess", user_id="uid-m"),
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
        "mailer": LogMailer(),
        "config": replace(
            load_config(),
            token_signing_key_pem=rsa_pem,
            session_secret=SESSION_SECRET,
            vault_master_key=VAULT_MASTER,
        ),
    }


@pytest.fixture
def mailer_settings_client(mailer_settings_env: dict[str, object]) -> Iterator[TestClient]:
    app = create_app(
        mailer_settings_env["config"],  # type: ignore[arg-type]
        academy=mailer_settings_env["academy"],  # type: ignore[arg-type]
        users=mailer_settings_env["users"],  # type: ignore[arg-type]
        clients=mailer_settings_env["clients"],  # type: ignore[arg-type]
        testers=mailer_settings_env["testers"],  # type: ignore[arg-type]
        auth_codes=mailer_settings_env["auth_codes"],  # type: ignore[arg-type]
        refresh_tokens=mailer_settings_env["refresh_tokens"],  # type: ignore[arg-type]
        consents=mailer_settings_env["consents"],  # type: ignore[arg-type]
        vault=mailer_settings_env["vault"],  # type: ignore[arg-type]
        mailer=mailer_settings_env["mailer"],  # type: ignore[arg-type]
    )
    with TestClient(app) as client:
        yield client


def _settings_login(client: TestClient) -> None:
    resp = client.post(
        "/settings/login",
        data={"username": "student", "password": PASSWORD},
        follow_redirects=False,
    )
    assert resp.status_code in {302, 303}
    assert SETTINGS_COOKIE in client.cookies


@pytest.mark.unit
def test_revoke_app_sends_mail_fail_open(
    mailer_settings_client: TestClient,
    mailer_settings_env: dict[str, object],
) -> None:
    now = datetime.now(UTC)
    consents: FakeConsentRepo = mailer_settings_env["consents"]  # type: ignore[assignment]
    consents._by_pair[(SUB, CLIENT_ID)] = Consent(
        sub=SUB,
        client_id=CLIENT_ID,
        scopes=frozenset({"openid", "profile"}),
        mode=ConsentMode.IDENTITY,
        granted_at=now,
    )
    mailer: LogMailer = mailer_settings_env["mailer"]  # type: ignore[assignment]

    _settings_login(mailer_settings_client)
    resp = mailer_settings_client.post(
        f"/settings/apps/{CLIENT_ID}/revoke",
        follow_redirects=False,
    )
    assert resp.status_code in {302, 303}
    assert (SUB, CLIENT_ID) not in consents._by_pair
    assert len(mailer.messages) == 1
    assert mailer.messages[0].to == "student@example.com"
    assert "revok" in mailer.messages[0].subject.lower() or "revok" in mailer.messages[0].body.lower()


@pytest.mark.unit
def test_revoke_app_succeeds_when_mailer_raises(
    mailer_settings_env: dict[str, object],
) -> None:
    now = datetime.now(UTC)
    consents: FakeConsentRepo = mailer_settings_env["consents"]  # type: ignore[assignment]
    consents._by_pair[(SUB, CLIENT_ID)] = Consent(
        sub=SUB,
        client_id=CLIENT_ID,
        scopes=frozenset({"openid"}),
        mode=ConsentMode.IDENTITY,
        granted_at=now,
    )
    app = create_app(
        mailer_settings_env["config"],  # type: ignore[arg-type]
        academy=mailer_settings_env["academy"],  # type: ignore[arg-type]
        users=mailer_settings_env["users"],  # type: ignore[arg-type]
        clients=mailer_settings_env["clients"],  # type: ignore[arg-type]
        testers=mailer_settings_env["testers"],  # type: ignore[arg-type]
        auth_codes=mailer_settings_env["auth_codes"],  # type: ignore[arg-type]
        refresh_tokens=mailer_settings_env["refresh_tokens"],  # type: ignore[arg-type]
        consents=consents,
        vault=mailer_settings_env["vault"],  # type: ignore[arg-type]
        mailer=RaisingMailer(),
    )
    with TestClient(app) as client:
        _settings_login(client)
        resp = client.post(f"/settings/apps/{CLIENT_ID}/revoke", follow_redirects=False)
        assert resp.status_code in {302, 303}
    assert (SUB, CLIENT_ID) not in consents._by_pair


@pytest.mark.unit
def test_revoke_app_succeeds_when_get_client_raises(
    mailer_settings_env: dict[str, object],
) -> None:
    """Revoke mutations must complete even if client name lookup for mail fails."""
    now = datetime.now(UTC)
    consents: FakeConsentRepo = mailer_settings_env["consents"]  # type: ignore[assignment]
    consents._by_pair[(SUB, CLIENT_ID)] = Consent(
        sub=SUB,
        client_id=CLIENT_ID,
        scopes=frozenset({"openid"}),
        mode=ConsentMode.IDENTITY,
        granted_at=now,
    )

    class BoomClients(FakeClientRepo):
        async def get_client(self, client_id: str) -> Client | None:
            raise RuntimeError("mongo get_client boom")

    boom = BoomClients()
    boom._by_id = mailer_settings_env["clients"]._by_id  # type: ignore[attr-defined]
    app = create_app(
        mailer_settings_env["config"],  # type: ignore[arg-type]
        academy=mailer_settings_env["academy"],  # type: ignore[arg-type]
        users=mailer_settings_env["users"],  # type: ignore[arg-type]
        clients=boom,
        testers=mailer_settings_env["testers"],  # type: ignore[arg-type]
        auth_codes=mailer_settings_env["auth_codes"],  # type: ignore[arg-type]
        refresh_tokens=mailer_settings_env["refresh_tokens"],  # type: ignore[arg-type]
        consents=consents,
        vault=mailer_settings_env["vault"],  # type: ignore[arg-type]
        mailer=LogMailer(),
    )
    with TestClient(app) as client:
        _settings_login(client)
        resp = client.post(f"/settings/apps/{CLIENT_ID}/revoke", follow_redirects=False)
        assert resp.status_code in {302, 303}
    assert (SUB, CLIENT_ID) not in consents._by_pair


@pytest.mark.unit
def test_delete_credentials_sends_mail(
    mailer_settings_client: TestClient,
    mailer_settings_env: dict[str, object],
) -> None:
    vault: FakeVaultRepo = mailer_settings_env["vault"]  # type: ignore[assignment]
    master = master_key_from_secret(VAULT_MASTER)
    blob = seal(master, b'{"username":"student","password":"x"}', 1)
    vault._by_sub[SUB] = VaultEntry(sub=SUB, blob=blob, session_expires_at=None)
    mailer: LogMailer = mailer_settings_env["mailer"]  # type: ignore[assignment]

    _settings_login(mailer_settings_client)
    resp = mailer_settings_client.post("/settings/credentials/delete", follow_redirects=False)
    assert resp.status_code in {302, 303}
    assert SUB not in vault._by_sub
    assert len(mailer.messages) == 1
    assert "credential" in mailer.messages[0].subject.lower() or "credential" in mailer.messages[0].body.lower()


@pytest.mark.unit
def test_delete_account_sends_mail_and_fail_open(
    mailer_settings_env: dict[str, object],
) -> None:
    users: FakeUserRepo = mailer_settings_env["users"]  # type: ignore[assignment]
    app = create_app(
        mailer_settings_env["config"],  # type: ignore[arg-type]
        academy=mailer_settings_env["academy"],  # type: ignore[arg-type]
        users=users,
        clients=mailer_settings_env["clients"],  # type: ignore[arg-type]
        testers=mailer_settings_env["testers"],  # type: ignore[arg-type]
        auth_codes=mailer_settings_env["auth_codes"],  # type: ignore[arg-type]
        refresh_tokens=mailer_settings_env["refresh_tokens"],  # type: ignore[arg-type]
        consents=mailer_settings_env["consents"],  # type: ignore[arg-type]
        vault=mailer_settings_env["vault"],  # type: ignore[arg-type]
        mailer=RaisingMailer(),
    )
    with TestClient(app) as client:
        _settings_login(client)
        resp = client.post(
            "/settings/account/delete",
            data={"confirm": "DELETE"},
            follow_redirects=False,
        )
        assert resp.status_code in {302, 303}
    assert users._by_sub[SUB].deleted_at is not None


@pytest.mark.unit
def test_production_request_and_decision_notify_owner(
    rsa_pem: str,
) -> None:
    now = datetime.now(UTC)
    users = FakeUserRepo()
    _seed_user(users, sub=OWNER_SUB, email="dev@example.com", prn="PES2202509999")
    clients = FakeClientRepo()
    client_id = new_client_id()
    clients._by_id[client_id] = Client(
        client_id=client_id,
        client_secret_hash=sha256_hex("secret"),
        name="Prod Notify App",
        owner_sub=OWNER_SUB,
        redirect_uris=("https://app.example/cb",),
        token_endpoint_auth_method="client_secret_post",
        publishing_status=PublishingStatus.TESTING,
        delegated_allowed=False,
        created_at=now,
        updated_at=now,
    )
    admins = FakeAdminRepo()
    admins._subs.add(OWNER_SUB)
    academy = FakeAcademyClient(
        {
            ("dev", PASSWORD): AcademyAuthResult(
                profile=_profile(prn="PES2202509999", email="dev@example.com"),
                session=AcademySession(token="portal-sess", user_id="uid-d"),
            ),
        }
    )
    mailer = LogMailer()
    config = replace(
        load_config(),
        token_signing_key_pem=rsa_pem,
        session_secret=SESSION_SECRET,
        vault_master_key=VAULT_MASTER,
    )
    app = create_app(
        config,
        academy=academy,
        users=users,
        clients=clients,
        testers=FakeTesterRepo(),
        auth_codes=FakeAuthCodeRepo(),
        refresh_tokens=FakeRefreshTokenRepo(),
        consents=FakeConsentRepo(),
        vault=FakeVaultRepo(),
        admins=admins,
        production_requests=FakeProductionRequestRepo(),
        mailer=mailer,
    )
    with TestClient(app) as client:
        login = client.post(
            "/portal/login",
            data={"username": "dev", "password": PASSWORD},
            follow_redirects=False,
        )
        assert login.status_code in {302, 303}
        assert PORTAL_COOKIE in client.cookies

        req = client.post(
            f"/portal/clients/{client_id}/request-production",
            follow_redirects=False,
        )
        assert req.status_code in {302, 303}
        assert any("production" in m.subject.lower() or "production" in m.body.lower() for m in mailer.messages)
        assert any(m.to == "dev@example.com" for m in mailer.messages)
        before_decision = len(mailer.messages)

        queue = app.state.production_requests
        request_id = next(iter(queue._by_id))  # type: ignore[attr-defined]
        approve = client.post(
            f"/admin/requests/{request_id}/approve",
            data={"delegated_allowed": "false"},
            follow_redirects=False,
        )
        assert approve.status_code in {302, 303}
        assert len(mailer.messages) > before_decision
        later = mailer.messages[before_decision:]
        assert any("approv" in m.subject.lower() or "approv" in m.body.lower() for m in later)


@pytest.mark.unit
def test_consent_allow_succeeds_when_mailer_raises(rsa_pem: str) -> None:
    """Consent Allow must never raise into the user flow on mail failure."""
    now = datetime.now(UTC)
    users = FakeUserRepo()
    _seed_user(users)
    clients = FakeClientRepo()
    clients._by_id[CLIENT_ID] = Client(
        client_id=CLIENT_ID,
        client_secret_hash=None,
        name="Consent Mail Club",
        owner_sub=OWNER_SUB,
        redirect_uris=("https://club.example/cb",),
        token_endpoint_auth_method="none",
        publishing_status=PublishingStatus.TESTING,
        delegated_allowed=False,
        created_at=now,
        updated_at=now,
    )
    testers = FakeTesterRepo()
    testers._pairs.add((CLIENT_ID, SUB))
    academy = FakeAcademyClient(
        {
            ("student", PASSWORD): AcademyAuthResult(
                profile=_profile(),
                session=AcademySession(token="consent-sess", user_id="uid-c"),
            ),
        }
    )
    config = replace(
        load_config(),
        token_signing_key_pem=rsa_pem,
        session_secret=SESSION_SECRET,
        vault_master_key=VAULT_MASTER,
    )
    app = create_app(
        config,
        academy=academy,
        users=users,
        clients=clients,
        testers=testers,
        auth_codes=FakeAuthCodeRepo(),
        refresh_tokens=FakeRefreshTokenRepo(),
        consents=FakeConsentRepo(),
        vault=FakeVaultRepo(),
        mailer=RaisingMailer(),
    )
    verifier = "a" * 43
    challenge = _s256_challenge(verifier)
    with TestClient(app) as client:
        start = client.get(
            "/authorize",
            params={
                "response_type": "code",
                "client_id": CLIENT_ID,
                "redirect_uri": "https://club.example/cb",
                "scope": "openid profile",
                "state": "st",
                "code_challenge": challenge,
                "code_challenge_method": "S256",
            },
            follow_redirects=False,
        )
        assert start.status_code in {302, 303}
        login = client.post(
            "/login",
            data={"username": "student", "password": PASSWORD},
            follow_redirects=False,
        )
        assert login.status_code in {302, 303}
        assert "/consent" in login.headers.get("location", "")
        allow = client.post(
            "/consent",
            data={"decision": "allow"},
            follow_redirects=False,
        )
        assert allow.status_code in {302, 303}
        assert "code=" in allow.headers.get("location", "")


class _ClientsBoomAfterConsent(FakeClientRepo):
    """Raises on get_client once a consent grant exists — simulates Mongo after upsert."""

    def __init__(self, consents: FakeConsentRepo) -> None:
        super().__init__()
        self._consents = consents

    async def get_client(self, client_id: str) -> Client | None:
        if any(pair[1] == client_id for pair in self._consents._by_pair):
            raise RuntimeError("mongo get_client boom")
        return await super().get_client(client_id)


@pytest.mark.unit
def test_consent_allow_succeeds_when_get_client_raises_after_upsert(rsa_pem: str) -> None:
    """After consent upsert, client lookup for mail must not block code issuance."""
    now = datetime.now(UTC)
    users = FakeUserRepo()
    _seed_user(users)
    consents = FakeConsentRepo()
    clients = _ClientsBoomAfterConsent(consents)
    clients._by_id[CLIENT_ID] = Client(
        client_id=CLIENT_ID,
        client_secret_hash=None,
        name="Consent Lookup Boom Club",
        owner_sub=OWNER_SUB,
        redirect_uris=("https://club.example/cb",),
        token_endpoint_auth_method="none",
        publishing_status=PublishingStatus.TESTING,
        delegated_allowed=False,
        created_at=now,
        updated_at=now,
    )
    testers = FakeTesterRepo()
    testers._pairs.add((CLIENT_ID, SUB))
    academy = FakeAcademyClient(
        {
            ("student", PASSWORD): AcademyAuthResult(
                profile=_profile(),
                session=AcademySession(token="consent-sess2", user_id="uid-c2"),
            ),
        }
    )
    config = replace(
        load_config(),
        token_signing_key_pem=rsa_pem,
        session_secret=SESSION_SECRET,
        vault_master_key=VAULT_MASTER,
    )
    app = create_app(
        config,
        academy=academy,
        users=users,
        clients=clients,
        testers=testers,
        auth_codes=FakeAuthCodeRepo(),
        refresh_tokens=FakeRefreshTokenRepo(),
        consents=consents,
        vault=FakeVaultRepo(),
        mailer=LogMailer(),
    )
    verifier = "b" * 43
    challenge = _s256_challenge(verifier)
    with TestClient(app) as client:
        start = client.get(
            "/authorize",
            params={
                "response_type": "code",
                "client_id": CLIENT_ID,
                "redirect_uri": "https://club.example/cb",
                "scope": "openid profile",
                "state": "st2",
                "code_challenge": challenge,
                "code_challenge_method": "S256",
            },
            follow_redirects=False,
        )
        assert start.status_code in {302, 303}
        login = client.post(
            "/login",
            data={"username": "student", "password": PASSWORD},
            follow_redirects=False,
        )
        assert login.status_code in {302, 303}
        assert "/consent" in login.headers.get("location", "")
        allow = client.post(
            "/consent",
            data={"decision": "allow"},
            follow_redirects=False,
        )
        assert allow.status_code in {302, 303}
        assert "code=" in allow.headers.get("location", "")
    assert (SUB, CLIENT_ID) in consents._by_pair
