"""Integration tests — expand when MongoDB and OIDC flows are implemented."""

from __future__ import annotations

from typing import TYPE_CHECKING

import pytest

if TYPE_CHECKING:
    from fastapi.testclient import TestClient


@pytest.mark.integration
def test_health_asgi_stack(client: TestClient) -> None:
    """Smoke test through the full ASGI stack (no external services)."""
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"
