"""Generate Copy-for-LLM Markdown from structured docs models."""

from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from src.docs_site.models import MethodDoc, ReferenceDoc


def markdown_for_llm(doc: MethodDoc) -> str:
    """Build self-contained Markdown for a method page from structured fields."""
    lines: list[str] = [
        f"# {doc.nav_label} — {doc.http_method} {doc.path}",
        "",
        "## Summary",
        "",
        doc.summary.strip(),
        "",
        "## Auth",
        "",
        doc.auth.strip(),
        "",
        "## Parameters",
        "",
    ]
    if doc.params:
        lines.extend(
            [
                "| Name | In | Required | Type | Description |",
                "| --- | --- | --- | --- | --- |",
            ]
        )
        for param in doc.params:
            required = "yes" if param.required else "no"
            lines.append(
                f"| `{param.name}` | {param.location} | {required} | {param.type_hint} | {param.description} |"
            )
        lines.append("")
    else:
        lines.extend(["None.", ""])

    lines.extend(
        [
            "## Example request",
            "",
            "```http",
            doc.example_request.strip(),
            "```",
            "",
            "## Success",
            "",
            doc.success.strip(),
            "",
            "## Errors",
            "",
        ]
    )
    if doc.errors:
        lines.extend(
            [
                "| Code | Description |",
                "| --- | --- |",
            ]
        )
        for err in doc.errors:
            lines.append(f"| `{err.status_or_code}` | {err.description} |")
        lines.append("")
    else:
        lines.extend(["None documented.", ""])

    if doc.notes:
        lines.extend(["## Notes", ""])
        for note in doc.notes:
            lines.append(f"- {note}")
        lines.append("")

    return "\n".join(lines).rstrip() + "\n"


def markdown_for_reference(doc: ReferenceDoc) -> str:
    """Build self-contained Markdown for a reference page."""
    lines: list[str] = [
        f"# {doc.heading}",
        "",
        doc.summary.strip(),
        "",
    ]
    for section in doc.sections:
        lines.extend([f"## {section.heading}", ""])
        for paragraph in section.paragraphs:
            lines.extend([paragraph.strip(), ""])
        if section.bullets:
            for bullet in section.bullets:
                lines.append(f"- {bullet}")
            lines.append("")
        if section.table is not None:
            headers = " | ".join(section.table.headers)
            sep = " | ".join("---" for _ in section.table.headers)
            lines.extend([f"| {headers} |", f"| {sep} |"])
            for row in section.table.rows:
                lines.append(f"| {' | '.join(row)} |")
            lines.append("")
        if section.code:
            lines.extend(["```", section.code.strip(), "```", ""])
    return "\n".join(lines).rstrip() + "\n"
