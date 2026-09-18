'use client';

import * as React from 'react';
import { Card, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { InlineAlert } from '@/components/ui/inline-alert';
import { ShieldAlert, UserCheck, Mail, Phone, RefreshCw, KeyRound } from 'lucide-react';

function ScopePermissionRow({
  icon,
  title,
  description,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <div className="flex items-start gap-3 p-3 rounded-xl bg-black/[0.02] dark:bg-white/[0.04] border border-black/5 dark:border-white/10">
      {icon}
      <div className="text-xs">
        <div className="font-semibold text-zinc-900 dark:text-zinc-100">{title}</div>
        <div className="text-zinc-500 dark:text-zinc-400 mt-0.5">{description}</div>
      </div>
    </div>
  );
}

interface ConsentClientProps {
  client: {
    clientId: string;
    name: string;
    publishingStatus: 'testing' | 'pending_production' | 'production';
    delegatedAllowed: boolean;
    ownerSub?: string;
  };
  userName: string;
  requestedScopes: string[];
  mode: 'identity' | 'delegated';
  redirectUri: string;
  state?: string;
  nonce?: string;
  codeChallenge: string;
  codeChallengeMethod: string;
}

export function ConsentClient({
  client,
  userName,
  requestedScopes,
  mode,
  redirectUri,
  state,
  nonce,
  codeChallenge,
  codeChallengeMethod,
}: ConsentClientProps) {
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const handleAction = async (action: 'allow' | 'deny') => {
    setLoading(true);
    setError(null);

    try {
      const res = await fetch('/api/oidc/consent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientId: client.clientId,
          redirectUri,
          scope: requestedScopes.join(' '),
          state,
          nonce,
          codeChallenge,
          codeChallengeMethod,
          mode,
          action,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to process consent');
      }

      if (data.redirectTo) {
        window.location.href = data.redirectTo;
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'An error occurred';
      setError(msg);
      setLoading(false);
    }
  };

  const isDelegated = mode === 'delegated' && client.delegatedAllowed;

  return (
    <div className="flex items-center justify-center min-h-[70vh] px-4 py-8">
      <Card className="w-full max-w-lg p-8 shadow-2xl">
        <div className="flex items-start justify-between gap-4 mb-6">
          <div>
            <span className="text-xs font-semibold text-zinc-500 dark:text-zinc-400">
              Sign in with PESU
            </span>
            <CardTitle className="text-2xl mt-1">{client.name}</CardTitle>
            <CardDescription className="text-xs mt-1">
              Signed in as <span className="font-medium text-zinc-900 dark:text-zinc-100">{userName}</span>
            </CardDescription>
            {client.ownerSub ? (
              <div className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
                Developer: <span className="font-mono text-zinc-700 dark:text-zinc-300">{client.ownerSub}</span>
              </div>
            ) : null}
          </div>
          <Badge variant={client.publishingStatus}>
            {client.publishingStatus.replace('_', ' ')}
          </Badge>
        </div>

        {error ? (
          <InlineAlert variant="error" message={error} className="mb-5 text-xs" />
        ) : null}

        <div className="space-y-4 mb-8">
          <p className="text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">
            This application is requesting permission to:
          </p>

          <div className="space-y-2.5">
            {requestedScopes.includes('openid') || requestedScopes.includes('profile') ? (
              <ScopePermissionRow
                icon={<UserCheck className="w-4 h-4 text-blue-600 dark:text-blue-400 mt-0.5 shrink-0" />}
                title="Access your Student Profile"
                description="Name, PRN, SRN, program, branch, semester, section, and campus."
              />
            ) : null}

            {requestedScopes.includes('email') ? (
              <ScopePermissionRow
                icon={<Mail className="w-4 h-4 text-indigo-600 dark:text-indigo-400 mt-0.5 shrink-0" />}
                title="View your Email Address"
                description="Your official university email registered on PESU Academy."
              />
            ) : null}

            {requestedScopes.includes('phone') ? (
              <ScopePermissionRow
                icon={<Phone className="w-4 h-4 text-emerald-600 dark:text-emerald-400 mt-0.5 shrink-0" />}
                title="View your Phone Number"
                description="Your contact phone number registered on PESU Academy."
              />
            ) : null}

            {requestedScopes.includes('offline_access') ? (
              <ScopePermissionRow
                icon={<RefreshCw className="w-4 h-4 text-purple-600 dark:text-purple-400 mt-0.5 shrink-0" />}
                title="Maintain Offline Access"
                description="Remain signed into this application without re-authenticating every hour."
              />
            ) : null}
          </div>

          {/* Explicit storage sentence */}
          <div
            className={`p-4 rounded-xl border text-xs leading-relaxed flex items-start gap-3 ${
              isDelegated
                ? 'bg-purple-500/10 border-purple-500/20 text-purple-900 dark:text-purple-300'
                : 'bg-blue-500/10 border-blue-500/20 text-blue-900 dark:text-blue-300'
            }`}
          >
            {isDelegated ? (
              <>
                <KeyRound className="w-4 h-4 shrink-0 text-purple-600 dark:text-purple-400 mt-0.5" />
                <div>
                  <span className="font-semibold">Delegated Credential Vault:</span> We will securely encrypt and store your PESU Academy password and session in our vault because this client is authorized to execute operations on your behalf.
                </div>
              </>
            ) : (
              <>
                <ShieldAlert className="w-4 h-4 shrink-0 text-blue-600 dark:text-blue-400 mt-0.5" />
                <div>
                  <span className="font-semibold">Identity Only:</span> We do not store your PESU password. This application cannot access or modify your PESU Academy account.
                </div>
              </>
            )}
          </div>

          {/* Redirect URI notice */}
          <div className="text-xs text-zinc-500 dark:text-zinc-400 flex items-center gap-1.5 break-all">
            <span>Redirects to:</span>
            <span className="font-mono text-zinc-700 dark:text-zinc-300">{redirectUri}</span>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <Button
            variant="secondary"
            className="flex-1"
            onClick={() => handleAction('deny')}
            disabled={loading}
          >
            Deny
          </Button>
          <Button
            variant="primary"
            className="flex-1"
            onClick={() => handleAction('allow')}
            loading={loading}
          >
            Allow
          </Button>
        </div>
      </Card>
    </div>
  );
}
