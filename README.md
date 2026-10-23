# PESU OAuth2 Authorization Server

Unofficial OAuth2 / OpenID Connect authorization server for PESU Academy. Third-party club sites can complete **Sign in with PESU** (authorization code + PKCE) without seeing the PESU password. Testing→Production publishing, optional delegated credential vault, and an internal token-exchange surface are included in the MVP.

## Status

| Area | State |
| --- | --- |
| Design (canonical) | Approved — [docs/superpowers/specs/2026-09-03-oidc-authorization-server-design.md](docs/superpowers/specs/2026-09-03-oidc-authorization-server-design.md) |
| Implementation plan | [docs/superpowers/plans/2026-09-09-nextjs-oauth2-migration.md](docs/superpowers/plans/2026-09-09-nextjs-oauth2-migration.md) (Next.js; the earlier [Python MVP plan](docs/superpowers/plans/2026-09-04-oidc-authorization-server-mvp.md) is historical) |
| Resource API & scopes | [docs/superpowers/specs/2026-10-23-resource-api-and-scopes-design.md](docs/superpowers/specs/2026-10-23-resource-api-and-scopes-design.md) — `resource:read` scopes, admin approval, `/api/v1/*` (beta: Academy menu ids pending) |
| Product ADRs (historical) | [docs/plans/architecture.md](docs/plans/architecture.md) — **outdated for build detail**; ADRs remain useful background |
| Bootstrap tech notes | [docs/plans/technical.md](docs/plans/technical.md) — **outdated stub**; hosting/Mongo choices still generally valid |
| HTTP API | OIDC discovery, JWKS, authorize, token, userinfo, revoke; resource API (`/api/v1/*`); portal, admin, settings; public FAQ/privacy/docs |
| Hosting target | Render (staging + prod) |
| Database | MongoDB Atlas `oauth2` (X.509; staging + prod clusters); Testcontainers Mongo in CI |

## Disclaimer

This project is **not affiliated with PESU University or PESU Academy**. Use at your own risk. See [SECURITY.md](.github/SECURITY.md).

## Quick start (local)

**Prerequisites:** Node.js 22+, [pnpm](https://pnpm.io/), Docker (for the local MongoDB).

```bash
cd oauth2
cp .env.example .env   # fill SESSION_SECRET, VAULT_MASTER_KEY, etc.
pnpm install
docker compose up -d --wait   # single-node Mongo replica set on 127.0.0.1:27017
node --env-file=.env scripts/seed_client.mjs   # prints a test client_id + secret
pnpm dev
# Server running at http://localhost:3000
```

MongoDB runs as a replica set because transactions require one, and is published on `127.0.0.1` only because it has no authentication. `docker compose down` stops it; add `-v` to wipe the data.

Local notes:

- Without `TOKEN_SIGNING_KEY_PATH`, the RS256 key is generated per process, so restarting the app invalidates issued tokens.
- Seed a client with pre-approved data scopes via `--scopes attendance:read,results:read`.
- Resource endpoints answer `501 resource_unavailable` until their PESU Academy menu ids are known; verified ids can be supplied with `ACADEMY_MENU_IDS='{"attendance":"…"}'` (see the [resource API design](docs/superpowers/specs/2026-10-23-resource-api-and-scopes-design.md)).

## Development

```bash
pnpm lint              # Run ESLint
pnpm typecheck         # TypeScript check without emit
pnpm test:unit         # Run Vitest unit test suite
pnpm test:integration  # Run Testcontainers MongoDB integration suite
pnpm build             # Build standalone production bundle
.githooks/install.sh   # once per clone
```

See [tests/README.md](tests/README.md) for the test structure and coverage details.

## Repository layout

```text
oauth2/
  docs/plans/        # historical architecture + bootstrap technical notes
  docs/superpowers/  # approved design spec + Next.js migration implementation plan
  src/
    app/             # Next.js App Router (pages & API route handlers)
    components/      # Reusable UI components (pesu-auth design language)
    lib/             # Core engines (OIDC, Academy client, crypto, db models)
    proxy.ts         # Edge routing and security proxy
  tests/             # Unit tests (Vitest)
  .agents/           # Curated agent skills
  .githooks/         # Git hooks (install via .githooks/install.sh)
  .github/           # CI, staging deploy, prod promote
```

## Contributing

See [CONTRIBUTING.md](.github/CONTRIBUTING.md). Pull requests target **`main`**.

## License

MIT — see [LICENSE](LICENSE).
