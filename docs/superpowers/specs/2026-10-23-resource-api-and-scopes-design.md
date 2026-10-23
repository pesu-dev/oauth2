# PESU Resource API & Expanded Scopes — Design

**Status:** Implemented (beta; see [Open items](#open-items))
**Date:** 2026-10-23
**Extends:** [OIDC authorization server MVP design](2026-09-03-oidc-authorization-server-design.md)
**Amends:** ADR-0003 in [architecture.md](../../plans/architecture.md) (resource API deployable)

## Goal

Let approved third-party apps read a student's own PESU Academy data (courses, attendance, results, timetable, announcements, assignments, exam seating) through scoped OAuth access tokens, so they stop collecting PESU passwords to scrape it themselves.

## Decisions

| Topic | Decision |
| --- | --- |
| Where the API lives | **In this app**, under `/api/v1/*` (unversioned `/api/*` aliases to the current version). This amends ADR-0003, which planned a separate service calling token exchange. Vault decryption stays isolated in one module, `src/lib/academy/session.ts`; route handlers never touch ciphertext or passwords. |
| Scope naming | `resource:read` (e.g. `attendance:read`). Read-only in v1; no write scopes. |
| Scope registry | `src/lib/oidc/scopes.ts` is the single source of truth for discovery `scopes_supported`, authorize/consent parsing, consent copy, portal/admin pickers and docs. |
| Mode | Any resource scope implies **delegated** mode (the API needs a live Academy session). `mode=identity` with a resource scope is rejected. Identity-only requests behave exactly as before. |
| Approval | Resource scopes are unavailable until an admin approves them per client (`clients.allowed_scopes`). Identity scopes are always allowed. Approving any resource scope enables `delegated_allowed`. |
| Testing apps | May request and use approved resource scopes, but only for their owner and testers (the existing publishing gate). |
| Data minimization | Responses are allowlists: each resource maps a fixed set of output fields from candidate Academy keys. Raw Academy objects (which include parents' contact details, addresses, etc.) are never passed through. |
| Revocation | Every API call re-checks the user (not deleted), the client (not suspended, scope still approved) and the consent (delegated, includes the scope). Revoking in Settings takes effect immediately, not when the 1-hour access JWT expires. |
| Rate limiting | 30 requests/min per student+app (`apiLimiter`), on top of the proxy's per-IP limits, to protect PESU Academy. |
| Excluded in v1 | `change_password`, placement, admin SRN search, `raw_request`, e-learning, daily feedback. Photo (`photo:read`) is planned with images. |

## Scope catalog (v1)

| Scope | Endpoints | Academy action / mode |
| --- | --- | --- |
| `openid`, `profile`, `email`, `phone`, `offline_access` | `/api/v1/userinfo`, ID token | unchanged |
| `courses:read` | `GET /api/v1/semesters`, `GET /api/v1/courses?semester=` | 18 / 1, 18 / 2 |
| `attendance:read` | `GET /api/v1/attendance?semester=` | 18 / 6 |
| `results:read` | `GET /api/v1/results/isa`, `GET /api/v1/results/esa` | 6 / 9, 7 / 3 |
| `timetable:read` | `GET /api/v1/timetable?day=` | 16 / 1 (16 / 2 with `day`) |
| `announcements:read` | `GET /api/v1/announcements?page=` | 20 / 5 |
| `assignments:read` | `GET /api/v1/assignments` | 37 / 1 |
| `seating:read` | `GET /api/v1/seating` | 13 / 3 |

Action/mode codes come from the reverse-engineered mobile app ([Vision2822/pesu-api](https://github.com/Vision2822/pesu-api) `pesu_api/endpoints.py`); the client is reimplemented in-repo, not added as a dependency.

## Flow

1. **Request** — In the portal, a Testing app requests Production and/or resource scopes; a Production app can request scopes alone (`productionRequested: false`). Stored on `production_requests` as `requested_scopes`.
2. **Review** — The admin queue lists requested scopes as checkboxes; only ticked scopes are approved (`approved_scopes`) and merged into `clients.allowed_scopes`. Scope-only requests never change publishing status.
3. **Authorize / consent** — Unapproved resource scopes fail with `invalid_scope`. The consent screen lists a "PESU Academy data" group with plain-language labels and the delegated storage sentence.
4. **Token** — Unchanged; the access JWT's `scope` carries the granted resource scopes.
5. **API call** — `requireScope` (RFC 6750 errors) → `withAcademySession` (reuse cached vault session; on Academy session rejection re-login once and retry) → dispatcher → allowlist normalizer → `{ resource, data, fetched_at }` with `Cache-Control: no-store`.

## Error contract

| Status | `error` | Meaning |
| --- | --- | --- |
| 401 | `invalid_token` | Missing/invalid/expired token, deleted user, suspended client, or revoked consent |
| 403 | `insufficient_scope` | Token or client lacks the scope (`WWW-Authenticate` names it) |
| 403 | `consent_required` | No usable stored credentials; the student must authorize again |
| 400 | `invalid_request` | Unknown or malformed query parameter |
| 429 | `rate_limited` | Per student+app limit hit |
| 501 | `resource_unavailable` | Resource not wired to PESU Academy yet (menu id unknown) |
| 502 | `academy_unavailable` | PESU Academy failed or rejected the call |
| 503 | `temporarily_unavailable` | Vault master key not configured |

## Data model changes

- `clients.allowed_scopes: string[]` (default `[]`).
- `production_requests.production_requested: boolean` (default `true`), `requested_scopes: string[]`, `approved_scopes: string[]`.

Existing documents need no migration: defaults reproduce previous behavior.

## Open items

- **Dispatcher menu ids.** As of 2026-10-23 PESU Academy rejects every dispatcher call without a feature-specific `menuId` ("Menu ID is required"). Only the profile id (`11172`) is known. Until verified ids are added to `RESOURCES` in `src/lib/academy/resources.ts` (or supplied by ops via `ACADEMY_MENU_IDS='{"attendance":"…"}'`), those endpoints answer `501 resource_unavailable`. They are never guessed.
- **Field coverage.** Normalizer candidate keys are based on pesu-api's models and need confirming against live responses from a current student account once menu ids are known.
- **`aud`.** Access tokens keep `aud = client_id`; the resource server lives on the issuer origin, so no separate audience is needed yet.
