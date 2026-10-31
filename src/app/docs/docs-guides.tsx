'use client';

import * as React from 'react';
import Link from 'next/link';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Check, Copy, Sparkles, Code2, Key, ExternalLink, Server, Database } from 'lucide-react';

export interface GuideDoc {
  id: string;
  title: string;
  category: 'Guides';
  summary: string;
}

export const GUIDES: GuideDoc[] = [
  {
    id: 'overview',
    title: 'Overview & Quickstart',
    category: 'Guides',
    summary: 'OIDC architecture, issuer URL, and client authentication models.',
  },
  {
    id: 'versioning',
    title: 'API Versioning',
    category: 'Guides',
    summary: 'Resource route versioning, unversioned aliases, and breaking change policy.',
  },
  {
    id: 'pkce',
    title: 'Mandatory PKCE (S256)',
    category: 'Guides',
    summary: 'Cryptographic proof key verification preventing authorization code interception.',
  },
  {
    id: 'scopes',
    title: 'Scopes & Student Claims',
    category: 'Guides',
    summary: 'Available OpenID scopes and user profile claims sourced from PESU Academy.',
  },
  {
    id: 'nextauth',
    title: 'NextAuth.js Integration',
    category: 'Guides',
    summary: 'Production-ready NextAuth.js / Auth.js configuration snippet for Next.js App Router.',
  },
];

interface GuideViewProps {
  id: string;
  issuerUrl: string;
  copiedId: string | null;
  onCopy: (text: string, id: string) => void;
}

/** Long-form guide pages rendered in the center column of the docs explorer. */
export function GuideView({ id, issuerUrl, copiedId, onCopy }: GuideViewProps) {
  return (
    <>
      {id === 'overview' && (
        <div className="space-y-8">
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Badge variant="production" className="text-xs">
                Overview
              </Badge>
              <span className="text-xs text-muted">RFC 6749 / OpenID Connect Core 1.0</span>
            </div>
            <h1 className="display text-fg">
              Getting Started with Sign in with PESU
            </h1>
            <p className="text-sm text-soft leading-relaxed">
              Sign in with PESU is an OpenID Connect (OIDC) identity provider enabling student
              developers to authenticate PES University students reliably, retrieve verified academic
              profile attributes, and eliminate the need for storing raw passwords.
            </p>
          </div>

          {/* Architecture Diagram / Overview Cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card className="p-4 space-y-2 bg-surface border border-line">
              <div className="eyebrow">
                1. Register Client
              </div>
              <p className="text-xs text-soft">
                Create an application in the{' '}
                <Link href="/portal" className="underline font-medium text-get">
                  Developer Portal
                </Link>{' '}
                to receive your unique <code className="font-mono">client_id</code> and register callback URIs.
              </p>
            </Card>
            <Card className="p-4 space-y-2 bg-surface border border-line">
              <div className="eyebrow">
                2. Initiate PKCE Flow
              </div>
              <p className="text-xs text-soft">
                Redirect users to <code className="font-mono">/oauth2/authorize</code> with a SHA-256 PKCE code challenge.
                Users consent to scopes requested by your client.
              </p>
            </Card>
            <Card className="p-4 space-y-2 bg-surface border border-line">
              <div className="eyebrow">
                3. Mint & Verify Tokens
              </div>
              <p className="text-xs text-soft">
                Exchange the single-use code at <code className="font-mono">/oauth2/token</code> for signed RS256 ID tokens and
                access tokens, or query <code className="font-mono">/api/v1/userinfo</code>.
              </p>
            </Card>
          </div>

          {/* Issuer URL & Discovery */}
          <div className="space-y-3">
            <h3 className="font-serif text-xl font-normal text-fg flex items-center gap-2">
              <Server className="w-4 h-4 text-get" />
              <span>Issuer URL & Discovery</span>
            </h3>
            <Card className="p-4 space-y-3 bg-surface border border-line">
              <p className="text-xs text-soft">
                Configure your OIDC client or authentication library with the following Issuer URL. All discovery endpoints, signing keys, and token handlers are resolved automatically from this base.
              </p>
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 p-2.5 rounded-md bg-surface-soft font-mono text-xs border border-line">
                <span className="text-fg font-semibold break-all">{issuerUrl}</span>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => onCopy(issuerUrl, 'issuer-url')}
                  className="text-[11px] h-7 px-2.5 shrink-0 font-sans"
                >
                  {copiedId === 'issuer-url' ? (
                    <>
                      <Check className="w-3 h-3 text-success" />
                      <span className="text-success">Copied</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3 h-3 text-muted" />
                      <span>Copy Issuer</span>
                    </>
                  )}
                </Button>
              </div>
              <div className="text-xs text-muted flex items-center gap-1.5 flex-wrap">
                <span>OpenID Discovery:</span>
                <a
                  href={`${issuerUrl}/.well-known/openid-configuration`}
                  target="_blank"
                  rel="noreferrer"
                  className="text-get hover:underline font-mono inline-flex items-center gap-1"
                >
                  <span>{issuerUrl}/.well-known/openid-configuration</span>
                  <ExternalLink className="w-3 h-3" />
                </a>
              </div>
            </Card>
          </div>

          {/* Publishing States Notice */}
          <Card className="p-4 space-y-2 bg-warning/5 border border-warning/40 text-xs text-warning">
            <div className="font-semibold text-warning">
              Client Publishing Lifecycle
            </div>
            <p>
              Newly created applications begin in <strong>testing</strong> status and can only authenticate
              the owner and designated testers listed in your portal. Submit a verification request from your client
              portal once ready for campus-wide production release.
            </p>
          </Card>
        </div>
      )}

      {id === 'versioning' && (
        <div className="space-y-6">
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Badge variant="identity" className="text-xs">
                Architecture & Standards
              </Badge>
              <span className="text-xs text-muted">Resource Server Routing</span>
            </div>
            <h1 className="display text-fg">
              API Versioning
            </h1>
            <p className="text-sm text-soft leading-relaxed">
              PESU OAuth2 uses path-based API versioning for all Resource Server endpoints to guarantee
              backward compatibility and predictable developer upgrades. Protocol endpoints remain unversioned per OIDC specifications.
            </p>
          </div>

          {/* Versioning Schemes Comparison Cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Card className="p-5 space-y-3 bg-surface border border-line">
              <div className="flex items-center justify-between">
                <span className="eyebrow">
                  Explicit Version Route
                </span>
                <Badge variant="production" className="text-[10px]">
                  Recommended for Production
                </Badge>
              </div>
              <div className="p-2.5 rounded-md bg-surface-soft font-mono text-xs text-fg border border-line break-all">
                GET {issuerUrl}/api/v1/userinfo
              </div>
              <p className="text-xs text-soft leading-relaxed">
                Pinned to an explicit version number (<code className="font-mono">v1</code>). Production applications should always specify the API version to guarantee immunity against breaking changes when future API versions are deployed.
              </p>
            </Card>

            <Card className="p-5 space-y-3 bg-surface border border-line">
              <div className="flex items-center justify-between">
                <span className="eyebrow text-warning">
                  Unversioned Route Alias
                </span>
                <Badge variant="optional" className="text-[10px]">
                  Aliases to Latest (v1)
                </Badge>
              </div>
              <div className="p-2.5 rounded-md bg-surface-soft font-mono text-xs text-fg border border-line break-all">
                GET {issuerUrl}/api/userinfo
              </div>
              <p className="text-xs text-soft leading-relaxed">
                Requests to unversioned paths are automatically rewritten at the edge proxy to the current default/latest API version (<code className="font-mono">v1</code>). Ideal for rapid prototyping and interactive testing.
              </p>
            </Card>
          </div>

          {/* Protocol Endpoints vs Resource Endpoints */}
          <Card className="p-5 space-y-3 bg-surface border border-line text-xs">
            <h3 className="font-serif text-xl font-normal text-fg">
              Authorization Server vs. Resource Server
            </h3>
            <p className="text-soft leading-relaxed">
              Only <strong>Resource Server</strong> endpoints follow API versioning. Core OAuth 2.0 and OpenID Connect 1.0 protocol endpoints follow RFC standards and remain unversioned.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
              <div className="p-3 rounded-md bg-surface-soft border border-line space-y-1.5">
                <div className="font-semibold text-fg flex items-center gap-1.5">
                  <Key className="w-3.5 h-3.5 text-get" />
                  <span>Protocol Endpoints (RFC-Governed)</span>
                </div>
                <p className="text-[11px] text-muted leading-relaxed">
                  Unversioned standard paths defined by OAuth 2.0 & OIDC specifications:
                </p>
                <ul className="font-mono text-[11px] text-soft space-y-0.5 list-disc list-inside">
                  <li>/oauth2/authorize</li>
                  <li>/oauth2/token</li>
                  <li>/oauth2/revoke</li>
                  <li>/.well-known/openid-configuration</li>
                  <li>/jwks.json</li>
                </ul>
              </div>

              <div className="p-3 rounded-md bg-surface-soft border border-line space-y-1.5">
                <div className="font-semibold text-fg flex items-center gap-1.5">
                  <Database className="w-3.5 h-3.5 text-success" />
                  <span>Resource Server Endpoints (Versioned)</span>
                </div>
                <p className="text-[11px] text-muted leading-relaxed">
                  Domain resource routes delivering student academic records and profile claims:
                </p>
                <ul className="font-mono text-[11px] text-soft space-y-0.5 list-disc list-inside">
                  <li>/api/v1/userinfo (pinned version)</li>
                  <li>/api/userinfo (unversioned alias)</li>
                </ul>
              </div>
            </div>
          </Card>

          {/* API Versions Table */}
          <div className="space-y-3">
            <h3 className="font-serif text-xl font-normal text-fg">
              Supported API Versions
            </h3>
            <div className="overflow-x-auto rounded-md border border-line bg-surface">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="border-b border-line bg-surface-soft text-muted">
                    <th className="py-2.5 px-3 font-semibold">Version</th>
                    <th className="py-2.5 px-3 font-semibold">Status</th>
                    <th className="py-2.5 px-3 font-semibold">Default</th>
                    <th className="py-2.5 px-3 font-semibold">Description</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  <tr>
                    <td className="py-2.5 px-3 font-mono font-semibold text-get">
                      v1
                    </td>
                    <td className="py-2.5 px-3">
                      <Badge variant="production" className="text-[10px] px-1.5 py-0.5">
                        Available
                      </Badge>
                    </td>
                    <td className="py-2.5 px-3 font-mono text-soft">
                      Yes
                    </td>
                    <td className="py-2.5 px-3 text-soft leading-relaxed">
                      Initial stable release of the PESU OIDC Resource Server, providing verified student profile claims via <code className="font-mono">/api/v1/userinfo</code>.
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          {/* Backward Compatibility & Evolution Policy */}
          <div className="p-4 rounded-md bg-surface-soft border border-line space-y-2 text-xs text-soft">
            <div className="font-semibold text-fg flex items-center gap-1.5 text-sm">
              <Sparkles className="w-4 h-4 text-get" />
              <span>Breaking Changes & Evolution Policy</span>
            </div>
            <ul className="list-disc list-inside space-y-1.5 leading-relaxed">
              <li>
                <strong>Non-Breaking Changes:</strong> Additive changes (e.g. adding new optional claims, new response headers, or new non-mandatory parameters) are introduced directly into the current version without breaking existing integrations.
              </li>
              <li>
                <strong>Breaking Changes:</strong> Structural changes (e.g. removing claims, renaming keys, altering parameter types, or changing status codes) will always increment the API version (e.g. <code className="font-mono">v2</code>).
              </li>
              <li>
                <strong>Deprecation Schedule:</strong> Whenever a new major version is released, previous versions enter a deprecation transition period to allow developers adequate time to upgrade.
              </li>
            </ul>
          </div>
        </div>
      )}

      {id === 'pkce' && (
        <div className="space-y-6">
          <div className="space-y-3">
            <Badge variant="identity" className="text-xs">Security Protocol</Badge>
            <h1 className="display text-fg">
              Mandatory PKCE (RFC 7636)
            </h1>
            <p className="text-sm text-soft leading-relaxed">
              Proof Key for Code Exchange (PKCE) is strictly mandatory on PESU OAuth2. All authorization
              requests must supply a SHA-256 code challenge with <code className="font-mono">code_challenge_method=S256</code>.
              Plain challenge methods are rejected.
            </p>
          </div>

          <Card className="p-5 space-y-3 bg-surface border border-line text-xs">
            <h3 className="font-serif text-xl font-normal text-fg">
              How PKCE Protects Your Application
            </h3>
            <ol className="list-decimal list-inside space-y-2 text-soft leading-relaxed">
              <li>
                <strong>Generate Code Verifier:</strong> Generate a high-entropy cryptographically random string
                between 43 and 128 characters using <code className="font-mono">A-Z, a-z, 0-9, -, ., _, ~</code>.
              </li>
              <li>
                <strong>Compute Code Challenge:</strong> Calculate the SHA-256 hash of the verifier and encode it using
                Base64URL: <code className="font-mono">BASE64URL(SHA256(code_verifier))</code>.
              </li>
              <li>
                <strong>Authorization Request:</strong> Send <code className="font-mono">code_challenge</code> and{' '}
                <code className="font-mono">code_challenge_method=S256</code> to <code className="font-mono">/oauth2/authorize</code>.
              </li>
              <li>
                <strong>Token Exchange:</strong> Submit the original plaintext <code className="font-mono">code_verifier</code> in
                the <code className="font-mono">POST /oauth2/token</code> request. The authorization server hashes it and matches the
                original challenge before issuing tokens.
              </li>
            </ol>
          </Card>

          {/* Code Generation Sample */}
          <div className="space-y-3">
            <span className="text-xs font-semibold text-muted">TypeScript / Browser PKCE Generator</span>
            <pre className="overflow-x-auto p-4 rounded-md bg-surface-soft font-mono text-xs leading-relaxed text-fg border border-line">
{`function generateRandomString(length: number): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes).map(b => chars[b % chars.length]).join("");
}

async function generatePkcePair() {
  const codeVerifier = generateRandomString(64);
  const encoder = new TextEncoder();
  const data = encoder.encode(codeVerifier);
  const hash = await crypto.subtle.digest("SHA-256", data);
  const codeChallenge = btoa(String.fromCharCode(...new Uint8Array(hash)))
.replace(/\\+/g, "-")
.replace(/\\//g, "_")
.replace(/=+$/, "");

  return { codeVerifier, codeChallenge };
}`}
            </pre>
          </div>
          <div className="space-y-3">
            <span className="text-xs font-semibold text-muted">Python PKCE Generator</span>
            <pre className="overflow-x-auto p-4 rounded-md bg-surface-soft font-mono text-xs leading-relaxed text-fg border border-line">
{`import base64
import hashlib
import secrets


def generate_pkce_pair() -> tuple[str, str]:
    code_verifier = secrets.token_urlsafe(48)
    digest = hashlib.sha256(code_verifier.encode("ascii")).digest()
    code_challenge = base64.urlsafe_b64encode(digest).rstrip(b"=").decode("ascii")

    return code_verifier, code_challenge`}
            </pre>
          </div>
        </div>
      )}

      {id === 'scopes' && (
        <div className="space-y-6">
          <div className="space-y-3">
            <Badge variant="identity" className="text-xs">User Identity</Badge>
            <h1 className="display text-fg">
              Scopes & Student Profile Claims
            </h1>
            <p className="text-sm text-soft leading-relaxed">
              PESU OAuth2 maps verified academic credentials from PESU Academy into standardized OpenID Connect
              claims. Request only the scopes your application requires.
            </p>
          </div>

          <div className="overflow-x-auto rounded-md border border-line bg-surface">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-line bg-surface-soft text-muted">
                  <th className="py-2.5 px-3 font-semibold">Scope</th>
                  <th className="py-2.5 px-3 font-semibold">Claims Returned</th>
                  <th className="py-2.5 px-3 font-semibold">Description</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                <tr>
                  <td className="py-2.5 px-3 font-mono font-semibold text-get">
                    openid
                  </td>
                  <td className="py-2.5 px-3 font-mono text-soft">sub</td>
                  <td className="py-2.5 px-3 text-soft">
                    Mandatory for OpenID Connect. Issues an RS256-signed ID token containing the stable user identifier.
                  </td>
                </tr>
                <tr>
                  <td className="py-2.5 px-3 font-mono font-semibold text-get">
                    profile
                  </td>
                  <td className="py-2.5 px-3 font-mono text-soft">
                    name, prn, srn, program, branch, semester, section, campus
                  </td>
                  <td className="py-2.5 px-3 text-soft">
                    Student academic registration attributes synced directly with PESU Academy records.
                  </td>
                </tr>
                <tr>
                  <td className="py-2.5 px-3 font-mono font-semibold text-get">
                    email
                  </td>
                  <td className="py-2.5 px-3 font-mono text-soft">email</td>
                  <td className="py-2.5 px-3 text-soft">
                    Email address registered on PESU Academy. It may be a university or a personal address.
                  </td>
                </tr>
                <tr>
                  <td className="py-2.5 px-3 font-mono font-semibold text-get">
                    phone
                  </td>
                  <td className="py-2.5 px-3 font-mono text-soft">
                    phone_number
                  </td>
                  <td className="py-2.5 px-3 text-soft">
                    Student contact telephone number registered on file.
                  </td>
                </tr>
                <tr>
                  <td className="py-2.5 px-3 font-mono font-semibold text-get">
                    offline_access
                  </td>
                  <td className="py-2.5 px-3 font-mono text-soft">
                    refresh_token
                  </td>
                  <td className="py-2.5 px-3 text-soft">
                    Issues a long-lived refresh token supporting automatic family rotation and reuse detection.
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}

      {id === 'nextauth' && (
        <div className="space-y-6">
          <div className="space-y-3">
            <Badge variant="identity" className="text-xs">Quickstart</Badge>
            <h1 className="display text-fg">
              NextAuth.js / Auth.js Integration
            </h1>
            <p className="text-sm text-soft leading-relaxed">
              Integrating Sign in with PESU into Next.js App Router takes fewer than 20 lines of code with Auth.js.
            </p>
          </div>

          <Card className="p-6 bg-surface-soft border-line space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Code2 className="w-4 h-4 text-get" />
                <span className="font-semibold text-sm text-fg">
                  auth.ts (Root Config)
                </span>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() =>
                  onCopy(
                    `import NextAuth from "next-auth";

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
{
  id: "pesu",
  name: "PESU",
  type: "oidc",
  issuer: process.env.PESU_OIDC_ISSUER || "${issuerUrl}",
  clientId: process.env.PESU_CLIENT_ID!,
  clientSecret: process.env.PESU_CLIENT_SECRET!,
  authorization: {
    params: {
      scope: "openid profile email offline_access",
    },
  },
  checks: ["pkce", "state"],
},
  ],
});`,
                    'nextauth-code'
                  )
                }
                className="h-7 text-xs gap-1"
              >
                {copiedId === 'nextauth-code' ? (
                  <Check className="w-3 h-3 text-success" />
                ) : (
                  <Copy className="w-3 h-3" />
                )}
                <span>{copiedId === 'nextauth-code' ? 'Copied' : 'Copy'}</span>
              </Button>
            </div>

            <pre className="overflow-x-auto p-4 rounded-md bg-surface-soft font-mono text-xs leading-relaxed text-fg">
{`import NextAuth from "next-auth";

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
{
  id: "pesu",
  name: "PESU",
  type: "oidc",
  issuer: process.env.PESU_OIDC_ISSUER || "${issuerUrl}",
  clientId: process.env.PESU_CLIENT_ID!,
  clientSecret: process.env.PESU_CLIENT_SECRET!,
  authorization: {
    params: {
      scope: "openid profile email offline_access",
    },
  },
  checks: ["pkce", "state"],
},
  ],
});`}
            </pre>
          </Card>

          <div className="space-y-3">
            <span className="text-xs font-semibold text-muted">Route Handler: app/api/auth/[...nextauth]/route.ts</span>
            <pre className="overflow-x-auto p-4 rounded-md bg-surface-soft font-mono text-xs leading-relaxed text-fg border border-line">
{`import { handlers } from "@/auth";
export const { GET, POST } = handlers;`}
            </pre>
          </div>
        </div>
      )}
    </>
  );
}
