# Test Suite

This repository uses [Vitest](https://vitest.dev/) for unit and smoke testing, with V8 for test coverage reporting.

## Running Tests

```bash
# Run unit and smoke tests (vitest.unit.config.ts)
pnpm test:unit

# Run real MongoDB integration tests (vitest.integration.config.ts; requires Docker / Colima)
pnpm test:integration

# Run unit tests in interactive watch mode
pnpm test:unit:watch

# Run test coverage report
pnpm test:coverage
```

## Structure

Tests directly mirror the `src/` directory layout:

- `tests/smoke.test.ts`: Integration/smoke verification (e.g., MongoDB Atlas connection).
- `tests/integration/`: End-to-end integration tests using real `mongo:7` via [Testcontainers](https://testcontainers.com/):
  - `mongo-indexes.test.ts`: Real MongoDB compound uniqueness and TTL index enforcement.
  - `oidc-code-flow.test.ts`: Complete code exchange, S256 PKCE verification, replay defense, and `/userinfo`.
  - `refresh-token-rotation.test.ts`: Refresh token rotation, compromise detection, and family-wide revocation.
  - `delegated-exchange.test.ts`: Delegated envelope encryption, vault persistence, and `/oauth/token-exchange`.
  - `production-gate.test.ts`: Testing mode gates, tester addition, and admin review queue approval.
  - `settings-lifecycle.test.ts`: Consent revocation, vault credential purging, and account tombstoning.
- `tests/unit/`:
  - `app/`: Next.js App Router route handlers, API endpoints, and page verifications.
    - `api/admin/`:
      - `requests.test.ts`: `/api/admin/requests` production request review, CAS concurrency protection, and approval/rejection.
    - `api/auth/`:
      - `login.test.ts`: `/api/auth/login` query guards, Academy authentication, user upsert, and redirect sanitization.
      - `logout.test.ts`: `/api/auth/logout` session/pending cookie clearing and safe redirects.
      - `status.test.ts`: `/api/auth/status` authentication and admin role status with error resilience.
    - `api/oidc/`:
      - `consent.test.ts`: `/api/oidc/consent` validation, client testing mode guards, and delegated vault resealing.
    - `api/portal/`:
      - `clients.test.ts`: `/api/portal/clients` creation privilege rules and redirect URI updates.
      - `production.test.ts`: `/api/portal/clients/[clientId]/request-production` status gating, duplicate guards, and notification.
      - `secret.test.ts`: `/api/portal/clients/[clientId]/rotate-secret` client secret rotation.
      - `testers.test.ts`: `/api/portal/clients/[clientId]/testers` PRN/SRN/sub tester authorization and removal.
    - `api/settings.test.ts`: `/api/settings` details retrieval, vault deletion, password re-encryption, and consent revocation.
    - `routes/`: Top-level OIDC protocol and service route handlers.
      - `discovery.test.ts`: `/.well-known/openid-configuration` discovery endpoint metadata.
      - `health.test.ts`: `/health` service liveness check.
      - `jwks.test.ts`: `/jwks.json` public key set endpoint.
      - `revoke.test.ts`: `/revoke` RFC 7009 token revocation, client auth, and timing safety.
      - `token.test.ts`: `/token` authorization code exchange, PKCE verification, refresh token grant, reuse detection, and client auth.
      - `token-exchange.test.ts`: `/oauth/token-exchange` internal token exchange, cached session decryption, and Academy session refresh.
      - `userinfo.test.ts`: `/userinfo` Bearer token verification and claims delivery.
    - `admin-page.test.tsx`: `/admin` admin queue rendering, delegated allowance toggling, and review actions.
    - `authorize.test.tsx`: `/authorize` page and `ConsentClient` interactive consent, scope filtering, testing-mode gates, and PKCE requirements.
    - `docs.test.ts` & `docs-client.test.tsx`: `/docs` documentation metadata, interactive endpoint selector, and LLM reference exports.
    - `login.test.tsx`: `/login` authentication form, credentials submission, error feedback, and return-to redirection.
    - `pages.test.tsx`: Public static pages (`/`, `/faq`, `/privacy`, `not-found`, and `layout`).
    - `portal-page.test.tsx`: `/portal` developer applications listing and registration drawer.
    - `portal-client-detail.test.tsx`: `/portal/[clientId]` client application management, redirect URIs, testers, and secret rotation.
    - `robots.test.ts`: `robots.ts` crawler disallow directives.
    - `settings-page.test.tsx`: `/settings` student identity, vault deletion, and application access revocation.
  - `components/`:
    - `ui.test.tsx`: Apple-style UI component rendering (`Button`, `Card`, `Badge`).
    - `ui-components.test.tsx`: `Input`, `Card`, `Drawer`, and `Navbar` interactive authentication and mobile navigation.
    - `theme.test.tsx`: `ThemeProvider` and `ThemeToggle` light/dark theme switching.
  - `lib/`: Core logic and helper engines.
    - `academy/client.test.ts`: PESU Academy Axios client authentication and profile parsing.
    - `crypto/crypto.test.ts`: Envelope encryption (DEK wrapping with AES-256-GCM), hashing, and PKCE S256 verification.
    - `db/models.test.ts`: Mongoose schema validation and collection bindings.
    - `id/nanoid.test.ts`: Prefixed Nanoid ID generators.
    - `mailer/mailer.test.ts`: Transactional logging mailer service and non-fatal delivery helpers.
    - `oidc/`:
      - `claims.test.ts`: OIDC standard scopes and claims mapper.
      - `discovery.test.ts`: Discovery document builder and advertised auth methods.
      - `jwt.test.ts`: Token minting (`at_hash`, `jti`, `nonce`), verification, and public JWKS export.
    - `session/`:
      - `cookie.test.ts`: Signed HS256 session token cookies and verification.
      - `pending-credentials.test.ts`: Ephemeral in-memory pending credential store with TTL expiration.
    - `validation/redirect-uri.test.ts`: Client redirect URI parsing, deduplication, and scheme validation.
    - `config.test.ts`: Zod configuration schema validation and fail-fast environment checks.
    - `rate-limit.test.ts`: Sliding window rate limiter accounting and key isolation.
  - `proxy.test.ts`: Next.js Edge security headers, CORS preflight, CSRF origin checks, and route rate limits.
