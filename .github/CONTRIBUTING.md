# Contributing to PESU OAuth2

Thank you for contributing to the unofficial PESU OAuth2 authorization server.

## Workflow

1. Clone the repository (or fork and clone your fork).
2. Create a branch: `(github-username)/feature-description`.
3. Make changes; keep commits focused and descriptive.
4. Open a pull request against **`main`** (not a `dev` branch).
5. Ensure CI passes (Typecheck, ESLint, Vitest, Next.js build on PRs).
6. Address review feedback.

## Development setup

### Prerequisites

- Node.js 22+
- [pnpm](https://pnpm.io/)
- Git

### Install

```bash
pnpm install
cp .env.example .env
.githooks/install.sh
```

### Run locally

```bash
pnpm dev
# App running at http://localhost:3000
```

### Tests and lint

```bash
pnpm lint          # Run ESLint
pnpm typecheck     # Typecheck with TypeScript
pnpm test          # Run Vitest test suite
pnpm build         # Build standalone production container
```

## What to work on

Before implementing OIDC flows, MongoDB collections, or Render deploy wiring, read:

1. **Product + tech contract:** [docs/superpowers/specs/2026-09-03-oidc-authorization-server-design.md](../docs/superpowers/specs/2026-09-03-oidc-authorization-server-design.md) (approved MVP design)
2. **Implementation plan:** [docs/superpowers/plans/2026-09-09-nextjs-oauth2-migration.md](../docs/superpowers/plans/2026-09-09-nextjs-oauth2-migration.md)

[docs/plans/architecture.md](../docs/plans/architecture.md) is **historical** (ADR log). [docs/plans/technical.md](../docs/plans/technical.md) is an **outdated bootstrap** stub — prefer the design spec for locked technical choices.

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

- TypeScript 5+, strict type annotations, ESLint for linting
- Next.js 16+ App Router and React 19 conventions
- Unit tests via Vitest for new behavior
- Follow curated agent rules in [`.agents/rules/`](../.agents/rules/) (style/security). Repo stack, commands, and product contract follow [`AGENTS.md`](../AGENTS.md).

## License

By contributing, you agree that your contributions are licensed under the MIT License.
