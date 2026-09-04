"""Structured models for OIDC API documentation pages."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class Param:
    """One request parameter on a method docs page."""

    name: str
    location: str  # query | body | header | path
    required: bool
    type_hint: str
    description: str


@dataclass(frozen=True, slots=True)
class ErrorDoc:
    """One error entry for a method docs page."""

    status_or_code: str
    description: str


@dataclass(frozen=True, slots=True)
class MethodDoc:
    """Structured API method documentation (Jinja UI + generated LLM Markdown)."""

    slug: str
    nav_label: str
    title: str
    meta_description: str
    http_method: str
    path: str
    summary: str
    auth: str
    params: tuple[Param, ...]
    example_request: str
    success: str
    errors: tuple[ErrorDoc, ...]
    notes: tuple[str, ...] = ()

    @property
    def docs_path(self) -> str:
        return f"/docs/{self.slug}"


@dataclass(frozen=True, slots=True)
class DocTable:
    """Simple table for reference pages."""

    headers: tuple[str, ...]
    rows: tuple[tuple[str, ...], ...]


@dataclass(frozen=True, slots=True)
class RefSection:
    """One section on a reference docs page."""

    heading: str
    paragraphs: tuple[str, ...] = ()
    bullets: tuple[str, ...] = ()
    table: DocTable | None = None
    code: str | None = None


@dataclass(frozen=True, slots=True)
class ReferenceDoc:
    """Structured reference page (scopes, quick start)."""

    slug: str
    nav_label: str
    title: str
    meta_description: str
    heading: str
    summary: str
    sections: tuple[RefSection, ...]

    @property
    def docs_path(self) -> str:
        return f"/docs/{self.slug}"
