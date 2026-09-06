"""FastAPI application factory — health, discovery, JWKS, OIDC, portal, admin."""

from __future__ import annotations

from contextlib import asynccontextmanager
from pathlib import Path
from typing import TYPE_CHECKING

import httpx
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from starlette.exceptions import HTTPException as StarletteHTTPException

from src.academy.client import HttpxAcademyClient
from src.admin.router import router as admin_router
from src.config import load_config
from src.crypto.jwt_keys import JwtKeySet
from src.csrf import CsrfStore
from src.db.client import get_database
from src.db.indexes import ensure_indexes
from src.docs_site.router import router as docs_router
from src.exchange.router import router as exchange_router
from src.mailer.port import build_mailer
from src.oidc.authorize import router as authorize_router
from src.oidc.discovery import router as discovery_router
from src.oidc.jwks import router as jwks_router
from src.oidc.pending_credentials import PendingCredentialStore
from src.oidc.rate_limit import SlidingWindowRateLimiter
from src.oidc.revoke import router as revoke_router
from src.oidc.token import router as token_router
from src.oidc.userinfo import router as userinfo_router
from src.portal.router import router as portal_router
from src.public.router import render_404
from src.public.router import router as public_router
from src.repos.admins import MongoAdminRepo
from src.repos.auth_codes import MongoAuthCodeRepo
from src.repos.clients import MongoClientRepo
from src.repos.consents import MongoConsentRepo
from src.repos.production_requests import MongoProductionRequestRepo
from src.repos.refresh_tokens import MongoRefreshTokenRepo
from src.repos.testers import MongoTesterRepo
from src.repos.users import MongoUserRepo
from src.repos.vault import MongoVaultRepo
from src.session_cookie import PortalSessionStore, SessionStore, SettingsSessionStore
from src.settings_ui.router import router as settings_router

if TYPE_CHECKING:
    from collections.abc import AsyncIterator

    from src.academy.port import AcademyClient
    from src.config import AppConfig
    from src.mailer.port import Mailer
    from src.repos.admins import AdminRepo
    from src.repos.auth_codes import AuthCodeRepo
    from src.repos.clients import ClientRepo
    from src.repos.consents import ConsentRepo
    from src.repos.production_requests import ProductionRequestRepo
    from src.repos.refresh_tokens import RefreshTokenRepo
    from src.repos.testers import TesterRepo
    from src.repos.users import UserRepo
    from src.repos.vault import VaultRepo

DEFAULT_SIGNING_KEY_ID = "default"
_STATIC_DIR = Path(__file__).resolve().parent / "static"
_ACADEMY_HTTP_TIMEOUT = 30.0


def _wire_mongo_repos(application: FastAPI) -> None:
    """Fill any unset repos from the connected Mongo database."""
    db = application.state.db
    if application.state.users is None:
        application.state.users = MongoUserRepo(db)
    if application.state.clients is None:
        application.state.clients = MongoClientRepo(db)
    if application.state.testers is None:
        application.state.testers = MongoTesterRepo(db)
    if application.state.auth_codes is None:
        application.state.auth_codes = MongoAuthCodeRepo(db)
    if application.state.refresh_tokens is None:
        application.state.refresh_tokens = MongoRefreshTokenRepo(db)
    if application.state.consents is None:
        application.state.consents = MongoConsentRepo(db)
    if application.state.admins is None:
        application.state.admins = MongoAdminRepo(db)
    if application.state.production_requests is None:
        application.state.production_requests = MongoProductionRequestRepo(db)
    if application.state.vault is None:
        application.state.vault = MongoVaultRepo(db)


def _wire_session_stores(
    application: FastAPI,
    config: AppConfig,
    session_store: SessionStore | None,
    portal_session_store: PortalSessionStore | None,
    settings_session_store: SettingsSessionStore | None = None,
) -> None:
    """Attach OIDC, portal, settings, and CSRF stores (shared secret, distinct salts)."""
    secret = config.session_secret
    if secret is None:
        msg = "SESSION_SECRET is required"
        raise ValueError(msg)
    ttl = config.session_cookie_ttl_seconds
    application.state.session_store = session_store or SessionStore(secret, max_age=ttl)
    application.state.portal_session_store = portal_session_store or PortalSessionStore(
        secret,
        max_age=ttl,
    )
    application.state.settings_session_store = settings_session_store or SettingsSessionStore(
        secret,
        max_age=ttl,
    )
    application.state.csrf_store = CsrfStore(secret, max_age=ttl)


def _default_academy() -> HttpxAcademyClient:
    return HttpxAcademyClient(httpx.AsyncClient(timeout=_ACADEMY_HTTP_TIMEOUT))


async def _shutdown_runtime(application: FastAPI) -> None:
    db = application.state.db
    if db is not None:
        await db.client.close()
        application.state.db = None
    academy_client = application.state.academy
    if isinstance(academy_client, HttpxAcademyClient):
        await academy_client.aclose()


def create_app(
    config: AppConfig | None = None,
    mongo_uri_override: str | None = None,
    *,
    connect_mongo: bool = False,
    academy: AcademyClient | None = None,
    users: UserRepo | None = None,
    clients: ClientRepo | None = None,
    testers: TesterRepo | None = None,
    auth_codes: AuthCodeRepo | None = None,
    refresh_tokens: RefreshTokenRepo | None = None,
    consents: ConsentRepo | None = None,
    admins: AdminRepo | None = None,
    production_requests: ProductionRequestRepo | None = None,
    vault: VaultRepo | None = None,
    session_store: SessionStore | None = None,
    portal_session_store: PortalSessionStore | None = None,
    settings_session_store: SettingsSessionStore | None = None,
    mailer: Mailer | None = None,
) -> FastAPI:
    """Build the ASGI app.

    Mongo is opened in lifespan only when ``mongo_uri_override`` is set or
    ``connect_mongo=True``. Unit tests leave both unset so ``app.state.db`` stays
    ``None`` and no Docker/Atlas is required.

    Repositories and Academy may be injected for tests. When Mongo connects and a
    repo was not injected, the corresponding Mongo implementation is wired.
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
            _wire_mongo_repos(application)
        else:
            application.state.db = None
        try:
            yield
        finally:
            await _shutdown_runtime(application)

    application = FastAPI(
        title="PESU OAuth2",
        description="Unofficial PESU Academy OAuth2 / OpenID Connect authorization server",
        version="0.0.0",
        lifespan=lifespan,
        docs_url=None,
        redoc_url=None,
    )
    application.state.config = config
    application.state.db = None
    application.state.jwt_keys = (
        JwtKeySet.from_pem(config.token_signing_key_pem, kid=DEFAULT_SIGNING_KEY_ID)
        if config.token_signing_key_pem is not None
        else None
    )
    application.state.academy = academy if academy is not None else _default_academy()
    application.state.users = users
    application.state.clients = clients
    application.state.testers = testers
    application.state.auth_codes = auth_codes
    application.state.refresh_tokens = refresh_tokens
    application.state.consents = consents
    application.state.admins = admins
    application.state.production_requests = production_requests
    application.state.vault = vault
    application.state.mailer = mailer if mailer is not None else build_mailer(config)
    _wire_session_stores(
        application,
        config,
        session_store,
        portal_session_store,
        settings_session_store,
    )
    application.state.login_limiter = SlidingWindowRateLimiter(limit=10, window_seconds=60)
    application.state.token_limiter = SlidingWindowRateLimiter(limit=60, window_seconds=60)
    application.state.exchange_limiter = SlidingWindowRateLimiter(limit=30, window_seconds=60)
    application.state.pending_credentials = PendingCredentialStore(
        ttl_seconds=float(config.session_cookie_ttl_seconds),
    )

    @application.get("/health")
    async def health() -> dict[str, str]:
        """Liveness probe for Cloud Run and local development."""
        return {"status": "ok"}

    @application.exception_handler(StarletteHTTPException)
    async def http_exception_handler(
        request: Request,
        exc: StarletteHTTPException,
    ) -> Response:
        """Serve branded HTML 404 for browser navigations; JSON otherwise."""
        if exc.status_code == 404:
            accept = request.headers.get("accept", "")
            if "text/html" in accept:
                return render_404(request)
        return JSONResponse(
            status_code=exc.status_code,
            content={"detail": exc.detail},
            headers=dict(exc.headers) if exc.headers else None,
        )

    application.include_router(public_router)
    application.include_router(docs_router)
    application.include_router(discovery_router)
    application.include_router(jwks_router)
    application.include_router(authorize_router)
    application.include_router(token_router)
    application.include_router(userinfo_router)
    application.include_router(portal_router)
    application.include_router(admin_router)
    application.include_router(settings_router)
    application.include_router(revoke_router)
    application.include_router(exchange_router)
    application.mount("/static", StaticFiles(directory=str(_STATIC_DIR)), name="static")

    return application


def build_app() -> FastAPI:
    """ASGI factory for uvicorn / Cloud Run (``src.app:build_app``)."""
    return create_app(connect_mongo=True)
