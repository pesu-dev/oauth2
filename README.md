# PESU OAuth2 Authorization Server

Unofficial OAuth2 / OpenID Connect authorization server for PESU Academy. This repository is **bootstrap-only** today: docs, CI/CD skeleton, and a `/health` stub. OIDC endpoints (`/authorize`, `/token`, `/userinfo`), MongoDB persistence, and Academy login are **not implemented yet**.

## Status

| Area | State |
| --- | --- |
| Architecture | Documented in [docs/plans/architecture.md](docs/plans/architecture.md) |
| Technical plan | [docs/plans/technical.md](docs/plans/technical.md) |
| HTTP API | `/health` only |
| Hosting target | Google Cloud Run (staging + prod) |
| Database | MongoDB Atlas `oauth2` (X.509; staging + prod clusters) |

## Disclaimer

This project is **not affiliated with PESU University or PESU Academy**. Use at your own risk. See [SECURITY.md](.github/SECURITY.md).

## Quick start (local)

**Prerequisites:** Python 3.13+, [uv](https://docs.astral.sh/uv/)

```bash
cd oauth2
cp .env.example .env   # fill in later when features land
uv sync --extra dev
uv run -m src --reload
curl http://localhost:8080/health
```

## Development

```bash
uv run ruff check .
uv run ruff format .
uv run pytest -m unit
uv run pytest -m integration
.githooks/install.sh   # once per clone
```

## Repository layout

```text
oauth2/
  docs/plans/     # architecture + technical plans
  design/         # Apple-style motion skill for hosted pages
  src/            # FastAPI application (stub)
  tests/          # unit + integration
  .githooks/      # git hooks (install via .githooks/install.sh)
  .github/        # CI, staging deploy, prod promote
  .cursor/        # curated skills and rules
```

## Contributing

See [CONTRIBUTING.md](.github/CONTRIBUTING.md). Pull requests target **`main`**.

## License

MIT — see [LICENSE](LICENSE).
