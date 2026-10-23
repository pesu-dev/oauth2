'use client';

import * as React from 'react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { InlineAlert } from '@/components/ui/inline-alert';
import { ShieldAlert, UserCheck, Mail, Phone, RefreshCw, KeyRound, Database } from 'lucide-react';
import { getScope } from '@/lib/oidc/scopes';

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
    <li className="flex items-start gap-3 py-3">
      {icon}
      <div className="text-sm">
        <div className="text-fg">{title}</div>
        <div className="text-muted text-xs mt-0.5 leading-relaxed">{description}</div>
      </div>
    </li>
  );
}

interface ConsentClientProps {
  client: {
    clientId: string;
    name: string;
    publishingStatus: 'testing' | 'pending_production' | 'production' | 'suspended';
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
      const res = await fetch('/api/internal/consent', {
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
  const resourceScopes = requestedScopes
    .map((name) => getScope(name))
    .filter((def): def is NonNullable<typeof def> => def?.kind === 'resource');

  return (
    <div className="flex justify-center py-6 min-[701px]:py-12">
      <div className="w-full max-w-[520px] space-y-6">
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-4">
            <p className="eyebrow">Sign in with PESU</p>
            <Badge variant={client.publishingStatus}>
              {client.publishingStatus.replace('_', ' ')}
            </Badge>
          </div>
          <h1 className="font-serif text-[36px] font-normal leading-[1.05] text-fg break-words">{client.name}</h1>
          <p className="text-sm text-soft">
            wants to sign you in. You are signed in as <span className="text-fg">{userName}</span>.
          </p>
        </div>

        <Card className="p-0">
          {error ? (
            <div className="p-5 pb-0">
              <InlineAlert variant="error" message={error} className="text-xs" />
            </div>
          ) : null}

          <dl className="grid grid-cols-[110px_1fr] gap-x-4 gap-y-2 p-5 border-b border-line text-xs">
            {client.ownerSub ? (
              <>
                <dt className="eyebrow pt-0.5">Developer</dt>
                <dd className="font-mono text-soft break-all">{client.ownerSub}</dd>
              </>
            ) : null}
            <dt className="eyebrow pt-0.5">Redirects to</dt>
            <dd className="font-mono text-soft break-all">{redirectUri}</dd>
          </dl>

          <div className="px-5 pt-4">
            <p className="eyebrow">This application is requesting permission to:</p>
            <ul className="divide-y divide-line list-none p-0">
              {requestedScopes.includes('openid') || requestedScopes.includes('profile') ? (
                <ScopePermissionRow
                  icon={<UserCheck className="w-4 h-4 text-muted mt-0.5 shrink-0" />}
                  title="Access your Student Profile"
                  description="Name, PRN, SRN, program, branch, semester, section, and campus."
                />
              ) : null}

              {requestedScopes.includes('email') ? (
                <ScopePermissionRow
                  icon={<Mail className="w-4 h-4 text-muted mt-0.5 shrink-0" />}
                  title="View your Email Address"
                  description="Your official university email registered on PESU Academy."
                />
              ) : null}

              {requestedScopes.includes('phone') ? (
                <ScopePermissionRow
                  icon={<Phone className="w-4 h-4 text-muted mt-0.5 shrink-0" />}
                  title="View your Phone Number"
                  description="Your contact phone number registered on PESU Academy."
                />
              ) : null}

              {requestedScopes.includes('offline_access') ? (
                <ScopePermissionRow
                  icon={<RefreshCw className="w-4 h-4 text-muted mt-0.5 shrink-0" />}
                  title="Maintain Offline Access"
                  description="Remain signed into this application without re-authenticating every hour."
                />
              ) : null}
            </ul>
          </div>

          {resourceScopes.length > 0 ? (
            <div className="px-5 pt-4 border-t border-line">
              <p className="eyebrow">PESU Academy data, read on your behalf:</p>
              <ul className="divide-y divide-line list-none p-0">
                {resourceScopes.map((def) => (
                  <ScopePermissionRow
                    key={def.name}
                    icon={<Database className={`w-4 h-4 mt-0.5 shrink-0 ${def.sensitive ? 'text-warning' : 'text-muted'}`} />}
                    title={def.consentLabel}
                    description={def.description}
                  />
                ))}
              </ul>
            </div>
          ) : null}

          {/* Explicit storage sentence */}
          <div
            className={`m-5 mt-2 p-4 rounded-[5px] border text-xs leading-relaxed flex items-start gap-3 ${
              isDelegated ? 'bg-json-key/5 border-json-key/40 text-fg' : 'bg-surface-soft border-line text-fg'
            }`}
          >
            {isDelegated ? (
              <>
                <KeyRound className="w-4 h-4 shrink-0 text-json-key mt-0.5" />
                <div>
                  <span className="font-bold text-json-key">Delegated Credential Vault:</span> We will securely encrypt and store your PESU Academy password and session in our vault because this client is authorized to execute operations on your behalf.
                </div>
              </>
            ) : (
              <>
                <ShieldAlert className="w-4 h-4 shrink-0 text-success mt-0.5" />
                <div>
                  <span className="font-bold text-success">Identity Only:</span> We do not store your PESU password. This application cannot access or modify your PESU Academy account.
                </div>
              </>
            )}
          </div>

          <div className="flex items-center gap-3 p-5 border-t border-line">
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

        <p className="text-xs text-muted">
          You can revoke this app at any time in <a href="/settings" className="underline hover:text-fg">Settings</a>.{' '}
          <a href="/privacy" className="underline hover:text-fg">Privacy</a> ·{' '}
          <a href="/faq" className="underline hover:text-fg">FAQ</a>
        </p>
      </div>
    </div>
  );
}
