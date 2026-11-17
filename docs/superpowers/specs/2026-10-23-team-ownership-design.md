# Team Ownership of Clients — Design

**Status:** Implemented
**Date:** 2026-10-23
**Extends:** [OIDC authorization server MVP design](2026-09-03-oidc-authorization-server-design.md)

## Goal

Clubs outlive any one student developer. Let a team own an OAuth client so several members can manage it, hand it over, and keep it running after the creator graduates.

## Model

- `teams`: `team_id` (`team_…`), `name`, unique `slug`, `created_by_sub`, timestamps, `avatar_id` (reserved).
- `team_members`: unique `(team_id, sub)`, `role` ∈ `owner | admin | developer`, `added_by_sub`.
- `clients`: `owner_type` (`user` default | `team`) and `owner_team_id`. `owner_sub` stays the creator for audit and notifications. Existing clients need no migration (missing `owner_type` = user-owned).

## Permissions (`src/lib/authz/client-access.ts`)

| Action | Creator (user-owned) | Team owner | Team admin | Team developer |
| --- | --- | --- | --- | --- |
| View app, edit redirect URIs, device-flow toggle, manage testers | ✓ | ✓ | ✓ | ✓ |
| Rotate client secret | ✓ | ✓ | ✓ | – |
| Request Production / API scopes | ✓ | ✓ | ✓ | – |
| Counts as a tester while the app is in Testing | ✓ | ✓ | ✓ | ✓ |

Once a team owns a client, the creator has rights only through their team role. All portal routes load the client by id and check `canManageClient`; unauthorized callers get `404` (no existence leak).

## Membership rules

- The creator of a team is its first owner. Only owners and admins can create team-owned clients.
- Owners manage everyone; admins manage non-owners and cannot grant `owner`; developers can only leave.
- A team always keeps at least one owner (cannot remove or demote the last one).
- People are added by PRN, SRN or `usr_` subject and must have signed in once (same rule as testers). They get a notification email.

## Consent

Team-owned apps show **"Published by <team name>"** on the consent and device screens instead of the developer's subject id.
