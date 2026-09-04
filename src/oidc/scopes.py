"""OIDC scope parsing for v1 identity scopes.

``parse_scopes`` keeps only known scopes. Missing ``openid`` after filtering
raises ``ValueError`` (OIDC requires ``openid``); it does not return empty.
"""

from __future__ import annotations

KNOWN_SCOPES: frozenset[str] = frozenset(
    {
        "openid",
        "profile",
        "email",
        "phone",
        "offline_access",
    }
)


def parse_scopes(requested: str) -> frozenset[str]:
    """Parse a space-delimited scope string into the allowed v1 set.

    Unknown scopes are dropped. If ``openid`` is not present after filtering,
    raises ``ValueError``.
    """
    parts = requested.split()
    allowed = frozenset(scope for scope in parts if scope in KNOWN_SCOPES)
    if "openid" not in allowed:
        msg = "OIDC requires the openid scope"
        raise ValueError(msg)
    return allowed
