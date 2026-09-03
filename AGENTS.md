# AGENTS.md

Guidance for AI coding agents working in this repository.

> **Source of truth**: Keep agent instructions in this file (and nested `AGENTS.md` files if added later). Do not scatter the same guidance into `CLAUDE.md` or `.cursor/rules/` unless a tool-specific feature requires it.

## Stack

- Python **>=3.13**, package manager **uv** (never pip/poetry/npm-style installs)
- **FastAPI** + **uvicorn**, MongoDB via **pymongo** (planned), HTTP via **httpx**
- Lint/format: **Ruff** (see `[tool.ruff]` in `pyproject.toml`)
- Tests: **pytest** + **pytest-asyncio** + **pytest-cov** (see [tests/README.md](tests/README.md))
- Hosting: **Google Cloud Run** (staging + prod); images on **GHCR**

## Commands

```bash
# Setup
.githooks/install.sh
uv sync --extra dev

# Run locally (from repo root; optional .env for secrets)
uv run -m src --reload

# Quality gates (match CI)
uv run ruff check .
uv run ruff format . --check
uv run -m compileall -q src tests
uv run pytest -m unit --cov=src --cov-report=term-missing --cov-fail-under=95
uv run pytest -m integration

# Auto-fix style
uv run ruff check . --fix
uv run ruff format .
```

Use `uv run …` for all Python tooling. Prefer `uv sync --frozen` when matching CI lockfile installs.

## Layout

| Path                 | Purpose                                                  |
| -------------------- | -------------------------------------------------------- |
| `src/app.py`         | FastAPI application                                      |
| `src/__main__.py`    | CLI / container entrypoint                               |
| `scripts/`           | CI/ops scripts (semver bump)                             |
| `tests/`             | pytest unit + integration suites (see `tests/README.md`) |
| `docs/plans/`        | Architecture + technical plans                           |
| `design/`            | Apple-style motion skill for hosted pages                |
| `.github/workflows/` | CI/CD (Cloud Run deploy)                                 |

Human docs: `README.md`, `.github/CONTRIBUTING.md`, `tests/README.md`, `docs/plans/`. Prefer those for long setup detail; keep this file operational.

## Config conventions

- **`APP_ENV`** (`local` | `staging` | `prod`, default `local`) selects hardcoded cluster URIs and `issuer_url` in app config — not env vars.
- **MongoDB:** X.509 client auth (`MONGO_X509_CERT_PATH`, optional); database `oauth2`; two Atlas clusters (staging vs prod). Not SCRAM.
- **Secrets:** `.env` locally; GitHub repository secrets / environment vars in CI; never commit keys or `.pem` files.

## Git / PR workflow

- Branch: `(github-username)/feature-description`
- Commits: Conventional Commits — `type: short description` (`feat`, `fix`, `docs`, `style`, `refactor`, `test`, `chore`, `perf`, `ci`, `build`, `revert`)
- Open PRs against **`main`**
- Follow `.github/PULL_REQUEST_TEMPLATE.md`
- Do not commit unless the user asks

## Boundaries

### Always

- Match existing FastAPI patterns and type annotations
- Run Ruff + unit tests before considering code complete
- Keep secrets out of the tree (`.env` is local-only; use `.env.example` as the template)

### Ask first

- New dependencies in `pyproject.toml`
- Changes to CI/CD, Cloud Run service accounts, or `docs/plans/` locked decisions
- Schema / collection changes affecting MongoDB data

### Never

- Commit signing keys, X.509 `.pem` certs, Gmail SMTP passwords, or other secrets
- Bypass hooks with `--no-verify`
- Force-push to `main`
- Implement OIDC endpoints before the relevant plan sections are agreed

## Definition of done

1. Change fits the `src/` / `tests/` layout above
2. `uv run ruff check .` and `uv run ruff format . --check` pass
3. `uv run pytest -m unit` passes with **95%+** coverage on `src/`
4. Run `pytest -m integration` when touching ASGI wiring or Mongo paths
5. No secrets or unrelated files staged

## Deploy notes (maintainers)

GitHub **repository variables** used by workflows:

| Variable                    | Example                                               |
| --------------------------- | ----------------------------------------------------- |
| `GCP_REGION`                | `us-central1`                                         |
| `CLOUD_RUN_SERVICE_STAGING` | `oauth2-staging`                                      |
| `CLOUD_RUN_SERVICE_PROD`    | `oauth2-prod`                                         |
| `CLOUD_RUN_RUNTIME_SA`      | `oauth2-runtime@dev-pesu-dev.iam.gserviceaccount.com` |

Repository secret: `GCP_SA_KEY` (deployer SA JSON). Cloud Run revisions run as `CLOUD_RUN_RUNTIME_SA`.
