export interface ParamDoc {
  name: string;
  location: 'query' | 'body' | 'header';
  type: string;
  required: boolean;
  defaultValue?: string;
  allowedValues?: string[];
  description: string;
  example?: string;
}

export interface ResponseDoc {
  status: number;
  statusText: string;
  description: string;
  sample: unknown;
}

export interface EndpointDoc {
  id: string;
  method: 'GET' | 'POST' | 'GET / POST';
  path: string;
  title: string;
  summary: string;
  description: string;
  auth: string;
  category: 'Discovery & Keys' | 'Authentication & Tokens';
  headers: ParamDoc[];
  params: ParamDoc[];
  responses: ResponseDoc[];
  curlSample: string;
  fetchSample: string;
  pythonSample: string;
}

export const DEFAULT_PROD_ISSUER_URL = 'https://oauth2-prod-66snrlj46a-uc.a.run.app';

export function createEndpoints(baseUrl: string = DEFAULT_PROD_ISSUER_URL): EndpointDoc[] {
  const cleanBase = baseUrl.replace(/\/+$/, '');

  return [
    {
      id: 'openid-configuration',
      method: 'GET',
      path: '/.well-known/openid-configuration',
      title: 'OpenID Connect Discovery',
      category: 'Discovery & Keys',
      summary: 'Standard OIDC Discovery 1.0 metadata containing endpoints and supported capabilities.',
      description:
        'Provides OpenID Connect clients with dynamic server metadata. Libraries such as NextAuth.js, OpenID Client, and Passport automatically ingest this document to configure endpoints, cryptographic signing algorithms, and supported scopes.',
      auth: 'None (Public)',
      headers: [
        {
          name: 'Accept',
          location: 'header',
          type: 'string',
          required: false,
          description: 'Set to application/json for JSON representation.',
          example: 'application/json',
        },
      ],
      params: [],
      responses: [
        {
          status: 200,
          statusText: 'OK',
          description: 'Successfully retrieved server discovery metadata.',
          sample: {
            issuer: cleanBase,
            authorization_endpoint: `${cleanBase}/authorize`,
            token_endpoint: `${cleanBase}/token`,
            userinfo_endpoint: `${cleanBase}/userinfo`,
            jwks_uri: `${cleanBase}/jwks.json`,
            revocation_endpoint: `${cleanBase}/revoke`,
            response_types_supported: ['code'],
            subject_types_supported: ['public'],
            id_token_signing_alg_values_supported: ['RS256'],
            code_challenge_methods_supported: ['S256'],
            scopes_supported: ['openid', 'profile', 'email', 'phone', 'offline_access'],
            grant_types_supported: ['authorization_code', 'refresh_token'],
            token_endpoint_auth_methods_supported: ['client_secret_post', 'none'],
          },
        },
      ],
      curlSample: `curl -X GET ${cleanBase}/.well-known/openid-configuration \\
  -H "Accept: application/json"`,
      fetchSample: `const response = await fetch("${cleanBase}/.well-known/openid-configuration");
const discovery = await response.json();
console.log(discovery.token_endpoint);`,
      pythonSample: `import requests

response = requests.get("${cleanBase}/.well-known/openid-configuration")
discovery = response.json()
print("Token endpoint:", discovery["token_endpoint"])`,
    },
    {
      id: 'jwks',
      method: 'GET',
      path: '/jwks.json',
      title: 'JSON Web Key Set (JWKS)',
      category: 'Discovery & Keys',
      summary: 'Public cryptographic keys (RS256) used to verify JWT access tokens and ID tokens.',
      description:
        'Exposes the public RSA key components required to mathematically verify tokens minted by PESU OAuth2. OIDC validation libraries cache this set and automatically match the "kid" (Key ID) header in signed JWTs.',
      auth: 'None (Public)',
      headers: [],
      params: [],
      responses: [
        {
          status: 200,
          statusText: 'OK',
          description: 'Active public JSON Web Key Set.',
          sample: {
            keys: [
              {
                kty: 'RSA',
                use: 'sig',
                alg: 'RS256',
                kid: 'pesu-oidc-active-key',
                n: 'u1lK3v7...',
                e: 'AQAB',
              },
            ],
          },
        },
      ],
      curlSample: `curl -X GET ${cleanBase}/jwks.json`,
      fetchSample: `import { createRemoteJWKSet, jwtVerify } from "jose";

const JWKS = createRemoteJWKSet(new URL("${cleanBase}/jwks.json"));
const { payload } = await jwtVerify(token, JWKS, {
  issuer: "${cleanBase}",
});
console.log("Verified sub:", payload.sub);`,
      pythonSample: `import requests

response = requests.get("${cleanBase}/jwks.json")
jwks = response.json()
print("Key IDs:", [k["kid"] for k in jwks.get("keys", [])])`,
    },
    {
      id: 'authorize',
      method: 'GET',
      path: '/authorize',
      title: 'Authorize (Authorization Code Flow)',
      category: 'Authentication & Tokens',
      summary: 'Interactive authentication & consent endpoint initiating the PKCE code flow.',
      description:
        'Directs the user agent to the PESU sign-in and consent interface. Following successful authentication and scope consent, PESU OAuth2 issues a single-use authorization code (5-minute TTL) and redirects back to the client redirect_uri.',
      auth: 'Browser session (pesu_session cookie)',
      headers: [],
      params: [
        {
          name: 'client_id',
          location: 'query',
          type: 'string',
          required: true,
          description: 'Unique client ID obtained during application registration.',
          example: 'client_live_a1b2c3d4e5',
        },
        {
          name: 'redirect_uri',
          location: 'query',
          type: 'string',
          required: true,
          description: 'Registered callback URI. Must exactly match one of the URIs configured in the developer portal.',
          example: 'https://yourapp.pesu.dev/api/auth/callback/pesu',
        },
        {
          name: 'response_type',
          location: 'query',
          type: 'string',
          required: true,
          defaultValue: 'code',
          allowedValues: ['code'],
          description: 'OAuth 2.0 response type. Only "code" is supported.',
          example: 'code',
        },
        {
          name: 'scope',
          location: 'query',
          type: 'string',
          required: false,
          defaultValue: 'openid',
          description: 'Space-delimited list of requested scopes. Include "offline_access" to receive a refresh token.',
          example: 'openid profile email offline_access',
        },
        {
          name: 'code_challenge',
          location: 'query',
          type: 'string',
          required: true,
          description: 'PKCE challenge: BASE64URL(SHA256(code_verifier)). Plain PKCE is strictly rejected.',
          example: 'E9Melhoa2OwvFrGMTJguCH5rtG64DTb3Ag618U7-wS4',
        },
        {
          name: 'code_challenge_method',
          location: 'query',
          type: 'string',
          required: false,
          defaultValue: 'S256',
          allowedValues: ['S256'],
          description: 'Cryptographic challenge method. Only "S256" is allowed.',
          example: 'S256',
        },
        {
          name: 'state',
          location: 'query',
          type: 'string',
          required: false,
          description: 'Opaque CSRF prevention token generated by the client and echoed verbatim on callback.',
          example: 'xyzSecureStateRandom123',
        },
        {
          name: 'mode',
          location: 'query',
          type: 'string',
          required: false,
          defaultValue: 'identity',
          allowedValues: ['identity', 'delegated_vault'],
          description:
            'Grant mode. Use "identity" for profile/claims sign-in. Use "delegated_vault" to request background PESU Academy session sync authorization.',
          example: 'identity',
        },
      ],
      responses: [
        {
          status: 302,
          statusText: 'Found (Redirect)',
          description: 'Successful authorization redirects the user back to redirect_uri with the code and state.',
          sample: {
            redirect: 'https://yourapp.pesu.dev/api/auth/callback/pesu?code=ac_live_7x9k2m...&state=xyzSecureStateRandom123',
          },
        },
        {
          status: 400,
          statusText: 'Bad Request',
          description: 'Missing mandatory parameters or invalid PKCE challenge method.',
          sample: {
            error: 'invalid_request',
            error_description: 'Required: client_id, redirect_uri, response_type=code, and code_challenge.',
          },
        },
        {
          status: 403,
          statusText: 'Forbidden',
          description: 'Client is in testing mode and current student is not registered in the tester allowlist.',
          sample: {
            error: 'access_denied',
            error_description: 'Application is in testing mode. Only owner and invited testers can authorize.',
          },
        },
      ],
      curlSample: `# Direct browser navigation URL:
${cleanBase}/authorize?client_id=client_live_a1b2c3d4e5&redirect_uri=https%3A%2F%2Fyourapp.pesu.dev%2Fapi%2Fauth%2Fcallback%2Fpesu&response_type=code&scope=openid%20profile%20email%20offline_access&code_challenge=E9Melhoa2OwvFrGMTJguCH5rtG64DTb3Ag618U7-wS4&code_challenge_method=S256&state=xyzSecureStateRandom123`,
      fetchSample: `// Generate PKCE pair and redirect user:
const codeVerifier = generateRandomString(64);
const codeChallenge = await sha256Base64Url(codeVerifier);

const authUrl = new URL("${cleanBase}/authorize");
authUrl.searchParams.set("client_id", "client_live_a1b2c3d4e5");
authUrl.searchParams.set("redirect_uri", "https://yourapp.pesu.dev/api/auth/callback/pesu");
authUrl.searchParams.set("response_type", "code");
authUrl.searchParams.set("scope", "openid profile email offline_access");
authUrl.searchParams.set("code_challenge", codeChallenge);
authUrl.searchParams.set("code_challenge_method", "S256");
authUrl.searchParams.set("state", crypto.randomUUID());

window.location.href = authUrl.toString();`,
      pythonSample: `import base64
import hashlib
import os
import urllib.parse

# 1. Generate code verifier and code challenge (S256)
code_verifier = base64.urlsafe_b64encode(os.urandom(32)).decode("utf-8").rstrip("=")
code_challenge = base64.urlsafe_b64encode(
    hashlib.sha256(code_verifier.encode("utf-8")).digest()
).decode("utf-8").rstrip("=")

# 2. Build authorization URL
params = {
    "client_id": "client_live_a1b2c3d4e5",
    "redirect_uri": "https://yourapp.pesu.dev/api/auth/callback/pesu",
    "response_type": "code",
    "scope": "openid profile email offline_access",
    "code_challenge": code_challenge,
    "code_challenge_method": "S256",
    "state": os.urandom(16).hex(),
}
auth_url = f"${cleanBase}/authorize?{urllib.parse.urlencode(params)}"
print("Direct user to:", auth_url)`,
    },
    {
      id: 'token',
      method: 'POST',
      path: '/token',
      title: 'Token Issuance & Refresh',
      category: 'Authentication & Tokens',
      summary: 'Exchange an authorization code or refresh token for access tokens and ID tokens.',
      description:
        'Validates client credentials, verifies single-use authorization codes with PKCE, and mints RS256 Access/ID tokens. Supports refresh token family rotation with strict reuse detection.',
      auth: 'Client Secret (via body or HTTP Basic Auth) or Public (PKCE only)',
      headers: [
        {
          name: 'Content-Type',
          location: 'header',
          type: 'string',
          required: true,
          description: 'application/x-www-form-urlencoded or application/json',
          example: 'application/x-www-form-urlencoded',
        },
        {
          name: 'Authorization',
          location: 'header',
          type: 'string',
          required: false,
          description: 'Basic <base64(client_id:client_secret)> for confidential client authentication.',
          example: 'Basic Y2xpZW50X2xpdmVfYTFiajpzZWNyZXRfMTIz',
        },
      ],
      params: [
        {
          name: 'grant_type',
          location: 'body',
          type: 'string',
          required: true,
          allowedValues: ['authorization_code', 'refresh_token'],
          description: 'The OAuth 2.0 grant type being executed.',
          example: 'authorization_code',
        },
        {
          name: 'client_id',
          location: 'body',
          type: 'string',
          required: true,
          description: 'The client application ID (if not provided in Authorization Basic header).',
          example: 'client_live_a1b2c3d4e5',
        },
        {
          name: 'client_secret',
          location: 'body',
          type: 'string',
          required: false,
          description: 'Application secret for confidential clients (if not provided in Basic header).',
          example: 'sec_live_9876543210',
        },
        {
          name: 'code',
          location: 'body',
          type: 'string',
          required: false,
          description: 'Authorization code issued by /authorize. Required when grant_type=authorization_code.',
          example: 'ac_live_7x9k2m1p0q',
        },
        {
          name: 'redirect_uri',
          location: 'body',
          type: 'string',
          required: false,
          description: 'Must match the redirect_uri used in the initial authorization request.',
          example: 'https://yourapp.pesu.dev/api/auth/callback/pesu',
        },
        {
          name: 'code_verifier',
          location: 'body',
          type: 'string',
          required: false,
          description: 'Plaintext PKCE code verifier (43-128 chars). Required when grant_type=authorization_code.',
          example: 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk',
        },
        {
          name: 'refresh_token',
          location: 'body',
          type: 'string',
          required: false,
          description: 'Existing refresh token. Required when grant_type=refresh_token.',
          example: 'rt_live_90ab34cd56ef',
        },
      ],
      responses: [
        {
          status: 200,
          statusText: 'OK',
          description: 'Tokens successfully issued.',
          sample: {
            access_token: 'eyJhbGciOiJSUzI1NiIsImtpZCI6InBlc3Utb2lkYy1hY3RpdmUta2V5In0.ey...access',
            token_type: 'Bearer',
            expires_in: 900,
            id_token: 'eyJhbGciOiJSUzI1NiIsImtpZCI6InBlc3Utb2lkYy1hY3RpdmUta2V5In0.ey...id',
            refresh_token: 'rt_live_newly_rotated_token_string',
            scope: 'openid profile email offline_access',
          },
        },
        {
          status: 400,
          statusText: 'Bad Request',
          description: 'Invalid PKCE verification, code expired/reused, or invalid refresh token.',
          sample: {
            error: 'invalid_grant',
            error_description: 'PKCE verification failed',
          },
        },
        {
          status: 401,
          statusText: 'Unauthorized',
          description: 'Client credentials invalid or client_secret mismatch.',
          sample: {
            error: 'invalid_client',
            error_description: 'Invalid client credentials',
          },
        },
      ],
      curlSample: `curl -X POST ${cleanBase}/token \\
  -H "Content-Type: application/x-www-form-urlencoded" \\
  -d "grant_type=authorization_code" \\
  -d "client_id=client_live_a1b2c3d4e5" \\
  -d "client_secret=sec_live_9876543210" \\
  -d "code=ac_live_7x9k2m1p0q" \\
  -d "redirect_uri=https://yourapp.pesu.dev/api/auth/callback/pesu" \\
  -d "code_verifier=dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"`,
      fetchSample: `const response = await fetch("${cleanBase}/token", {
  method: "POST",
  headers: {
    "Content-Type": "application/x-www-form-urlencoded",
  },
  body: new URLSearchParams({
    grant_type: "authorization_code",
    client_id: "client_live_a1b2c3d4e5",
    client_secret: "sec_live_9876543210",
    code: authorizationCode,
    redirect_uri: "https://yourapp.pesu.dev/api/auth/callback/pesu",
    code_verifier: codeVerifier,
  }),
});

const tokenData = await response.json();
console.log("Access token expires in:", tokenData.expires_in);`,
      pythonSample: `import requests

response = requests.post(
    "${cleanBase}/token",
    data={
        "grant_type": "authorization_code",
        "client_id": "client_live_a1b2c3d4e5",
        "client_secret": "sec_live_9876543210",
        "code": authorization_code,
        "redirect_uri": "https://yourapp.pesu.dev/api/auth/callback/pesu",
        "code_verifier": code_verifier,
    },
)

token_data = response.json()
print("Access token expires in:", token_data.get("expires_in"))`,
    },
    {
      id: 'userinfo',
      method: 'GET / POST',
      path: '/userinfo',
      title: 'User Profile Claims',
      category: 'Authentication & Tokens',
      summary: 'Returns authorized student profile claims for a valid Bearer access token.',
      description:
        'Standard OIDC userinfo endpoint. Validates the signature and expiration of the RS256 Bearer access token, then returns profile claims filtered according to the scopes originally consented by the student.',
      auth: 'Bearer <access_token>',
      headers: [
        {
          name: 'Authorization',
          location: 'header',
          type: 'string',
          required: true,
          description: 'Bearer token minted by the /token endpoint.',
          example: 'Bearer eyJhbGciOiJSUzI1NiIs...',
        },
      ],
      params: [],
      responses: [
        {
          status: 200,
          statusText: 'OK',
          description: 'Authenticated student claims matching granted scopes.',
          sample: {
            sub: 'usr_live_88320491',
            name: 'Ananya Sharma',
            prn: 'PES1UG22CS001',
            srn: 'PES1202200001',
            program: 'B.Tech',
            branch: 'Computer Science and Engineering',
            semester: 6,
            section: 'A',
            campus: 'RR',
            email: 'ananya.sharma@pesu.pes.edu',
            phone_number: '+919876543210',
          },
        },
        {
          status: 401,
          statusText: 'Unauthorized',
          description: 'Token expired, invalid signature, or malformed Authorization header.',
          sample: {
            error: 'invalid_token',
            error_description: 'Token signature or expiration invalid',
          },
        },
      ],
      curlSample: `curl -X GET ${cleanBase}/userinfo \\
  -H "Authorization: Bearer eyJhbGciOiJSUzI1NiIs..."`,
      fetchSample: `const response = await fetch("${cleanBase}/userinfo", {
  headers: {
    Authorization: \`Bearer \${accessToken}\`,
  },
});

const user = await response.json();
console.log(\`Signed in as \${user.name} (\${user.prn})\`);`,
      pythonSample: `import requests

headers = {
    "Authorization": f"Bearer {access_token}"
}
response = requests.get("${cleanBase}/userinfo", headers=headers)
user = response.json()
print(f"Signed in as {user.get('name')} ({user.get('prn')})")`,
    },
    {
      id: 'revoke',
      method: 'POST',
      path: '/revoke',
      title: 'Token Revocation (RFC 7009)',
      category: 'Authentication & Tokens',
      summary: 'Revokes a refresh token and immediately invalidates its token family.',
      description:
        'Implements RFC 7009 token revocation. Allows client applications to explicitly invalidate refresh tokens on user logout or session termination. Per standard, returns HTTP 200 even if the token was already revoked or invalid.',
      auth: 'Public or Client Secret',
      headers: [
        {
          name: 'Content-Type',
          location: 'header',
          type: 'string',
          required: true,
          description: 'application/x-www-form-urlencoded or application/json',
          example: 'application/x-www-form-urlencoded',
        },
      ],
      params: [
        {
          name: 'token',
          location: 'body',
          type: 'string',
          required: true,
          description: 'The refresh token to be revoked.',
          example: 'rt_live_90ab34cd56ef',
        },
        {
          name: 'token_type_hint',
          location: 'body',
          type: 'string',
          required: false,
          defaultValue: 'refresh_token',
          allowedValues: ['refresh_token'],
          description: 'Hint regarding the token type being revoked.',
          example: 'refresh_token',
        },
      ],
      responses: [
        {
          status: 200,
          statusText: 'OK',
          description: 'Token successfully marked as revoked.',
          sample: {
            revoked: true,
          },
        },
        {
          status: 400,
          statusText: 'Bad Request',
          description: 'Missing token parameter in request body.',
          sample: {
            error: 'invalid_request',
            error_description: 'Missing token parameter',
          },
        },
      ],
      curlSample: `curl -X POST ${cleanBase}/revoke \\
  -H "Content-Type: application/x-www-form-urlencoded" \\
  -d "token=rt_live_90ab34cd56ef" \\
  -d "token_type_hint=refresh_token"`,
      fetchSample: `await fetch("${cleanBase}/revoke", {
  method: "POST",
  headers: {
    "Content-Type": "application/x-www-form-urlencoded",
  },
  body: new URLSearchParams({
    token: refreshToken,
    token_type_hint: "refresh_token",
  }),
});`,
      pythonSample: `import requests

response = requests.post(
    "${cleanBase}/revoke",
    data={
        "token": refresh_token,
        "token_type_hint": "refresh_token",
    },
)
print("Revocation response:", response.json())`,
    },
  ];
}

export const API_ENDPOINTS: EndpointDoc[] = createEndpoints();

/**
 * Generates an LLM-friendly Markdown prompt for a single endpoint.
 * Modeled after Stedi's API reference "Copy for LLM" standard.
 */
export function generateEndpointMarkdownForLlm(
  ep: EndpointDoc,
  baseUrl: string = DEFAULT_PROD_ISSUER_URL
): string {
  const cleanBase = baseUrl.replace(/\/+$/, '');
  const fullUrl = `${cleanBase}${ep.path}`;
  const sections: string[] = [];

  sections.push(`# API Reference: ${ep.title}`);
  sections.push(`\`${ep.method} ${ep.path}\``);
  sections.push(`**Full URL:** \`${fullUrl}\``);
  sections.push(`**Authentication:** ${ep.auth}`);
  sections.push(`\n## Description\n${ep.description}`);

  if (ep.headers.length > 0) {
    sections.push('\n## Request Headers');
    sections.push('| Header | Type | Required | Description | Example |');
    sections.push('|---|---|---|---|---|');
    ep.headers.forEach((h) => {
      sections.push(
        `| \`${h.name}\` | \`${h.type}\` | ${h.required ? '**Yes**' : 'No'} | ${h.description} | ${h.example ? `\`${h.example}\`` : '-'} |`
      );
    });
  }

  if (ep.params.length > 0) {
    sections.push('\n## Parameters');
    sections.push('| Name | Location | Type | Required | Default | Description | Example |');
    sections.push('|---|---|---|---|---|---|---|');
    ep.params.forEach((p) => {
      const allowed = p.allowedValues ? ` (Allowed: ${p.allowedValues.map((v) => `\`${v}\``).join(', ')})` : '';
      sections.push(
        `| \`${p.name}\` | \`${p.location}\` | \`${p.type}\` | ${p.required ? '**Yes**' : 'No'} | ${p.defaultValue ? `\`${p.defaultValue}\`` : '-'} | ${p.description}${allowed} | ${p.example ? `\`${p.example}\`` : '-'} |`
      );
    });
  }

  if (ep.responses.length > 0) {
    sections.push('\n## Responses');
    ep.responses.forEach((r) => {
      sections.push(`### \`${r.status} ${r.statusText}\``);
      sections.push(`${r.description}\n`);
      sections.push('```json');
      sections.push(JSON.stringify(r.sample, null, 2));
      sections.push('```');
    });
  }

  sections.push('\n## Request Example (cURL)');
  sections.push('```bash');
  sections.push(ep.curlSample);
  sections.push('```');

  sections.push('\n## Request Example (TypeScript / Fetch)');
  sections.push('```typescript');
  sections.push(ep.fetchSample);
  sections.push('```');

  sections.push('\n## Request Example (Python / requests)');
  sections.push('```python');
  sections.push(ep.pythonSample);
  sections.push('```');

  return sections.join('\n\n');
}

/**
 * Generates the complete Markdown documentation for all endpoints formatted for LLMs.
 */
export function generateFullApiReferenceMarkdown(
  endpoints: EndpointDoc[] = API_ENDPOINTS,
  baseUrl: string = DEFAULT_PROD_ISSUER_URL
): string {
  const cleanBase = baseUrl.replace(/\/+$/, '');
  const parts: string[] = [
    '# PESU OAuth2 / OpenID Connect Complete API Reference',
    '> Official API specification and integration manual for PESU OAuth 2.0 and OpenID Connect 1.0 services.',
    `- **Issuer Base URL:** \`${cleanBase}\``,
    '- **Protocol Standard:** OpenID Connect Core 1.0 / OAuth 2.0 RFC 6749',
    '- **Security Profiles:** Mandatory PKCE (S256), RS256 token signatures, refresh token family rotation',
    '---',
  ];

  endpoints.forEach((ep) => {
    parts.push(generateEndpointMarkdownForLlm(ep, cleanBase));
    parts.push('\n---\n');
  });

  return parts.join('\n\n');
}
