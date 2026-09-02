# Contributing to PESU OAuth2

Thank you for contributing to the unofficial PESU OAuth2 authorization server.

## Workflow

1. Clone the repository (or fork and clone your fork).
2. Create a branch: `(github-username)/feature-description`.
3. Make changes; keep commits focused and descriptive.
4. Open a pull request against **`main`** (not a `dev` branch).
5. Ensure CI passes (Ruff, pytest, Docker build on PRs).
6. Address review feedback.

## Development setup

### Prerequisites

- Python 3.13+
- [uv](https://docs.astral.sh/uv/)
- Git

### Install

```bash
uv sync --extra dev
cp .env.example .env
.githooks/install.sh
```

### Run locally

```bash
uv run -m src --reload
```

### Tests and lint

```bash
uv run ruff check .
uv run ruff format .
uv run pytest -m unit
uv run pytest -m integration
```

## What to work on

Read [docs/plans/architecture.md](../docs/plans/architecture.md) and [docs/plans/technical.md](../docs/plans/technical.md) before implementing OIDC flows, MongoDB collections, or Cloud Run deploy wiring.

**Do not commit secrets.** Use `.env` locally and GitHub environment secrets (`staging` / `prod`) in CI/CD.

## MongoDB Atlas access

OAuth2 uses the **same two Atlas clusters and X.509 CA as discord_bot** — **not SCRAM**. Database name is **`oauth2`** on both clusters.

| Work against | Set `APP_ENV` | Cluster |
| --- | --- | --- |
| Local / staging data | `local` or `staging` | `pesudev.andmjbp.mongodb.net` (discord_bot `dev`) |
| Production data | `prod` | `pesudev.nkzgere.mongodb.net` (discord_bot `prod`) |

1. Follow the certificate setup in [discord_bot CONTRIBUTING — MongoDB Atlas access](https://github.com/pesu-dev/discord_bot/blob/dev/.github/CONTRIBUTING.md#mongodb-atlas-access) (CSR, maintainer signing, combined `.pem`).
2. In `.env` (both optional — defaults apply when unset):

   ```env
   # APP_ENV=local
   # MONGO_X509_CERT_PATH="/absolute/path/to/scratch/client.pem"
   ```

3. Request a temporary Atlas grant from a maintainer (`/eng mongo access` on the **dev/staging** cluster for local work).

Never commit `.pem`, `.key`, or `.csr` files.

## Security

Report vulnerabilities per [SECURITY.md](SECURITY.md). Do not open public issues for security problems.

## Code style

- Python 3.13+, type hints, Ruff for lint/format
- Immutable data patterns where practical
- Tests for new behavior (`unit` / `integration` markers)
- Follow curated rules in `.cursor/rules/`

## License

By contributing, you agree that your contributions are licensed under the MIT License.
