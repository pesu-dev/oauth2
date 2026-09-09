import Link from 'next/link';
import { Card, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ShieldCheck, Key, Lock, ArrowRight, Layers, FileCode } from 'lucide-react';

export default function HomePage() {
  return (
    <div className="space-y-16 py-8">
      {/* Hero section */}
      <section className="text-center space-y-6 max-w-3xl mx-auto pt-6">
        <Badge variant="production" className="px-3 py-1 text-xs">
          OpenID Connect 1.0 Provider
        </Badge>
        <h1 className="text-4xl sm:text-6xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50 leading-[1.1]">
          Sign in with PESU.
          <br />
          <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-600 via-indigo-600 to-purple-600 dark:from-blue-400 dark:via-indigo-400 dark:to-purple-400">
            Privacy-first identity.
          </span>
        </h1>
        <p className="text-base sm:text-lg text-zinc-600 dark:text-zinc-400 max-w-2xl mx-auto leading-relaxed">
          The official-grade, unofficial OAuth 2.0 authorization server for student apps, clubs, and developers across PES University.
        </p>
        <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
          <Link href="/portal">
            <Button size="lg" className="shadow-lg shadow-blue-500/20">
              Developer Portal <ArrowRight className="w-4 h-4 ml-1" />
            </Button>
          </Link>
          <Link href="/docs">
            <Button variant="secondary" size="lg">
              Read the Docs
            </Button>
          </Link>
        </div>
      </section>

      {/* Trust & Architecture Grid */}
      <section className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card className="hover:border-black/15 dark:hover:border-white/20 transition-all">
          <div className="w-10 h-10 rounded-xl bg-blue-500/10 text-blue-600 dark:text-blue-400 flex items-center justify-center mb-4">
            <ShieldCheck className="w-5 h-5" />
          </div>
          <CardTitle>Zero Password Exposure</CardTitle>
          <CardDescription className="mt-2">
            Third-party apps receive standard RS256 JWT tokens. They never see, touch, or handle your PESU Academy password.
          </CardDescription>
        </Card>

        <Card className="hover:border-black/15 dark:hover:border-white/20 transition-all">
          <div className="w-10 h-10 rounded-xl bg-purple-500/10 text-purple-600 dark:text-purple-400 flex items-center justify-center mb-4">
            <Lock className="w-5 h-5" />
          </div>
          <CardTitle>AES-256-GCM Vault</CardTitle>
          <CardDescription className="mt-2">
            Delegated client integrations store credentials in an isolated vault using envelope encryption with per-user data keys.
          </CardDescription>
        </Card>

        <Card className="hover:border-black/15 dark:hover:border-white/20 transition-all">
          <div className="w-10 h-10 rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center mb-4">
            <Key className="w-5 h-5" />
          </div>
          <CardTitle>Strict PKCE Required</CardTitle>
          <CardDescription className="mt-2">
            Every authorization flow mandates Proof Key for Code Exchange (S256), preventing authorization code interception attacks.
          </CardDescription>
        </Card>
      </section>

      {/* Developer Experience Showcase */}
      <section className="rounded-3xl border border-black/[0.08] dark:border-white/[0.12] bg-white/50 dark:bg-zinc-900/50 backdrop-blur-xl p-8 sm:p-12 overflow-hidden relative">
        <div className="max-w-2xl space-y-4">
          <div className="flex items-center gap-2 text-xs font-semibold text-blue-600 dark:text-blue-400 uppercase tracking-wider">
            <Layers className="w-4 h-4" /> Seamless Integration
          </div>
          <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
            Standard OIDC. Works with NextAuth, Lucia, and Passport.
          </h2>
          <p className="text-sm sm:text-base text-zinc-600 dark:text-zinc-400 leading-relaxed">
            Configure your client ID and redirect URI in the portal. Point your library to our discovery document at <code className="bg-black/5 dark:bg-white/10 px-1.5 py-0.5 rounded text-xs font-mono">/.well-known/openid-configuration</code> and start signing in students in minutes.
          </p>
          <div className="pt-4 flex items-center gap-4">
            <Link href="/docs">
              <Button variant="outline" size="sm">
                <FileCode className="w-4 h-4 mr-1.5" /> Integration Code Examples
              </Button>
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
