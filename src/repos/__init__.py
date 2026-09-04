"""OIDC persistence repositories."""

from __future__ import annotations

from src.repos.auth_codes import AuthCodeRepo, MongoAuthCodeRepo
from src.repos.clients import ClientRepo, MongoClientRepo
from src.repos.consents import ConsentRepo, MongoConsentRepo
from src.repos.fakes import (
    FakeAuthCodeRepo,
    FakeClientRepo,
    FakeConsentRepo,
    FakeRefreshTokenRepo,
    FakeTesterRepo,
    FakeUserRepo,
)
from src.repos.refresh_tokens import MongoRefreshTokenRepo, RefreshTokenRepo
from src.repos.testers import MongoTesterRepo, TesterRepo
from src.repos.users import MongoUserRepo, UserRepo

__all__ = [
    "AuthCodeRepo",
    "ClientRepo",
    "ConsentRepo",
    "FakeAuthCodeRepo",
    "FakeClientRepo",
    "FakeConsentRepo",
    "FakeRefreshTokenRepo",
    "FakeTesterRepo",
    "FakeUserRepo",
    "MongoAuthCodeRepo",
    "MongoClientRepo",
    "MongoConsentRepo",
    "MongoRefreshTokenRepo",
    "MongoTesterRepo",
    "MongoUserRepo",
    "RefreshTokenRepo",
    "TesterRepo",
    "UserRepo",
]
