"""Unit tests for trusted-proxy client IP extraction."""

from __future__ import annotations

import pytest
from starlette.requests import Request


def _request(*, headers: dict[str, str] | None = None, client_host: str | None = "10.0.0.1") -> Request:
    scope: dict[str, object] = {
        "type": "http",
        "asgi": {"version": "3.0"},
        "http_version": "1.1",
        "method": "GET",
        "scheme": "http",
        "path": "/",
        "raw_path": b"/",
        "query_string": b"",
        "headers": [(k.lower().encode(), v.encode()) for k, v in (headers or {}).items()],
        "client": (client_host, 12345) if client_host is not None else None,
        "server": ("test", 80),
    }
    return Request(scope)


@pytest.mark.unit
def test_client_ip_prefers_leftmost_xff() -> None:
    from src.client_ip import client_ip

    req = _request(headers={"x-forwarded-for": "203.0.113.9, 10.0.0.1"}, client_host="10.0.0.1")
    assert client_ip(req) == "203.0.113.9"


@pytest.mark.unit
def test_client_ip_falls_back_to_socket_host() -> None:
    from src.client_ip import client_ip

    assert client_ip(_request()) == "10.0.0.1"


@pytest.mark.unit
def test_client_ip_unknown_without_client() -> None:
    from src.client_ip import client_ip

    assert client_ip(_request(client_host=None)) == "unknown"
