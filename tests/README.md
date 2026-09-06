# Testing

How we test the PESU OAuth2 authorization server.

## Pyramid

| Layer | What | How |
| --- | --- | --- |
| **Unit** (majority) | FastAPI routes, config helpers, pure logic with mocked I/O | `pytest -m unit` |
| **Integration** (selective) | ASGI + real Mongo via **Testcontainers**; OIDC/portal/settings flows | `pytest -m integration` |
| **Atlas smoke** (opt-in) | X.509 connect against real Atlas when a cert is present | `pytest -m atlas_smoke` |

We do **not** run live Cloud Run or Atlas e2e in default CI (credentials, flakiness, cost). Atlas smoke is skipped unless the cert path is ready.

## Docker / Testcontainers

Integration tests start `mongo:7` through [Testcontainers](https://testcontainers.com/).

| Environment | Docker requirement |
| --- | --- |
| **Local (macOS)** | [Colima](https://github.com/abiosoft/colima) or Docker Desktop. `tests/integration/conftest.py` auto-points Testcontainers at `~/.colima/default/docker.sock` when present. |
| **CI** | GitHub Actions `ubuntu-latest` (Docker preinstalled). The integration job verifies `docker info`, pre-pulls `mongo:7`, and sets `DOCKER_HOST=unix:///var/run/docker.sock`. |

Without a working Docker daemon, `pytest -m integration` will fail when the Mongo container starts.

## Commands

```bash
uv sync --extra dev

# Fast local loop (also what pre-commit runs)
uv run pytest -m unit -q --cov=src --cov-report=term:skip-covered --cov-fail-under=95

# ASGI + Testcontainers Mongo (needs Docker)
uv run pytest -m integration

# Optional Atlas X.509 smoke (needs MONGO_X509_CERT_PATH / cert file)
uv run pytest -m atlas_smoke

# Everything
uv run pytest
```

Coverage floor is **95%** on `src/` (see `[tool.coverage.report]` in `pyproject.toml`), enforced on the unit CI job.

## Layout

```text
tests/
  conftest.py           # shared fixtures (TestClient, app)
  unit/                 # modules named test_*.py
  integration/          # modules named test_*.py (+ Testcontainers conftest)
```

Unit and integration tests cover **`src/` only**. Do not add pytest suites for `scripts/` or workflow YAML — those are exercised by CI / manual ops instead. Coverage is scoped with `--cov=src` / `[tool.coverage.run] source = ["src"]`.

## Conventions

- Name test modules `test_*.py` (see `name-tests-test` in pre-commit).
- Prefer asserting **outcomes** (status codes, JSON bodies), not mock call sequences that mirror implementation.
- Use `TYPE_CHECKING` imports for `TestClient` in test modules; runtime import stays in `conftest.py`.
- Use absolute imports (`from src...`) the same as production code.
- Never require real `.env`, Mongo X.509 certs, or GCP credentials for default automated tests (Atlas smoke is the exception and is opt-in).

## When to add which test

- New pure helper / config resolver → **unit**
- New HTTP route behavior → **unit** with `TestClient`
- New Mongo write path that must survive real queries → **integration** (plus unit with mocks)
- New OIDC / portal / settings flow spanning persistence → **integration** with Testcontainers
