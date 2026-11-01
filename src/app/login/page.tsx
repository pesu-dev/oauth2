'use client';

import * as React from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { InlineAlert } from '@/components/ui/inline-alert';
import { PageLoader } from '@/components/ui/page-loader';
import { ShieldCheck, AlertCircle } from 'lucide-react';

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const returnTo = searchParams.get('return_to') || '/portal';

  const [username, setUsername] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const res = await fetch('/api/internal/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password, returnTo }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Authentication failed');
      }

      router.push(data.redirectTo || returnTo);
      router.refresh();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Invalid credentials';
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex justify-center py-6 min-[701px]:py-12">
      <div className="w-full max-w-[420px] space-y-6">
        <div className="space-y-3">
          <p className="eyebrow flex items-center gap-2">
            <ShieldCheck className="w-3.5 h-3.5" /> PESU Academy account
          </p>
          <h1 className="font-serif text-[36px] font-normal leading-[1.05] text-fg">Sign in with PESU</h1>
          <p className="text-sm text-soft leading-[1.65]">
            Use your PESU Academy PRN or SRN and password. They go straight to PESU Academy to check who you are.
          </p>
        </div>

        <Card className="p-6 space-y-5">
          {error ? (
            <InlineAlert
              variant="error"
              message={error}
              icon={<AlertCircle className="w-4 h-4" />}
              className="text-xs"
            />
          ) : null}

          <form onSubmit={handleSubmit} className="space-y-4">
            <Input
              label="PRN or SRN"
              placeholder="e.g. PES1UG20CS001"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              autoComplete="username"
              spellCheck={false}
              disabled={loading}
            />

            <Input
              label="Password"
              type="password"
              placeholder="Academy password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="current-password"
              disabled={loading}
            />

            <Button type="submit" className="w-full" size="lg" loading={loading}>
              Authenticate
            </Button>
          </form>
        </Card>

        <p className="text-xs text-muted leading-[1.65]">
          For identity-only apps your password is used once and never stored. Apps approved for delegated access say so
          on the next screen before anything is kept.{' '}
          <a href="/privacy" className="underline hover:text-fg">Privacy</a> ·{' '}
          <a href="/faq" className="underline hover:text-fg">FAQ</a>
        </p>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <React.Suspense fallback={<PageLoader />}>
      <LoginForm />
    </React.Suspense>
  );
}
