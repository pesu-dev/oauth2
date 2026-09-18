'use client';

import * as React from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Card, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
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
      const res = await fetch('/api/auth/login', {
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
    <div className="flex items-center justify-center min-h-[70vh] px-4">
      <Card className="w-full max-w-md p-8 shadow-xl">
        <CardHeader
          icon={<ShieldCheck className="w-5 h-5" />}
          iconColor="blue"
          className="mb-6"
        >
          <CardTitle className="text-xl">Sign in with PESU</CardTitle>
          <CardDescription className="text-xs">
            Use your official PESU Academy credentials
          </CardDescription>
        </CardHeader>

        {error ? (
          <InlineAlert
            variant="error"
            message={error}
            icon={<AlertCircle className="w-4 h-4" />}
            className="mb-5 text-xs p-3"
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
            disabled={loading}
          />

          <Input
            label="Password"
            type="password"
            placeholder="Academy Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoComplete="current-password"
            disabled={loading}
          />

          <Button
            type="submit"
            className="w-full mt-2"
            size="lg"
            loading={loading}
          >
            Authenticate
          </Button>
        </form>

        <p className="text-center text-xs text-zinc-400 dark:text-zinc-500 mt-6 leading-relaxed">
          Your credentials are authenticated directly with PESU Academy. In identity mode, your password is never stored on our servers.
        </p>
      </Card>
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
