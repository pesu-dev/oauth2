"""Unit tests for OIDC scope parsing."""

from __future__ import annotations

import pytest

from src.oidc.scopes import KNOWN_SCOPES, parse_scopes


@pytest.mark.unit
def test_parse_scopes_openid_only() -> None:
    assert parse_scopes("openid") == frozenset({"openid"})


@pytest.mark.unit
def test_parse_scopes_allows_known_v1_scopes() -> None:
    requested = "openid profile email phone offline_access"
    assert parse_scopes(requested) == frozenset({"openid", "profile", "email", "phone", "offline_access"})
    assert KNOWN_SCOPES == frozenset({"openid", "profile", "email", "phone", "offline_access"})


@pytest.mark.unit
def test_parse_scopes_drops_unknown_scopes() -> None:
    assert parse_scopes("openid profile api.read") == frozenset({"openid", "profile"})


@pytest.mark.unit
def test_parse_scopes_deduplicates() -> None:
    assert parse_scopes("openid email openid") == frozenset({"openid", "email"})


@pytest.mark.unit
def test_parse_scopes_missing_openid_raises() -> None:
    with pytest.raises(ValueError, match="openid"):
        parse_scopes("profile email")


@pytest.mark.unit
def test_parse_scopes_empty_string_raises() -> None:
    with pytest.raises(ValueError, match="openid"):
        parse_scopes("")


@pytest.mark.unit
def test_parse_scopes_unknown_only_raises() -> None:
    with pytest.raises(ValueError, match="openid"):
        parse_scopes("api.read custom")
