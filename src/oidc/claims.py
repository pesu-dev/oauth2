"""Build OIDC claim dicts from a User and granted scopes."""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from src.models.user import User


def profile_claims(user: User, scopes: frozenset[str]) -> dict[str, Any]:
    """Return userinfo / ID-token claims filtered by granted scopes."""
    claims: dict[str, Any] = {"sub": user.sub}
    if "profile" in scopes:
        claims.update(
            {
                "name": user.name,
                "prn": user.prn,
                "srn": user.srn,
                "program": user.program,
                "branch": user.branch,
                "semester": user.semester,
                "section": user.section,
                "campus": user.campus,
            }
        )
    if "email" in scopes and user.email is not None:
        claims["email"] = user.email
    if "phone" in scopes and user.phone is not None:
        claims["phone_number"] = user.phone
    return claims
