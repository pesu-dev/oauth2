"""Unit tests for OIDC API docs site and Copy for LLM."""

from __future__ import annotations

import re
from typing import TYPE_CHECKING

import pytest

if TYPE_CHECKING:
    from fastapi.testclient import TestClient

GITHUB = "https://github.com/pesu-dev/oauth2"

DOCS_INDEX = "/docs"

METHOD_PAGES = (
    ("/docs/discovery", "discovery", "GET /.well-known/openid-configuration"),
    ("/docs/authorize", "authorize", "GET /authorize"),
    ("/docs/token", "token", "POST /token"),
    ("/docs/userinfo", "userinfo", "GET /userinfo"),
    ("/docs/revoke", "revoke", "POST /revoke"),
    ("/docs/jwks", "jwks", "GET /jwks.json"),
)

REFERENCE_PAGES = (
    ("/docs/scopes", "scopes"),
    ("/docs/quick-start", "quick start"),
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


def _llm_markdown(html: str) -> str | None:
    match = re.search(
        r'<script\s+type="text/markdown"\s+id="llm-md"[^>]*>(.*?)</script>',
        html,
        flags=re.IGNORECASE | re.DOTALL,
    )
    return match.group(1) if match else None


@pytest.mark.unit
def test_docs_index_returns_200(client: TestClient) -> None:
    response = client.get(DOCS_INDEX)
    assert response.status_code == 200
    assert "text/html" in response.headers["content-type"]
    html = response.text
    assert "Docs" in _title(html) or "API" in _title(html)
    description = _meta_description(html)
    assert description is not None
    assert len(description) > 20


@pytest.mark.unit
def test_docs_index_links_public_methods_not_token_exchange(client: TestClient) -> None:
    html = client.get(DOCS_INDEX).text
    for path, _slug, _hint in METHOD_PAGES:
        assert path in html
    for path, _label in REFERENCE_PAGES:
        assert path in html
    assert 'href="/oauth/token-exchange"' not in html
    assert "/docs/token-exchange" not in html
    assert 'href="/docs/exchange"' not in html


@pytest.mark.unit
def test_authorize_docs_has_copy_for_llm_and_embedded_markdown(client: TestClient) -> None:
    response = client.get("/docs/authorize")
    assert response.status_code == 200
    html = response.text
    assert "Copy for LLM" in html
    md = _llm_markdown(html)
    assert md is not None
    assert "GET /authorize" in md
    assert "code_challenge" in md
    assert "S256" in md
    assert "PKCE" in md or "code_challenge" in md


@pytest.mark.unit
def test_authorize_docs_structured_header_and_params_table(client: TestClient) -> None:
    html = client.get("/docs/authorize").text
    assert re.search(r'class="[^"]*\bdocs-method\b', html)
    assert re.search(r'class="[^"]*\bmethod-badge\b', html)
    assert re.search(r'class="[^"]*\bmethod-badge\b[^>]*>\s*GET\s*<', html)
    assert re.search(r'class="[^"]*\bmethod-path\b[^>]*>\s*/authorize\s*<', html)
    assert "code_challenge" in html
    assert "S256" in html
    assert re.search(r'class="[^"]*\bdocs-table\b', html)
    assert "<th" in html and "<td" in html
    assert "docs-markdown-view" not in html
    assert "docs-prose" not in html
    md = _llm_markdown(html)
    assert md is not None
    assert "GET /authorize" in md
    assert "Copy for LLM" in html


@pytest.mark.unit
@pytest.mark.parametrize(("path", "_slug", "method_hint"), METHOD_PAGES)
def test_method_docs_pages(
    client: TestClient,
    path: str,
    _slug: str,
    method_hint: str,
) -> None:
    response = client.get(path)
    assert response.status_code == 200
    html = response.text
    assert "Copy for LLM" in html
    md = _llm_markdown(html)
    assert md is not None
    assert method_hint in md
    assert _meta_description(html) is not None
    assert GITHUB in html
    assert re.search(r"\bMIT\b", html)
    assert re.search(r'class="[^"]*\bdocs-method\b', html)
    assert re.search(r'class="[^"]*\bmethod-badge\b', html)
    assert re.search(r'class="[^"]*\bdocs-table\b', html) or "Parameters" in html or "Auth" in html
    assert "docs-markdown-view" not in html
    assert "docs-prose" not in html


@pytest.mark.unit
@pytest.mark.parametrize(("path", "label"), REFERENCE_PAGES)
def test_reference_docs_pages(client: TestClient, path: str, label: str) -> None:
    response = client.get(path)
    assert response.status_code == 200
    html = response.text
    title = _title(html)
    assert label.split()[0].lower() in title.lower() or "docs" in title.lower()
    assert _meta_description(html) is not None
    assert 'href="/oauth/token-exchange"' not in html
    assert "/docs/token-exchange" not in html
    assert re.search(r'class="[^"]*\bdocs-reference\b', html)
    assert "docs-markdown-view" not in html
    assert "docs-prose" not in html
    assert re.search(r"<h[12]\b", html)
    assert "<p>" in html
    assert "Copy for LLM" in html
    assert _llm_markdown(html) is not None


@pytest.mark.unit
def test_docs_pages_have_unique_titles(client: TestClient) -> None:
    paths = [DOCS_INDEX, *(p for p, *_ in METHOD_PAGES), *(p for p, _ in REFERENCE_PAGES)]
    titles = {_title(client.get(path).text) for path in paths}
    assert len(titles) == len(paths)


@pytest.mark.unit
def test_docs_footer_matches_public_chrome(client: TestClient) -> None:
    html = client.get(DOCS_INDEX).text
    for href in ("/", "/docs", "/portal", "/settings", "/faq", "/privacy", GITHUB):
        assert href in html
    assert "unofficial" in html.lower()


@pytest.mark.unit
def test_docs_content_matches_identity_protocol(client: TestClient) -> None:
    authorize = client.get("/docs/authorize").text
    assert "Testing" in authorize
    assert "PKCE" in authorize or "code_challenge" in authorize

    scopes = client.get("/docs/scopes").text.lower()
    assert "openid" in scopes
    assert "profile" in scopes
    assert "email" in scopes
    assert "offline_access" in scopes
    assert 'href="/oauth/token-exchange"' not in scopes
    assert "/docs/token-exchange" not in scopes

    quick = client.get("/docs/quick-start").text
    assert "S256" in quick
    assert "authorization_code" in quick or "authorization code" in quick.lower()


@pytest.mark.unit
def test_copy_for_llm_script_is_referenced(client: TestClient) -> None:
    html = client.get("/docs/authorize").text
    assert "/static/js/copy_for_llm.js" in html


@pytest.mark.unit
def test_markdown_for_llm_generated_from_method_doc() -> None:
    from src.docs_site.content import METHOD_DOCS
    from src.docs_site.markdown import markdown_for_llm

    doc = METHOD_DOCS["authorize"]
    md = markdown_for_llm(doc)
    assert "GET /authorize" in md
    assert "code_challenge" in md
    assert "S256" in md
    assert "## Summary" in md
    assert "## Parameters" in md


@pytest.mark.unit
def test_markdown_for_llm_empty_params_errors_and_notes() -> None:
    from src.docs_site.markdown import markdown_for_llm
    from src.docs_site.models import MethodDoc

    doc = MethodDoc(
        slug="ping",
        nav_label="Ping",
        title="Ping",
        meta_description="x" * 24,
        http_method="GET",
        path="/ping",
        summary="Health check.",
        auth="None.",
        params=(),
        example_request="GET /ping HTTP/1.1",
        success="200 ok",
        errors=(),
        notes=(),
    )
    md = markdown_for_llm(doc)
    assert "None." in md
    assert "None documented." in md
    assert "## Notes" not in md


@pytest.mark.unit
def test_markdown_for_reference_includes_code_block() -> None:
    from src.docs_site.markdown import markdown_for_reference
    from src.docs_site.models import ReferenceDoc, RefSection

    doc = ReferenceDoc(
        slug="sample",
        nav_label="Sample",
        title="Sample",
        meta_description="x" * 24,
        heading="Sample",
        summary="A sample reference.",
        sections=(
            RefSection(
                heading="Snippet",
                paragraphs=("See below.",),
                code="echo hello",
            ),
        ),
    )
    md = markdown_for_reference(doc)
    assert "## Snippet" in md
    assert "```\necho hello\n```" in md
