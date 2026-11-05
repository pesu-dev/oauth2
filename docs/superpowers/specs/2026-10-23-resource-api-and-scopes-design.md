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

| Scope | Endpoints | Academy action / mode (`menuId`) |
| --- | --- | --- |
| `openid`, `profile`, `email`, `phone`, `offline_access` | `/api/v1/userinfo`, ID token | unchanged |
| `courses:read` | `GET /api/v1/semesters`, `GET /api/v1/courses?semester=`, `GET /api/v1/courses/syllabus?course=` | 18 / 1 (11100), 18 / 2 (11166), 18 / 11 (11166) |
| `attendance:read` | `GET /api/v1/attendance?semester=` | 18 / 6 (11169) |
| `results:read` | `GET /api/v1/results/isa?semester=`, `GET /api/v1/results/esa?semester=`, `GET /api/v1/results/cgpa` | 53 / 19 (11171) for ISA, 7 / 7 (11162) for ESA, 7 / 6 (11162) for CGPA |
| `timetable:read` | `GET /api/v1/timetable?day=`, `GET /api/v1/calendar` | 16 / 1 (11105, `callMethod=background`; `day` is applied by the server), 14 / 1 (none) |
| `announcements:read` | `GET /api/v1/announcements` | 20 / 7 (none, `instId=1,6`; no paging, the whole feed comes back) |
| `assignments:read` | `GET /api/v1/assignments` | 37 / 1 (pending) |
| `seating:read` | `GET /api/v1/seating` | 44 / 4 `seating_info` (none; pending) |

**Source.** Calls follow the team's PES API field guide (`pes-api-guide-updated.html`, built from sanitized captures of the official mobile app): the same action/mode, `menuId`, semester fields and headers the app sends. Syllabus (18 / 11) and assignments (37 / 1) are not in the guide and come from the reverse-engineered [Vision2822/pesu-api](https://github.com/Vision2822/pesu-api) client. The client is reimplemented in-repo, not added as a dependency. Checked against seven live accounts (current students and graduates) on 2026-11-04. Wire details that matter:

- Each feature has its own `menuId` (above); calendar, announcements and the events/seating call send none. Ops can override any id, or enable a pending resource, with `ACADEMY_MENU_IDS='{"seating":"…"}'` without a code change.
- Calls authenticate with `Authorization: Bearer <accessToken>` and `X-Client-Type: MOBILE` only; no `userId` field is sent.
- `semester` is the `batchClassId` from `/semesters`. ESA alone spells the form field `BatchClassId`. ISA also needs the semester's `classBatchSectionId` and `fetchId=<batchClassId>-<classBatchSectionId>`, so it looks the semester up in the student's semester list; a semester the student does not have returns no rows.
- Without `semester`, the latest semester (highest `batchClassOrder`) is used, except ESA, which uses the latest semester with published results (the first `StudentSemesterWise` row of 7 / 6), because a semester in progress has none.
- ISA rows carry the student's name and login id; the allowlist drops them. PESU Academy spells the attendance percentage key `AttendancePercenrage`.
- The events call (44 / 4) also returns `events`: the calendar's rows for today and tomorrow, identical across campuses and sections, so it adds nothing over `/calendar`.

**Academy sessions.** Login returns a 30-minute access token and a 30-day refresh token. The vault keeps both (sealed) with the access token's expiry; shortly before it lapses, `getAcademySession` renews it at `POST /MAcademy/mobile/mobilelogin/refresh` (JSON `{ refreshToken }`), and logs in with the stored password only if that fails. Academy answers refresh with an empty refresh token, so the old one is kept. Token exchange never returns the refresh token.

**Dates and times.** Instants (`fetched_at`) are ISO 8601 in UTC. Calendar days (`startDate`, `endDate`) are ISO 8601 dates (`2026-08-15`) as observed in IST. Weekly timetable slots have no date, so `start` and `end` are ISO 8601 times with the IST offset (`08:45:00+05:30`); PESU Academy's seconds are not meaningful and are set to `00`.

## Flow

1. **Authorize / consent** — The client adds resource scopes to its authorization request. The consent screen lists a "PESU Academy data" group with plain-language labels and the delegated storage sentence, and the student allows or denies. Unknown scopes are dropped.
2. **Token** — Unchanged; the access JWT's `scope` carries the granted resource scopes.
3. **API call** — `requireScope` (RFC 6750 errors) → `withAcademySession` (reuse the cached vault session until it nears expiry, then renew it with the refresh token or, failing that, a password login; if Academy still rejects it, log in with the password once and retry) → dispatcher → allowlist normalizer → `{ resource, data, fetched_at }` with `Cache-Control: no-store`.

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

- **Assignments, seating.** No account checked on 2026-11-03 and 2026-11-04, current students included, returned data for these. The field guide documents seating only as the empty `seating_info` array of 44 / 4, so its field names are still unknown; it does not cover assignments at all. Both answer `501 resource_unavailable` until a response with data is seen; then drop `pending` in `RESOURCES` (`src/lib/academy/resources.ts`) and fix their field lists.
- **Announcement attachments and banners.** Attachments are paths that only PESU Academy can sign, so only their count is returned. Banner `image` links are pre-signed and expire.
- **Timetable faculty.** PESU Academy leaves `facultyName` null in every timetable seen so far, so `faculty` is mapped but not yet observed.
- **Default semester.** The latest semester is the one with the highest `batchClassOrder`, which can be a minor or summer-term course rather than the main semester (ESA instead defaults to the latest semester with published results); apps should pass `?semester=` from `/api/v1/semesters` when it matters.
- **Attendance figures.** PESU Academy leaves held/attended counts null for courses it does not track (e.g. hackathon courses); those fields are omitted rather than shown as zero.
- **`aud`.** Access tokens keep `aud = client_id`; the resource server lives on the issuer origin, so no separate audience is needed yet.
