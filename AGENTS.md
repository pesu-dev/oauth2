# AGENTS.md

Guidance for AI coding agents working in this repository.

> **Precedence:** This file is the **repo constitution** for stack, commands, layout, git boundaries, and definition of done. Committed [`.cursor/rules/`](.cursor/rules/) are Cursor-applied style/security/framework conventions (always-on or path-scoped). Committed [`.cursor/skills/`](.cursor/skills/) are opt-in workflows. **Product/tech truth** lives in `docs/superpowers/` — not in rules. If a generic rule conflicts with this file or the design spec (e.g. wrong ORM, coverage target, package manager), **this file and the design spec win**; update or narrow the rule rather than inventing a parallel stack.

## Living docs (roles)

| Role | Canonical source | Notes |
| --- | --- | --- |
| **Constitution** | This file + [`.github/CONTRIBUTING.md`](.github/CONTRIBUTING.md) | Ops, gates, ask/never boundaries; keep short |
| **Map** | [`README.md`](README.md) layout + [`src/`](src/) | What exists and where |
| **Status** | [`README.md`](README.md) Status table | Current health / what is shipped |
| **History / product ADRs** | [`docs/plans/architecture.md`](docs/plans/architecture.md) | Historical; not the build checklist |
| **Product + tech contract** | [`docs/superpowers/specs/2026-09-03-oidc-authorization-server-design.md`](docs/superpowers/specs/2026-09-03-oidc-authorization-server-design.md) | Approved MVP design |
| **Implementation plan** | [`docs/superpowers/plans/2026-09-04-oidc-authorization-server-mvp.md`](docs/superpowers/plans/2026-09-04-oidc-authorization-server-mvp.md) | Task checklist for the shipped MVP |
| **Cursor conventions** | [`.cursor/rules/`](.cursor/rules/) | Committed; style/security/FastAPI defaults for the IDE |
| **Cursor skills** | [`.cursor/skills/`](.cursor/skills/) | Committed; invoke when the skill’s trigger matches |

`docs/plans/technical.md` is an **outdated bootstrap** plan (repo creation / hosting notes). Prefer the design spec for locked technical choices.

Do **not** duplicate long product/spec text into `.cursor/rules/` — link or defer to `docs/superpowers/`. Keep rules short and mechanical. Do not reintroduce the same operational checklist into `CLAUDE.md`; nest `AGENTS.md` if a subtree needs its own constitution.

On entry for non-trivial work: read Status → Map → relevant History/spec sections; verify claims against code and tests.

## Stack

- Python **>=3.13**, package manager **uv** (never pip/poetry/npm-style installs)
- **FastAPI** + **uvicorn**, MongoDB via **pymongo** (`AsyncMongoClient`), HTTP via **httpx**
- Lint/format: **Ruff** (see `[tool.ruff]` in `pyproject.toml`)
- Tests: **pytest** + **pytest-asyncio** + **pytest-cov** + **testcontainers** (see [tests/README.md](tests/README.md))
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
uv run pytest -m integration   # needs Docker (Colima locally; GHA ubuntu-latest in CI)

# Auto-fix style
uv run ruff check . --fix
uv run ruff format .
```

Use `uv run …` for all Python tooling. Prefer `uv sync --frozen` when matching CI lockfile installs.

## Layout

| Path | Purpose |
| -------------------- | -------------------------------------------------------- |
| `src/app.py` | FastAPI application |
| `src/__main__.py` | CLI / container entrypoint |
| `scripts/` | CI/ops scripts (semver bump, seed_admin) |
| `tests/` | pytest unit + integration suites (see `tests/README.md`) |
| `docs/superpowers/` | Approved design spec + MVP implementation plan |
| `docs/plans/` | Historical architecture ADRs + outdated bootstrap tech notes |
| `.cursor/rules/` | Cursor rules (security, testing, Python/FastAPI style) |
| `.cursor/skills/` | Curated agent skills (incl. Apple-design for hosted pages) |
| `.github/workflows/` | CI/CD (Cloud Run deploy) |

Human docs: `README.md`, `.github/CONTRIBUTING.md`, `tests/README.md`, `docs/superpowers/`. Prefer those for long setup detail; keep this file operational.

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
- Extend OIDC/product behavior against the approved design spec and plan — do not invent parallel contracts

### Ask first

- New dependencies in `pyproject.toml`
- Changes to CI/CD, Cloud Run service accounts, or locked decisions in the design spec / plans
- Schema / collection changes affecting MongoDB data

### Never

- Commit signing keys, X.509 `.pem` certs, Gmail SMTP passwords, or other secrets
- Bypass hooks with `--no-verify`
- Force-push to `main`

## Definition of done

1. Change fits the `src/` / `tests/` layout above
2. `uv run ruff check .` and `uv run ruff format . --check` pass
3. `uv run pytest -m unit` passes with **95%+** coverage on `src/`
4. Run `pytest -m integration` when touching ASGI wiring or Mongo paths (Docker required)
5. No secrets or unrelated files staged

## Deploy notes (maintainers)

GitHub **repository variables** used by workflows:

| Variable | Example |
| -------------------------------- | ------------------------------------------------------------------------------------------ |
| `GCP_REGION` | `us-central1` |
| `CLOUD_RUN_SERVICE_STAGING` | `oauth2-staging` |
| `CLOUD_RUN_SERVICE_PROD` | `oauth2-prod` |
| `CLOUD_RUN_RUNTIME_SA` | `oauth2-runtime@dev-pesu-dev.iam.gserviceaccount.com` |
| `GCP_DEPLOYER_SA` | `github-oauth2-deploy@dev-pesu-dev.iam.gserviceaccount.com` |
| `GCP_WORKLOAD_IDENTITY_PROVIDER` | `projects/<number>/locations/global/workloadIdentityPools/github/providers/github-actions` |

Deploy auth is Workload Identity Federation (no JSON key). Cloud Run revisions run as `CLOUD_RUN_RUNTIME_SA`.

Deploy workflows pin **`--max-instances=1`**. Process-local pending credentials and login rate limits require a single instance; do not scale out until those move to shared storage.

Mongo X.509 PEMs are mounted in the Cloud Run console at `/run/secrets/mongo.pem`. Deploy sets `MONGO_X509_CERT_PATH` to that path.
