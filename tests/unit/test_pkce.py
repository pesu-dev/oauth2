"""Unit tests for PKCE S256 verification."""

from __future__ import annotations

import base64
import hashlib

import pytest

from src.oidc.pkce import verify_s256


def _s256_challenge(verifier: str) -> str:
    digest = hashlib.sha256(verifier.encode("ascii")).digest()
    return base64.urlsafe_b64encode(digest).rstrip(b"=").decode("ascii")


@pytest.mark.unit
def test_verify_s256_accepts_matching_challenge() -> None:
    verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"
    challenge = _s256_challenge(verifier)
    assert verify_s256(challenge, verifier) is True


@pytest.mark.unit
def test_verify_s256_rejects_mismatched_verifier() -> None:
    challenge = _s256_challenge("correct-verifier-value-here-abcdef")
    assert verify_s256(challenge, "wrong-verifier-value-here-abcdefg") is False


@pytest.mark.unit
def test_verify_s256_rejects_empty_verifier() -> None:
    challenge = _s256_challenge("some-nonempty-verifier-value")
    assert verify_s256(challenge, "") is False


@pytest.mark.unit
def test_verify_s256_rejects_empty_challenge() -> None:
    assert verify_s256("", "some-nonempty-verifier-value") is False


@pytest.mark.unit
def test_verify_s256_rejects_non_ascii_verifier() -> None:
    challenge = _s256_challenge("ascii-only-verifier-value")
    assert verify_s256(challenge, "verifier-with-é") is False


@pytest.mark.unit
def test_verify_s256_rejects_tampered_challenge() -> None:
    verifier = "another-valid-code-verifier-string"
    challenge = _s256_challenge(verifier)
    tampered = ("A" if challenge[0] != "A" else "B") + challenge[1:]
    assert verify_s256(tampered, verifier) is False
