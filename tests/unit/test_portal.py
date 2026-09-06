"""Unit tests for developer portal, admin Production queue, and AC-005."""

from __future__ import annotations

import re
from dataclasses import replace
from datetime import UTC, datetime
from typing import TYPE_CHECKING

import pytest
from fastapi.testclient import TestClient

from src.academy.fake import FakeAcademyClient
from src.academy.models import AcademyAuthResult, AcademyProfile, AcademySession
from src.app import create_app
from src.config import load_config
from src.models.client import PublishingStatus
from src.models.user import User
from src.repos.fakes import (
    FakeAdminRepo,
    FakeAuthCodeRepo,
    FakeClientRepo,
    FakeConsentRepo,
    FakeProductionRequestRepo,
    FakeRefreshTokenRepo,
    FakeTesterRepo,
    FakeUserRepo,
)
from tests.csrf_helpers import form_with_csrf, install_auto_csrf

if TYPE_CHECKING:
    from collections.abc import Iterator

PORTAL_COOKIE = "oauth2_portal"
OIDC_COOKIE = "oauth2_login"
REDIRECT_URI = "https://club.example/callback"
OWNER_SUB = "usr_portal_owner"
OWNER_PRN = "PES2202501001"
ADMIN_SUB = "usr_portal_admin"
ADMIN_PRN = "PES2202501002"
STRANGER_PRN = "PES2202501999"
PORTAL_SESSION_SECRET = "portal-unit-session-secret"


def _csrf(client: TestClient, data: dict[str, object] | None = None) -> dict[str, object]:
    return form_with_csrf(client, PORTAL_SESSION_SECRET, data)  # type: ignore[return-value]


def _install_auto_csrf(client: TestClient) -> TestClient:
    return install_auto_csrf(
        client,
        PORTAL_SESSION_SECRET,
        login_path="/portal/login",
        home_path="/portal",
    )


def _profile(**overrides: object) -> AcademyProfile:
    base: dict[str, object] = {
        "name": "PORTAL OWNER",
        "prn": OWNER_PRN,
        "srn": "PES2UG25CS101",
        "program": "B.Tech.",
        "branch": "CSE",
        "semester": "2",
        "section": "A",
        "campus": "RR",
        "email": "owner@example.com",
        "phone": "9000000101",
    }
    base.update(overrides)
    return AcademyProfile(**base)  # type: ignore[arg-type]


def _seed_user(users: FakeUserRepo, *, sub: str, prn: str, name: str) -> User:
    now = datetime.now(UTC)
    user = User(
        sub=sub,
        name=name,
        prn=prn,
        srn="PES2UG25CS000",
        program="B.Tech.",
        branch="CSE",
        semester="1",
        section="A",
        campus="RR",
        email=f"{sub}@example.com",
        phone="9000000000",
        created_at=now,
        last_login_at=now,
        deleted_at=None,
    )
    users._by_sub[sub] = user
    return user


@pytest.fixture
def portal_deps(rsa_pem: str) -> dict[str, object]:
    users = FakeUserRepo()
    _seed_user(users, sub=OWNER_SUB, prn=OWNER_PRN, name="PORTAL OWNER")
    _seed_user(users, sub=ADMIN_SUB, prn=ADMIN_PRN, name="PORTAL ADMIN")
    admins = FakeAdminRepo()
    admins._subs.add(ADMIN_SUB)
    academy = FakeAcademyClient(
        {
            ("owner", "correct-password"): AcademyAuthResult(
                profile=_profile(),
                session=AcademySession(token="portal-owner-sess"),
            ),
            ("admin", "correct-password"): AcademyAuthResult(
                profile=_profile(prn=ADMIN_PRN, name="PORTAL ADMIN", email="admin@example.com"),
                session=AcademySession(token="portal-admin-sess"),
            ),
            ("stranger", "correct-password"): AcademyAuthResult(
                profile=_profile(prn=STRANGER_PRN, name="STRANGER", email="stranger@example.com"),
                session=AcademySession(token="portal-stranger-sess"),
            ),
        }
    )
    return {
        "users": users,
        "clients": FakeClientRepo(),
        "testers": FakeTesterRepo(),
        "auth_codes": FakeAuthCodeRepo(),
        "refresh_tokens": FakeRefreshTokenRepo(),
        "consents": FakeConsentRepo(),
        "admins": admins,
        "production_requests": FakeProductionRequestRepo(),
        "academy": academy,
        "config": replace(
            load_config(),
            token_signing_key_pem=rsa_pem,
            session_secret=PORTAL_SESSION_SECRET,
        ),
    }


@pytest.fixture
def portal_client(portal_deps: dict[str, object]) -> Iterator[TestClient]:
    application = create_app(
        portal_deps["config"],  # type: ignore[arg-type]
        academy=portal_deps["academy"],  # type: ignore[arg-type]
        users=portal_deps["users"],  # type: ignore[arg-type]
        clients=portal_deps["clients"],  # type: ignore[arg-type]
        testers=portal_deps["testers"],  # type: ignore[arg-type]
        auth_codes=portal_deps["auth_codes"],  # type: ignore[arg-type]
        refresh_tokens=portal_deps["refresh_tokens"],  # type: ignore[arg-type]
        consents=portal_deps["consents"],  # type: ignore[arg-type]
        admins=portal_deps["admins"],  # type: ignore[arg-type]
        production_requests=portal_deps["production_requests"],  # type: ignore[arg-type]
    )
    with TestClient(application) as client:
        yield _install_auto_csrf(client)


def _portal_login(client: TestClient, *, username: str = "owner", password: str = "correct-password") -> None:
    page = client.get("/portal/login")
    assert page.status_code == 200
    assert "Sign in" in page.text or "Portal" in page.text
    resp = client.post(
        "/portal/login",
        data=_csrf(client, {"username": username, "password": password}),
        follow_redirects=False,
    )
    assert resp.status_code in {302, 303}
    assert PORTAL_COOKIE in client.cookies
    assert OIDC_COOKIE not in client.cookies or client.cookies.get(OIDC_COOKIE) in {"", None}


def _create_client(
    client: TestClient,
    *,
    name: str = "Club App",
    redirect_uri: str = REDIRECT_URI,
) -> tuple[str, str]:
    client.get("/portal/clients/new")
    resp = client.post(
        "/portal/clients",
        data=_csrf(client, {"name": name, "redirect_uri": redirect_uri}),
        follow_redirects=False,
    )
    assert resp.status_code in {302, 303}
    location = resp.headers["location"]
    assert "/portal/clients/" in location
    client_id = location.rstrip("/").split("/")[-1].split("?")[0]
    follow = client.get(location)
    assert follow.status_code == 200
    assert "testing" in follow.text.lower()
    secret_match = re.search(r'data-client-secret="([^"]+)"', follow.text)
    assert secret_match is not None, "plaintext secret must be shown once after create"
    return client_id, secret_match.group(1)


@pytest.mark.unit
def test_portal_login_uses_distinct_cookie(portal_client: TestClient) -> None:
    _portal_login(portal_client)
    dash = portal_client.get("/portal")
    assert dash.status_code == 200
    assert "Portal" in dash.text or "Clients" in dash.text
    assert PORTAL_COOKIE in portal_client.cookies


@pytest.mark.unit
def test_create_client_testing_and_secret_once(
    portal_client: TestClient,
    portal_deps: dict[str, object],
) -> None:
    _portal_login(portal_client)
    client_id, secret = _create_client(portal_client)
    assert client_id.startswith("cli_")
    assert len(secret) >= 16

    clients = portal_deps["clients"]
    assert isinstance(clients, FakeClientRepo)
    stored = clients._by_id[client_id]
    assert stored.publishing_status == PublishingStatus.TESTING
    assert stored.owner_sub == OWNER_SUB
    assert REDIRECT_URI in stored.redirect_uris
    assert stored.client_secret_hash is not None
    assert stored.client_secret_hash != secret
    assert stored.client_secret_hash.startswith("$argon2")

    again = portal_client.get(f"/portal/clients/{client_id}")
    assert again.status_code == 200
    assert f'data-client-secret="{secret}"' not in again.text
    assert secret not in again.text


@pytest.mark.unit
def test_flash_secret_not_shown_on_other_owned_client(
    portal_client: TestClient,
    portal_deps: dict[str, object],
) -> None:
    """Flash plaintext secret is bound to client_id — must not render on another client."""
    from src.portal.router import FLASH_COOKIE

    _portal_login(portal_client)
    create_a = portal_client.post(
        "/portal/clients",
        data={"name": "Client A", "redirect_uri": REDIRECT_URI},
        follow_redirects=False,
    )
    assert create_a.status_code in {302, 303}
    client_a = create_a.headers["location"].rstrip("/").split("/")[-1]
    flash_a = portal_client.cookies.get(FLASH_COOKIE)
    assert flash_a

    client_b, _secret_b = _create_client(portal_client, name="Client B")
    # Restore A's one-time flash after B's create consumed/replaced the cookie.
    portal_client.cookies.set(FLASH_COOKIE, flash_a)

    page_b = portal_client.get(f"/portal/clients/{client_b}")
    assert page_b.status_code == 200
    assert "data-client-secret=" not in page_b.text
    # Flash must still be present so A can display it.
    assert portal_client.cookies.get(FLASH_COOKIE) == flash_a

    page_a = portal_client.get(f"/portal/clients/{client_a}")
    assert page_a.status_code == 200
    secret_match = re.search(r'data-client-secret="([^"]+)"', page_a.text)
    assert secret_match is not None
    assert len(secret_match.group(1)) >= 16


@pytest.mark.unit
def test_manage_redirect_uris_and_testers(
    portal_client: TestClient,
    portal_deps: dict[str, object],
) -> None:
    _portal_login(portal_client)
    client_id, _ = _create_client(portal_client)
    new_uri = "https://club.example/alt"
    resp = portal_client.post(
        f"/portal/clients/{client_id}/redirect-uris",
        data={"redirect_uris": f"{REDIRECT_URI}\n{new_uri}"},
        follow_redirects=False,
    )
    assert resp.status_code in {302, 303}

    tester_sub = "usr_tester_portal"
    add = portal_client.post(
        f"/portal/clients/{client_id}/testers",
        data={"sub": tester_sub},
        follow_redirects=False,
    )
    assert add.status_code in {302, 303}

    clients = portal_deps["clients"]
    assert isinstance(clients, FakeClientRepo)
    assert new_uri in clients._by_id[client_id].redirect_uris

    testers = portal_deps["testers"]
    assert isinstance(testers, FakeTesterRepo)
    assert (client_id, tester_sub) in testers._pairs


@pytest.mark.unit
def test_request_production_creates_queue_row(
    portal_client: TestClient,
    portal_deps: dict[str, object],
) -> None:
    _portal_login(portal_client)
    client_id, _ = _create_client(portal_client)
    resp = portal_client.post(
        f"/portal/clients/{client_id}/request-production",
        follow_redirects=False,
    )
    assert resp.status_code in {302, 303}

    clients = portal_deps["clients"]
    assert isinstance(clients, FakeClientRepo)
    assert clients._by_id[client_id].publishing_status == PublishingStatus.PENDING_PRODUCTION

    queue = portal_deps["production_requests"]
    assert isinstance(queue, FakeProductionRequestRepo)
    pending = [r for r in queue._by_id.values() if r.client_id == client_id]
    assert len(pending) == 1
    assert pending[0].status.value == "pending"
    assert pending[0].requested_by_sub == OWNER_SUB


@pytest.mark.unit
def test_developer_cannot_self_set_production(
    portal_client: TestClient,
    portal_deps: dict[str, object],
) -> None:
    """AC-005: no portal path lets the owner flip publishing_status to production."""
    _portal_login(portal_client)
    client_id, _ = _create_client(portal_client)
    resp = portal_client.post(
        f"/portal/clients/{client_id}/publishing-status",
        data={"publishing_status": "production"},
    )
    assert resp.status_code in {403, 404, 405}

    clients = portal_deps["clients"]
    assert isinstance(clients, FakeClientRepo)
    assert clients._by_id[client_id].publishing_status == PublishingStatus.TESTING


@pytest.mark.unit
def test_admin_approve_sets_production(
    portal_client: TestClient,
    portal_deps: dict[str, object],
) -> None:
    _portal_login(portal_client)
    client_id, _ = _create_client(portal_client)
    portal_client.post(f"/portal/clients/{client_id}/request-production", follow_redirects=False)
    portal_client.cookies.clear()

    _portal_login(portal_client, username="admin")
    queue_page = portal_client.get("/admin")
    assert queue_page.status_code == 200
    assert client_id in queue_page.text

    queue = portal_deps["production_requests"]
    assert isinstance(queue, FakeProductionRequestRepo)
    request_id = next(iter(queue._by_id))

    approve = portal_client.post(
        f"/admin/requests/{request_id}/approve",
        data={"delegated_allowed": "false"},
        follow_redirects=False,
    )
    assert approve.status_code in {302, 303}

    clients = portal_deps["clients"]
    assert isinstance(clients, FakeClientRepo)
    assert clients._by_id[client_id].publishing_status == PublishingStatus.PRODUCTION
    assert clients._by_id[client_id].delegated_allowed is False
    assert queue._by_id[request_id].status.value == "approved"


@pytest.mark.unit
def test_admin_reject_back_to_testing(
    portal_client: TestClient,
    portal_deps: dict[str, object],
) -> None:
    _portal_login(portal_client)
    client_id, _ = _create_client(portal_client)
    portal_client.post(f"/portal/clients/{client_id}/request-production", follow_redirects=False)
    portal_client.cookies.clear()

    _portal_login(portal_client, username="admin")
    queue = portal_deps["production_requests"]
    assert isinstance(queue, FakeProductionRequestRepo)
    request_id = next(iter(queue._by_id))

    reject = portal_client.post(
        f"/admin/requests/{request_id}/reject",
        follow_redirects=False,
    )
    assert reject.status_code in {302, 303}

    clients = portal_deps["clients"]
    assert isinstance(clients, FakeClientRepo)
    assert clients._by_id[client_id].publishing_status == PublishingStatus.TESTING
    assert queue._by_id[request_id].status.value == "rejected"


@pytest.mark.unit
def test_admin_approve_can_set_delegated_allowed(
    portal_client: TestClient,
    portal_deps: dict[str, object],
) -> None:
    _portal_login(portal_client)
    client_id, _ = _create_client(portal_client)
    portal_client.post(f"/portal/clients/{client_id}/request-production", follow_redirects=False)
    portal_client.cookies.clear()

    _portal_login(portal_client, username="admin")
    queue = portal_deps["production_requests"]
    assert isinstance(queue, FakeProductionRequestRepo)
    request_id = next(iter(queue._by_id))

    portal_client.post(
        f"/admin/requests/{request_id}/approve",
        data={"delegated_allowed": "true"},
        follow_redirects=False,
    )
    clients = portal_deps["clients"]
    assert isinstance(clients, FakeClientRepo)
    assert clients._by_id[client_id].delegated_allowed is True


@pytest.mark.unit
def test_non_admin_cannot_access_admin_queue(portal_client: TestClient) -> None:
    _portal_login(portal_client)
    resp = portal_client.get("/admin")
    assert resp.status_code in {403, 302, 303}


@pytest.mark.unit
@pytest.mark.asyncio
async def test_seed_admin_adds_sub(portal_deps: dict[str, object]) -> None:
    from scripts.seed_admin import seed_admin

    admins = portal_deps["admins"]
    assert isinstance(admins, FakeAdminRepo)
    new_sub = "usr_seeded_admin"
    assert new_sub not in admins._subs

    await seed_admin(admins, new_sub)
    assert new_sub in admins._subs


@pytest.mark.unit
@pytest.mark.asyncio
async def test_seed_admin_rejects_non_usr_sub(portal_deps: dict[str, object]) -> None:
    from scripts.seed_admin import seed_admin

    with pytest.raises(ValueError, match="usr_"):
        await seed_admin(portal_deps["admins"], "not-a-sub")  # type: ignore[arg-type]


@pytest.mark.unit
def test_portal_unauthenticated_redirects(portal_client: TestClient) -> None:
    resp = portal_client.get("/portal", follow_redirects=False)
    assert resp.status_code in {302, 303}
    assert "/portal/login" in resp.headers["location"]


@pytest.mark.unit
def test_portal_bad_login_shows_error(portal_client: TestClient) -> None:
    resp = portal_client.post(
        "/portal/login",
        data={"username": "owner", "password": "wrong"},
    )
    assert resp.status_code == 200
    assert "invalid" in resp.text.lower()


@pytest.mark.unit
def test_create_client_rejects_bad_redirect(portal_client: TestClient) -> None:
    _portal_login(portal_client)
    resp = portal_client.post(
        "/portal/clients",
        data={"name": "Bad", "redirect_uri": "ftp://evil.example/cb"},
    )
    assert resp.status_code == 400
    assert "redirect" in resp.text.lower()


@pytest.mark.unit
def test_create_client_rejects_empty_name(portal_client: TestClient) -> None:
    _portal_login(portal_client)
    resp = portal_client.post(
        "/portal/clients",
        data={"name": "   ", "redirect_uri": REDIRECT_URI},
    )
    assert resp.status_code == 400


@pytest.mark.unit
def test_cannot_request_production_twice(
    portal_client: TestClient,
    portal_deps: dict[str, object],
) -> None:
    _portal_login(portal_client)
    client_id, _ = _create_client(portal_client)
    portal_client.post(f"/portal/clients/{client_id}/request-production", follow_redirects=False)
    again = portal_client.post(f"/portal/clients/{client_id}/request-production")
    assert again.status_code == 400
    queue = portal_deps["production_requests"]
    assert isinstance(queue, FakeProductionRequestRepo)
    assert len(queue._by_id) == 1


@pytest.mark.unit
def test_foreign_client_not_found(portal_client: TestClient, portal_deps: dict[str, object]) -> None:
    _portal_login(portal_client)
    clients = portal_deps["clients"]
    assert isinstance(clients, FakeClientRepo)
    now = datetime.now(UTC)
    from src.models.client import Client

    clients._by_id["cli_other"] = Client(
        client_id="cli_other",
        client_secret_hash="hash",
        name="Other",
        owner_sub="usr_someone_else",
        redirect_uris=(REDIRECT_URI,),
        token_endpoint_auth_method="client_secret_post",
        publishing_status=PublishingStatus.TESTING,
        delegated_allowed=False,
        created_at=now,
        updated_at=now,
    )
    resp = portal_client.get("/portal/clients/cli_other")
    assert resp.status_code == 404


@pytest.mark.unit
def test_add_tester_rejects_bad_sub(portal_client: TestClient) -> None:
    _portal_login(portal_client)
    client_id, _ = _create_client(portal_client)
    resp = portal_client.post(
        f"/portal/clients/{client_id}/testers",
        data={"sub": "not-usr"},
    )
    assert resp.status_code == 400


@pytest.mark.unit
def test_redirect_uris_reject_empty(portal_client: TestClient) -> None:
    _portal_login(portal_client)
    client_id, _ = _create_client(portal_client)
    resp = portal_client.post(
        f"/portal/clients/{client_id}/redirect-uris",
        data={"redirect_uris": "\n\n"},
    )
    assert resp.status_code == 400


@pytest.mark.unit
def test_portal_logout_clears_session(portal_client: TestClient) -> None:
    _portal_login(portal_client)
    resp = portal_client.post("/portal/logout", follow_redirects=False)
    assert resp.status_code in {302, 303}
    again = portal_client.get("/portal", follow_redirects=False)
    assert again.status_code in {302, 303}


@pytest.mark.unit
def test_admin_approve_unknown_request(portal_client: TestClient) -> None:
    _portal_login(portal_client, username="admin")
    resp = portal_client.post(
        "/admin/requests/req_missing/approve",
        data={"delegated_allowed": "false"},
    )
    assert resp.status_code == 404


@pytest.mark.unit
def test_new_client_form_renders(portal_client: TestClient) -> None:
    _portal_login(portal_client)
    resp = portal_client.get("/portal/clients/new")
    assert resp.status_code == 200
    assert "New client" in resp.text or "redirect" in resp.text.lower()


class _OrderTrackingClientRepo(FakeClientRepo):
    """Fake clients that records update_client calls and can fail them."""

    def __init__(self, order: list[str], *, fail_update: bool = False) -> None:
        super().__init__()
        self._order = order
        self.fail_update = fail_update

    async def update_client(self, client: object) -> object:
        self._order.append("update_client")
        if self.fail_update:
            msg = "simulated client update failure"
            raise RuntimeError(msg)
        return await super().update_client(client)  # type: ignore[arg-type]


class _OrderTrackingQueueRepo(FakeProductionRequestRepo):
    """Fake queue that records create/resolve/delete order."""

    def __init__(self, order: list[str]) -> None:
        super().__init__()
        self._order = order

    async def create_request(self, request: object) -> object:
        self._order.append("create_request")
        return await super().create_request(request)  # type: ignore[arg-type]

    async def resolve_request(self, request_id: str, **kwargs: object) -> object | None:
        self._order.append("resolve_request")
        return await super().resolve_request(request_id, **kwargs)  # type: ignore[arg-type]

    async def delete_request(self, request_id: str) -> bool:
        self._order.append("delete_request")
        return await super().delete_request(request_id)


def _portal_client_with_deps(deps: dict[str, object]) -> TestClient:
    application = create_app(
        deps["config"],  # type: ignore[arg-type]
        academy=deps["academy"],  # type: ignore[arg-type]
        users=deps["users"],  # type: ignore[arg-type]
        clients=deps["clients"],  # type: ignore[arg-type]
        testers=deps["testers"],  # type: ignore[arg-type]
        auth_codes=deps["auth_codes"],  # type: ignore[arg-type]
        refresh_tokens=deps["refresh_tokens"],  # type: ignore[arg-type]
        consents=deps["consents"],  # type: ignore[arg-type]
        admins=deps["admins"],  # type: ignore[arg-type]
        production_requests=deps["production_requests"],  # type: ignore[arg-type]
    )
    return _install_auto_csrf(TestClient(application))


@pytest.mark.unit
def test_request_production_creates_queue_before_updating_client(
    portal_deps: dict[str, object],
) -> None:
    """Request Production must insert the queue row before flipping client status."""
    order: list[str] = []
    portal_deps["clients"] = _OrderTrackingClientRepo(order)
    portal_deps["production_requests"] = _OrderTrackingQueueRepo(order)
    with _portal_client_with_deps(portal_deps) as client:
        _portal_login(client)
        client_id, _ = _create_client(client)
        order.clear()
        resp = client.post(
            f"/portal/clients/{client_id}/request-production",
            follow_redirects=False,
        )
        assert resp.status_code in {302, 303}
    assert order == ["create_request", "update_client"]


@pytest.mark.unit
def test_request_production_compensates_when_client_update_fails(
    portal_deps: dict[str, object],
) -> None:
    """If update_client fails after create_request, orphan queue row is removed so retry works."""
    order: list[str] = []
    clients = _OrderTrackingClientRepo(order, fail_update=True)
    queue = _OrderTrackingQueueRepo(order)
    portal_deps["clients"] = clients
    portal_deps["production_requests"] = queue
    with _portal_client_with_deps(portal_deps) as client:
        _portal_login(client)
        client_id, _ = _create_client(client)
        order.clear()
        resp = client.post(f"/portal/clients/{client_id}/request-production")
        assert resp.status_code >= 400
        assert clients._by_id[client_id].publishing_status == PublishingStatus.TESTING
        assert queue._by_id == {}
        assert "create_request" in order
        assert "update_client" in order
        assert "delete_request" in order

        clients.fail_update = False
        order.clear()
        retry = client.post(
            f"/portal/clients/{client_id}/request-production",
            follow_redirects=False,
        )
        assert retry.status_code in {302, 303}
        assert clients._by_id[client_id].publishing_status == PublishingStatus.PENDING_PRODUCTION
        assert len(queue._by_id) == 1
        assert order == ["create_request", "update_client"]


@pytest.mark.unit
def test_admin_approve_updates_client_before_resolve(
    portal_deps: dict[str, object],
) -> None:
    """Approve must update the client first, then CAS-resolve the queue row."""
    order: list[str] = []
    portal_deps["clients"] = _OrderTrackingClientRepo(order)
    portal_deps["production_requests"] = _OrderTrackingQueueRepo(order)
    with _portal_client_with_deps(portal_deps) as client:
        _portal_login(client)
        client_id, _ = _create_client(client)
        client.post(f"/portal/clients/{client_id}/request-production", follow_redirects=False)
        client.cookies.clear()
        _portal_login(client, username="admin")
        request_id = next(iter(portal_deps["production_requests"]._by_id))  # type: ignore[attr-defined]
        order.clear()
        approve = client.post(
            f"/admin/requests/{request_id}/approve",
            data={"delegated_allowed": "false"},
            follow_redirects=False,
        )
        assert approve.status_code in {302, 303}
    assert order == ["update_client", "resolve_request"]


@pytest.mark.unit
def test_admin_reject_updates_client_before_resolve(
    portal_deps: dict[str, object],
) -> None:
    """Reject must update the client first, then CAS-resolve the queue row."""
    order: list[str] = []
    portal_deps["clients"] = _OrderTrackingClientRepo(order)
    portal_deps["production_requests"] = _OrderTrackingQueueRepo(order)
    with _portal_client_with_deps(portal_deps) as client:
        _portal_login(client)
        client_id, _ = _create_client(client)
        client.post(f"/portal/clients/{client_id}/request-production", follow_redirects=False)
        client.cookies.clear()
        _portal_login(client, username="admin")
        request_id = next(iter(portal_deps["production_requests"]._by_id))  # type: ignore[attr-defined]
        order.clear()
        reject = client.post(
            f"/admin/requests/{request_id}/reject",
            follow_redirects=False,
        )
        assert reject.status_code in {302, 303}
    assert order == ["update_client", "resolve_request"]


@pytest.mark.unit
def test_admin_approve_skips_resolve_when_client_update_fails(
    portal_deps: dict[str, object],
) -> None:
    """If client update fails on approve, the pending queue row must remain for retry."""
    order: list[str] = []
    clients = _OrderTrackingClientRepo(order)
    queue = _OrderTrackingQueueRepo(order)
    portal_deps["clients"] = clients
    portal_deps["production_requests"] = queue
    with _portal_client_with_deps(portal_deps) as client:
        _portal_login(client)
        client_id, _ = _create_client(client)
        client.post(f"/portal/clients/{client_id}/request-production", follow_redirects=False)
        client.cookies.clear()
        _portal_login(client, username="admin")
        request_id = next(iter(queue._by_id))
        clients.fail_update = True
        order.clear()
        resp = client.post(
            f"/admin/requests/{request_id}/approve",
            data={"delegated_allowed": "false"},
        )
        assert resp.status_code >= 400
        assert clients._by_id[client_id].publishing_status == PublishingStatus.PENDING_PRODUCTION
        assert queue._by_id[request_id].status.value == "pending"
        assert order == ["update_client"]
        assert "resolve_request" not in order


@pytest.mark.unit
def test_admin_unauthenticated_redirects(portal_client: TestClient) -> None:
    portal_client.cookies.clear()
    resp = portal_client.get("/admin", follow_redirects=False)
    assert resp.status_code in {302, 303}
    assert "/portal/login" in resp.headers["location"]
    approve = portal_client.post(
        "/admin/requests/req_x/approve",
        data={"delegated_allowed": "false"},
        follow_redirects=False,
    )
    assert approve.status_code in {302, 303}
    reject = portal_client.post(
        "/admin/requests/req_x/reject",
        follow_redirects=False,
    )
    assert reject.status_code in {302, 303}


@pytest.mark.unit
def test_admin_approve_and_reject_missing_client(
    portal_deps: dict[str, object],
) -> None:
    from datetime import UTC, datetime

    from src.models.production_request import ProductionRequest, ProductionRequestStatus

    queue = portal_deps["production_requests"]
    assert isinstance(queue, FakeProductionRequestRepo)
    now = datetime.now(UTC)
    queue._by_id["req_orphan"] = ProductionRequest(
        request_id="req_orphan",
        client_id="cli_missing",
        requested_by_sub=OWNER_SUB,
        status=ProductionRequestStatus.PENDING,
        delegated_requested=False,
        created_at=now,
        resolved_at=None,
        resolved_by_sub=None,
    )
    with _portal_client_with_deps(portal_deps) as client:
        _portal_login(client, username="admin")
        approve = client.post(
            "/admin/requests/req_orphan/approve",
            data={"delegated_allowed": "false"},
        )
        assert approve.status_code == 404
        assert "Client missing" in approve.text

        queue._by_id["req_orphan2"] = ProductionRequest(
            request_id="req_orphan2",
            client_id="cli_missing",
            requested_by_sub=OWNER_SUB,
            status=ProductionRequestStatus.PENDING,
            delegated_requested=False,
            created_at=now,
            resolved_at=None,
            resolved_by_sub=None,
        )
        reject = client.post("/admin/requests/req_orphan2/reject")
        assert reject.status_code == 404
        assert "Client missing" in reject.text


@pytest.mark.unit
def test_admin_reject_unknown_request(portal_client: TestClient) -> None:
    _portal_login(portal_client, username="admin")
    resp = portal_client.post("/admin/requests/req_missing/reject")
    assert resp.status_code == 404


@pytest.mark.unit
def test_admin_reject_skips_resolve_when_client_update_fails(
    portal_deps: dict[str, object],
) -> None:
    order: list[str] = []
    clients = _OrderTrackingClientRepo(order)
    queue = _OrderTrackingQueueRepo(order)
    portal_deps["clients"] = clients
    portal_deps["production_requests"] = queue
    with _portal_client_with_deps(portal_deps) as client:
        _portal_login(client)
        client_id, _ = _create_client(client)
        client.post(f"/portal/clients/{client_id}/request-production", follow_redirects=False)
        client.cookies.clear()
        _portal_login(client, username="admin")
        request_id = next(iter(queue._by_id))
        clients.fail_update = True
        order.clear()
        resp = client.post(f"/admin/requests/{request_id}/reject")
        assert resp.status_code >= 400
        assert "Reject failed" in resp.text or resp.status_code == 500
        assert queue._by_id[request_id].status.value == "pending"
        assert "resolve_request" not in order


@pytest.mark.unit
def test_portal_redirect_uri_helpers_and_auth_gates(portal_client: TestClient) -> None:
    from src.portal.router import _parse_redirect_uris, _valid_https_redirect

    assert _valid_https_redirect("http://localhost:3000/cb") is True
    assert _valid_https_redirect("http://127.0.0.1/cb") is True
    assert _valid_https_redirect("http://evil.example/cb") is False
    assert _parse_redirect_uris("not-a-uri\nhttps://ok.example/cb") is None
    parsed = _parse_redirect_uris("https://a.example/cb\nhttps://a.example/cb\nhttps://b.example/cb")
    assert parsed == ("https://a.example/cb", "https://b.example/cb")

    # Unauthenticated gates
    portal_client.cookies.clear()
    for path, method in (
        ("/portal/clients/new", "get"),
        ("/portal/clients", "post"),
        ("/portal/clients/cli_x", "get"),
        ("/portal/clients/cli_x/redirect-uris", "post"),
        ("/portal/clients/cli_x/testers", "post"),
        ("/portal/clients/cli_x/request-production", "post"),
    ):
        if method == "get":
            resp = portal_client.get(path, follow_redirects=False)
        else:
            resp = portal_client.post(
                path,
                data={
                    "name": "x",
                    "redirect_uri": "https://x",
                    "redirect_uris": "https://x",
                    "sub": "usr_x",
                },
                follow_redirects=False,
            )
        assert resp.status_code in {302, 303}, path
        assert "/portal/login" in resp.headers["location"]


@pytest.mark.unit
def test_portal_login_get_redirects_when_signed_in(portal_client: TestClient) -> None:
    _portal_login(portal_client)
    resp = portal_client.get("/portal/login", follow_redirects=False)
    assert resp.status_code in {302, 303}
    assert resp.headers["location"].rstrip("/").endswith("/portal")


@pytest.mark.unit
def test_portal_login_rate_limited(portal_client: TestClient) -> None:
    for _ in range(10):
        portal_client.post("/portal/login", data={"username": "nope", "password": "nope"})
    resp = portal_client.post("/portal/login", data={"username": "nope", "password": "nope"})
    assert resp.status_code == 429


@pytest.mark.unit
def test_portal_owned_client_not_found(portal_client: TestClient) -> None:
    _portal_login(portal_client)
    for path in (
        "/portal/clients/cli_missing/redirect-uris",
        "/portal/clients/cli_missing/testers",
        "/portal/clients/cli_missing/request-production",
    ):
        resp = portal_client.post(
            path,
            data={"redirect_uris": "https://a.example/cb", "sub": "usr_t"},
        )
        assert resp.status_code == 404
