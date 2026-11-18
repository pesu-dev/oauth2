# Scripts

## `check_version_bump.mjs`

Enforces that `package.json` has a strictly bumped SemVer version relative to the base branch or previous commit.
Used by CI checks on pull requests, merge queue runs, and pushes to `main`.

```bash
node scripts/check_version_bump.mjs
```

## `seed_admin.mjs`

Inserts a `sub` (e.g. `usr_...`) into the MongoDB `admins` collection idempotently.

The script derives the Atlas cluster URI from `APP_ENV` (matching `src/lib/config.ts`).
Set `MONGO_X509_CERT_PATH` to your client PEM when connecting to a non-local cluster.
Override the URI entirely with `MONGODB_URI` if needed.

```bash
# Local (defaults to staging Atlas cluster — set MONGODB_URI to override)
node scripts/seed_admin.mjs --sub usr_...

# Staging / prod with X.509 auth
APP_ENV=staging MONGO_X509_CERT_PATH=/run/secrets/mongo.pem \
  node scripts/seed_admin.mjs --sub usr_...
```
