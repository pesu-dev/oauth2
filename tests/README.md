# Test Suite

This repository uses [Vitest](https://vitest.dev/) for unit testing.

## Running Tests

```bash
# Run all unit tests
pnpm test

# Run tests in watch mode
pnpm vitest
```

## Structure

- `tests/unit/`:
  - `academy.test.ts`: PESU Academy Axios client authentication and profile parsing.
  - `claims.test.ts`: OIDC standard scopes and claims mapper.
  - `config.test.ts`: Zod configuration schema validation and defaults.
  - `crypto.test.ts`: Envelope encryption (DEK wrapping with AES-256-GCM) and PKCE S256 verification.
  - `discovery.test.ts`: OpenID Connect discovery document schema and endpoints.
  - `id.test.ts`: Prefixed Nanoid generators (`usr_`, `cli_`, `sec_`, `code_`, `rt_`, `fam_`, `req_`).
  - `jwt.test.ts`: RS256 token minting, JWKS export, and token verification.
  - `models.test.ts`: Mongoose schema validation for User, Client, Consent, Vault, AuthCode, RefreshToken, ProductionRequest, and Admin.
  - `proxy.test.ts`: Next.js Edge proxy security headers and session route guards.
  - `session.test.ts`: Signed HS256 session token cookies and verification.
