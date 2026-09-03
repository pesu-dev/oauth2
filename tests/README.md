# Testing

How we test the PESU OAuth2 authorization server.

## Pyramid

| Layer                       | What                                                         | How                          |
| --------------------------- | ------------------------------------------------------------ | ---------------------------- |
| **Unit** (majority)         | FastAPI routes, config helpers, pure logic with mocked I/O   | `pytest -m unit`             |
| **Integration** (selective) | ASGI stack smoke tests; Mongo/OIDC flows when implemented    | `pytest -m integration`      |

We do **not** run live Cloud Run or Atlas e2e in CI (credentials, flakiness, cost).

## Commands

```bash
uv sync --extra dev

# Fast local loop (also what pre-commit runs)
uv run pytest -m unit -q --cov=src --cov-report=term:skip-covered --cov-fail-under=95

# ASGI / future Mongo integration tests
uv run pytest -m integration

# Everything
uv run pytest
```

Coverage floor is **95%** on `src/` (see `[tool.coverage.report]` in `pyproject.toml`), enforced on the unit CI job.

## Layout

```text
tests/
  conftest.py           # shared fixtures (TestClient, app)
  unit/                 # modules named test_*.py
  integration/          # modules named test_*.py
```

Unit and integration tests cover **`src/` only**. Do not add pytest suites for `scripts/` or workflow YAML — those are exercised by CI / manual ops instead. Coverage is scoped with `--cov=src` / `[tool.coverage.run] source = ["src"]`.

## Conventions

- Name test modules `test_*.py` (see `name-tests-test` in pre-commit).
- Prefer asserting **outcomes** (status codes, JSON bodies), not mock call sequences that mirror implementation.
- Use `TYPE_CHECKING` imports for `TestClient` in test modules; runtime import stays in `conftest.py`.
- Use absolute imports (`from src...`) the same as production code.
- Never require real `.env`, Mongo X.509 certs, or GCP credentials for automated tests.

## When to add which test

- New pure helper / config resolver → **unit**
- New HTTP route behavior → **unit** with `TestClient`
- New Mongo write path that must survive real queries → **integration** (plus unit with mocks)
- New OIDC flow spanning multiple endpoints → **integration** once persistence lands
