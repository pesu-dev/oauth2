"""OIDC persistence repositories."""

from __future__ import annotations

from src.repos.admins import AdminRepo, MongoAdminRepo
from src.repos.auth_codes import AuthCodeRepo, MongoAuthCodeRepo
from src.repos.clients import ClientRepo, MongoClientRepo
from src.repos.consents import ConsentRepo, MongoConsentRepo
from src.repos.fakes import (
    FakeAdminRepo,
    FakeAuthCodeRepo,
    FakeClientRepo,
    FakeConsentRepo,
    FakeProductionRequestRepo,
    FakeRefreshTokenRepo,
    FakeTesterRepo,
    FakeUserRepo,
)
from src.repos.production_requests import MongoProductionRequestRepo, ProductionRequestRepo
from src.repos.refresh_tokens import MongoRefreshTokenRepo, RefreshTokenRepo
from src.repos.testers import MongoTesterRepo, TesterRepo
from src.repos.users import MongoUserRepo, UserRepo

__all__ = [
    "AdminRepo",
    "AuthCodeRepo",
    "ClientRepo",
    "ConsentRepo",
    "FakeAdminRepo",
    "FakeAuthCodeRepo",
    "FakeClientRepo",
    "FakeConsentRepo",
    "FakeProductionRequestRepo",
    "FakeRefreshTokenRepo",
    "FakeTesterRepo",
    "FakeUserRepo",
    "MongoAdminRepo",
    "MongoAuthCodeRepo",
    "MongoClientRepo",
    "MongoConsentRepo",
    "MongoProductionRequestRepo",
    "MongoRefreshTokenRepo",
    "MongoTesterRepo",
    "MongoUserRepo",
    "ProductionRequestRepo",
    "RefreshTokenRepo",
    "TesterRepo",
    "UserRepo",
]
