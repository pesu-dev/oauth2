"""Seed the first admin row into Mongo ``admins``."""

from __future__ import annotations

import argparse
import asyncio

from src.config import load_config
from src.db.client import get_database
from src.db.indexes import ensure_indexes
from src.repos.admins import AdminRepo, MongoAdminRepo


async def seed_admin(admins: AdminRepo, sub: str) -> None:
    """Idempotently insert ``sub`` into the admin roster."""
    if not sub.startswith("usr_"):
        msg = f"Expected a usr_ subject, got {sub!r}"
        raise ValueError(msg)
    await admins.add_admin(sub)


async def _main(sub: str) -> None:
    config = load_config()
    db = await get_database(config)
    try:
        await ensure_indexes(db)
        await seed_admin(MongoAdminRepo(db), sub)
        print(f"Seeded admin sub={sub}")
    finally:
        await db.client.close()


def main() -> None:
    """CLI entry: ``python -m scripts.seed_admin --sub usr_…``."""
    parser = argparse.ArgumentParser(description="Insert a sub into the admins collection")
    parser.add_argument("--sub", required=True, help="Opaque subject (usr_…)")
    args = parser.parse_args()
    asyncio.run(_main(args.sub))


if __name__ == "__main__":
    main()
