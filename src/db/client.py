"""MongoDB async client factory (X.509 for Atlas; URI override for tests)."""

from __future__ import annotations

from typing import TYPE_CHECKING

from pymongo import AsyncMongoClient

if TYPE_CHECKING:
    from pymongo.asynchronous.database import AsyncDatabase

    from src.config import AppConfig


async def get_database(
    config: AppConfig,
    mongo_uri_override: str | None = None,
) -> AsyncDatabase:
    """Return the configured ``oauth2`` async database.

    When ``mongo_uri_override`` is set (Testcontainers), connect without X.509.
    Otherwise use Atlas self-managed X.509 per the technical plan.
    """
    if mongo_uri_override is not None:
        client: AsyncMongoClient = AsyncMongoClient(mongo_uri_override)
    else:
        client = AsyncMongoClient(
            config.mongo_uri,
            tls=True,
            tlsCertificateKeyFile=config.mongo_x509_cert_path,
            authSource="$external",
            authMechanism="MONGODB-X509",
        )
    return client[config.db_name]
