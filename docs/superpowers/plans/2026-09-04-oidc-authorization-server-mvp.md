# PESU OAuth2 Authorization Server MVP — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Mandatory:** Before every task’s final `git add` / `git commit` step, use **AskUserQuestion** to ask whether to proceed, request changes, or skip the commit. Do not commit without that answer.

**Goal:** Build the identity + delegated vault OIDC authorization server so a third-party client can complete Sign in with PESU (code + PKCE), with Testing→Production, vault, internal token exchange, portal/admin/settings, and public trust/docs pages.

**Architecture:** One FastAPI Cloud Run service; Mongo `oauth2` via repository pattern; in-repo httpx Academy mobile adapter; RS256 JWT access/id tokens + opaque rotating refresh; Jinja2 hosted UI. Deliver in vertical slices matching the approved spec.

**Tech Stack:** Python ≥3.13, uv, FastAPI, uvicorn, pymongo **`AsyncMongoClient`** + FastAPI **`async def`** routes, httpx, Jinja2, PyJWT, cryptography, nanoid, python-multipart, itsdangerous; dev: pytest, pytest-asyncio, testcontainers, httpx2 TestClient, ruff.

**Spec:** [docs/superpowers/specs/2026-09-03-oidc-authorization-server-design.md](../specs/2026-09-03-oidc-authorization-server-design.md)

## Global Constraints

- Issuer URL and Mongo SRV come from `APP_ENV` (`local`|`staging`|`prod`); never from `Host`
- Access/id TTL **1 hour**; refresh **14 days absolute** + rotate on use; auth code **10 minutes**; browser session cookie **30 minutes**
- `sub` = `usr_` + nanoid; never reuse after delete
- PKCE S256 required on `/authorize`; no ROPC; no website scrape
- Identity-only must not write `vault`; delegated writes envelope-encrypted password+session
- Token exchange: `TOKEN_EXCHANGE_SECRET` header; never return PESU password
- Unit coverage ≥95% on `src/`; integration uses Testcontainers Mongo; Atlas X.509 smoke opt-in
- Do not add `pesu-api` package; ask before deps beyond the spec list
- Secrets never committed; use `.env` / `.env.example` placeholders
- Commits: Conventional Commits; **never** run a task’s commit step until AskUserQuestion (or equivalent chat gate) returns Proceed or Skip commit — see Skill usage → Commit policy
- Align env name to spec: `VAULT_MASTER_KEY` (replace any `VAULT_WRAPPING_KEY` placeholder in `.env.example`)

## Skill usage

Executors **must** read and follow a skill when starting work that matches its row. Do not skip because the step “looks obvious.” Paths are relative to the repo unless noted.

### Always on (every task)

| Skill                                                  | Path                                   | Use for                                                                                                    |
| ------------------------------------------------------ | -------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| **subagent-driven-development** or **executing-plans** | Superpowers plugin                     | Drive this plan task-by-task (chosen at session start)                                                     |
| **tdd-workflow**                                       | `.cursor/skills/tdd-workflow/SKILL.md` | RED → GREEN → refactor; no production code before a failing test for that change                           |
| **test-driven-development**                            | Superpowers plugin                     | Same discipline if tdd-workflow is unavailable                                                             |
| **verification-before-completion**                     | Superpowers plugin                     | Before marking any task done — run the stated pytest/ruff commands; no “should pass” claims without output |

### Task-triggered

| When working on…                                                                         | Skill                             | Path                                                                                                |
| ---------------------------------------------------------------------------------------- | --------------------------------- | --------------------------------------------------------------------------------------------------- |
| Tasks **9–12, 14** (login, consent, portal, admin, settings, public HTML, static JS/CSS) | **apple-design**                  | `.cursor/skills/apple-design/SKILL.md`                                                              |
| After Task **9** UI is clickable (and again after **12** / **14**)                       | **click-path-audit**              | `.cursor/skills/click-path-audit/SKILL.md`                                                          |
| After a deployable UI slice exists and human wants visual checks                         | **browser-qa**                    | `.cursor/skills/browser-qa/SKILL.md`                                                                |
| After Tasks **9**, **13**, or **14** (auth, vault, exchange, revoke/delete)              | **review-security**               | Cursor skill `review-security` — run before claiming those tasks complete                           |
| After major slices (recommend: end of **9**, **13**, **16**)                             | **requesting-code-review**        | Superpowers plugin                                                                                  |
| Task **16** / final docs sync                                                            | **living-docs-governance**        | `.cursor/skills/living-docs-governance/SKILL.md`                                                    |
| New architectural decision **not** already in the approved spec                          | **architecture-decision-records** | `.cursor/skills/architecture-decision-records/SKILL.md` — **ask human before** creating `docs/adr/` |

### Do not re-invoke unless scope changes

- brainstorming, product-lens, intent-driven-development, codebase-onboarding — already done for this MVP

### Commit policy (mandatory human gate)

Before the **last step of every task** (the `git add` / `git commit` step):

1. **Stop.** Do not stage or commit yet.
2. Call **AskUserQuestion** (Cursor) with options equivalent to:
   - **Proceed** — stage + commit this task as planned
   - **Changes first** — human will describe edits; apply them, re-verify, then AskUserQuestion again
   - **Skip commit** — leave changes uncommitted; mark task complete only if verification already passed
3. Proceed with git **only** after an explicit Proceed (or Skip commit) answer.
4. If AskUserQuestion is unavailable in the session, ask the same choice in chat and wait — do not treat silence as approval.

This gate applies even when the human previously allowed “autonomous commits” for the session, unless they explicitly revoke this instruction.

## Open items resolved in this plan

| Item               | Resolution                                                                                                    |
| ------------------ | ------------------------------------------------------------------------------------------------------------- |
| Access `aud`       | `client_id` of the requesting client                                                                          |
| Login rate limit   | 10 POSTs / minute / client IP (in-memory for single instance; document Cloud Run multi-instance caveat)       |
| First admin        | `uv run python -m scripts.seed_admin --sub usr_…` inserts into `admins`                                       |
| `jti` denylist     | Deferred; revoke refresh only                                                                                 |
| FAQ / privacy copy | Draft English in templates during Tasks 10–11; human review before prod                                       |
| Mongo driver       | **pymongo `AsyncMongoClient`** + FastAPI **`async def`** route handlers (revised 2026-09-04; was sync for v1) |

## File structure (target)

```text
src/
  app.py                 # create_app(), router includes, exception handlers, 404
  config.py              # Settings / ENVIRONMENTS
  deps.py                # FastAPI dependencies (db, repos, session, config)
  db/
    client.py            # MongoClient factory (X.509 or URI override for tests)
    indexes.py           # ensure_indexes()
  academy/
    port.py              # Protocol / ABC
    client.py            # httpx mobile dispatcher
    fake.py              # test double
    models.py            # AcademyProfile, AcademySession
  crypto/
    jwt_keys.py          # load RSA, kid, JWKS
    tokens.py            # sign/verify access + id tokens
    vault_crypto.py      # envelope encrypt/decrypt
    hashing.py           # sha256_hex for codes/refresh/secrets
    ids.py               # new_sub(), new_token(), new_client_id()
  models/                # dataclasses / TypedDicts for documents
  repos/                 # one module per collection
  oidc/
    discovery.py
    jwks.py
    authorize.py
    token.py
    userinfo.py
    revoke.py
    pkce.py
    scopes.py
  exchange/
    router.py
  portal/
    router.py
  admin/
    router.py
  settings_ui/
    router.py
  public/
    router.py            # /, /privacy, /faq, robots, 404 helper
  docs_site/
    router.py            # /docs + method pages
    content.py           # markdown blobs for Copy for LLM
  mailer/
    port.py
    log.py
    smtp.py
  session_cookie.py      # itsdangerous URLSafeTimedSerializer
  templates/
  static/
scripts/
  seed_admin.py
tests/
  unit/...
  integration/
    conftest_mongo.py    # testcontainers fixture
    test_*.py
```

---

### Task 1: Config module (`APP_ENV`, TTLs, secrets)

**Files:**

- Create: `src/config.py`
- Modify: `.env.example`
- Test: `tests/unit/test_config.py`

**Interfaces:**

- Produces: `AppConfig` dataclass; `load_config() -> AppConfig`; `ENVIRONMENTS` map with `mongo_uri`, `issuer_url` per technical plan

- [ ] **Step 1: Write the failing test**

```python
# tests/unit/test_config.py
import os
import pytest
from src.config import load_config


@pytest.mark.unit
def test_default_app_env_is_local(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("APP_ENV", raising=False)
    cfg = load_config()
    assert cfg.app_env == "local"
    assert cfg.issuer_url == "http://localhost:8080"
    assert cfg.db_name == "oauth2"
    assert cfg.access_token_ttl_seconds == 3600
    assert cfg.refresh_token_ttl_seconds == 14 * 24 * 3600
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest tests/unit/test_config.py::test_default_app_env_is_local -v`  
Expected: FAIL (module missing)

- [ ] **Step 3: Write minimal implementation**

Implement `src/config.py` with hardcoded `ENVIRONMENTS` from technical plan (`prod` / `staging` / `local` SRV + issuer URLs), TTLs from spec, fields for secret paths/env names (`token_signing_key_pem`, `vault_master_key`, `token_exchange_secret`, `session_secret`, `mongo_x509_cert_path`, optional SMTP). Read secrets from env; allow missing secrets in `local` only where tests inject them. Reject unknown `APP_ENV`.

- [ ] **Step 4: Run test to verify it passes**

Run: `uv run pytest tests/unit/test_config.py -v`  
Expected: PASS

- [ ] **Step 5: Update** `.env.example`

Document `APP_ENV`, `MONGO_X509_CERT_PATH`, `TOKEN_SIGNING_KEY`, `VAULT_MASTER_KEY`, `TOKEN_EXCHANGE_SECRET`, `SESSION_SECRET`, SMTP vars. Remove `VAULT_WRAPPING_KEY` if present.

- [ ] **Step 6: AskUserQuestion, then commit if Proceed**

```bash
git add src/config.py tests/unit/test_config.py .env.example
git commit -m "$(cat <<'EOF'
feat: add APP_ENV config and token TTL constants

EOF
)"
```

---

### Task 2: Crypto helpers — ids, hashing, RSA JWT

**Files:**

- Create: `src/crypto/ids.py`, `src/crypto/hashing.py`, `src/crypto/jwt_keys.py`, `src/crypto/tokens.py`
- Modify: `pyproject.toml` (add `PyJWT`, `cryptography`, `nanoid`)
- Test: `tests/unit/test_crypto_ids.py`, `tests/unit/test_crypto_tokens.py`

**Interfaces:**

- Produces: `new_sub() -> str` (`usr_` + nanoid); `sha256_hex(value: str) -> str`; `JwtKeySet.from_pem(pem: str, kid: str)`; `sign_access_token(...)`, `sign_id_token(...)`, `verify_access_token(...) -> dict`; JWKS dict via `keyset.public_jwks()`

- [ ] **Step 1: Add dependencies**

```bash
uv add PyJWT cryptography nanoid
```

- [ ] **Step 2: Write failing tests for** `new_sub` **and token round-trip**

```python
@pytest.mark.unit
def test_new_sub_has_prefix() -> None:
    from src.crypto.ids import new_sub

    s = new_sub()
    assert s.startswith("usr_")
    assert s != new_sub()


@pytest.mark.unit
def test_access_token_round_trip(rsa_pem: str) -> None:
    from src.crypto.jwt_keys import JwtKeySet
    from src.crypto.tokens import sign_access_token, verify_access_token

    keys = JwtKeySet.from_pem(rsa_pem, kid="test-1")
    token = sign_access_token(
        keys,
        issuer="http://localhost:8080",
        sub="usr_abc",
        client_id="cli_1",
        scope="openid profile",
        ttl_seconds=3600,
    )
    claims = verify_access_token(token, keys, issuer="http://localhost:8080")
    assert claims["sub"] == "usr_abc"
    assert claims["aud"] == "cli_1"
    assert claims["client_id"] == "cli_1"
    assert "jti" in claims
```

Provide `rsa_pem` fixture generating an ephemeral RSA key in `tests/conftest.py` or the crypto test module.

- [ ] **Step 3: Run tests — expect FAIL**

Run: `uv run pytest tests/unit/test_crypto_ids.py tests/unit/test_crypto_tokens.py -v`

- [ ] **Step 4: Implement crypto modules (RS256 only; pluggable keyset type for later algs)**

- [ ] **Step 5: Run tests — expect PASS**

- [ ] **Step 6: AskUserQuestion, then commit if Proceed**

```bash
git commit -m "feat: add sub generator and RS256 JWT helpers"
```

---

### Task 3: Mongo client factory + Testcontainers harness

**Files:**

- Create: `src/db/client.py`, `src/db/indexes.py`
- Modify: `pyproject.toml` (add `pymongo`, dev `testcontainers`)
- Modify: `tests/conftest.py`, create `tests/integration/conftest.py`
- Test: `tests/integration/test_mongo_indexes.py`
- Modify: CI workflow if needed so Docker is available for integration job

**Interfaces:**

- Produces: `async def get_database(config: AppConfig, mongo_uri_override: str | None = None) -> AsyncDatabase` (pymongo `AsyncMongoClient`)
- When `mongo_uri_override` set (tests): connect without X.509
- When unset: X.509 via `MONGO_X509_CERT_PATH` / default path as technical plan
- `async def ensure_indexes(db) -> None`
- Later OIDC/portal routes: **`async def`** handlers (not sync `def`)

- [ ] **Step 1: Add deps**

```bash
uv add pymongo
uv add --dev testcontainers
```

- [ ] **Step 2: Write integration test using Testcontainers**

```python
@pytest.mark.integration
@pytest.mark.asyncio
async def test_ensure_indexes_creates_users_sub_unique(mongo_db) -> None:
    from src.db.indexes import ensure_indexes

    await ensure_indexes(mongo_db)
    indexes = await mongo_db.users.index_information()
    assert any("sub" in str(v.get("key")) for v in indexes.values())
```

Fixture `mongo_db`: start `MongoDBContainer`, yield async DB via `AsyncMongoClient(uri)[db_name]`, stop container.

- [ ] **Step 3: Run — expect FAIL**

Run: `uv run pytest tests/integration/test_mongo_indexes.py -v`

- [ ] **Step 4: Implement** `get_database` **+** `ensure_indexes` for collections in the spec (unique `users.sub`, `clients.client_id`, `vault.sub`, TTL on `authorization_codes`, unique refresh hash, unique tester/consent pairs, unique `admins.sub`)

- [ ] **Step 5: Run — expect PASS**

- [ ] **Step 6: Opt-in Atlas smoke**

```python
@pytest.mark.integration
@pytest.mark.atlas_smoke
def test_atlas_x509_ping() -> None: ...
```

Skip unless `MONGO_X509_CERT_PATH` exists and `RUN_ATLAS_SMOKE=1`.

- [ ] **Step 7: AskUserQuestion, then commit if Proceed**

```bash
git commit -m "feat: add Mongo client, indexes, and Testcontainers harness"
```

---

### Task 4: App factory wiring config + health + lifespan indexes

**Files:**

- Modify: `src/app.py`, `src/__main__.py` if needed, `tests/conftest.py`
- Test: `tests/unit/test_health.py` (keep green), `tests/unit/test_app_factory.py`

**Interfaces:**

- Produces: `create_app(config: AppConfig | None = None, mongo_uri_override: str | None = None) -> FastAPI`
- Store `config` and `db` on `app.state`
- Default module-level `app = create_app()` for uvicorn

- [ ] **Step 1: Failing test — create_app attaches config**

```python
@pytest.mark.unit
def test_create_app_exposes_config() -> None:
    from src.app import create_app
    from src.config import load_config

    application = create_app(load_config())
    assert application.state.config.issuer_url == "http://localhost:8080"
```

- [ ] **Step 2: Implement** `create_app`**; keep** `/health`

For unit tests without Mongo: allow `mongo_uri_override=None` and lazy db, or inject a fake. Prefer: unit tests that need no DB don't call lifespan connect; integration tests use Testcontainers URI.

- [ ] **Step 3: Update** `tests/conftest.py` **to use** `create_app()`

- [ ] **Step 4: Run unit suite**

Run: `uv run pytest -m unit --cov=src --cov-fail-under=95`

- [ ] **Step 5: AskUserQuestion, then commit if Proceed**

```bash
git commit -m "refactor: introduce FastAPI app factory with config state"
```

---

### Task 5: Discovery + JWKS endpoints

**Files:**

- Create: `src/oidc/discovery.py`, `src/oidc/jwks.py`
- Modify: `src/app.py` (include routers)
- Test: `tests/unit/test_discovery.py`, `tests/unit/test_jwks.py`

**Interfaces:**

- Produces: `GET /.well-known/openid-configuration`, `GET /jwks.json`
- Discovery `issuer` and endpoint URLs derived only from `config.issuer_url`

- [ ] **Step 1: Failing tests**

```python
@pytest.mark.unit
def test_discovery_issuer_from_config(client: TestClient) -> None:
    r = client.get("/.well-known/openid-configuration")
    assert r.status_code == 200
    body = r.json()
    assert body["issuer"] == "http://localhost:8080"
    assert body["authorization_endpoint"] == "http://localhost:8080/authorize"
    assert "S256" in body["code_challenge_methods_supported"]
    assert "RS256" in body["id_token_signing_alg_values_supported"]
```

Use test app with ephemeral RSA key in env/fixture.

- [ ] **Step 2: Implement routers; wire signing key from config**

- [ ] **Step 3: PASS; then AskUserQuestion, then commit if Proceed**

```bash
git commit -m "feat: add OIDC discovery and JWKS endpoints"
```

---

### Task 6: Academy port + httpx client + fake

**Files:**

- Create: `src/academy/port.py`, `src/academy/models.py`, `src/academy/client.py`, `src/academy/fake.py`
- Modify: `pyproject.toml` (`httpx`)
- Test: `tests/unit/test_academy_client.py` (respx or httpx mock transport)

**Interfaces:**

- Produces:

```python
class AcademyClient(Protocol):
    def login(self, username: str, password: str) -> AcademyAuthResult: ...
```

`AcademyAuthResult` has `profile: AcademyProfile` and `session: AcademySession` (token + expiry if known).  
`FakeAcademyClient` maps credentials → result or raises `AcademyAuthError`.  
Real client: `POST https://www.pesuacademy.com/MAcademy/mobile/dispatcher` with action/mode from pesu-api / auth#152 research — implement **login + profile fields only**.

- [ ] **Step 1:** `uv add httpx`

- [ ] **Step 2: Failing unit test with MockTransport returning a fixture payload**

- [ ] **Step 3: Implement port, fake, and real client**

- [ ] **Step 4: Opt-in live test marked** `@pytest.mark.live_academy` **skipped by default**

- [ ] **Step 5: AskUserQuestion, then commit if Proceed**

```bash
git commit -m "feat: add PESU Academy mobile dispatcher adapter"
```

---

### Task 7: Repos for users, clients, testers, codes, refresh, consents

**Files:**

- Create: `src/models/*.py`, `src/repos/*.py`
- Test: `tests/unit/test_repos_users.py` (mongomock **not** required — use Fake in-memory repos for unit; Testcontainers for integration)

**Interfaces:**

- Produces: `UserRepo`, `ClientRepo`, `TesterRepo`, `AuthCodeRepo`, `RefreshTokenRepo`, `ConsentRepo` with methods used by OIDC flows (`upsert_user_from_profile`, `get_client`, `is_tester`, `store_code`, `consume_code`, `store_refresh`, `rotate_refresh`, `get_consent`, `upsert_consent`)

- [ ] **Step 1: Define in-memory fakes implementing the same protocols for unit tests**
- [ ] **Step 2: Integration tests against Testcontainers for unique constraints + TTL field presence**
- [ ] **Step 3: Implement Mongo repos**
- [ ] **Step 4: AskUserQuestion, then commit if Proceed**

```bash
git commit -m "feat: add Mongo repositories for OIDC persistence"
```

---

### Task 8: Session cookie + PKCE + scope helpers

**Files:**

- Create: `src/session_cookie.py`, `src/oidc/pkce.py`, `src/oidc/scopes.py`
- Modify: `pyproject.toml` (`itsdangerous`, `python-multipart`)
- Test: `tests/unit/test_pkce.py`, `tests/unit/test_session_cookie.py`, `tests/unit/test_scopes.py`

**Interfaces:**

- `verify_s256(challenge: str, verifier: str) -> bool`
- `parse_scopes(requested: str) -> frozenset[str]` — only allow known v1 scopes; `openid` required for OIDC
- `SessionStore` dump/load login pending state (client_id, redirect_uri, scopes, challenge, mode, authenticated sub, etc.) with 30-minute max_age

- [ ] **Step 1–4: TDD implement**
- [ ] **Step 5: AskUserQuestion, then commit if Proceed**

```bash
git commit -m "feat: add PKCE, scope parsing, and browser session cookies"
```

---

### Task 9: Authorize + login + consent + token + userinfo (identity-only + Testing)

**Files:**

- Create: `src/oidc/authorize.py`, `src/oidc/token.py`, `src/oidc/userinfo.py`, templates for login/consent/error
- Modify: `src/app.py`, `src/static/` minimal CSS/JS (Apple-design press feedback + reduced motion)
- Test: `tests/unit/test_authorize_flow.py`, `tests/integration/test_oidc_code_flow.py`

**Interfaces:**

- `GET /authorize` — validate client, redirect_uri, PKCE S256, scopes; start session; redirect to login
- `GET/POST /login` — Academy login; on failure no user write; on success apply Testing gate; then consent or issue code
- `GET/POST /consent` — identity storage sentence; on Allow store consent (mode identity), issue redirect with code; discard password/session
- `POST /token` — auth code + verifier; or refresh rotation
- `GET/POST /userinfo` — bearer access JWT

**AC coverage:** AC-001, AC-002, AC-003, AC-004 (identity), AC-006, AC-007

- [ ] **Step 1: Write failing integration test for full code+PKCE happy path with FakeAcademy + Testcontainers**

```python
@pytest.mark.integration
def test_identity_code_flow_issues_tokens_without_vault(oidc_client, mongo_db, fake_academy):
    # register testing client + tester
    # GET /authorize → follow login → consent allow → extract code
    # POST /token → assert access_token, id_token, refresh_token
    # assert mongo_db.vault.count_documents({}) == 0
    # userinfo returns profile claims only for granted scopes
```

- [ ] **Step 2: Write failing tests for Testing deny (non-tester), bad password no-op, missing PKCE**

- [ ] **Step 3: Implement minimal HTML templates (unique titles; footer links to** `/privacy`**,** `/faq`**, GitHub even if pages stubbed)**

- [ ] **Step 4: Implement routers until tests pass**

- [ ] **Step 5: Rate-limit login POST (10/min/IP)**

- [ ] **Step 6: Run unit + integration**

```bash
uv run pytest -m unit --cov=src --cov-fail-under=95
uv run pytest -m integration
```

- [ ] **Step 7: AskUserQuestion, then commit if Proceed**

```bash
git commit -m "feat: implement OIDC authorize, login, consent, token, userinfo"
```

---

### Task 10: Public pages — home, privacy, FAQ, robots, 404

**Files:**

- Create: `src/public/router.py`, templates `home.html`, `privacy.html`, `faq.html`, `404.html`
- Modify: `src/app.py` (exception handler for 404 HTML)
- Test: `tests/unit/test_public_pages.py`

**Content requirements:**

- Open source MIT + link `https://github.com/pesu-dev/oauth2` on home, privacy, FAQ, footer
- Exactly 5 FAQ topics from spec (draft answers aligned with ACs)
- Privacy covers transient vs vault password, consents, tokens, email, delete flows, unofficial disclaimer
- Unique titles; meta descriptions on these public pages
- `GET /robots.txt` disallows auth surfaces; allows `/`, `/faq`, `/privacy`, `/docs`

- [ ] **Step 1: Failing tests for 200 + title + GitHub link + robots disallow** `/authorize`
- [ ] **Step 2: Implement**
- [ ] **Step 3: AskUserQuestion, then commit if Proceed**

```bash
git commit -m "feat: add public home, privacy, FAQ, robots.txt, and 404"
```

---

### Task 11: API docs site + Copy for LLM

**Files:**

- Create: `src/docs_site/router.py`, `src/docs_site/content.py`, templates under `templates/docs/`
- Create: `src/static/js/copy_for_llm.js`
- Test: `tests/unit/test_docs_site.py`

**Content:** Pages for discovery, authorize, token, userinfo, revoke, JWKS, scopes/claims, quick start. Do **not** document token-exchange as a third-party API (omit or page marked internal-only and excluded from public nav).

**Copy for LLM:** Each method page embeds Markdown in `<script type="text/markdown" id="llm-md">`; button copies via JS; “Copied” feedback; hide/no-op if JS unavailable.

- [ ] **Step 1: Failing test —** `/docs` **200; authorize page contains** `Copy for LLM` **and embedded markdown with** `GET /authorize`

- [ ] **Step 2: Implement**

- [ ] **Step 3: AskUserQuestion, then commit if Proceed**

```bash
git commit -m "feat: add OIDC API docs with Copy for LLM"
```

---

### Task 12: Developer portal + admins + Production queue

**Files:**

- Create: `src/portal/router.py`, `src/admin/router.py`, `src/repos/admins.py`, `src/repos/production_requests.py`, `scripts/seed_admin.py`
- Templates for portal/admin
- Test: `tests/unit/test_portal.py`, `tests/integration/test_production_gate.py`

**Behavior:**

- Portal login via same PESU login (session)
- Create client → `publishing_status=testing`, show secret once, manage redirect URIs + testers
- Request Production → `pending_production` + `production_requests` row
- Admin (sub in `admins`) approve → `production`; reject → back to `testing`; optional `delegated_allowed`
- Developer cannot self-set Production (AC-005)

- [ ] **Step 1: Failing tests for create client + admin approve unlocks non-tester authorize**
- [ ] **Step 2: Implement seed script**

```bash
uv run python -m scripts.seed_admin --sub usr_xxx
```

- [ ] **Step 3: Implement portal/admin**

- [ ] **Step 4: AskUserQuestion, then commit if Proceed**

```bash
git commit -m "feat: add developer portal and admin Production queue"
```

---

### Task 13: Vault crypto + delegated consent + token exchange

**Files:**

- Create: `src/crypto/vault_crypto.py`, `src/repos/vault.py`, `src/exchange/router.py`
- Modify: consent templates (delegated storage sentence), authorize/consent flow for mode
- Test: `tests/unit/test_vault_crypto.py`, `tests/integration/test_delegated_exchange.py`

**Interfaces:**

- `seal(master_key: bytes, plaintext: bytes, key_version: int) -> SealedBlob`
- `open(master_key: bytes, blob: SealedBlob) -> bytes`
- `POST /oauth/token-exchange` requires header `X-Token-Exchange-Secret: …` (or `Authorization: Bearer <TOKEN_EXCHANGE_SECRET>`) matching config; validates access JWT; requires delegated consent; returns Academy session material only

**AC coverage:** AC-003 (still no vault on identity), AC-004 delegated copy, AC-009

- [ ] **Step 1: Failing vault round-trip unit test**

- [ ] **Step 2: Failing integration — delegated allow writes vault; exchange returns session; password not in response; identity flow still vault-empty**

- [ ] **Step 3: Implement**

- [ ] **Step 4: AskUserQuestion, then commit if Proceed**

```bash
git commit -m "feat: add delegated vault and internal token exchange"
```

---

### Task 14: Revoke + settings (revoke app, delete credentials, delete account)

**Files:**

- Create: `src/oidc/revoke.py`, `src/settings_ui/router.py`
- Test: `tests/integration/test_settings_lifecycle.py`

**AC coverage:** AC-008

- [ ] **Step 1: Failing tests — revoke refresh fails subsequent refresh; delete credentials drops vault only; delete account tombsstones sub and rejects reuse**

- [ ] **Step 2: Implement**

- [ ] **Step 3: AskUserQuestion, then commit if Proceed**

```bash
git commit -m "feat: add token revocation and student settings lifecycle"
```

---

### Task 15: Mailer port (log backend default)

**Files:**

- Create: `src/mailer/port.py`, `src/mailer/log.py`, `src/mailer/smtp.py`
- Hook send points: Production request/decision, revoke, delete credentials/account (fail-open)
- Test: `tests/unit/test_mailer.py`

- [ ] **Step 1: Failing test — LogMailer records message; SMTP backend selected only when SMTP env present**
- [ ] **Step 2: Implement; ensure consent Allow never raises on mail failure**
- [ ] **Step 3: AskUserQuestion, then commit if Proceed**

```bash
git commit -m "feat: add mailer port with log backend and optional SMTP"
```

---

### Task 16: CI + docs polish

**Files:**

- Modify: `.github/workflows/*` for Docker/testcontainers on integration; `tests/README.md`; `README.md` status table; `AGENTS.md` if commands change
- Verify: `uv run ruff check .`, `uv run ruff format . --check`, unit cov 95%, integration green

- [x] **Step 1: Ensure CI integration job has Docker**
- [x] **Step 2: Update human docs to point at spec + this plan; mark stub status outdated**
- [x] **Step 3: Full quality gates**

```bash
uv run ruff check .
uv run ruff format . --check
uv run -m compileall -q src tests
uv run pytest -m unit --cov=src --cov-report=term-missing --cov-fail-under=95
uv run pytest -m integration
```

- [x] **Step 4: AskUserQuestion, then commit if Proceed** (implementer: DO NOT commit)

```bash
git commit -m "ci: enable Testcontainers integration and refresh docs"
```

---

## Spec coverage checklist

| Spec area                                       | Task(s)                           |
| ----------------------------------------------- | --------------------------------- |
| Config / issuer / TTLs                          | 1                                 |
| RS256 JWT / JWKS / discovery                    | 2, 5                              |
| Mongo + Testcontainers + Atlas smoke            | 3                                 |
| Academy adapter                                 | 6                                 |
| OIDC code+PKCE identity + Testing               | 7–9                               |
| Public HTML + robots + FAQ + privacy + OSS link | 10                                |
| API docs + Copy for LLM                         | 11                                |
| Portal + admin Production                       | 12                                |
| Vault + exchange                                | 13                                |
| Revoke + settings                               | 14                                |
| Mailer                                          | 15                                |
| CI / docs                                       | 16                                |
| AC-010 pesu-auth unchanged                      | process — do not modify that repo |
| AC-011 no scrape                                | Task 6 single backend             |

## Plan self-review notes

- No Stedi references
- `VAULT_MASTER_KEY` naming aligned to spec
- Token exchange excluded from public docs nav
- Commits gated by AskUserQuestion before every task’s final git step
