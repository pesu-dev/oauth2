# Device Authorization Grant (RFC 8628) — Design

**Status:** Implemented
**Date:** 2026-10-23
**Extends:** [OIDC authorization server MVP design](2026-09-03-oidc-authorization-server-design.md)

## Goal

Let input-constrained clients (club kiosks, TV dashboards, CLIs) sign students in the way GitHub CLI does: the device shows a short code, the student approves on their phone or laptop.

## Flow

1. Device → `POST /oauth2/device_authorization` (`client_id`, optional `client_secret`, `scope`) → `device_code`, `user_code` (`XXXX-XXXX`), `verification_uri` (`/device`), `verification_uri_complete`, `expires_in` (900), `interval` (5).
2. Student → `/device` (login first; `return_to` keeps the code) → the standard consent screen in device mode, showing the code as an anti-phishing check → Allow / Deny (`POST /api/internal/device`).
3. Device polls `POST /oauth2/token` with `grant_type=urn:ietf:params:oauth:grant-type:device_code`:
   `authorization_pending` → `slow_down` (+5 s to the interval when polling early) → tokens, or `access_denied` / `expired_token`.

## Decisions

| Topic | Decision |
| --- | --- |
| Opt-in | Per client: `clients.device_flow_enabled` (portal toggle). Otherwise `unauthorized_client`. |
| Clients | Public (`none`) or confidential; shipped devices should use public clients. |
| Storage | `device_codes`: SHA-256 of the device code, normalized user code (unique), scopes, status, `sub`, `mode`, interval, `last_polled_at`, TTL index on `expires_at`. |
| User code | 8 characters from `BCDFGHJKLMNPQRSTVWXZ` (no vowels or look-alikes, RFC 8628 §6.1); input is case/space/dash-insensitive. |
| Gates | Same as browser consent at approval time: suspension, Testing allowlist, admin-approved resource scopes, delegated vault (credentials captured at login when the code needs them). |
| Single use | Approved codes are claimed with an atomic delete; reuse returns `expired_token`. |
| Tokens | Same minting path as the code grant (`issueTokens`): access JWT, ID token with `openid`, refresh family with `offline_access`. No PKCE (not applicable to RFC 8628). |
| Abuse limits | Per-IP limit on starting flows (20/min) plus the existing token endpoint limit; codes expire after 15 minutes. |
