"""PKCE helpers (RFC 7636 S256)."""

from __future__ import annotations

import base64
import hashlib
import hmac


def verify_s256(challenge: str, verifier: str) -> bool:
    """Return True if ``challenge`` is the S256 transform of ``verifier``."""
    if not challenge or not verifier:
        return False
    try:
        digest = hashlib.sha256(verifier.encode("ascii")).digest()
    except UnicodeEncodeError:
        return False
    computed = base64.urlsafe_b64encode(digest).rstrip(b"=").decode("ascii")
    return hmac.compare_digest(computed, challenge)
