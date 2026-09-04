"""Opaque ID helpers for subjects and related identifiers."""

from __future__ import annotations

from nanoid import generate


def new_sub() -> str:
    """Return a new opaque subject identifier (`usr_` + nanoid)."""
    return f"usr_{generate()}"
