# PESU Resource API & Expanded Scopes — Design

**Status:** Implemented. Semesters, courses, syllabus, attendance, results, calendar, timetable and announcements are checked against live PESU Academy data; assignments and seating are not yet (see [Open items](#open-items)).
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
| Excluded in v1 | `change_password`, placement, admin SRN search, `raw_request`, e-learning, course notes and files, daily feedback. From the profile record: parents' names and contacts, addresses, blood group, admission quota, entrance exam rank and school marks. Photo (`photo:read`) is planned with images. |

## Scope catalog (v1)

| Scope | Endpoints | Academy action / mode |
| --- | --- | --- |
| `openid`, `profile`, `email`, `phone`, `offline_access` | `/api/v1/userinfo`, ID token | unchanged |
| `courses:read` | `GET /api/v1/semesters`, `GET /api/v1/courses?semester=`, `GET /api/v1/courses/syllabus?course=` | 18 / 1, 18 / 2, 18 / 11 |
| `attendance:read` | `GET /api/v1/attendance?semester=` | 18 / 6 |
| `results:read` | `GET /api/v1/results/isa?semester=`, `GET /api/v1/results/esa?semester=`, `GET /api/v1/results/cgpa` | 7 / 11 for ISA and ESA (ISA marks are nested per course), 7 / 6 for CGPA |
| `timetable:read` | `GET /api/v1/timetable?day=`, `GET /api/v1/calendar` | 16 / 1 (`day` is applied by the server; 16 / 2 returns nothing), 14 / 1 |
| `announcements:read` | `GET /api/v1/announcements` | 20 / 7 (pesu-api's 20 / 5 returns nothing; `pageNo` is ignored, so the whole feed comes back) |
| `assignments:read` | `GET /api/v1/assignments` | 37 / 1 |
| `seating:read` | `GET /api/v1/seating` | 13 / 3 |

Action/mode codes come from the reverse-engineered mobile app ([Vision2822/pesu-api](https://github.com/Vision2822/pesu-api) `pesu_api/endpoints.py`); the client is reimplemented in-repo, not added as a dependency. Checked against a live account on 2026-11-03, which corrected three things pesu-api has wrong or out of date:

- `semester` is sent to PESU Academy as `batchClassId` (pesu-api's `selectedSemester` returns nothing). Its value is the `id` from `/semesters`. Without it, the latest semester (highest `batchClassOrder`) is used.
- ISA mode 9 and ESA mode 3 return nothing. ESA mode 11 with `batchClassId` returns each course's grade and credits, the semester's SGPA and CGPA, and the ISA marks.
- PESU Academy spells the attendance percentage key `AttendancePercenrage`.
- For the semester in progress, ESA mode 11 has no per-course results; its ISA marks come as flat rows under `Current_SEMESTERWISE`, which `/results/isa` reads too.

**Menu id.** Every dispatcher call needs a `menuId`. PESU Academy checks that the account can open that menu, but not that it belongs to the action, so the profile menu id (`11172`), which every student has, works for all read actions. The mobile app's other menu ids are not exposed (the web portal's ids are rejected). If PESU Academy starts matching menu ids to actions, these calls fail with `502 academy_unavailable`, and verified ids can be set per resource with `ACADEMY_MENU_IDS='{"attendance":"…"}'` without a code change.

**Dates and times.** Instants (`fetched_at`) are ISO 8601 in UTC. Calendar days (`startDate`, `endDate`) are ISO 8601 dates (`2026-08-15`) as observed in IST. Weekly timetable slots have no date, so `start` and `end` are ISO 8601 times with the IST offset (`08:45:00+05:30`); PESU Academy's seconds are not meaningful and are set to `00`.

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

- **Assignments, seating.** No account checked on 2026-11-03 and 2026-11-04, including current students, returned data for these in any mode (assignments mode 3 and seating mode 5 answer HTTP 500; assignments mode 5 returns only the list of assignment types).
- **Announcement attachments and banners.** Attachments are paths that only PESU Academy can sign, so only their count is returned. Banner `image` links are pre-signed and expire. They answer `501 resource_unavailable` until checked with an account that has some; then set `menuId` in `RESOURCES` (`src/lib/academy/resources.ts`) and fix their field lists.
- **Timetable faculty.** PESU Academy leaves `facultyName` null in every timetable seen so far, so `faculty` is mapped but not yet observed.
- **Default semester.** The latest semester is the one with the highest `batchClassOrder`, which can be a minor or summer-term course rather than the main semester; apps should pass `?semester=` from `/api/v1/semesters` when it matters.
- **Attendance figures.** PESU Academy returned held/attended counts for only some courses and older semesters; fields it leaves null are omitted.
- **`aud`.** Access tokens keep `aud = client_id`; the resource server lives on the issuer origin, so no separate audience is needed yet.
