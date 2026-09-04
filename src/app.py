"""FastAPI application factory — health check until OIDC endpoints are implemented."""

from __future__ import annotations

from contextlib import asynccontextmanager
from typing import TYPE_CHECKING

from fastapi import FastAPI

from src.config import load_config
from src.db.client import get_database
from src.db.indexes import ensure_indexes

if TYPE_CHECKING:
    from collections.abc import AsyncIterator

    from src.config import AppConfig


def create_app(
    config: AppConfig | None = None,
    mongo_uri_override: str | None = None,
    *,
    connect_mongo: bool = False,
) -> FastAPI:
    """Build the ASGI app.

    Mongo is opened in lifespan only when ``mongo_uri_override`` is set or
    ``connect_mongo=True``. Unit tests leave both unset so ``app.state.db`` stays
    ``None`` and no Docker/Atlas is required.
    """
    if config is None:
        config = load_config()

    should_connect = mongo_uri_override is not None or connect_mongo

    @asynccontextmanager
    async def lifespan(application: FastAPI) -> AsyncIterator[None]:
        if should_connect:
            application.state.db = await get_database(
                application.state.config,
                mongo_uri_override,
            )
            await ensure_indexes(application.state.db)
        else:
            application.state.db = None
        try:
            yield
        finally:
            db = getattr(application.state, "db", None)
            if db is not None:
                await db.client.close()
                application.state.db = None

    application = FastAPI(
        title="PESU OAuth2",
        description="Unofficial PESU Academy OAuth2 / OpenID Connect authorization server",
        version="0.0.0",
        lifespan=lifespan,
    )
    application.state.config = config
    application.state.db = None

    @application.get("/health")
    async def health() -> dict[str, str]:
        """Liveness probe for Cloud Run and local development."""
        return {"status": "ok"}

    return application


app = create_app(connect_mongo=True)
