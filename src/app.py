"""FastAPI application stub — health check only until OIDC endpoints are implemented."""

from __future__ import annotations

from fastapi import FastAPI

app = FastAPI(
    title="PESU OAuth2",
    description="Unofficial PESU Academy OAuth2 / OpenID Connect authorization server",
    version="0.0.0",
)


@app.get("/health")
def health() -> dict[str, str]:
    """Liveness probe for Cloud Run and local development."""
    return {"status": "ok"}
