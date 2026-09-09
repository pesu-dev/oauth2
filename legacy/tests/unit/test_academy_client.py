"""Unit tests for PESU Academy mobile login adapter."""

from __future__ import annotations

import json
import os
from typing import TYPE_CHECKING

import httpx
import pytest

from src.academy.client import (
    DISPATCHER_URL,
    LOGIN_URL,
    HttpxAcademyClient,
    _campus_from_prn,
    _semester_from_class,
)
from src.academy.fake import FakeAcademyClient
from src.academy.models import (
    AcademyAuthError,
    AcademyAuthResult,
    AcademyProfile,
    AcademySession,
)

if TYPE_CHECKING:
    from collections.abc import Callable


SUCCESS_LOGIN_BODY: dict[str, object] = {
    "accessToken": "bearer-jwt-token",
    "mobileJsonObject": {
        "userId": "user-uuid-123",
        "userRoleId": "3",
        "login": "SUCCESS",
        "errorMessage": None,
        "name": "JOHN",
        "phone": "9876543210",
        "email": "john@example.com",
        "program": "B.Tech.",
        "branch": "Branch:CSE",
        "className": "Sem-2, Section A",
        "sectionName": "Section A",
        "loginId": "PES2202501872",
        "departmentId": "0",
        "batchClass": "2025",
        "usertype": "2",
    },
}

DISPATCHER_PROFILE_BODY: dict[str, object] = {
    "MESSAGE": "SUCCESS_Record found Successfully",
    "STUDENT_PHOTO": {
        "userId": "user-uuid-123",
        "loginId": "PES2UG25CS026",
        "email": "john.doe@example.com",
        "mobile": "9998887777",
        "firstName": "JOHN",
        "nameAsInSSLC": "JOHN DOE",
        "instituteName": "PES University",
    },
}


def _login_transport(
    *,
    login_handler: Callable[[httpx.Request], httpx.Response] | None = None,
    dispatcher_handler: Callable[[httpx.Request], httpx.Response] | None = None,
) -> httpx.MockTransport:
    def handler(request: httpx.Request) -> httpx.Response:
        path = request.url.path
        if path.endswith("/mobile/mobilelogin/auth"):
            if login_handler is not None:
                return login_handler(request)
            return httpx.Response(
                200,
                json=SUCCESS_LOGIN_BODY,
                headers={"mobileAppAuthenticationToken": "mobile-token-abc"},
            )
        if path.endswith("/mobile/dispatcher"):
            if dispatcher_handler is not None:
                return dispatcher_handler(request)
            return httpx.Response(200, json=DISPATCHER_PROFILE_BODY)
        return httpx.Response(404, json={"error": "unexpected url"})

    return httpx.MockTransport(handler)


def _sample_result() -> AcademyAuthResult:
    return AcademyAuthResult(
        profile=AcademyProfile(
            name="Test Student",
            prn="PES1201800001",
            srn="PES1UG18CS001",
            program="Bachelor of Technology",
            branch="Computer Science and Engineering",
            semester="Sem-4",
            section="Section C",
            campus="RR",
            email="test@example.com",
            phone="1234567890",
        ),
        session=AcademySession(token="fake-token", user_id="uid-1"),
    )


@pytest.mark.unit
@pytest.mark.asyncio
async def test_httpx_client_login_maps_profile_and_session() -> None:
    transport = _login_transport()
    async with httpx.AsyncClient(transport=transport) as http:
        client = HttpxAcademyClient(http)
        result = await client.login("PES2202501872", "secret")

    assert result.profile.name == "JOHN DOE"
    assert result.profile.prn == "PES2202501872"
    assert result.profile.srn == "PES2UG25CS026"
    assert result.profile.program == "Bachelor of Technology"
    assert result.profile.branch == "Computer Science and Engineering"
    assert result.profile.semester == "Sem-2"
    assert result.profile.section == "Section A"
    assert result.profile.campus == "EC"
    assert result.profile.email == "john.doe@example.com"
    assert result.profile.phone == "9998887777"
    assert result.session.token == "mobile-token-abc"
    assert result.session.access_token == "bearer-jwt-token"
    assert result.session.user_id == "user-uuid-123"
    assert result.session.expires_at is None


@pytest.mark.unit
@pytest.mark.asyncio
async def test_httpx_client_posts_login_to_mobile_auth_url() -> None:
    seen: dict[str, object] = {}

    def login_handler(request: httpx.Request) -> httpx.Response:
        seen["url"] = str(request.url)
        seen["method"] = request.method
        seen["content_type"] = request.headers.get("content-type", "")
        return httpx.Response(
            200,
            json=SUCCESS_LOGIN_BODY,
            headers={"mobileAppAuthenticationToken": "tok"},
        )

    transport = _login_transport(login_handler=login_handler)
    async with httpx.AsyncClient(transport=transport) as http:
        client = HttpxAcademyClient(http)
        await client.login("user1", "pass1")

    assert seen["method"] == "POST"
    assert seen["url"] == LOGIN_URL
    assert "multipart" in str(seen["content_type"]).lower()


@pytest.mark.unit
@pytest.mark.asyncio
async def test_httpx_client_enriches_via_dispatcher_admin_search() -> None:
    seen: dict[str, str] = {}

    def dispatcher_handler(request: httpx.Request) -> httpx.Response:
        seen["url"] = str(request.url)
        # multipart fields land in request content
        body = request.content.decode("utf-8", errors="replace")
        seen["body"] = body
        seen["auth_header"] = request.headers.get("authorization", "")
        seen["mobile_token"] = request.headers.get("mobileappauthenticationtoken", "")
        return httpx.Response(200, json=DISPATCHER_PROFILE_BODY)

    transport = _login_transport(dispatcher_handler=dispatcher_handler)
    async with httpx.AsyncClient(transport=transport) as http:
        client = HttpxAcademyClient(http)
        await client.login("PES2202501872", "secret")

    assert seen["url"] == DISPATCHER_URL
    assert 'name="action"' in seen["body"] and "27" in seen["body"]
    assert 'name="mode"' in seen["body"] and "1" in seen["body"]
    assert seen["auth_header"] == "Bearer bearer-jwt-token"
    assert seen["mobile_token"] == "mobile-token-abc"


@pytest.mark.unit
@pytest.mark.asyncio
async def test_httpx_client_falls_back_to_login_fields_if_dispatcher_fails() -> None:
    def dispatcher_handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(500, text="boom")

    transport = _login_transport(dispatcher_handler=dispatcher_handler)
    async with httpx.AsyncClient(transport=transport) as http:
        client = HttpxAcademyClient(http)
        result = await client.login("PES2202501872", "secret")

    assert result.profile.name == "JOHN"
    assert result.profile.prn == "PES2202501872"
    assert result.profile.srn == "PES2202501872"
    assert result.profile.email == "john@example.com"
    assert result.profile.phone == "9876543210"
    assert result.profile.campus == "EC"


@pytest.mark.unit
@pytest.mark.asyncio
async def test_httpx_client_raises_on_bad_credentials() -> None:
    def login_handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json={
                "mobileJsonObject": {
                    "login": "ERROR",
                    "errorMessage": "Invalid username or password",
                }
            },
        )

    transport = _login_transport(login_handler=login_handler)
    async with httpx.AsyncClient(transport=transport) as http:
        client = HttpxAcademyClient(http)
        with pytest.raises(AcademyAuthError, match="Invalid username or password"):
            await client.login("bad", "creds")


@pytest.mark.unit
@pytest.mark.asyncio
async def test_httpx_client_raises_on_http_error() -> None:
    def login_handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(503, text="unavailable")

    transport = _login_transport(login_handler=login_handler)
    async with httpx.AsyncClient(transport=transport) as http:
        client = HttpxAcademyClient(http)
        with pytest.raises(AcademyAuthError, match="503"):
            await client.login("user", "pass")


@pytest.mark.unit
@pytest.mark.asyncio
async def test_httpx_client_raises_on_invalid_json() -> None:
    def login_handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, text="not-json", headers={"content-type": "text/plain"})

    transport = _login_transport(login_handler=login_handler)
    async with httpx.AsyncClient(transport=transport) as http:
        client = HttpxAcademyClient(http)
        with pytest.raises(AcademyAuthError, match="JSON"):
            await client.login("user", "pass")


@pytest.mark.unit
@pytest.mark.asyncio
async def test_httpx_client_raises_on_transport_error() -> None:
    def handler(_request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("connection refused")

    transport = httpx.MockTransport(handler)
    async with httpx.AsyncClient(transport=transport) as http:
        client = HttpxAcademyClient(http)
        with pytest.raises(AcademyAuthError, match="Connection"):
            await client.login("user", "pass")


@pytest.mark.unit
@pytest.mark.asyncio
async def test_fake_academy_client_returns_mapped_result() -> None:
    expected = _sample_result()
    fake = FakeAcademyClient({("alice", "secret"): expected})
    result = await fake.login("alice", "secret")
    assert result == expected


@pytest.mark.unit
@pytest.mark.asyncio
async def test_fake_academy_client_raises_on_unknown_credentials() -> None:
    fake = FakeAcademyClient({("alice", "secret"): _sample_result()})
    with pytest.raises(AcademyAuthError, match="Invalid"):
        await fake.login("alice", "wrong")


@pytest.mark.unit
def test_semester_and_campus_helpers() -> None:
    assert _semester_from_class(None, None) is None
    assert _semester_from_class("3rd-Sem", None) == "Sem-3"
    assert _semester_from_class("Batch 5", None) == "Sem-5"
    assert _semester_from_class(None, "no-digits") is None
    assert _campus_from_prn(None) is None
    assert _campus_from_prn("XYZ") is None
    assert _campus_from_prn("PES1201800001") == "RR"
    assert _campus_from_prn("PES9201800001") is None


@pytest.mark.unit
@pytest.mark.asyncio
async def test_httpx_client_parses_stringified_json_body() -> None:
    def login_handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            content=json.dumps(json.dumps(SUCCESS_LOGIN_BODY)),
            headers={
                "content-type": "application/json",
                "mobileAppAuthenticationToken": "tok",
            },
        )

    transport = _login_transport(login_handler=login_handler)
    async with httpx.AsyncClient(transport=transport) as http:
        client = HttpxAcademyClient(http)
        result = await client.login("PES2202501872", "secret")
    assert result.profile.prn == "PES2202501872"


@pytest.mark.unit
@pytest.mark.asyncio
async def test_httpx_client_raises_on_invalid_nested_json_string() -> None:
    def login_handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            content=json.dumps("not-json-object"),
            headers={"content-type": "application/json"},
        )

    transport = _login_transport(login_handler=login_handler)
    async with httpx.AsyncClient(transport=transport) as http:
        client = HttpxAcademyClient(http)
        with pytest.raises(AcademyAuthError, match="nested JSON"):
            await client.login("user", "pass")


@pytest.mark.unit
@pytest.mark.asyncio
async def test_httpx_client_raises_on_non_object_json() -> None:
    def login_handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=["not", "a", "dict"])

    transport = _login_transport(login_handler=login_handler)
    async with httpx.AsyncClient(transport=transport) as http:
        client = HttpxAcademyClient(http)
        with pytest.raises(AcademyAuthError, match="Unexpected response shape"):
            await client.login("user", "pass")


@pytest.mark.unit
@pytest.mark.asyncio
async def test_httpx_client_raises_when_mobile_object_missing() -> None:
    def login_handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"accessToken": "x"})

    transport = _login_transport(login_handler=login_handler)
    async with httpx.AsyncClient(transport=transport) as http:
        client = HttpxAcademyClient(http)
        with pytest.raises(AcademyAuthError, match="Invalid username or password"):
            await client.login("user", "pass")


@pytest.mark.unit
@pytest.mark.asyncio
async def test_httpx_client_skips_dispatcher_without_token() -> None:
    mobile = dict(SUCCESS_LOGIN_BODY["mobileJsonObject"])  # type: ignore[arg-type]
    mobile["loginId"] = "PES1201800001"
    body = {
        "accessToken": "bearer",
        "mobileJsonObject": mobile,
    }

    dispatcher_called = False

    def login_handler(_request: httpx.Request) -> httpx.Response:
        # No mobileAppAuthenticationToken header
        return httpx.Response(200, json=body)

    def dispatcher_handler(_request: httpx.Request) -> httpx.Response:
        nonlocal dispatcher_called
        dispatcher_called = True
        return httpx.Response(200, json=DISPATCHER_PROFILE_BODY)

    transport = _login_transport(login_handler=login_handler, dispatcher_handler=dispatcher_handler)
    async with httpx.AsyncClient(transport=transport) as http:
        client = HttpxAcademyClient(http)
        result = await client.login("PES1201800001", "secret")

    assert dispatcher_called is False
    assert result.profile.campus == "RR"
    assert result.session.token == ""


@pytest.mark.unit
@pytest.mark.asyncio
async def test_httpx_client_maps_missing_optional_fields() -> None:
    body = {
        "accessToken": "bearer",
        "mobileJsonObject": {
            "userId": "u1",
            "login": "SUCCESS",
            "name": "ONLY NAME",
            "loginId": None,
            "program": None,
            "branch": None,
            "className": None,
            "batchClass": None,
            "sectionName": None,
            "email": None,
            "phone": None,
        },
    }

    def login_handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json=body,
            headers={"mobileAppAuthenticationToken": "tok"},
        )

    def dispatcher_handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(500, text="no")

    transport = _login_transport(login_handler=login_handler, dispatcher_handler=dispatcher_handler)
    async with httpx.AsyncClient(transport=transport) as http:
        client = HttpxAcademyClient(http)
        result = await client.login("someone", "secret")

    assert result.profile.name == "ONLY NAME"
    assert result.profile.prn is None
    assert result.profile.srn == "someone"
    assert result.profile.email is None
    assert result.profile.phone is None
    assert result.profile.campus is None


@pytest.mark.unit
@pytest.mark.asyncio
async def test_dispatcher_http_error_falls_back() -> None:
    def dispatcher_handler(_request: httpx.Request) -> httpx.Response:
        raise httpx.ReadTimeout("timed out")

    transport = _login_transport(dispatcher_handler=dispatcher_handler)
    async with httpx.AsyncClient(transport=transport) as http:
        client = HttpxAcademyClient(http)
        result = await client.login("PES2202501872", "secret")
    assert result.profile.name == "JOHN"


@pytest.mark.unit
@pytest.mark.asyncio
async def test_dispatcher_invalid_json_falls_back() -> None:
    def dispatcher_handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, text="not-json", headers={"content-type": "text/plain"})

    transport = _login_transport(dispatcher_handler=dispatcher_handler)
    async with httpx.AsyncClient(transport=transport) as http:
        client = HttpxAcademyClient(http)
        result = await client.login("PES2202501872", "secret")
    assert result.profile.email == "john@example.com"


@pytest.mark.unit
@pytest.mark.asyncio
async def test_dispatcher_non_object_or_failed_message_falls_back() -> None:
    calls = {"n": 0}

    def dispatcher_handler(_request: httpx.Request) -> httpx.Response:
        calls["n"] += 1
        if calls["n"] == 1:
            return httpx.Response(200, json=["list"])
        return httpx.Response(200, json={"MESSAGE": "FAIL", "STUDENT_PHOTO": {}})

    # First login: non-object dispatcher body
    transport = _login_transport(dispatcher_handler=dispatcher_handler)
    async with httpx.AsyncClient(transport=transport) as http:
        client = HttpxAcademyClient(http)
        result = await client.login("PES2202501872", "secret")
    assert result.profile.name == "JOHN"

    # Second login: failed MESSAGE
    transport = _login_transport(dispatcher_handler=dispatcher_handler)
    async with httpx.AsyncClient(transport=transport) as http:
        client = HttpxAcademyClient(http)
        result = await client.login("PES2202501872", "secret")
    assert result.profile.srn == "PES2202501872"


@pytest.mark.unit
@pytest.mark.asyncio
async def test_dispatcher_success_without_student_photo_falls_back() -> None:
    def dispatcher_handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"MESSAGE": "SUCCESS_ok", "STUDENT_PHOTO": "nope"})

    transport = _login_transport(dispatcher_handler=dispatcher_handler)
    async with httpx.AsyncClient(transport=transport) as http:
        client = HttpxAcademyClient(http)
        result = await client.login("PES2202501872", "secret")
    assert result.profile.name == "JOHN"


def _live_academy_ready() -> bool:
    return (
        os.environ.get("RUN_LIVE_ACADEMY") == "1"
        and bool(os.environ.get("PESU_USERNAME"))
        and bool(os.environ.get("PESU_PASSWORD"))
    )


@pytest.mark.live_academy
@pytest.mark.asyncio
@pytest.mark.skipif(
    not _live_academy_ready(),
    reason="Set RUN_LIVE_ACADEMY=1 and PESU_USERNAME / PESU_PASSWORD to run live Academy login",
)
async def test_live_academy_login() -> None:
    username = os.environ["PESU_USERNAME"]
    password = os.environ["PESU_PASSWORD"]
    async with httpx.AsyncClient(follow_redirects=True, timeout=30.0) as http:
        client = HttpxAcademyClient(http)
        result = await client.login(username, password)
    assert result.profile.name
    assert result.session.token
    # Smoke: response is JSON-serializable enough for debugging without printing secrets
    assert json.dumps({"prn": result.profile.prn, "srn": result.profile.srn})
