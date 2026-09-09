import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Terminal, Code, Link2 } from 'lucide-react';

const ENDPOINTS = [
  {
    method: 'GET',
    path: '/.well-known/openid-configuration',
    desc: 'OIDC Discovery document containing server capabilities and URLs.',
  },
  {
    method: 'GET',
    path: '/jwks.json',
    desc: 'Public JSON Web Key Set (RS256) used to verify access and ID token signatures.',
  },
  {
    method: 'GET',
    path: '/authorize',
    desc: 'Authorization endpoint. Mandates response_type=code and PKCE code_challenge (S256).',
  },
  {
    method: 'POST',
    path: '/token',
    desc: 'Token endpoint supporting grant_type=authorization_code and grant_type=refresh_token.',
  },
  {
    method: 'GET/POST',
    path: '/userinfo',
    desc: 'Returns student profile claims for valid Bearer access tokens.',
  },
  {
    method: 'POST',
    path: '/revoke',
    desc: 'RFC 7009 endpoint to revoke refresh tokens.',
  },
];

export default function DocsPage() {
  return (
    <div className="max-w-4xl mx-auto py-6 space-y-10">
      <div className="space-y-2">
        <Badge variant="production" className="text-xs">Developer Documentation</Badge>
        <h1 className="text-3xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
          Integrating Sign in with PESU
        </h1>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          Complete API reference and integration guidelines for OpenID Connect clients.
        </p>
      </div>

      {/* Protocol Endpoints */}
      <section className="space-y-4">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-zinc-400">
          <Link2 className="w-4 h-4" /> Protocol Endpoints
        </div>

        <div className="grid grid-cols-1 gap-3">
          {ENDPOINTS.map((ep, i) => (
            <Card key={i} className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="space-y-1">
                <div className="flex items-center gap-2.5">
                  <Badge variant={ep.method.includes('POST') ? 'pending' : 'neutral'}>
                    {ep.method}
                  </Badge>
                  <code className="font-mono text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                    {ep.path}
                  </code>
                </div>
                <p className="text-xs text-zinc-500 dark:text-zinc-400">{ep.desc}</p>
              </div>
            </Card>
          ))}
        </div>
      </section>

      {/* NextAuth Example */}
      <section className="space-y-4">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-zinc-400">
          <Code className="w-4 h-4" /> NextAuth.js / Auth.js Configuration
        </div>

        <Card className="p-6 bg-black/[0.02] dark:bg-black/40 border-black/10 dark:border-white/10 space-y-4">
          <div className="flex items-center justify-between">
            <span className="font-mono text-xs text-zinc-400">auth.ts / [...nextauth].ts</span>
            <span className="text-xs text-zinc-500">TypeScript</span>
          </div>

          <pre className="overflow-x-auto p-4 rounded-xl bg-black/5 dark:bg-black/60 font-mono text-xs leading-relaxed text-zinc-800 dark:text-zinc-200">
{`import NextAuth from "next-auth";

export const { handlers, auth } = NextAuth({
  providers: [
    {
      id: "pesu",
      name: "PESU",
      type: "oidc",
      issuer: process.env.PESU_OIDC_ISSUER || "https://auth.pesu.dev",
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
      </section>

      {/* PKCE Requirement Notice */}
      <section className="p-4 rounded-2xl bg-amber-500/10 border border-amber-500/20 text-amber-800 dark:text-amber-200 text-xs flex items-start gap-3">
        <Terminal className="w-4 h-4 mt-0.5 shrink-0" />
        <div className="leading-relaxed">
          <span className="font-semibold">PKCE is mandatory:</span> All authorization requests to <code className="font-mono font-semibold">/authorize</code> must include a valid <code className="font-mono font-semibold">code_challenge</code> with <code className="font-mono font-semibold">code_challenge_method=S256</code>. Plain challenge methods are rejected.
        </div>
      </section>
    </div>
  );
}
