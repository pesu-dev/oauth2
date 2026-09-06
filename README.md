# PESU OAuth2 Authorization Server

Unofficial OAuth2 / OpenID Connect authorization server for PESU Academy. Third-party club sites can complete **Sign in with PESU** (authorization code + PKCE) without seeing the PESU password. Testing→Production publishing, optional delegated credential vault, and an internal token-exchange surface are included in the MVP.

## Status

| Area | State |
| --- | --- |
| Design (canonical) | Approved — [docs/superpowers/specs/2026-09-03-oidc-authorization-server-design.md](docs/superpowers/specs/2026-09-03-oidc-authorization-server-design.md) |
| Implementation plan | [docs/superpowers/plans/2026-09-04-oidc-authorization-server-mvp.md](docs/superpowers/plans/2026-09-04-oidc-authorization-server-mvp.md) (Tasks 1–16) |
| Product ADRs (historical) | [docs/plans/architecture.md](docs/plans/architecture.md) — **outdated for build detail**; ADRs remain useful background |
| Bootstrap tech notes | [docs/plans/technical.md](docs/plans/technical.md) — **outdated stub**; hosting/Mongo choices still generally valid |
| HTTP API | OIDC discovery, JWKS, authorize, token, userinfo, revoke; portal, admin, settings; public FAQ/privacy/docs |
| Hosting target | Google Cloud Run (staging + prod) |
| Database | MongoDB Atlas `oauth2` (X.509; staging + prod clusters); Testcontainers Mongo in CI |

## Disclaimer

This project is **not affiliated with PESU University or PESU Academy**. Use at your own risk. See [SECURITY.md](.github/SECURITY.md).

## Quick start (local)

**Prerequisites:** Python 3.13+, [uv](https://docs.astral.sh/uv/). Integration tests also need Docker (Colima on macOS is fine).

```bash
cd oauth2
cp .env.example .env   # fill SESSION_SECRET, etc.
uv sync --extra dev
uv run -m src --reload
curl http://localhost:8080/health
```

## Development

```bash
uv run ruff check .
uv run ruff format .
uv run pytest -m unit
uv run pytest -m integration   # requires Docker
.githooks/install.sh   # once per clone
```

See [tests/README.md](tests/README.md) for the test pyramid, coverage floor, and Testcontainers notes.

## Repository layout

```text
oauth2/
  docs/plans/        # historical architecture + bootstrap technical notes
  docs/superpowers/  # approved design spec + MVP implementation plan
  src/               # FastAPI application
  tests/             # unit + integration
  .cursor/           # curated skills and rules (incl. Apple-design)
  .githooks/         # git hooks (install via .githooks/install.sh)
  .github/           # CI, staging deploy, prod promote
```

## Contributing

See [CONTRIBUTING.md](.github/CONTRIBUTING.md). Pull requests target **`main`**.

## License

MIT — see [LICENSE](LICENSE).
