# AGENTS.md

Guidance for AI coding agents working in this repository.

> **Precedence:** This file is the **repo constitution** for stack, commands, layout, git boundaries, and definition of done. Committed [`.agents/rules/`](.agents/rules/) are agent-applied style/security/framework conventions (always-on or path-scoped). Committed [`.agents/skills/`](.agents/skills/) are opt-in workflows. **Product/tech truth** lives in `docs/superpowers/` — not in rules. If a generic rule conflicts with this file or the design spec (e.g. wrong ORM, coverage target, package manager), **this file and the design spec win**; update or narrow the rule rather than inventing a parallel stack.

## Living docs (roles)

| Role | Canonical source | Notes |
| --- | --- | --- |
| **Constitution** | This file + [`.github/CONTRIBUTING.md`](.github/CONTRIBUTING.md) | Ops, gates, ask/never boundaries; keep short |
| **Map** | [`README.md`](README.md) layout + [`src/`](src/) | What exists and where |
| **Status** | [`README.md`](README.md) Status table | Current health / what is shipped |
| **History / product ADRs** | [`docs/plans/architecture.md`](docs/plans/architecture.md) | Historical; not the build checklist |
| **Product + tech contract** | [`docs/superpowers/specs/2026-09-03-oidc-authorization-server-design.md`](docs/superpowers/specs/2026-09-03-oidc-authorization-server-design.md) | Approved MVP design |
| **Implementation plan** | [`docs/superpowers/plans/2026-09-09-nextjs-oauth2-migration.md`](docs/superpowers/plans/2026-09-09-nextjs-oauth2-migration.md) | Task checklist for the Next.js migration |
| **Agent conventions** | [`.agents/rules/`](.agents/rules/) | Committed; style/security conventions |
| **Agent skills** | [`.agents/skills/`](.agents/skills/) | Committed; invoke when the skill’s trigger matches |

`docs/plans/technical.md` is an **outdated bootstrap** plan (repo creation / hosting notes). Prefer the design spec for locked technical choices.

Do **not** duplicate long product/spec text into `.agents/rules/` — link or defer to `docs/superpowers/`. Keep rules short and mechanical. Do not reintroduce the same operational checklist into `CLAUDE.md`; nest `AGENTS.md` if a subtree needs its own constitution.

On entry for non-trivial work: read Status → Map → relevant History/spec sections; verify claims against code and tests.

## Stack

- **Node.js >=22**, package manager **pnpm** (never npm/yarn)
- **Next.js 16+** (App Router) + **React 19**, MongoDB via **mongoose**, HTTP via **axios** with cookiejar
- Lint: **ESLint** (Next.js flat config), Typecheck: **TypeScript**
- Tests: **Vitest** (see [tests/README.md](tests/README.md))
- Hosting: **Google Cloud Run** (staging + prod); standalone container images on **GHCR**

## Commands

```bash
# Setup
.githooks/install.sh
pnpm install

# Run locally (from repo root; optional .env for secrets)
pnpm dev

# Quality gates (match CI)
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

Use `pnpm …` for all tooling.

## Layout

| Path | Purpose |
| -------------------- | -------------------------------------------------------- |
| `src/app/` | Next.js App Router (pages & API route handlers) |
| `src/components/` | Reusable Apple-design UI components |
| `src/lib/` | Core engines (OIDC protocol, Academy client, crypto envelope, db models) |
| `src/proxy.ts` | Edge security & auth proxy |
| `tests/unit/` | Vitest unit test suites |
| `docs/superpowers/` | Approved design spec + migration plan |
| `docs/plans/` | Historical architecture ADRs + bootstrap tech notes |
| `.agents/skills/` | Curated agent skills (incl. Apple-design) |
| `.github/workflows/` | CI/CD (Cloud Run deploy) |

Human docs: `README.md`, `.github/CONTRIBUTING.md`, `tests/README.md`, `docs/superpowers/`. Prefer those for long setup detail; keep this file operational.

## Config conventions

- **`APP_ENV`** (`local` | `staging` | `prod`, default `local`) selects hardcoded cluster URIs and `issuer_url` in app config — not env vars.
- **MongoDB:** Mongoose connection singleton with optional X.509 client auth (`MONGO_X509_CERT_PATH`); database `oauth2`; two Atlas clusters (staging vs prod).
- **Secrets:** `.env` locally; GitHub repository secrets / environment vars in CI; never commit keys or `.pem` files.

## Git / PR workflow

- Branch: `(github-username)/feature-description`
- Commits: Conventional Commits — `type: short description` (`feat`, `fix`, `docs`, `style`, `refactor`, `test`, `chore`, `perf`, `ci`, `build`, `revert`)
- Open PRs against **`main`**
- Follow `.github/PULL_REQUEST_TEMPLATE.md`
- Do not commit unless the user asks
- **Never use git add -A or git add .** (always stage specific files)

## Boundaries

### Always

- Match existing TypeScript/React/Next.js patterns and strict type annotations
- Run typecheck, lint, and tests before considering code complete
- Keep secrets out of the tree (`.env` is local-only; use `.env.example` as the template)
- Extend OIDC/product behavior against the approved design spec and plan — do not invent parallel contracts

### Ask first

- New dependencies in `package.json`
- Changes to CI/CD, Cloud Run service accounts, or locked decisions in the design spec / plans
- Schema / collection changes affecting MongoDB data

### Never

- Commit signing keys, X.509 `.pem` certs, Gmail SMTP passwords, or other secrets
- Bypass hooks with `--no-verify`
- Force-push to `main`
- Run `git add -A` or `git add .`

## Definition of done

1. Change fits the `src/` / `tests/` layout above
2. `pnpm typecheck` passes with zero errors
3. `pnpm lint` passes with zero warnings/errors
4. `pnpm test` passes
5. `pnpm build` completes standalone compilation cleanly
6. No secrets or unrelated files staged

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

Mongo X.509 PEMs are mounted at `/run/secrets/mongo.pem` with `MONGO_X509_CERT_PATH` (and `APP_ENV`) set on the Cloud Run service; deploy updates the image only and leaves those env vars in place.
