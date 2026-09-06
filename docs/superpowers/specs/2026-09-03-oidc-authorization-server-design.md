# PESU OAuth2 Authorization Server — MVP Design

**Status:** Approved  
**Date:** 2026-09-03  
**Spec revision:** 1  
**Approved:** 2026-09-04  
**Related:** [MVP implementation plan](../plans/2026-09-04-oidc-authorization-server-mvp.md); historical [architecture.md](../../plans/architecture.md) (product ADRs), [technical.md](../../plans/technical.md) (outdated bootstrap)

This document is the **canonical implementation contract** for the identity + delegated vault MVP in this repository. It supersedes open “later” items in the bootstrap technical plan where this conversation locked a choice. Product ADRs in `architecture.md` remain useful historical product context; prefer this spec for build-time technical decisions.

---

## Goal

Ship an unofficial OpenID Connect authorization server so a third-party club site can complete **Sign in with PESU** (authorization code + PKCE) without ever seeing the PESU password, with Testing→Production publishing, optional **delegated** credential vault, and an **internal** token-exchange surface for a future resource API.

## Non-goals

- Resource API implementation or naming of API resource scopes
- Replacing or changing pesu-auth
- Discord `/link` migration
- Website scrape fallback
- ROPC / implicit grants
- PostHog, Sentry, AS-side 2FA (v2)
- Dual JWT algorithms at issue time (Ed25519 deferred; signer stays pluggable)
- Marketing growth chrome: CTA above the fold on auth pages, sticky mobile CTA, thank-you page, breadcrumbs, response-time promises, LocalBusiness schema, social share images (unless a shareable public landing is added later)

---

## Locked decisions

| Topic                   | Decision                                                                                                                                                                                                |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Scope of MVP            | Full identity-only OIDC **and** delegated vault + internal token exchange                                                                                                                               |
| Delivery                | Vertical slices (see Build order)                                                                                                                                                                       |
| Access / id tokens      | RS256 JWT (`kid` rotation); signer interface pluggable for future algs                                                                                                                                  |
| Refresh tokens          | Opaque; store hash only; rotate; reuse detection revokes family                                                                                                                                         |
| `sub`                   | `usr_` + nanoid-class ID; never UUID/PRN/SRN; never reuse after delete                                                                                                                                  |
| Vault crypto            | Envelope encryption: per-row DEK (AES-GCM) wrapped by `VAULT_MASTER_KEY`; `key_version`                                                                                                                 |
| Admins                  | Mongo `admins` collection (`sub`)                                                                                                                                                                       |
| Academy client          | Minimal in-repo httpx adapter; spec from [pesu-api](https://github.com/Vision2822/pesu-api) and [pesu-dev/auth#152](https://github.com/pesu-dev/auth/pull/152); **do not** add pesu-api as a dependency |
| Email                   | Mailer port + templates; **log-only in `local`** until SMTP secrets exist; send failures never block Allow/Deny                                                                                         |
| Mongo integration tests | **Testcontainers** in CI; **opt-in** Atlas X.509 smoke when cert present                                                                                                                                |
| Issuer URL              | From `APP_ENV` config map — never inferred from `Host`                                                                                                                                                  |
| Token TTLs              | Access/id **1 hour**; refresh **14 days absolute** + rotate on use; auth code 10 minutes                                                                                                                |
| Public HTML             | Privacy + FAQ (5) + API docs + minimal 404; `robots.txt` blocks auth surfaces; unique titles; meta only on public pages; image alt text; open-source + GitHub link on public/trust pages                |

---

## System shape

One FastAPI service on Cloud Run (staging + prod). This repo is the authorization server only.

```text
ClubSite ──OIDC──► AS (this service)
                     ├── hosted HTML: login, consent, portal, admin, settings
                     ├── MongoDB Atlas db `oauth2` (X.509 at runtime)
                     ├── Academy mobile dispatcher (owned httpx adapter)
                     └── mailer port (log | Gmail SMTP)
```

Passwords and long-lived Academy sessions exist only inside the AS, and only for users who consented to a **delegated** client.

Internal token exchange is implemented now so a future first-party API can obtain a short-lived Academy session without decrypting the vault. Third parties must not call exchange.

---

## OIDC protocol surface

### Endpoints

| Method + path                           | Purpose                                                                                    |
| --------------------------------------- | ------------------------------------------------------------------------------------------ |
| `GET /.well-known/openid-configuration` | Discovery                                                                                  |
| `GET /jwks.json`                        | RS256 public JWK set                                                                       |
| `GET /authorize`                        | Authorization code + **PKCE required** (S256)                                              |
| `POST /token`                           | `authorization_code`, `refresh_token`                                                      |
| `GET` / `POST /userinfo`                | Bearer access token                                                                        |
| `POST /revoke`                          | Revoke refresh tokens (access JWT expiry-only in v1; no `jti` denylist unless added later) |
| `POST /oauth/token-exchange`            | Internal only → Academy session material                                                   |

No resource-owner password grant. No implicit. Confidential clients: client secret + PKCE. Public clients: PKCE only.

### Scopes (v1)

`openid`, `profile`, `email`, `phone`, `offline_access`

Do not name API resource scopes in v1.

### Claims

- **`sub`:** opaque `usr_…`
- **`profile`:** name, PRN, SRN, program, branch, semester, section, campus
- **`email` / `phone`:** only when those scopes were granted
- **Access JWT:** `iss`, `sub`, `aud` (default `client_id` until API exists), `client_id`, `scope`, `exp`, `iat`, `jti`
- **ID token:** standard OIDC + scoped profile claims; include `at_hash` when issued with access token
- **Refresh:** opaque random string; only SHA-256 hash in Mongo; bind to `sub`, `client_id`, scopes, rotation `family_id`

### TTLs (config constants; locked for MVP)

| Artifact                     | TTL                                                                                     |
| ---------------------------- | --------------------------------------------------------------------------------------- |
| Authorization code           | 10 minutes                                                                              |
| Access token                 | **1 hour**                                                                              |
| ID token                     | **1 hour** (align with access)                                                          |
| Refresh token                | **14 days absolute** lifetime; rotated on every use; reuse detection revokes the family |
| Browser login session cookie | 30 minutes                                                                              |

### Publishing gate

After successful Academy authentication and before issuing a code:

- `publishing_status == testing` → allow only `owner_sub` or rows in `client_testers`
- `production` → any authenticated Academy user
- `pending_production` → treat as testing for authorization

Developer cannot self-flip to Production.

### Consent

Show consent when there is no prior matching grant, or requested scopes/mode exceed the stored grant. Consent UI must show: app name, publisher identity, redirect URI, Testing vs Production, plain-language scopes, and a **mode-specific storage sentence**:

- **Identity:** we do **not** store PESU credentials; this app cannot call the future API on your behalf.
- **Delegated:** we **will** store password and Academy session because this client will make future API requests on your behalf.

Identity-only success must leave **no** vault document.

---

## Data model

Database name: `oauth2`. Cluster selected by `APP_ENV` (see technical plan). Runtime auth: Atlas self-managed X.509.

| Collection            | Notes                                                                                                                                                                                                         |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `users`               | `sub` unique; profile; `created_at`, `last_login_at`, `deleted_at` tombstone                                                                                                                                  |
| `clients`             | `client_id`, `client_secret_hash`, name, `owner_sub`, `redirect_uris`, `token_endpoint_auth_method`, `publishing_status` (`testing` \| `pending_production` \| `production`), `delegated_allowed`, timestamps |
| `client_testers`      | unique `(client_id, sub)`                                                                                                                                                                                     |
| `consents`            | `(sub, client_id)`, `scopes`, `mode` (`identity` \| `delegated`), `granted_at`                                                                                                                                |
| `vault`               | `sub` unique; exists **only** after delegated consent; wrapped DEK + ciphertext for password + session; `session_expires_at`; `key_version`                                                                   |
| `authorization_codes` | code hash, PKCE, client, sub, scopes, mode, redirect_uri; TTL index                                                                                                                                           |
| `refresh_tokens`      | token hash unique, family_id, client, sub, scopes, `revoked_at`                                                                                                                                               |
| `production_requests` | admin queue fields                                                                                                                                                                                            |
| `admins`              | `sub` unique                                                                                                                                                                                                  |

### Vault lifecycle

1. Delegated Allow → encrypt password + mobile session; upsert `vault`
2. Identity-only → discard password/session; no vault write
3. Update credentials (settings) → re-auth with current PESU password; overwrite vault
4. Delete credentials → delete vault; identity consents may remain
5. Delete account → tombstone user, revoke grants/tokens, delete vault; never reuse `sub`

### Internal token exchange

1. Authenticate caller with `TOKEN_EXCHANGE_SECRET` (header); not available to third-party clients
2. Validate user access JWT
3. Require active **delegated** consent for the hardcoded first-party API `client_id` (`FIRST_PARTY_API_CLIENT_ID` in `src/config.py`)
4. If vault session valid → return short-lived Academy session material to caller only
5. Else decrypt password → mobile re-login → re-wrap vault → return session
6. Never return PESU password

---

## Hosted UI

Server-rendered Jinja2. Progressive enhancement: Allow/Deny and login POST work without JS. Apply [Apple-design](../../../.cursor/skills/apple-design/SKILL.md) motion with `prefers-reduced-motion` support. Motion must not obscure publisher, redirect URI, or storage sentence.

### Product surfaces

| Surface          | Responsibility                                                                       |
| ---------------- | ------------------------------------------------------------------------------------ |
| Login            | Username/password on AS hostname; rate limit; generic failure messaging              |
| Consent          | Trust copy + storage sentence                                                        |
| Error            | OAuth-safe errors only                                                               |
| Developer portal | Clients, secrets (show once), redirect URIs, testers, request Production / delegated |
| Admin queue      | Approve/reject Production; set `delegated_allowed`                                   |
| Settings         | Revoke apps; vault update/delete if present; delete account                          |

### Public / trust surfaces (in MVP)

| Surface             | Path (indicative)                         | Responsibility                                                                                                                                                                                                     |
| ------------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Home                | `/`                                       | Short developer-oriented blurb (not a marketing funnel): what Sign in with PESU is, link to portal + docs + FAQ + privacy; **open-source notice + GitHub repo link**                                               |
| Privacy policy      | `/privacy`                                | What we collect (password transient vs vault), consents, tokens, email events, retention/delete, unofficial disclaimer; **open-source notice + GitHub link**; linked from login, consent, portal, settings footers |
| FAQ                 | `/faq`                                    | Exactly **five** questions (topics below); public; linked from footers; mention open source / GitHub where relevant (e.g. unofficial)                                                                              |
| API / protocol docs | `/docs` (and per-endpoint pages under it) | Developer reference for **this AS** (OIDC/OAuth surfaces third parties call). See below. **Allow** in `robots.txt`                                                                                                 |
| Custom 404          | unmatched HTML routes                     | Branded not-found with links to home/docs/portal/FAQ/privacy — not raw framework JSON for browser navigations                                                                                                      |
| `robots.txt`        | `/robots.txt`                             | **Disallow** crawling of `/authorize`, login, consent, settings, admin, token, userinfo, exchange, revoke (JWKS optional); **Allow** `/`, `/faq`, `/privacy`, `/docs`                                              |

### Open source notice

Everywhere public/trust chrome appears (home, privacy, FAQ, docs chrome, shared footer), state that the project is **open source (MIT)** and link **https://github.com/pesu-dev/oauth2**. Do not bury this only in the README.

### API documentation + “Copy for LLM”

**Relevant:** yes — club developers integrating Auth.js/AppAuth need a human reference; a **Copy for LLM** control copies that method’s docs as **Markdown** to the clipboard so they can paste into an agent/chat. That is DX for integration, not marketing chrome.

**In scope for `/docs` (this MVP):**

- Discovery, authorize (PKCE), token (code + refresh), userinfo, revoke, JWKS
- Scopes/claims, Testing vs Production, redirect URI rules, error shapes
- Short “quick start” for a confidential/public client

**Out of public docs (or clearly marked internal / not for third parties):**

- `/oauth/token-exchange` (AS-internal only)
- Future resource API routes/scopes (not built yet)
- Vault crypto internals

**Copy for LLM behavior (per endpoint/method page):**

- Button label: **Copy for LLM**
- On click: copy a self-contained Markdown blob for that method (title, method + path, summary, auth requirements, params, example request/response, errors) into the clipboard; brief “Copied” feedback
- Works without a backend round-trip if the Markdown is embedded in the page (e.g. `<script type="text/plain">` or `data-` payload); progressive enhancement — page remains readable if JS fails (button no-ops or hidden)
- Do not copy secrets, live tokens, or environment credentials

Serve as first-party Jinja/static docs on the AS host (same origin as issuer). No requirement for a separate docs site in v1.

### Internal links (partial)

Shared footer (and portal nav where authenticated) links among: **Home** · **Docs** · **Portal** · **Settings** · **FAQ** · **Privacy** · **GitHub** · unofficial disclaimer. Auth pages (login/consent) get footer trust links only (Privacy, FAQ, GitHub, open-source line) — no competing primary CTA.

### Titles, meta, images

- **Unique `<title>`** on every HTML page (e.g. `Login · PESU OAuth`, `Consent · …`, `FAQ · …`, `Privacy · …`, `Authorize · Docs · …`).
- **Meta descriptions** only on **public** pages (`/`, `/faq`, `/privacy`, `/docs`…). Omit on login/consent/settings (not meant to be indexed).
- **Alt text** on meaningful images (logo/brand); decorative motion assets use empty `alt=""`.

### FAQ topics (five — copy finalized at implement time)

1. Is this an official PESU / PESU Academy product?
2. Does “Sign in with PESU” store my password?
3. What is Testing vs Production for apps?
4. What is delegated access / the credential vault?
5. How is this different from pesu-auth?

Answers must match architecture ACs (especially identity-only vs vault, Testing gate, unofficial status).

Browser flow session: signed HttpOnly cookie; `Secure` on staging/prod; SameSite appropriate for top-level authorize redirects.

---

## Academy adapter

Module owns:

- `POST https://www.pesuacademy.com/MAcademy/mobile/dispatcher`
- Login → mobile auth token + profile mapping into our claim set
- Session validity / re-login used by vault refresh and token exchange

Behavior:

- Single backend (mobile only). Dispatcher down ⇒ login/exchange fail
- Unit tests use a fake implementing the same port
- Live Academy calls are opt-in integration tests only (never default CI)

Reference behavior: Vision2822/pesu-api and the mobile login approach explored in pesu-dev/auth#152. Reimplement minimally; do not vendor the whole client surface (attendance/results/etc. stay out).

---

## Code layout

```text
src/
  app.py
  config.py
  db/
  academy/
  crypto/          # JWT RS256 + vault envelope
  models/
  repos/
  oidc/
  exchange/
  portal/
  admin/
  settings/
  public/              # privacy, faq, home, 404, robots.txt
  docs_site/           # API/OIDC reference pages + Copy for LLM payloads
  mailer/
  templates/
  static/
```

Repository pattern for Mongo access. FastAPI routers stay thin.

### Dependencies to add (implementation time)

Expected: `httpx`, `pymongo` (sync) or `motor` (async — prefer matching FastAPI async style), `jinja2`, `PyJWT`, `cryptography`, `nanoid`, `python-multipart`, `itsdangerous` (browser session); **dev:** `testcontainers` (+ Docker available in CI).

Ask before adding anything beyond this set.

### Secrets

| Secret                                | Use                    |
| ------------------------------------- | ---------------------- |
| RSA private key / `TOKEN_SIGNING_KEY` | RS256                  |
| `VAULT_MASTER_KEY`                    | Wrap vault DEKs        |
| `TOKEN_EXCHANGE_SECRET`               | Internal exchange auth |
| `SESSION_SECRET`                      | Browser session cookie |
| SMTP app password (optional)          | Gmail backend          |
| `MONGO_X509_CERT_PATH`                | Atlas client PEM       |

Local: `.env` (gitignored). Cloud Run: env from GitHub environment secrets. Never commit PEMs or passwords.

---

## Testing strategy

| Layer        | Backend                        | When                         |
| ------------ | ------------------------------ | ---------------------------- |
| Unit         | Fakes (Academy, repos, mailer) | Always; TDD default          |
| Integration  | Testcontainers Mongo + ASGI    | Default CI `integration`     |
| Atlas smoke  | Real staging URI + X.509 cert  | Opt-in; skip if cert missing |
| Live Academy | Real dispatcher                | Opt-in marker only           |

Testcontainers uses a test-only Mongo URI override; production config continues to hardcode Atlas SRV by `APP_ENV` with X.509.

Coverage gate: **95%** on `src/` for unit suite (existing project rule).

---

## Build order (vertical slices)

1. **Config + Mongo client + health** — `APP_ENV`, X.509 connect path, Testcontainers harness
2. **Discovery + JWKS + RS256 signing**
3. **Authorize → login → consent → token → userinfo** — identity-only + Testing allowlist (MVP thesis); login/consent footers link Privacy/FAQ
4. **Public trust + docs pages** — `/`, `/privacy`, `/faq` (5 Qs), `/docs` (+ per-method pages with **Copy for LLM**), custom 404, `robots.txt`, open-source/GitHub chrome, unique titles + public meta + image alt text
5. **Developer portal + admin Production queue** (`admins` collection)
6. **Delegated vault + consent mode + internal token exchange**
7. **Settings + mailer port** (log backend default locally)

Each slice is TDD’d and independently demoable where possible.

---

## Acceptance mapping

Architecture ACs remain in force. This MVP must satisfy at least:

- AC-001 OIDC without password leak
- AC-002 Testing allowlist
- AC-003 Identity-only leaves no vault row
- AC-004 Consent storage sentence
- AC-005 Production requires admin
- AC-006 Scope least privilege
- AC-007 Failed Academy login is a no-op
- AC-008 Revoke / delete credentials / delete account
- AC-009 Delegated vault + exchange (in scope for this MVP)
- AC-010 pesu-auth unchanged (process — do not modify that repo)
- AC-011 No website scrape

---

## Open items (non-blocking; decide during implementation plan)

- Exact access-token `aud` value once resource API exists (default `client_id` for now)
- Rate-limit numbers for login
- Bootstrap process for first `admins` row (seed script vs manual insert)
- `jti` denylist deferred (access JWT lives ≤1h; revoke kills refresh only)
- Final FAQ answer copy (topics locked; wording reviewed before ship)
- Privacy policy legal wording (unofficial; retention aligned with delete-account / delete-credentials)

---

## Next step

After this spec is approved:

1. Write an implementation plan under `docs/superpowers/plans/`
2. Execute slice-by-slice with TDD
3. Do not implement OIDC endpoints until the plan is approved
