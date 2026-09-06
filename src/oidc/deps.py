"""Request-scoped accessors for dependencies wired on ``app.state``."""

from __future__ import annotations

from typing import TYPE_CHECKING, cast

from fastapi import HTTPException, Request

if TYPE_CHECKING:
    from src.academy.port import AcademyClient
    from src.config import AppConfig
    from src.crypto.jwt_keys import JwtKeySet
    from src.csrf import CsrfStore
    from src.mailer.port import Mailer
    from src.oidc.pending_credentials import PendingCredentialStore
    from src.oidc.rate_limit import SlidingWindowRateLimiter
    from src.repos.admins import AdminRepo
    from src.repos.auth_codes import AuthCodeRepo
    from src.repos.clients import ClientRepo
    from src.repos.consents import ConsentRepo
    from src.repos.production_requests import ProductionRequestRepo
    from src.repos.refresh_tokens import RefreshTokenRepo
    from src.repos.testers import TesterRepo
    from src.repos.users import UserRepo
    from src.repos.vault import VaultRepo
    from src.session_cookie import PortalSessionStore, SessionStore, SettingsSessionStore


def config(request: Request) -> AppConfig:
    return cast("AppConfig", request.app.state.config)


def jwt_keys(request: Request) -> JwtKeySet:
    keys = request.app.state.jwt_keys
    if keys is None:
        raise HTTPException(status_code=503, detail="Signing key not configured")
    return cast("JwtKeySet", keys)


def session_store(request: Request) -> SessionStore:
    return cast("SessionStore", request.app.state.session_store)


def portal_session_store(request: Request) -> PortalSessionStore:
    return cast("PortalSessionStore", request.app.state.portal_session_store)


def settings_session_store(request: Request) -> SettingsSessionStore:
    return cast("SettingsSessionStore", request.app.state.settings_session_store)


def academy(request: Request) -> AcademyClient:
    return cast("AcademyClient", request.app.state.academy)


def users(request: Request) -> UserRepo:
    return cast("UserRepo", request.app.state.users)


def clients(request: Request) -> ClientRepo:
    return cast("ClientRepo", request.app.state.clients)


def testers(request: Request) -> TesterRepo:
    return cast("TesterRepo", request.app.state.testers)


def auth_codes(request: Request) -> AuthCodeRepo:
    return cast("AuthCodeRepo", request.app.state.auth_codes)


def refresh_tokens(request: Request) -> RefreshTokenRepo:
    return cast("RefreshTokenRepo", request.app.state.refresh_tokens)


def consents(request: Request) -> ConsentRepo:
    return cast("ConsentRepo", request.app.state.consents)


def admins(request: Request) -> AdminRepo:
    return cast("AdminRepo", request.app.state.admins)


def production_requests(request: Request) -> ProductionRequestRepo:
    return cast("ProductionRequestRepo", request.app.state.production_requests)


def vault(request: Request) -> VaultRepo:
    return cast("VaultRepo", request.app.state.vault)


def mailer(request: Request) -> Mailer:
    return cast("Mailer", request.app.state.mailer)


def pending_credentials(request: Request) -> PendingCredentialStore:
    return cast("PendingCredentialStore", request.app.state.pending_credentials)


def login_limiter(request: Request) -> SlidingWindowRateLimiter:
    return cast("SlidingWindowRateLimiter", request.app.state.login_limiter)


def token_limiter(request: Request) -> SlidingWindowRateLimiter:
    return cast("SlidingWindowRateLimiter", request.app.state.token_limiter)


def exchange_limiter(request: Request) -> SlidingWindowRateLimiter:
    return cast("SlidingWindowRateLimiter", request.app.state.exchange_limiter)


def csrf_store(request: Request) -> CsrfStore:
    return cast("CsrfStore", request.app.state.csrf_store)
