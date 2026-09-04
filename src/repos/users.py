"""User repository protocol and Mongo implementation."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import TYPE_CHECKING, Protocol

from src.crypto.ids import new_sub
from src.models.user import User

if TYPE_CHECKING:
    from pymongo.asynchronous.database import AsyncDatabase

    from src.academy.models import AcademyProfile


def _opt_str(doc: dict[str, object], key: str) -> str | None:
    value = doc.get(key)
    if value is None:
        return None
    return str(value)


def _user_from_doc(doc: dict[str, object]) -> User:
    return User(
        sub=str(doc["sub"]),
        name=str(doc["name"]),
        prn=_opt_str(doc, "prn"),
        srn=_opt_str(doc, "srn"),
        program=_opt_str(doc, "program"),
        branch=_opt_str(doc, "branch"),
        semester=_opt_str(doc, "semester"),
        section=_opt_str(doc, "section"),
        campus=_opt_str(doc, "campus"),
        email=_opt_str(doc, "email"),
        phone=_opt_str(doc, "phone"),
        created_at=doc["created_at"],  # type: ignore[arg-type]
        last_login_at=doc["last_login_at"],  # type: ignore[arg-type]
        deleted_at=doc.get("deleted_at"),  # type: ignore[arg-type]
    )


class UserRepo(Protocol):
    """Persistence for opaque subjects and Academy profile claims."""

    async def upsert_user_from_profile(self, profile: AcademyProfile) -> User:
        """Create or update a non-deleted user matched by PRN; never reuse tombstoned subs."""
        ...


class MongoUserRepo:
    """MongoDB-backed UserRepo (`users` collection)."""

    def __init__(self, db: AsyncDatabase) -> None:
        self._users = db.users

    async def upsert_user_from_profile(self, profile: AcademyProfile) -> User:
        """Match active users by PRN; insert with ``new_sub`` when none found."""
        now = datetime.now(UTC)
        existing = None
        if profile.prn is not None:
            existing = await self._users.find_one({"prn": profile.prn, "deleted_at": None})

        profile_fields = {
            "name": profile.name,
            "prn": profile.prn,
            "srn": profile.srn,
            "program": profile.program,
            "branch": profile.branch,
            "semester": profile.semester,
            "section": profile.section,
            "campus": profile.campus,
            "email": profile.email,
            "phone": profile.phone,
            "last_login_at": now,
        }

        if existing is not None:
            updated = await self._users.find_one_and_update(
                {"sub": existing["sub"], "deleted_at": None},
                {"$set": profile_fields},
                return_document=True,
            )
            assert updated is not None
            return _user_from_doc(updated)

        sub = new_sub()
        doc = {
            "sub": sub,
            **profile_fields,
            "created_at": now,
            "deleted_at": None,
        }
        await self._users.insert_one(doc)
        return _user_from_doc(doc)
