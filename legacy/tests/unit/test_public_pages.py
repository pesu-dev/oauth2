"""Unit tests for public trust pages, robots.txt, and HTML 404."""

from __future__ import annotations

import re
from typing import TYPE_CHECKING

import pytest

if TYPE_CHECKING:
    from fastapi.testclient import TestClient

GITHUB = "https://github.com/pesu-dev/oauth2"

FAQ_TOPICS = (
    "Is this an official PESU / PESU Academy product?",
    'Does "Sign in with PESU" store my password?',
    "What is Testing vs Production for apps?",
    "What is delegated access / the credential vault?",
    "How is this different from pesu-auth?",
)

PUBLIC_ROUTES = (
    ("/", "Home"),
    ("/privacy", "Privacy"),
    ("/faq", "FAQ"),
)


def _title(html: str) -> str:
    match = re.search(r"<title>([^<]+)</title>", html)
    assert match is not None, "missing <title>"
    return match.group(1).strip()


def _meta_description(html: str) -> str | None:
    match = re.search(
        r'<meta\s+name="description"\s+content="([^"]+)"\s*/?>',
        html,
        flags=re.IGNORECASE,
    )
    return match.group(1).strip() if match else None


@pytest.mark.unit
@pytest.mark.parametrize(("path", "_label"), PUBLIC_ROUTES)
def test_public_pages_return_200(client: TestClient, path: str, _label: str) -> None:
    response = client.get(path)
    assert response.status_code == 200
    assert "text/html" in response.headers["content-type"]


@pytest.mark.unit
def test_public_pages_have_unique_titles(client: TestClient) -> None:
    titles = {_title(client.get(path).text) for path, _ in PUBLIC_ROUTES}
    assert len(titles) == len(PUBLIC_ROUTES)
    for path, label in PUBLIC_ROUTES:
        title = _title(client.get(path).text)
        assert label.lower() in title.lower() or path.strip("/") in title.lower()


@pytest.mark.unit
@pytest.mark.parametrize(("path", "_label"), PUBLIC_ROUTES)
def test_public_pages_have_meta_description(
    client: TestClient,
    path: str,
    _label: str,
) -> None:
    html = client.get(path).text
    description = _meta_description(html)
    assert description is not None
    assert len(description) > 20


@pytest.mark.unit
@pytest.mark.parametrize(("path", "_label"), PUBLIC_ROUTES)
def test_public_pages_link_github_and_mit(
    client: TestClient,
    path: str,
    _label: str,
) -> None:
    html = client.get(path).text
    assert GITHUB in html
    assert re.search(r"\bMIT\b", html)
    assert "open source" in html.lower() or "open-source" in html.lower()


@pytest.mark.unit
def test_public_footer_links(client: TestClient) -> None:
    html = client.get("/").text
    for href in ("/", "/docs", "/portal", "/settings", "/faq", "/privacy", GITHUB):
        assert href in html
    assert "unofficial" in html.lower()


@pytest.mark.unit
def test_faq_has_exactly_five_spec_topics(client: TestClient) -> None:
    html = client.get("/faq").text
    for topic in FAQ_TOPICS:
        assert topic in html
    # Exactly five question headings (h2)
    headings = re.findall(r"<h2[^>]*>([^<]+)</h2>", html)
    assert len(headings) == 5


@pytest.mark.unit
def test_privacy_covers_required_topics(client: TestClient) -> None:
    html = client.get("/privacy").text.lower()
    assert "password" in html
    assert "vault" in html
    assert "consent" in html
    assert "token" in html
    assert "email" in html
    assert "delete" in html
    assert "unofficial" in html
    assert "transient" in html or "not store" in html or "do not store" in html


@pytest.mark.unit
def test_robots_txt_allows_public_and_disallows_auth(client: TestClient) -> None:
    response = client.get("/robots.txt")
    assert response.status_code == 200
    assert "text/plain" in response.headers["content-type"]
    body = response.text

    for path in ("/", "/faq", "/privacy", "/docs"):
        assert f"Allow: {path}" in body

    for path in (
        "/authorize",
        "/login",
        "/consent",
        "/settings",
        "/portal",
        "/admin",
        "/token",
        "/userinfo",
        "/oauth/token-exchange",
        "/revoke",
    ):
        assert f"Disallow: {path}" in body


@pytest.mark.unit
def test_unknown_html_route_returns_branded_404(client: TestClient) -> None:
    response = client.get(
        "/this-page-does-not-exist",
        headers={"Accept": "text/html"},
    )
    assert response.status_code == 404
    assert "text/html" in response.headers["content-type"]
    html = response.text
    title = _title(html)
    assert "404" in title or "not found" in title.lower()
    for href in ("/", "/docs", "/portal", "/faq", "/privacy"):
        assert href in html
    assert GITHUB in html
    assert re.search(r"\bMIT\b", html)


@pytest.mark.unit
def test_unknown_api_route_returns_json_404(client: TestClient) -> None:
    response = client.get(
        "/this-page-does-not-exist",
        headers={"Accept": "application/json"},
    )
    assert response.status_code == 404
    assert "application/json" in response.headers["content-type"]
    assert response.json()["detail"] == "Not Found"


@pytest.mark.unit
def test_home_links_to_portal_docs_faq_privacy(client: TestClient) -> None:
    html = client.get("/").text
    assert "/portal" in html
    assert "/docs" in html
    assert "/faq" in html
    assert "/privacy" in html
    assert "Sign in with PESU" in html or "sign in with PESU" in html
