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

```bash
node scripts/seed_admin.mjs --sub usr_...
```
