# Images (Logos, Avatars, Student Photo) — Design

**Status:** Implemented
**Date:** 2026-10-23

## Goal

Let apps show a logo on the consent screen so students recognize who they are signing in to, and let teams have an avatar in the portal. Expose the student's own photo to approved apps without storing it.

## Storage (the infra question)

Images live in a Mongo `images` collection (`image_id`, `kind`, `owner_ref`, `mime`, `data`, `bytes`, `width`, `height`, `sha256`, `created_by_sub`). No object storage, CDN or new Render service is needed: uploads are capped at **256 KB**, so a club-scale deployment stays far below Atlas limits. If volume grows, `src/lib/image-store.ts` and `/img/:id` are the only places to change for an S3-style backend.

## Validation

- PNG, JPEG or WebP only, detected from **magic bytes** (the declared content type is ignored). SVG is refused because it can carry script.
- 64–2048 px on each side; dimensions are read from the file header (no image library dependency).
- No re-encoding in v1 (a library such as `sharp` would be a new dependency).

## Serving

`GET /img/:id` returns the stored bytes with `Cache-Control: public, max-age=31536000, immutable` (every upload gets a new id), `X-Content-Type-Options: nosniff`, `Content-Security-Policy: default-src 'none'; sandbox` and `Cross-Origin-Resource-Policy: same-site`.

## Client logos

- Uploaded in the portal by anyone with `edit` rights on the client; replacing deletes the previous image.
- **Shown on consent and device sign-in only after admin approval** (Admin → Logo Reviews). New uploads reset to `pending`. This stops apps impersonating PESU, PES University or other clubs. Owners are emailed the outcome.

## Team avatars

Team owners/admins upload an avatar shown in the portal (team cards and the team page). Avatars never appear on consent, so they need no review.

## Student photo

`photo:read` (sensitive resource scope, admin approval + delegated consent) adds a `picture` claim pointing to `GET /api/v1/photo`, which fetches the photo live from PESU Academy through the vault session and returns it with `Cache-Control: private, no-store`. The photo is never stored by this service.
