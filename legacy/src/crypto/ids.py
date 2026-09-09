"""Opaque ID helpers for subjects and related identifiers."""

from __future__ import annotations

from nanoid import generate


def new_sub() -> str:
    """Return a new opaque subject identifier (`usr_` + nanoid)."""
    return f"usr_{generate()}"


def new_client_id() -> str:
    """Return a new opaque client identifier (`cli_` + nanoid)."""
    return f"cli_{generate()}"


def new_request_id() -> str:
    """Return a new opaque production-request identifier (`req_` + nanoid)."""
    return f"req_{generate()}"
