# PESU OAuth2 Server — TypeScript / Next.js Migration Plan

> **Status:** Draft  
> **Date:** 2026-09-09  
> **Spec Reference:** [`docs/superpowers/specs/2026-09-03-oidc-authorization-server-design.md`](../specs/2026-09-03-oidc-authorization-server-design.md)  
> **Previous Plan:** [`docs/superpowers/plans/2026-09-04-oidc-authorization-server-mvp.md`](2026-09-04-oidc-authorization-server-mvp.md)

---

## 1. Executive Summary & Migration Objectives

This plan outlines the complete rewrite and migration of the PESU OAuth2 Authorization Server from Python (FastAPI, pymongo, Jinja2, raw CSS) to a unified modern stack:
* **Frontend / Framework:** Next.js (App Router), React 19 / Server Components, Tailwind CSS, `motion` (Framer Motion spring physics), `vaul` (Apple-style interactive drawers), `next-themes` (Light & Dark mode).
* **Language & Package Manager:** TypeScript 5+, `pnpm` (system version 10.33.2).
* **Database & Modeling:** MongoDB via **Mongoose** (with connection singleton caching and typed schemas).
* **Identity & Crypto:** `nanoid` (for all prefixed IDs: `usr_`, `cli_`, `sec_`, `code_`, `rt_`, `fam_`), Node.js `node:crypto` (AES-256-GCM envelope encryption with per-row DEK wrapped by `VAULT_MASTER_KEY`), and `jose` (RS256 JWT key signing, verification, and JWKS).
* **External Integration:** `axios` + `axios-cookiejar-support` + `tough-cookie` for PESU Academy mobile API session dispatching.
* **Edge & Middleware:** Next.js Middleware for Edge-level security headers, client IP normalization, and lightweight signed/encrypted session verification.

---

## 2. Research & Architectural Decisions

Based on modern 2025/2026 Next.js architecture and edge runtime research:

### 2.1 HTTP Client: Axios vs. Native Fetch
* **Research finding:** Next.js App Router patches native `fetch` for caching, revalidation, and request deduplication in React Server Components. Axios adds ~14 KB and does not hook into Next.js caching.
* **Architectural decision:**
  * **PESU Academy Adapter (`src/lib/academy/`):** Use **`axios`** with `axios-cookiejar-support` and `tough-cookie`. The Academy integration requires stateful session cookie jar management, custom mobile headers, and interceptors that are difficult to manage in standard fetch.
  * **Server-side internal/public fetches:** Use native `fetch` where Next.js caching and streaming are beneficial.

### 2.2 Next.js Middleware vs. Database Access
* **Research finding:** Next.js `middleware.ts` runs on the **Edge Runtime** by default. Mongoose and MongoDB drivers require Node.js network sockets (`net`, `tls`) and cannot execute inside Edge middleware without throwing runtime errors or causing severe connection overhead.
* **Architectural decision:**
  * `middleware.ts` handles:
    1. **Security headers:** HSTS, X-Frame-Options: DENY, X-Content-Type-Options: nosniff, CSP, Referrer-Policy.
    2. **Client IP normalization:** Extracting and sanitizing `x-forwarded-for` / `x-real-ip`.
    3. **Edge session guard:** Verifying signed/encrypted session cookies using Edge-compatible Web Crypto / `jose`. If invalid on protected paths (`/portal`, `/admin`, `/settings`), redirects immediately to `/login`.
  * Deep DB verification and Mongoose queries run inside Server Components, Route Handlers, or Server Actions.

### 2.3 Mongoose Connection Management
* **Research finding:** In development (Fast Refresh / HMR) and serverless environments, creating multiple `mongoose.connect()` calls causes connection storming.
* **Architectural decision:** Implement a strict global singleton cache (`global.mongoose = { conn: null, promise: null }`) in `src/lib/db/connection.ts`.

### 2.4 Light & Dark Mode + Apple Design System
* **Apple Design Principles applied:**
  * **Fluid Spring Physics (`motion`):** Critically damped springs (`damping: 1.0`, `response: 0.35s`) for UI transitions; under-damped springs (`damping: 0.8`) strictly for user flick/drag momentum releases.
  * **Interactive Drawers (`vaul`):** iOS-style bottom sheet for mobile authorization/consent and modal confirmations with natural rubber-banding.
  * **Instant Feedback:** `pointerdown` active state scaling (`active:scale-[0.98] transition-transform duration-100`).
  * **Materials & Depth:** Translucent glassmorphism (`backdrop-blur-xl`, `bg-white/70 dark:bg-zinc-900/70`, top specular light-catching edge `border-t border-white/20`).
  * **Typography:** System font stack (`system-ui, -apple-system, BlinkMacSystemFont, "SF Pro Text"`), tight headline tracking (`tracking-tight`), comfortable body leading (`leading-relaxed`).
  * **Accessibility:** Full coverage for `@media (prefers-reduced-motion)` and `@media (prefers-reduced-transparency)`.

### 2.5 Greenfield Development (Zero Backward Compatibility)
* **No legacy shims:** Treat this as building a brand-new application from scratch.
* **No migration adapters:** Do not write backward-compatibility glue, dual-format decoders, schema migration shims, or transitional fallbacks.
* **Pure modern implementations:** Write lean, direct TypeScript/Next.js/Mongoose code adhering directly to the OIDC specification and modern design principles.

---

## 3. Directory Layout (Repo Root)

```text
├── src/
│   ├── middleware.ts                         # Edge middleware (headers, IP, session token guard)
│   ├── app/
│   │   ├── layout.tsx                        # Root layout (ThemeProvider, font, toast provider)
│   │   ├── page.tsx                          # Landing page (open source trust & protocol overview)
│   │   ├── (auth)/
│   │   │   ├── login/page.tsx                # PESU Academy login form
│   │   │   └── authorize/page.tsx            # OIDC consent screen (Identity vs. Delegated)
│   │   ├── (dashboard)/
│   │   │   ├── portal/
│   │   │   │   ├── page.tsx                  # Client apps list & creation modal
│   │   │   │   └── [clientId]/page.tsx       # App management: secrets, testers, prod request
│   │   │   ├── admin/page.tsx                # Production review queue & approval actions
│   │   │   └── settings/page.tsx             # Vault credentials update & consent revocation
│   │   ├── (public)/
│   │   │   ├── faq/page.tsx                  # FAQ
│   │   │   ├── privacy/page.tsx              # Privacy policy
│   │   │   └── docs/page.tsx                 # OIDC Integration & API documentation
│   │   ├── .well-known/
│   │   │   └── openid-configuration/route.ts # OIDC discovery
│   │   ├── jwks.json/route.ts                # Public RS256 JWKS set
│   │   ├── token/route.ts                    # Token endpoint (auth_code & refresh_token)
│   │   ├── userinfo/route.ts                 # UserInfo endpoint
│   │   ├── revoke/route.ts                   # Refresh token revocation
│   │   └── oauth/token-exchange/route.ts     # Internal token exchange (delegated session)
│   ├── components/
│   │   ├── ui/                               # Reusable Apple-design primitives
│   │   │   ├── button.tsx                    # Press scaling, spring feedback, variants
│   │   │   ├── card.tsx                      # Translucent surface with specular border
│   │   │   ├── input.tsx                     # Floating label / crisp focus ring, inline validation
│   │   │   ├── badge.tsx                     # Status tags (Testing, Pending, Production)
│   │   │   ├── drawer.tsx                    # Vaul drawer with momentum & drag handle
│   │   │   ├── modal.tsx                     # Spring-animated dialog with backdrop blur
│   │   │   └── theme-toggle.tsx              # Fluid Light/Dark mode toggle
│   │   └── features/                         # ConsentCard, ClientCard, TestersList, etc.
│   └── lib/
│       ├── config.ts                         # Validated env config (Zod)
│       ├── db/
│       │   ├── connection.ts                 # Mongoose singleton with connection caching
│       │   └── models/                       # Typed Mongoose schemas (User, Client, Vault, etc.)
│       ├── crypto/
│       │   ├── envelope.ts                   # AES-256-GCM envelope encryption (DEK + VAULT_MASTER_KEY)
│       │   ├── hash.ts                       # SHA-256 token/secret hashing
│       │   └── pkce.ts                       # PKCE code_challenge S256 verification
│       ├── oidc/
│       │   ├── jwks.ts                       # RS256 keypair loading & JWKS generator ('jose')
│       │   └── jwt.ts                        # Access and ID token minting
│       ├── academy/
│       │   └── client.ts                     # Axios client with cookiejar for PESU Academy
│       ├── session/
│       │   └── cookie.ts                     # Signed & encrypted browser session cookies
│       └── id/
│           └── nanoid.ts                     # Prefixed Nanoid generators (usr_, cli_, sec_, etc.)
├── tests/
│   ├── unit/                                 # Vitest unit tests (crypto, oidc, id, models)
│   └── integration/                          # Route handler & OIDC flow tests (Testcontainers)
├── next.config.ts                            # Standalone output for Cloud Run
├── tailwind.config.ts                        # Extended colors, materials, animations
├── package.json
└── pnpm-lock.yaml
```

---

## 4. Phase-by-Phase Implementation Checklist

### Phase 0: Legacy Codebase Archival
- [ ] Create `legacy/` directory in the repo.
- [ ] Move all Python-specific files and directories into `legacy/`:
  - `src/` -> `legacy/src/`
  - `tests/` -> `legacy/tests/`
  - `scripts/` -> `legacy/scripts/`
  - `pyproject.toml`, `uv.lock`, `Dockerfile` -> `legacy/`
- [ ] Clean up local Python cache artifacts (`.pytest_cache`, `.ruff_cache`, `.coverage`, `.venv`).
- [ ] Verify that repo root is cleanly vacated for Next.js (`src/` and `tests/` are clear for `pnpm create next-app`).

### Phase 1: Project Scaffolding & Tooling
- [ ] Initialize Next.js 15+ App Router using `pnpm create next-app` at repo root.
- [ ] Configure `package.json` dependencies:
  - Runtime: `mongoose`, `nanoid`, `jose`, `axios`, `axios-cookiejar-support`, `tough-cookie`, `motion`, `vaul`, `next-themes`, `zod`, `lucide-react`.
  - Dev: `vitest`, `@testing-library/react`, `@types/node`, `@types/tough-cookie`, `@testcontainers/mongodb`.
- [ ] Configure Tailwind CSS:
  - Add Apple design tokens: typography tracking, translucent background colors, specular highlights, spring transition utilities.
  - Setup dark mode (`class` strategy).
- [ ] Set up `vitest.config.ts` and test script in `package.json`.

### Phase 2: Core Utilities & Data Layer (Mongoose + Crypto + IDs)
- [ ] **Config & Environment (`src/lib/config.ts`):** Zod-validated environment variables (`APP_ENV`, `VAULT_MASTER_KEY`, `MONGODB_URI`, `ISSUER_URL`, etc.).
- [ ] **Nanoid Generator (`src/lib/id/nanoid.ts`):** Typed ID generator with standard prefixes (`usr_`, `cli_`, `sec_`, `code_`, `rt_`, `fam_`, `req_`).
- [ ] **Envelope Encryption (`src/lib/crypto/envelope.ts`):**
  - Per-row DEK generation (256-bit).
  - AES-256-GCM encryption of payload.
  - Master key wrapping of DEK with `key_version`.
- [ ] **PKCE & Hashing (`src/lib/crypto/`):** SHA-256 hashing and PKCE `code_verifier` S256 validation.
- [ ] **Mongoose Connection Singleton (`src/lib/db/connection.ts`):** Cached connection avoiding HMR exhaustion.
- [ ] **Mongoose Models (`src/lib/db/models/`):**
  - `User`: `sub` unique, profile fields, login timestamps, tombstone `deleted_at`.
  - `Client`: `client_id`, `client_secret_hash`, `owner_sub`, `redirect_uris`, `publishing_status`, `delegated_allowed`.
  - `ClientTester`: `client_id`, `sub`.
  - `Consent`: `sub`, `client_id`, `scopes`, `mode`, `granted_at`.
  - `Vault`: `sub` unique, `encrypted_password`, `encrypted_session`, `session_expires_at`, `key_version`, `wrapped_dek`.
  - `AuthCode`: `code_hash`, `client_id`, `sub`, `scopes`, `mode`, `redirect_uri`, `code_challenge`, TTL index (10 minutes).
  - `RefreshToken`: `token_hash` unique, `family_id`, `client_id`, `sub`, `scopes`, `revoked_at`, `created_at`.
  - `ProductionRequest`: `client_id`, `status`, `justification`, timestamps.
  - `Admin`: `sub` unique.
- [ ] **Unit Tests:** Verify envelope encryption round-trip, Mongoose schema validation, and Nanoid formats.

### Phase 3: PESU Academy Client (Axios + Cookie Jar)
- [ ] Implement `PesuAcademyClient` in `src/lib/academy/client.ts`:
  - Axios instance initialized with `axios-cookiejar-support` and `tough-cookie`.
  - Methods: `authenticate(username, password)`, `fetchProfile()`, `validateSession()`.
  - Error mapping for bad credentials, captcha blocks, and network timeouts.
- [ ] **Unit Tests:** Mock Axios adapter verifying Academy login flow, profile extraction, and cookie retention.

### Phase 4: OIDC Protocol Engine (`jose`) & Route Handlers
- [ ] **Key Management & JWKS (`src/lib/oidc/`):**
  - RS256 keypair loading/generation with `kid`.
  - `GET /.well-known/openid-configuration`: OpenID Connect Discovery document.
  - `GET /jwks.json`: Public JWK set.
- [ ] **Token Issuance (`src/lib/oidc/jwt.ts`):**
  - Access JWT issuance (1-hour TTL, claims: `iss`, `sub`, `aud`, `client_id`, `scope`).
  - ID Token issuance (1-hour TTL, user profile claims, `at_hash`).
- [ ] **Protocol Route Handlers (`src/app/`):**
  - `POST /token`: Handles `authorization_code` (with PKCE check) and `refresh_token` (with rotation & reuse detection revoking family).
  - `GET /userinfo` & `POST /userinfo`: Bearer token validation and claims return.
  - `POST /revoke`: Revoking refresh tokens and token families.
  - `POST /oauth/token-exchange`: Internal token exchange for delegated vault session material.
- [ ] **Integration Tests:** Full protocol flow (discovery, auth code exchange, token refresh, revocation).

### Phase 5: Reusable Apple-Design System & Theme
- [ ] **Theme Provider (`src/components/ui/theme-provider.tsx`):** `next-themes` integration supporting Light, Dark, and System preference.
- [ ] **Core Primitives (`src/components/ui/`):**
  - `Button`: Pointer-down instant feedback (`active:scale-[0.98]`), spring transitions, variants (primary, secondary, destructive, ghost).
  - `Card`: Translucent material (`backdrop-blur-xl`, `bg-white/70 dark:bg-zinc-900/70`), specular border highlight (`border-t border-white/20`).
  - `Input`: High-contrast borders, focus rings, inline helper & error text.
  - `Badge`: Status tags for `testing`, `pending_production`, `production`.
  - `Drawer` / `BottomSheet`: Apple-style sheet using `vaul` with momentum projection and rubber-band edge resistance.
  - `ThemeToggle`: Fluid, spring-animated light/dark switch.
- [ ] **Accessibility Audit:** Ensure `@media (prefers-reduced-motion)` and `@media (prefers-reduced-transparency)` override spring and blur effects gracefully.

### Phase 6: Hosted Web Surfaces (Pages & Server Actions)
- [ ] **Next.js Middleware (`src/middleware.ts`):**
  - Set security headers (HSTS, CSP, X-Frame-Options: DENY, Referrer-Policy).
  - IP sanitization.
  - Session cookie verification on `/portal`, `/admin`, `/settings`.
- [ ] **Login & Authorize Flow:**
  - `GET /authorize`: Validate client, PKCE, scopes, redirect URI. Check existing consent or active session.
  - `/login`: Academy credentials form with instant inline feedback and error states.
  - `/authorize`: Apple-style consent screen clearly displaying App Name, Publishing Status (Testing vs. Prod), Scopes, and explicit Mode description (Identity vs. Delegated Vault).
- [ ] **Developer Portal (`/portal`):**
  - Apps list with publishing status badge.
  - Create App modal/drawer (returns `client_id` and raw `client_secret` once).
  - App detail page: Manage redirect URIs, testers list, and Request Production button.
- [ ] **Admin Dashboard (`/admin`):**
  - Production requests queue with Approve and Reject actions.
- [ ] **User Settings (`/settings`):**
  - Vault management: Re-authenticate to update stored PESU credentials, or delete delegated vault document.
  - Consent revocation: List consented third-party apps and revoke permissions.
- [ ] **Public Pages:**
  - `/`: Modern, sleek landing & open-source trust page.
  - `/faq`: Common questions regarding PESU authentication, security, and privacy.
  - `/privacy`: Data handling and credential storage policy.
  - `/docs`: Guide for third-party developers on integrating with Sign in with PESU.

### Phase 7: Deployment, Cleanup & Verification
- [ ] Configure `output: 'standalone'` in `next.config.ts`.
- [ ] Create updated root `Dockerfile` to build and run the standalone Next.js server on Google Cloud Run.
- [ ] Run full verification:
  - Typecheck: `pnpm tsc --noEmit`
  - Linter: `pnpm eslint .`
  - Unit & Integration Tests: `pnpm test`
  - Production Build: `pnpm build`
- [ ] Review and clean up the `legacy/` directory once migration parity is achieved.

---

## 5. Definition of Done

1. Next.js App Router project scaffolds cleanly and runs locally with `pnpm dev`.
2. All OIDC endpoints (`.well-known`, `jwks.json`, `token`, `userinfo`, `revoke`, `token-exchange`) achieve 100% behavioral parity with the approved design spec.
3. Light and Dark modes are fully supported with Apple-design translucent materials and spring motion.
4. Mongoose models enforce validation and connection singleton caching.
5. All tests pass in Vitest with comprehensive coverage.
6. The application builds cleanly into a standalone container ready for Cloud Run.
