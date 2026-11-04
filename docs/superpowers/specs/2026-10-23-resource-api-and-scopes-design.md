# PESU Resource API & Expanded Scopes — Design

**Status:** Implemented. Semesters, courses, attendance and results are checked against live PESU Academy data; timetable, announcements, assignments and seating are not yet (see [Open items](#open-items)).
**Date:** 2026-10-23
**Extends:** [OIDC authorization server MVP design](2026-09-03-oidc-authorization-server-design.md)
**Amends:** ADR-0003 in [architecture.md](../../plans/architecture.md) (resource API deployable)

## Goal

Let third-party apps read a student's own PESU Academy data (courses, attendance, results, timetable, announcements, assignments, exam seating) through scoped OAuth access tokens, so they stop collecting PESU passwords to scrape it themselves.

## Decisions

| Topic | Decision |
| --- | --- |
| Where the API lives | **In this app**, under `/api/v1/*` (unversioned `/api/*` aliases to the current version). This amends ADR-0003, which planned a separate service calling token exchange. Vault decryption stays isolated in one module, `src/lib/academy/session.ts`; route handlers never touch ciphertext or passwords. |
| Scope naming | `resource:read` (e.g. `attendance:read`). Read-only in v1; no write scopes. |
| Scope registry | `src/lib/oidc/scopes.ts` is the single source of truth for discovery `scopes_supported`, authorize/consent parsing, consent copy and docs. |
| Mode | Any resource scope implies **delegated** mode (the API needs a live Academy session). `mode=identity` with a resource scope is rejected. Identity-only requests behave exactly as before. |
| Approval | There is no per-scope admin approval: any client may request any scope, and the student allows or denies it on the consent screen. Resource scopes do not need `delegated_allowed`; that flag still gates `mode=delegated` without a resource scope. Admins still review Production publishing and can suspend a client. |
| Testing apps | May request and use resource scopes, but only for their owner and testers (the existing publishing gate). |
| Data minimization | Responses are allowlists: each resource maps a fixed set of output fields from candidate Academy keys. Raw Academy objects (which include parents' contact details, addresses, etc.) are never passed through. |
| Revocation | Every API call re-checks the user (not deleted), the client (not suspended) and the consent (delegated, includes the scope). Revoking in Settings takes effect immediately, not when the 1-hour access JWT expires. |
| Rate limiting | 30 requests/min per student+app (`apiLimiter`), on top of the proxy's per-IP limits, to protect PESU Academy. |
| Excluded in v1 | `change_password`, placement, admin SRN search, `raw_request`, e-learning, daily feedback. Photo (`photo:read`) is planned with images. |

## Scope catalog (v1)

| Scope | Endpoints | Academy action / mode |
| --- | --- | --- |
| `openid`, `profile`, `email`, `phone`, `offline_access` | `/api/v1/userinfo`, ID token | unchanged |
| `courses:read` | `GET /api/v1/semesters`, `GET /api/v1/courses?semester=` | 18 / 1, 18 / 2 |
| `attendance:read` | `GET /api/v1/attendance?semester=` | 18 / 6 |
| `results:read` | `GET /api/v1/results/isa?semester=`, `GET /api/v1/results/esa?semester=` | 7 / 11 for both (ISA marks are nested per course) |
| `timetable:read` | `GET /api/v1/timetable?day=` | 16 / 1 (16 / 2 with `day`) |
| `announcements:read` | `GET /api/v1/announcements?page=` | 20 / 5 |
| `assignments:read` | `GET /api/v1/assignments` | 37 / 1 |
| `seating:read` | `GET /api/v1/seating` | 13 / 3 |

Action/mode codes come from the reverse-engineered mobile app ([Vision2822/pesu-api](https://github.com/Vision2822/pesu-api) `pesu_api/endpoints.py`); the client is reimplemented in-repo, not added as a dependency. Checked against a live account on 2026-11-03, which corrected three things pesu-api has wrong or out of date:

- `semester` is sent to PESU Academy as `batchClassId` (pesu-api's `selectedSemester` returns nothing). Its value is the `id` from `/semesters`. Without it, the latest semester (highest `batchClassOrder`) is used.
- ISA mode 9 and ESA mode 3 return nothing. ESA mode 11 with `batchClassId` returns each course's grade and credits, the semester's SGPA and CGPA, and the ISA marks.
- PESU Academy spells the attendance percentage key `AttendancePercenrage`.

**Menu id.** Every dispatcher call needs a `menuId`. PESU Academy checks that the account can open that menu, but not that it belongs to the action, so the profile menu id (`11172`), which every student has, works for all read actions. The mobile app's other menu ids are not exposed (the web portal's ids are rejected). If PESU Academy starts matching menu ids to actions, these calls fail with `502 academy_unavailable`, and verified ids can be set per resource with `ACADEMY_MENU_IDS='{"attendance":"…"}'` without a code change.

## Flow

1. **Authorize / consent** — The client adds resource scopes to its authorization request. The consent screen lists a "PESU Academy data" group with plain-language labels and the delegated storage sentence, and the student allows or denies. Unknown scopes are dropped.
2. **Token** — Unchanged; the access JWT's `scope` carries the granted resource scopes.
3. **API call** — `requireScope` (RFC 6750 errors) → `withAcademySession` (reuse cached vault session; on Academy session rejection re-login once and retry) → dispatcher → allowlist normalizer → `{ resource, data, fetched_at }` with `Cache-Control: no-store`.

## Error contract

| Status | `error` | Meaning |
| --- | --- | --- |
| 401 | `invalid_token` | Missing/invalid/expired token, deleted user, suspended client, or revoked consent |
| 403 | `insufficient_scope` | Token lacks the scope (`WWW-Authenticate` names it) |
| 403 | `consent_required` | No usable stored credentials; the student must authorize again |
| 400 | `invalid_request` | Unknown or malformed query parameter |
| 429 | `rate_limited` | Per student+app limit hit |
| 501 | `resource_unavailable` | Resource not yet checked against real PESU Academy data |
| 502 | `academy_unavailable` | PESU Academy failed or rejected the call |
| 503 | `temporarily_unavailable` | Vault master key not configured |

## Data model changes

None.

## Open items

- **Timetable, announcements, assignments, seating.** The account used on 2026-11-03 belongs to a student who has graduated, so these returned nothing. They answer `501 resource_unavailable` until checked with a current student's account; then set `menuId` in `RESOURCES` (`src/lib/academy/resources.ts`) and fix their field lists.
- **Attendance figures.** PESU Academy returned held/attended counts for only some courses and older semesters; fields it leaves null are omitted.
- **`aud`.** Access tokens keep `aud = client_id`; the resource server lives on the issuer origin, so no separate audience is needed yet.
