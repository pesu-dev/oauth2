"""Request-scoped accessors for OIDC dependencies wired on ``app.state``."""

from __future__ import annotations

from typing import TYPE_CHECKING, TypeVar, cast

from fastapi import HTTPException, Request

if TYPE_CHECKING:
    from src.academy.port import AcademyClient
    from src.config import AppConfig
    from src.crypto.jwt_keys import JwtKeySet
    from src.oidc.rate_limit import SlidingWindowRateLimiter
    from src.repos.admins import AdminRepo
    from src.repos.auth_codes import AuthCodeRepo
    from src.repos.clients import ClientRepo
    from src.repos.consents import ConsentRepo
    from src.repos.production_requests import ProductionRequestRepo
    from src.repos.refresh_tokens import RefreshTokenRepo
    from src.repos.testers import TesterRepo
    from src.repos.users import UserRepo
    from src.session_cookie import PortalSessionStore, SessionStore

T = TypeVar("T")


def config(request: Request) -> AppConfig:
    return cast("AppConfig", request.app.state.config)


def jwt_keys(request: Request) -> JwtKeySet:
    keys = request.app.state.jwt_keys
    if keys is None:
        raise HTTPException(status_code=503, detail="Signing keys unavailable")
    return cast("JwtKeySet", keys)


def session_store(request: Request) -> SessionStore:
    store = getattr(request.app.state, "session_store", None)
    if store is None:
        raise HTTPException(status_code=503, detail="Session store unavailable")
    return cast("SessionStore", store)


def portal_session_store(request: Request) -> PortalSessionStore:
    store = getattr(request.app.state, "portal_session_store", None)
    if store is None:
        raise HTTPException(status_code=503, detail="Portal session store unavailable")
    return cast("PortalSessionStore", store)


def academy(request: Request) -> AcademyClient:
    client = getattr(request.app.state, "academy", None)
    if client is None:
        raise HTTPException(status_code=503, detail="Academy client unavailable")
    return cast("AcademyClient", client)


def users(request: Request) -> UserRepo:
    return _require_repo(request, "users")


def clients(request: Request) -> ClientRepo:
    return _require_repo(request, "clients")


def testers(request: Request) -> TesterRepo:
    return _require_repo(request, "testers")


def auth_codes(request: Request) -> AuthCodeRepo:
    return _require_repo(request, "auth_codes")


def refresh_tokens(request: Request) -> RefreshTokenRepo:
    return _require_repo(request, "refresh_tokens")


def consents(request: Request) -> ConsentRepo:
    return _require_repo(request, "consents")


def admins(request: Request) -> AdminRepo:
    return _require_repo(request, "admins")


def production_requests(request: Request) -> ProductionRequestRepo:
    return _require_repo(request, "production_requests")


def login_limiter(request: Request) -> SlidingWindowRateLimiter:
    return cast("SlidingWindowRateLimiter", request.app.state.login_limiter)


def _require_repo(request: Request, name: str) -> T:
    repo = getattr(request.app.state, name, None)
    if repo is None:
        raise HTTPException(status_code=503, detail=f"{name} repository unavailable")
    return cast("T", repo)
