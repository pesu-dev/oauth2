"""First-party OIDC API docs under ``/docs`` with Copy for LLM."""

from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, Request
from fastapi.responses import HTMLResponse
from fastapi.templating import Jinja2Templates

from src.docs_site.content import (
    GITHUB_URL,
    INDEX_META_DESCRIPTION,
    METHOD_DOCS,
    REFERENCE_DOCS,
    nav_items,
)
from src.docs_site.markdown import markdown_for_llm, markdown_for_reference

router = APIRouter(tags=["docs"])

_TEMPLATES_DIR = Path(__file__).resolve().parent.parent / "templates"
templates = Jinja2Templates(directory=str(_TEMPLATES_DIR))


def _method_context(slug: str) -> dict[str, object]:
    doc = METHOD_DOCS[slug]
    return {
        "title": doc.title,
        "meta_description": doc.meta_description,
        "github_url": GITHUB_URL,
        "doc": doc,
        "markdown": markdown_for_llm(doc),
        "nav_items": nav_items(),
        "current_path": doc.docs_path,
        "show_copy_for_llm": True,
    }


def _reference_context(slug: str) -> dict[str, object]:
    doc = REFERENCE_DOCS[slug]
    return {
        "title": doc.title,
        "meta_description": doc.meta_description,
        "github_url": GITHUB_URL,
        "doc": doc,
        "markdown": markdown_for_reference(doc),
        "nav_items": nav_items(),
        "current_path": doc.docs_path,
        "show_copy_for_llm": True,
    }


@router.get("/docs", response_class=HTMLResponse)
async def docs_index(request: Request) -> HTMLResponse:
    """Docs landing page with links to method and reference pages."""
    return templates.TemplateResponse(
        request,
        "docs/index.html",
        {
            "title": "Docs · PESU OAuth",
            "meta_description": INDEX_META_DESCRIPTION,
            "github_url": GITHUB_URL,
            "nav_items": nav_items(),
            "current_path": "/docs",
            "show_copy_for_llm": False,
        },
    )


@router.get("/docs/discovery", response_class=HTMLResponse)
async def docs_discovery(request: Request) -> HTMLResponse:
    """Discovery endpoint documentation."""
    return templates.TemplateResponse(request, "docs/method.html", _method_context("discovery"))


@router.get("/docs/authorize", response_class=HTMLResponse)
async def docs_authorize(request: Request) -> HTMLResponse:
    """Authorize endpoint documentation."""
    return templates.TemplateResponse(request, "docs/method.html", _method_context("authorize"))


@router.get("/docs/token", response_class=HTMLResponse)
async def docs_token(request: Request) -> HTMLResponse:
    """Token endpoint documentation."""
    return templates.TemplateResponse(request, "docs/method.html", _method_context("token"))


@router.get("/docs/userinfo", response_class=HTMLResponse)
async def docs_userinfo(request: Request) -> HTMLResponse:
    """UserInfo endpoint documentation."""
    return templates.TemplateResponse(request, "docs/method.html", _method_context("userinfo"))


@router.get("/docs/revoke", response_class=HTMLResponse)
async def docs_revoke(request: Request) -> HTMLResponse:
    """Revocation endpoint documentation."""
    return templates.TemplateResponse(request, "docs/method.html", _method_context("revoke"))


@router.get("/docs/jwks", response_class=HTMLResponse)
async def docs_jwks(request: Request) -> HTMLResponse:
    """JWKS endpoint documentation."""
    return templates.TemplateResponse(request, "docs/method.html", _method_context("jwks"))


@router.get("/docs/scopes", response_class=HTMLResponse)
async def docs_scopes(request: Request) -> HTMLResponse:
    """Scopes and claims reference."""
    return templates.TemplateResponse(
        request,
        "docs/reference.html",
        _reference_context("scopes"),
    )


@router.get("/docs/quick-start", response_class=HTMLResponse)
async def docs_quick_start(request: Request) -> HTMLResponse:
    """Integration quick start."""
    return templates.TemplateResponse(
        request,
        "docs/reference.html",
        _reference_context("quick-start"),
    )
