"""Public trust surfaces: home, privacy, FAQ, robots.txt."""

from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, Request
from fastapi.responses import HTMLResponse, PlainTextResponse
from fastapi.templating import Jinja2Templates

router = APIRouter(tags=["public"])

_TEMPLATES_DIR = Path(__file__).resolve().parent.parent / "templates"
templates = Jinja2Templates(directory=str(_TEMPLATES_DIR))

GITHUB_URL = "https://github.com/pesu-dev/oauth2"

_ROBOTS_TXT = """\
User-agent: *
Allow: /
Allow: /faq
Allow: /privacy
Allow: /docs
Disallow: /authorize
Disallow: /login
Disallow: /consent
Disallow: /settings
Disallow: /portal
Disallow: /admin
Disallow: /token
Disallow: /userinfo
Disallow: /oauth/token-exchange
Disallow: /revoke
"""


def render_404(request: Request) -> HTMLResponse:
    """Branded HTML 404 for browser navigations."""
    return templates.TemplateResponse(
        request,
        "404.html",
        {
            "title": "Not found · PESU OAuth",
            "meta_description": ("This page was not found on the unofficial PESU OAuth2 authorization server."),
            "github_url": GITHUB_URL,
        },
        status_code=404,
    )


@router.get("/", response_class=HTMLResponse)
async def home(request: Request) -> HTMLResponse:
    """Developer-oriented home for Sign in with PESU."""
    return templates.TemplateResponse(
        request,
        "home.html",
        {
            "title": "Home · PESU OAuth",
            "meta_description": (
                "Unofficial open-source Sign in with PESU (OIDC) for campus apps. "
                "MIT licensed — docs, portal, privacy, and FAQ."
            ),
            "github_url": GITHUB_URL,
        },
    )


@router.get("/privacy", response_class=HTMLResponse)
async def privacy(request: Request) -> HTMLResponse:
    """Privacy policy for the authorization server."""
    return templates.TemplateResponse(
        request,
        "privacy.html",
        {
            "title": "Privacy · PESU OAuth",
            "meta_description": (
                "How PESU OAuth2 handles passwords, vault credentials, consents, "
                "tokens, email, and account deletion. Unofficial; open source (MIT)."
            ),
            "github_url": GITHUB_URL,
        },
    )


@router.get("/faq", response_class=HTMLResponse)
async def faq(request: Request) -> HTMLResponse:
    """Public FAQ with the five locked topic questions."""
    return templates.TemplateResponse(
        request,
        "faq.html",
        {
            "title": "FAQ · PESU OAuth",
            "meta_description": (
                "Answers about official status, password storage, Testing vs "
                "Production, the credential vault, and how this differs from "
                "pesu-auth."
            ),
            "github_url": GITHUB_URL,
        },
    )


@router.get("/robots.txt", response_class=PlainTextResponse)
async def robots() -> PlainTextResponse:
    """Crawl rules: allow public trust pages; disallow auth surfaces."""
    return PlainTextResponse(_ROBOTS_TXT, media_type="text/plain")
