"""Structured OIDC API documentation content."""

from __future__ import annotations

from src.docs_site.models import (
    DocTable,
    ErrorDoc,
    MethodDoc,
    Param,
    ReferenceDoc,
    RefSection,
)

GITHUB_URL = "https://github.com/pesu-dev/oauth2"

INDEX_META_DESCRIPTION = (
    "Developer API docs for the unofficial PESU OAuth2 / OpenID Connect "
    "authorization server — discovery, authorize, token, UserInfo, revoke, JWKS."
)

METHOD_DOCS: dict[str, MethodDoc] = {
    "discovery": MethodDoc(
        slug="discovery",
        nav_label="Discovery",
        title="Discovery · Docs · PESU OAuth",
        meta_description=(
            "OpenID Provider discovery document for PESU OAuth2 — endpoints, scopes, PKCE S256, and grant types."
        ),
        http_method="GET",
        path="/.well-known/openid-configuration",
        summary=(
            "OpenID Provider Metadata for this authorization server. Use it to "
            "discover issuer, endpoints, supported scopes, grants, and PKCE methods."
        ),
        auth="None (public).",
        params=(),
        example_request=("GET /.well-known/openid-configuration HTTP/1.1\nHost: <issuer-host>"),
        success=(
            "JSON metadata including issuer, authorization_endpoint (/authorize), "
            "token_endpoint (/token), userinfo_endpoint (/userinfo), jwks_uri "
            "(/jwks.json), revocation_endpoint (/revoke), response_types_supported "
            '["code"], code_challenge_methods_supported ["S256"], scopes_supported '
            "(openid, profile, email, phone, offline_access), grant_types_supported "
            "(authorization_code, refresh_token), token_endpoint_auth_methods_supported "
            "(client_secret_post, none), and id_token_signing_alg_values_supported [RS256]."
        ),
        errors=(ErrorDoc("5xx", "Standard HTTP errors only; this endpoint is read-only metadata."),),
        notes=(
            "Do not hardcode endpoints — read discovery from the issuer URL.",
            "Token exchange (/oauth/token-exchange) is AS-internal only and omitted from public docs.",
        ),
    ),
    "authorize": MethodDoc(
        slug="authorize",
        nav_label="Authorize",
        title="Authorize · Docs · PESU OAuth",
        meta_description=(
            "GET /authorize — authorization code + PKCE S256, Testing gate, "
            "and redirect URI rules for Sign in with PESU."
        ),
        http_method="GET",
        path="/authorize",
        summary=(
            "Starts the OAuth 2.0 authorization code + PKCE (S256) flow for Sign in "
            "with PESU. Validates the client and redirect URI, then redirects the "
            "browser to hosted login (and consent when needed)."
        ),
        auth="Browser redirect (end-user). No client secret on this request.",
        params=(
            Param("response_type", "query", True, "string", "Must be `code`."),
            Param("client_id", "query", True, "string", "Registered client identifier."),
            Param(
                "redirect_uri",
                "query",
                True,
                "string",
                "Exact match to a registered redirect URI.",
            ),
            Param(
                "scope",
                "query",
                True,
                "string",
                "Space-delimited; must include `openid` after filtering known scopes.",
            ),
            Param(
                "code_challenge",
                "query",
                True,
                "string",
                "BASE64URL (no padding) S256 challenge.",
            ),
            Param(
                "code_challenge_method",
                "query",
                True,
                "string",
                "Must be `S256`.",
            ),
            Param("state", "query", False, "string", "Opaque CSRF value; returned on redirect."),
            Param("nonce", "query", False, "string", "Bound into the ID token when present."),
        ),
        example_request=(
            "GET /authorize?response_type=code&client_id=CLIENT_ID\n"
            "  &redirect_uri=https%3A%2F%2Fapp.example%2Fcallback\n"
            "  &scope=openid%20profile%20email&state=xyz\n"
            "  &code_challenge=CHALLENGE&code_challenge_method=S256 HTTP/1.1\n"
            "Host: <issuer-host>"
        ),
        success=(
            "302 to /login with an HttpOnly session cookie carrying the pending request. "
            "After login (and consent if required), the user is redirected to redirect_uri "
            "with code and state (if provided)."
        ),
        errors=(
            ErrorDoc("invalid_client", "Unknown or missing client_id (HTML error page)."),
            ErrorDoc("invalid_redirect", "redirect_uri missing or not registered."),
            ErrorDoc("unsupported_response", "Only response_type=code is supported."),
            ErrorDoc("pkce_required", "Missing PKCE or code_challenge_method is not S256."),
            ErrorDoc("invalid_scope", "openid scope required after filtering."),
            ErrorDoc(
                "testing_gate",
                "Client in Testing: only the developer and invited testers may sign in.",
            ),
        ),
        notes=(
            "PKCE S256 is mandatory for all clients.",
            "Clients in Testing may only sign in the developer and invited testers until Production approval.",
            "Identity-only scopes in this MVP (no public vault or token-exchange APIs).",
        ),
    ),
    "token": MethodDoc(
        slug="token",
        nav_label="Token",
        title="Token · Docs · PESU OAuth",
        meta_description=(
            "POST /token — exchange authorization codes with PKCE and rotate refresh tokens on the PESU OAuth2 server."
        ),
        http_method="POST",
        path="/token",
        summary=(
            "Exchanges an authorization code (+ PKCE verifier) for tokens, or rotates "
            "a refresh token. Form-encoded body (application/x-www-form-urlencoded)."
        ),
        auth=(
            "Confidential clients: client_id + client_secret (client_secret_post). "
            "Public clients: client_id only (token_endpoint_auth_method=none)."
        ),
        params=(
            Param(
                "grant_type",
                "body",
                True,
                "string",
                "`authorization_code` or `refresh_token`.",
            ),
            Param("code", "body", False, "string", "One-time authorization code (code grant)."),
            Param(
                "redirect_uri",
                "body",
                False,
                "string",
                "Must match the authorize request (code grant).",
            ),
            Param(
                "code_verifier",
                "body",
                False,
                "string",
                "PKCE verifier, 43–128 unreserved chars (code grant).",
            ),
            Param("refresh_token", "body", False, "string", "Previously issued refresh token."),
            Param("client_id", "body", True, "string", "Registered client identifier."),
            Param(
                "client_secret",
                "body",
                False,
                "string",
                "Required unless the client uses auth method none.",
            ),
        ),
        example_request=(
            "POST /token HTTP/1.1\n"
            "Host: <issuer-host>\n"
            "Content-Type: application/x-www-form-urlencoded\n\n"
            "grant_type=authorization_code&code=CODE&redirect_uri=https%3A%2F%2Fapp.example%2Fcallback"
            "&client_id=CLIENT_ID&code_verifier=VERIFIER"
        ),
        success=(
            "JSON with access_token, token_type (Bearer), expires_in, id_token (when openid), "
            "and refresh_token when offline_access was granted. Refresh uses rotation with "
            "reuse detection (compromised family is revoked)."
        ),
        errors=(
            ErrorDoc("invalid_client", "Unknown client or bad credentials (often HTTP 401)."),
            ErrorDoc("invalid_grant", "Bad/expired code, PKCE failure, or refresh reuse."),
            ErrorDoc("invalid_request", "Missing required fields for the grant."),
            ErrorDoc("unsupported_grant_type", "Only authorization_code and refresh_token."),
        ),
        notes=(
            "Only authorization_code and refresh_token grants are supported.",
            "PKCE verification is required on the code grant (S256).",
        ),
    ),
    "userinfo": MethodDoc(
        slug="userinfo",
        nav_label="UserInfo",
        title="UserInfo · Docs · PESU OAuth",
        meta_description=(
            "GET/POST /userinfo — OIDC claims for the access-token subject, "
            "filtered by openid, profile, email, and phone scopes."
        ),
        http_method="GET|POST",
        path="/userinfo",
        summary=(
            "Returns OIDC claims for the subject of a valid access token, filtered by the token's granted scopes."
        ),
        auth="Authorization: Bearer <access_token> (JWT access token from /token).",
        params=(
            Param(
                "Authorization",
                "header",
                True,
                "string",
                "Bearer access token.",
            ),
        ),
        example_request=("GET /userinfo HTTP/1.1\nHost: <issuer-host>\nAuthorization: Bearer ACCESS_TOKEN"),
        success=(
            "JSON claims always including sub. With profile: name, prn, srn, program, "
            "branch, semester, section, campus. With email: email (when available). "
            "With phone: phone_number (when available)."
        ),
        errors=(
            ErrorDoc(
                "invalid_token",
                "Missing, invalid, or expired Bearer token, or subject no longer exists (401).",
            ),
        ),
        notes=(
            "POST /userinfo with the same Bearer header is also supported.",
            "No vault or resource-API scopes in this MVP.",
        ),
    ),
    "revoke": MethodDoc(
        slug="revoke",
        nav_label="Revoke",
        title="Revoke · Docs · PESU OAuth",
        meta_description=(
            "POST /revoke — token revocation endpoint advertised in OIDC discovery for Sign in with PESU clients."
        ),
        http_method="POST",
        path="/revoke",
        summary=(
            "OAuth 2.0 token revocation endpoint advertised in discovery as "
            "revocation_endpoint. Call this to invalidate refresh (and access) tokens "
            "when the user signs out of the app."
        ),
        auth="Same client authentication as /token (client_secret_post or none).",
        params=(
            Param("token", "body", True, "string", "Access or refresh token to revoke."),
            Param(
                "token_type_hint",
                "body",
                False,
                "string",
                "Optional: access_token or refresh_token.",
            ),
            Param("client_id", "body", True, "string", "Registered client identifier."),
            Param(
                "client_secret",
                "body",
                False,
                "string",
                "Required unless the client uses auth method none.",
            ),
        ),
        example_request=(
            "POST /revoke HTTP/1.1\n"
            "Host: <issuer-host>\n"
            "Content-Type: application/x-www-form-urlencoded\n\n"
            "token=REFRESH_OR_ACCESS&token_type_hint=refresh_token&client_id=CLIENT_ID"
        ),
        success=(
            "Per RFC 7009, successful revocation typically returns 200 with an empty body "
            "even if the token was already invalid (to avoid token scanning)."
        ),
        errors=(ErrorDoc("invalid_client", "Client authentication failed."),),
        notes=(
            "Listed in /.well-known/openid-configuration.",
            "Not a substitute for refresh-token rotation / reuse detection on /token.",
        ),
    ),
    "jwks": MethodDoc(
        slug="jwks",
        nav_label="JWKS",
        title="JWKS · Docs · PESU OAuth",
        meta_description=("GET /jwks.json — public RS256 keys for verifying PESU OAuth2 ID and access tokens."),
        http_method="GET",
        path="/jwks.json",
        summary=(
            "JSON Web Key Set containing the public RSA key(s) used to verify ID tokens and access tokens (RS256)."
        ),
        auth="None (public).",
        params=(),
        example_request="GET /jwks.json HTTP/1.1\nHost: <issuer-host>",
        success=('JSON object {"keys":[{kty,kid,use,alg,n,e,...}]} for RS256 signature verification.'),
        errors=(ErrorDoc("503", "Signing key not configured on the server."),),
        notes=(
            "Cache with normal HTTP caching; rotate by kid.",
            "Matches id_token_signing_alg_values_supported from discovery (RS256).",
        ),
    ),
}

REFERENCE_DOCS: dict[str, ReferenceDoc] = {
    "scopes": ReferenceDoc(
        slug="scopes",
        nav_label="Scopes & claims",
        title="Scopes · Docs · PESU OAuth",
        meta_description=(
            "Identity scopes and claims for PESU OAuth2, plus Testing vs Production and redirect URI rules."
        ),
        heading="Scopes & claims",
        summary=("Identity scopes, claim mapping, Testing gate, and redirect URI rules for Sign in with PESU."),
        sections=(
            RefSection(
                heading="Supported scopes (v1 identity)",
                paragraphs=(
                    "Unknown scopes are dropped. After filtering, openid must still be present or authorize fails.",
                ),
                table=DocTable(
                    headers=("Scope", "Purpose"),
                    rows=(
                        ("`openid`", "Required. Sign-in; enables ID token"),
                        ("`profile`", "Name and academic profile claims"),
                        ("`email`", "Email address"),
                        ("`phone`", "Phone number (sensitive)"),
                        ("`offline_access`", "Refresh token / stay signed in"),
                    ),
                ),
            ),
            RefSection(
                heading="Claims by scope",
                bullets=(
                    "Always: `sub`",
                    "`profile`: `name`, `prn`, `srn`, `program`, `branch`, `semester`, `section`, `campus`",
                    "`email`: `email`",
                    "`phone`: `phone_number`",
                ),
            ),
            RefSection(
                heading="Testing vs Production",
                paragraphs=(
                    "Apps start in Testing: only the developer and invited testers can "
                    "complete login. After admin approval for Production, any PESU user "
                    "can sign in.",
                ),
            ),
            RefSection(
                heading="Redirect URIs",
                paragraphs=(
                    "redirect_uri on /authorize and /token must be an exact match to a "
                    "URI registered for the client. No open redirects.",
                ),
            ),
            RefSection(
                heading="Out of public docs",
                paragraphs=("/oauth/token-exchange is AS-internal only — not for third-party clients.",),
            ),
        ),
    ),
    "quick-start": ReferenceDoc(
        slug="quick-start",
        nav_label="Quick start",
        title="Quick start · Docs · PESU OAuth",
        meta_description=(
            "Quick start for Sign in with PESU: discovery, PKCE S256 authorize, token exchange, UserInfo, and refresh."
        ),
        heading="Quick start",
        summary=("Wire a confidential or public client to authorization code + PKCE S256."),
        sections=(
            RefSection(
                heading="1. Register a client",
                paragraphs=(
                    "Create an app in the developer portal (when available) with redirect "
                    "URIs and choose public (none) or confidential (client_secret_post) auth.",
                ),
            ),
            RefSection(
                heading="2. Discover the issuer",
                paragraphs=(
                    "GET /.well-known/openid-configuration and use authorization_endpoint, "
                    "token_endpoint, jwks_uri, and code_challenge_methods_supported (S256 only).",
                ),
            ),
            RefSection(
                heading="3. Authorize (PKCE S256)",
                bullets=(
                    "Generate code_verifier (43–128 chars) and code_challenge = BASE64URL(SHA256(verifier)).",
                    "Redirect to GET /authorize with response_type=code, client_id, redirect_uri, "
                    "scope (include openid), code_challenge, code_challenge_method=S256, optional state/nonce.",
                    "User signs in with PESU Academy credentials on the hosted login page.",
                    "Handle Testing gate errors if the user is not an allowed tester.",
                ),
            ),
            RefSection(
                heading="4. Exchange the code",
                paragraphs=(
                    "POST /token with grant_type=authorization_code, code, redirect_uri, "
                    "code_verifier, and client credentials as required. Receive access_token, "
                    "id_token, and optionally refresh_token.",
                ),
            ),
            RefSection(
                heading="5. Call UserInfo (optional)",
                paragraphs=("GET /userinfo with Authorization: Bearer <access_token>.",),
            ),
            RefSection(
                heading="6. Refresh / revoke",
                bullets=(
                    "Refresh: POST /token with grant_type=refresh_token.",
                    "Revoke: POST /revoke with the token when signing the user out.",
                ),
            ),
            RefSection(
                heading="Libraries",
                paragraphs=(
                    "Works with standard OIDC clients (Auth.js, AppAuth, etc.) that support "
                    "authorization code + PKCE S256. Do not call /oauth/token-exchange from "
                    "third-party apps.",
                ),
            ),
        ),
    ),
}

NAV_ORDER: tuple[str, ...] = (
    "quick-start",
    "discovery",
    "authorize",
    "token",
    "userinfo",
    "revoke",
    "jwks",
    "scopes",
)


def nav_items() -> list[dict[str, str]]:
    """Ordered docs nav links for templates."""
    items: list[dict[str, str]] = []
    for slug in NAV_ORDER:
        if slug in METHOD_DOCS:
            doc = METHOD_DOCS[slug]
            items.append({"path": doc.docs_path, "label": doc.nav_label})
        else:
            doc_ref = REFERENCE_DOCS[slug]
            items.append({"path": doc_ref.docs_path, "label": doc_ref.nav_label})
    return items
