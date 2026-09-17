# Scripts

## `next_semver.py`

Prints the next `MAJOR.MINOR.PATCH` version by bumping the latest git tag that
matches exact `vMAJOR.MINOR.PATCH` (prerelease / junk `v*` tags are skipped).
Pass `--merged COMMIT` to ignore tags that are not ancestors of that commit.
Used by the production promote workflow.

```bash
python3 scripts/next_semver.py --bump patch
python3 scripts/next_semver.py --bump minor --merged HEAD
python3 scripts/next_semver.py --bump major
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
