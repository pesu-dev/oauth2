'use client';

import * as React from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { Card, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { getScope, resourceScopeNames } from '@/lib/oidc/scopes';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { PageLoader } from '@/components/ui/page-loader';
import { InlineAlert } from '@/components/ui/inline-alert';
import { DrawerActions } from '@/components/ui/drawer-actions';
import {
  Drawer,
  DrawerTrigger,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerDescription,
} from '@/components/ui/drawer';
import {
  ArrowLeft,
  Plus,
  Trash2,
  Rocket,
  Check,
  Copy,
  RefreshCw,
  KeyRound,
  AlertTriangle,
  CheckCircle2,
} from 'lucide-react';

interface ClientData {
  client_id: string;
  name: string;
  publishing_status: 'testing' | 'pending_production' | 'production' | 'suspended';
  redirect_uris: string[];
  delegated_allowed: boolean;
  allowed_scopes?: string[];
  device_flow_enabled?: boolean;
  logo_image_id?: string | null;
  logo_status?: 'pending' | 'approved' | 'rejected' | null;
  suspension_reason?: string | null;
  suspended_at?: string | null;
}

interface TesterData {
  client_id: string;
  sub: string;
  added_at: string;
}

export default function ClientDetailPage() {
  const params = useParams();
  const clientId = params.clientId as string;

  const [client, setClient] = React.useState<ClientData | null>(null);
  const [testers, setTesters] = React.useState<TesterData[]>([]);
  const [loading, setLoading] = React.useState(true);

  // Edit redirect URIs state
  const [redirectUris, setRedirectUris] = React.useState<string[]>([]);
  const [newUriInput, setNewUriInput] = React.useState('');
  const [savingUris, setSavingUris] = React.useState(false);
  const [uriSuccess, setUriSuccess] = React.useState(false);

  // Secret rotation state
  const [isRotateSecretOpen, setIsRotateSecretOpen] = React.useState(false);
  const [rotatingSecret, setRotatingSecret] = React.useState(false);
  const [rotatedSecret, setRotatedSecret] = React.useState<string | null>(null);
  const [copiedRotatedSecret, setCopiedRotatedSecret] = React.useState(false);
  const [rotateError, setRotateError] = React.useState<string | null>(null);

  // Tester input state
  const [testerInput, setTesterInput] = React.useState('');
  const [addingTester, setAddingTester] = React.useState(false);

  // Production request state
  const [isProdDrawerOpen, setIsProdDrawerOpen] = React.useState(false);
  const [justification, setJustification] = React.useState('');
  const [delegatedRequested, setDelegatedRequested] = React.useState(false);
  const [requestedScopes, setRequestedScopes] = React.useState<string[]>([]);
  const [prodError, setProdError] = React.useState<string | null>(null);
  const [deviceSaving, setDeviceSaving] = React.useState(false);
  const [permissions, setPermissions] = React.useState<{ secrets: boolean; publish: boolean }>({ secrets: true, publish: true });
  const [team, setTeam] = React.useState<{ team_id: string; name: string } | null>(null);
  const [logoError, setLogoError] = React.useState<string | null>(null);
  const [logoBusy, setLogoBusy] = React.useState(false);
  const logoInput = React.useRef<HTMLInputElement>(null);

  const uploadLogo = async (file: File) => {
    setLogoError(null);
    if (file.size > 256 * 1024) {
      setLogoError('Images must be 256 KB or smaller');
      return;
    }
    setLogoBusy(true);
    try {
      const form = new FormData();
      form.append('file', file);
      const res = await fetch(`/api/internal/portal/clients/${clientId}/logo`, { method: 'POST', body: form });
      const data = await res.json();
      if (!res.ok) {
        setLogoError(data.error || 'Upload failed');
      } else {
        setClient((prev) => (prev ? { ...prev, logo_image_id: data.logo.image_id, logo_status: 'pending' } : prev));
      }
    } finally {
      setLogoBusy(false);
      if (logoInput.current) logoInput.current.value = '';
    }
  };

  const removeLogo = async () => {
    setLogoBusy(true);
    try {
      const res = await fetch(`/api/internal/portal/clients/${clientId}/logo`, { method: 'DELETE' });
      if (res.ok) setClient((prev) => (prev ? { ...prev, logo_image_id: null, logo_status: null } : prev));
    } finally {
      setLogoBusy(false);
    }
  };

  const toggleDeviceFlow = async (enabled: boolean) => {
    setDeviceSaving(true);
    try {
      const res = await fetch(`/api/internal/portal/clients/${clientId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deviceFlowEnabled: enabled }),
      });
      if (res.ok) {
        setClient((prev) => (prev ? { ...prev, device_flow_enabled: enabled } : prev));
      }
    } finally {
      setDeviceSaving(false);
    }
  };
  const [prodLoading, setProdLoading] = React.useState(false);

  const [copiedId, setCopiedId] = React.useState(false);

  const fetchData = React.useCallback(async () => {
    try {
      const res = await fetch(`/api/internal/portal/clients/${clientId}`);
      const data = await res.json();
      if (res.ok) {
        setClient(data.client);
        setTesters(data.testers || []);
        setPermissions(data.permissions ?? { secrets: true, publish: true });
        setTeam(data.team ?? null);
        setRedirectUris(data.client.redirect_uris || []);
      }
    } finally {
      setLoading(false);
    }
  }, [clientId]);

  React.useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleUriChange = (index: number, value: string) => {
    setRedirectUris((prev) => {
      const updated = [...prev];
      updated[index] = value;
      return updated;
    });
  };

  const handleRemoveUri = (index: number) => {
    setRedirectUris((prev) => prev.filter((_, idx) => idx !== index));
  };

  const handleAddUriRow = () => {
    setRedirectUris((prev) => [...prev, '']);
  };

  const handleQuickAddUri = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = newUriInput.trim();
    if (!trimmed) return;
    if (!redirectUris.includes(trimmed)) {
      setRedirectUris((prev) => [...prev, trimmed]);
    }
    setNewUriInput('');
  };

  const handleSaveUris = async () => {
    setSavingUris(true);
    setUriSuccess(false);

    const allUris = [...redirectUris];
    if (newUriInput.trim() && !allUris.includes(newUriInput.trim())) {
      allUris.push(newUriInput.trim());
      setNewUriInput('');
    }

    const cleanedUris = allUris
      .map((u) => u.trim())
      .filter(Boolean);

    try {
      const res = await fetch(`/api/internal/portal/clients/${clientId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ redirectUris: cleanedUris }),
      });
      if (res.ok) {
        setRedirectUris(cleanedUris);
        setUriSuccess(true);
        setTimeout(() => setUriSuccess(false), 2500);
      }
    } finally {
      setSavingUris(false);
    }
  };

  const handleRotateSecret = async () => {
    setRotatingSecret(true);
    setRotateError(null);
    try {
      const res = await fetch(`/api/internal/portal/clients/${clientId}/rotate-secret`, {
        method: 'POST',
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to rotate client secret');
      }
      setRotatedSecret(data.clientSecret);
      setIsRotateSecretOpen(false);
    } catch (err: unknown) {
      setRotateError(err instanceof Error ? err.message : 'Error rotating secret');
    } finally {
      setRotatingSecret(false);
    }
  };

  const handleAddTester = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!testerInput.trim()) return;
    setAddingTester(true);

    try {
      const res = await fetch(`/api/internal/portal/clients/${clientId}/testers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier: testerInput.trim() }),
      });
      if (res.ok) {
        setTesterInput('');
        fetchData();
      }
    } finally {
      setAddingTester(false);
    }
  };

  const handleRemoveTester = async (sub: string) => {
    await fetch(`/api/internal/portal/clients/${clientId}/testers?sub=${encodeURIComponent(sub)}`, {
      method: 'DELETE',
    });
    fetchData();
  };

  const handleRequestProduction = async (e: React.FormEvent) => {
    e.preventDefault();
    setProdLoading(true);
    setProdError(null);

    try {
      const res = await fetch(`/api/internal/portal/clients/${clientId}/request-production`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          justification,
          delegatedRequested,
          requestedScopes,
          // Testing apps ask for Production; live apps ask for extra API scopes only
          productionRequested: client?.publishing_status === 'testing',
        }),
      });
      if (res.ok) {
        setIsProdDrawerOpen(false);
        setJustification('');
        setDelegatedRequested(false);
        setRequestedScopes([]);
        fetchData();
      } else {
        const data = await res.json().catch(() => ({}));
        setProdError(data.error || 'Request failed');
      }
    } finally {
      setProdLoading(false);
    }
  };

  const copyClientId = () => {
    navigator.clipboard.writeText(clientId);
    setCopiedId(true);
    setTimeout(() => setCopiedId(false), 2000);
  };

  if (loading) {
    return <PageLoader message="Loading details..." />;
  }

  if (!client) {
    return (
      <div className="py-16 text-center text-sm text-muted">
        Application not found.{' '}
        <Link href="/portal" className="underline">
          Back to Portal
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-8 py-4 max-w-4xl mx-auto">
      <div>
        <Link
          href="/portal"
          className="inline-flex items-center text-xs font-medium text-muted hover:text-fg transition-colors mb-4"
        >
          <ArrowLeft className="w-3.5 h-3.5 mr-1" /> Back to applications
        </Link>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="font-serif text-[36px] font-normal leading-[1.05] text-fg break-words">
                {client.name}
              </h1>
              {team ? (
                <Link href={`/portal/teams/${team.team_id}`} className="no-underline">
                  <Badge variant="neutral">Team: {team.name}</Badge>
                </Link>
              ) : null}
              <Badge variant={client.publishing_status}>
                {client.publishing_status.replace('_', ' ')}
              </Badge>
              {client.delegated_allowed && (
                <Badge variant="delegated">
                  Delegated Access
                </Badge>
              )}
            </div>
            <div className="flex items-center gap-2 font-mono text-xs text-muted mt-2">
              <span>Client ID: {client.client_id}</span>
              <Button
                variant="ghost"
                size="sm"
                onClick={copyClientId}
                className="h-6 w-6 p-0 hover:text-fg"
                title="Copy Client ID"
              >
                {copiedId ? <Check className="w-3.5 h-3.5 text-success" /> : <Copy className="w-3.5 h-3.5" />}
              </Button>
            </div>
          </div>

          {permissions.publish && (client.publishing_status === 'testing' || client.publishing_status === 'production') ? (
            <Drawer open={isProdDrawerOpen} onOpenChange={setIsProdDrawerOpen}>
              <DrawerTrigger asChild>
                <Button variant={client.publishing_status === 'testing' ? 'primary' : 'secondary'}>
                  {client.publishing_status === 'testing' ? (
                    <>
                      <Rocket className="w-4 h-4 mr-1.5" /> Request Production
                    </>
                  ) : (
                    <>
                      <KeyRound className="w-4 h-4 mr-1.5" /> Request API Access
                    </>
                  )}
                </Button>
              </DrawerTrigger>
              <DrawerContent className="max-w-xl mx-auto">
                <DrawerHeader>
                  <DrawerTitle>
                    {client.publishing_status === 'testing' ? 'Request Production Publishing' : 'Request API Access'}
                  </DrawerTitle>
                  <DrawerDescription>
                    {client.publishing_status === 'testing'
                      ? 'Production approval removes tester restrictions so any authenticated student can sign in.'
                      : 'Ask an admin to approve additional PESU Academy data scopes for this app.'}
                  </DrawerDescription>
                </DrawerHeader>

                <form onSubmit={handleRequestProduction} className="space-y-4">
                  {prodError ? <InlineAlert variant="error" message={prodError} className="text-xs" /> : null}
                  <Textarea
                    label="Justification & Club / Project Context"
                    rows={4}
                    placeholder="Explain your app's purpose, target audience, and why each requested scope is needed..."
                    value={justification}
                    onChange={(e) => setJustification(e.target.value)}
                    required
                  />

                  <fieldset className="space-y-2">
                    <legend className="eyebrow mb-1">PESU Academy data scopes (optional)</legend>
                    <p className="text-[11px] text-muted">
                      Each scope lets your app read that data through the resource API. Students see every scope on
                      the consent screen, and their credentials are stored in the vault.
                    </p>
                    <div className="grid grid-cols-1 min-[701px]:grid-cols-2 gap-2">
                      {resourceScopeNames().map((name) => {
                        const def = getScope(name)!;
                        const approved = (client.allowed_scopes ?? []).includes(name);
                        return (
                          <label
                            key={name}
                            className={`flex items-start gap-2 p-2 rounded-[5px] border border-line text-xs ${approved ? 'opacity-60' : 'cursor-pointer hover:bg-surface-soft'}`}
                          >
                            <input
                              type="checkbox"
                              className="mt-0.5 w-4 h-4"
                              disabled={approved}
                              checked={approved || requestedScopes.includes(name)}
                              onChange={(e) =>
                                setRequestedScopes((prev) =>
                                  e.target.checked ? [...prev, name] : prev.filter((s) => s !== name)
                                )
                              }
                            />
                            <span>
                              <code className="font-mono text-fg">{name}</code>
                              <span className="block text-muted">{approved ? 'Already approved' : def.description}</span>
                            </span>
                          </label>
                        );
                      })}
                    </div>
                  </fieldset>

                  {client.publishing_status === 'testing' ? (
                    <div className="flex items-start gap-2.5 pt-1">
                      <input
                        type="checkbox"
                        id="delegatedRequested"
                        checked={delegatedRequested}
                        onChange={(e) => setDelegatedRequested(e.target.checked)}
                        className="mt-0.5 rounded border-line-strong w-4 h-4"
                      />
                      <label
                        htmlFor="delegatedRequested"
                        className="text-xs text-soft cursor-pointer select-none"
                      >
                        <span className="font-medium text-fg">Request Delegated Credential Vault Access</span>
                        <p className="text-muted text-[11px] mt-0.5">
                          Enables token exchange for encrypted Academy student credentials. Requires explicit justification and review.
                        </p>
                      </label>
                    </div>
                  ) : null}

                  <DrawerActions
                    onCancel={() => setIsProdDrawerOpen(false)}
                    submitLabel="Submit for Review"
                    loading={prodLoading}
                  />
                </form>
              </DrawerContent>
            </Drawer>
          ) : null}
        </div>
      </div>

      {/* Application Suspended Banner */}
      {client.publishing_status === 'suspended' && (
        <Card className="p-4 bg-danger/5 border border-danger/40 space-y-2 text-danger">
          <div className="flex items-center gap-2 font-semibold text-sm">
            <AlertTriangle className="w-4 h-4 text-danger" />
            <span>Application Suspended by Administrator</span>
          </div>
          <p className="text-xs leading-relaxed text-danger">
            This application has been suspended. Authorization and token exchange requests for this client are currently blocked.
          </p>
          {client.suspension_reason && (
            <div className="mt-2 pt-2 border-t border-danger/40 text-xs">
              <span className="font-semibold block mb-0.5 text-danger">Reason:</span>
              <p className="text-danger">{client.suspension_reason}</p>
            </div>
          )}
        </Card>
      )}

      {/* Rotated Secret Banner */}
      {rotatedSecret && (
        <Card className="p-4 bg-success/5 border border-success/40 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-success font-semibold text-sm">
              <CheckCircle2 className="w-4 h-4 text-success" />
              <span>New Client Secret Generated</span>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setRotatedSecret(null)}
              className="h-auto p-0 text-xs font-medium text-muted hover:text-soft hover:bg-transparent"
            >
              Dismiss
            </Button>
          </div>
          <p className="text-xs text-success">
            Please copy your new secret now. For security reasons, it will not be displayed again.
          </p>
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-2.5 rounded-md bg-surface border border-success/40 font-mono text-xs">
            <span className="select-all break-all text-fg font-semibold">{rotatedSecret}</span>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={() => {
                navigator.clipboard.writeText(rotatedSecret);
                setCopiedRotatedSecret(true);
                setTimeout(() => setCopiedRotatedSecret(false), 2000);
              }}
              className="shrink-0 text-xs flex items-center gap-1.5 self-end sm:self-center"
            >
              {copiedRotatedSecret ? (
                <>
                  <Check className="w-3.5 h-3.5 text-success" /> Copied!
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5" /> Copy Secret
                </>
              )}
            </Button>
          </div>
        </Card>
      )}

      {/* Client Credentials Card */}
      <Card>
        <CardTitle className="text-lg flex items-center gap-2">
          <KeyRound className="w-4 h-4 text-get" />
          <span>Client Credentials</span>
        </CardTitle>
        <CardDescription className="mt-1">
          OAuth2 authentication credentials for code exchange and server-to-server calls.
        </CardDescription>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-soft">
              Client ID
            </label>
            <div className="flex items-center gap-2">
              <div className="flex-1 p-2.5 rounded-md bg-surface-soft border border-line font-mono text-xs select-all text-fg truncate">
                {client.client_id}
              </div>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={copyClientId}
                className="shrink-0"
              >
                {copiedId ? <Check className="w-3.5 h-3.5 text-success" /> : <Copy className="w-3.5 h-3.5" />}
                <span className="ml-1">{copiedId ? 'Copied' : 'Copy'}</span>
              </Button>
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-soft">
              Client Secret
            </label>
            <div className="flex items-center gap-2">
              <div className="flex-1 p-2.5 rounded-md bg-surface-soft border border-line font-mono text-xs text-muted tracking-wider select-none">
                ••••••••••••••••••••••••••••••••
              </div>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={!permissions.secrets}
                title={permissions.secrets ? undefined : 'Only team owners and admins can rotate the secret'}
                onClick={() => setIsRotateSecretOpen(true)}
                className="shrink-0 text-xs flex items-center gap-1.5 text-soft"
              >
                <RefreshCw className="w-3.5 h-3.5 text-warning" />
                <span>Rotate Secret</span>
              </Button>
            </div>
          </div>
        </div>
      </Card>

      <Card>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="text-lg">API Scopes</CardTitle>
            <CardDescription className="mt-1">
              Identity scopes (openid, profile, email, phone, offline_access) are always available. PESU Academy data
              scopes need admin approval.
            </CardDescription>
          </div>
        </div>
        <div className="flex flex-wrap gap-2 mt-4">
          {(client.allowed_scopes ?? []).length === 0 ? (
            <p className="text-xs text-muted">No PESU Academy data scopes approved yet.</p>
          ) : (
            (client.allowed_scopes ?? []).map((name) => (
              <Badge key={name} variant="delegated" title={getScope(name)?.description}>
                {name}
              </Badge>
            ))
          )}
        </div>
      </Card>

      <Card>
        <label className="flex items-start gap-3 cursor-pointer">
          <input
            type="checkbox"
            className="mt-1 w-4 h-4"
            checked={Boolean(client.device_flow_enabled)}
            disabled={deviceSaving}
            onChange={(e) => toggleDeviceFlow(e.target.checked)}
            aria-describedby="device-flow-help"
          />
          <span>
            <CardTitle className="text-lg">Device sign-in</CardTitle>
            <span id="device-flow-help" className="block text-sm text-soft mt-1">
              Let TVs, CLIs and kiosks sign students in with a short code (RFC 8628), the way GitHub CLI does. Your
              device calls <code className="font-mono text-xs">POST /oauth2/device_authorization</code> and students
              enter the code at <code className="font-mono text-xs">/device</code>.
            </span>
          </span>
        </label>
      </Card>

      <Card>
        <div className="flex flex-col min-[701px]:flex-row gap-5 min-[701px]:items-center">
          <div className="w-20 h-20 shrink-0 rounded-md border border-line bg-surface-soft grid place-items-center overflow-hidden">
            {client.logo_image_id ? (
              // eslint-disable-next-line @next/next/no-img-element -- same-origin uploaded logo preview
              <img src={`/img/${client.logo_image_id}`} alt={`${client.name} logo`} className="w-full h-full object-cover" />
            ) : (
              <span className="eyebrow">No logo</span>
            )}
          </div>
          <div className="flex-1 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <CardTitle className="text-lg">App logo</CardTitle>
              {client.logo_status === 'pending' ? <Badge variant="pending">Awaiting review</Badge> : null}
              {client.logo_status === 'approved' ? <Badge variant="production">Shown on consent</Badge> : null}
              {client.logo_status === 'rejected' ? <Badge variant="suspended">Not approved</Badge> : null}
            </div>
            <CardDescription>
              Square PNG, JPEG or WebP, 64–2048 px, up to 256 KB. An admin reviews each logo before students see it,
              so apps can&apos;t impersonate PESU or other clubs.
            </CardDescription>
            {logoError ? <InlineAlert variant="error" message={logoError} className="text-xs" /> : null}
            <div className="flex flex-wrap gap-2 pt-1">
              <input
                ref={logoInput}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="sr-only"
                id="logo-file"
                aria-label="Choose logo file"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) uploadLogo(file);
                }}
              />
              <Button size="sm" variant="secondary" loading={logoBusy} onClick={() => logoInput.current?.click()}>
                {client.logo_image_id ? 'Replace logo' : 'Upload logo'}
              </Button>
              {client.logo_image_id ? (
                <Button size="sm" variant="ghost" disabled={logoBusy} onClick={removeLogo}>
                  Remove
                </Button>
              ) : null}
            </div>
          </div>
        </div>
      </Card>

      {/* Secret Rotation Confirmation Drawer */}
      <Drawer open={isRotateSecretOpen} onOpenChange={setIsRotateSecretOpen}>
        <DrawerContent className="max-w-xl mx-auto">
          <DrawerHeader>
            <DrawerTitle className="flex items-center gap-2 text-warning">
              <AlertTriangle className="w-5 h-5" />
              <span>Rotate Client Secret</span>
            </DrawerTitle>
            <DrawerDescription>
              Rotating your client secret will immediately invalidate the active secret. Any backend server using the existing secret will fail to exchange codes or refresh tokens until updated.
            </DrawerDescription>
          </DrawerHeader>

          <div className="space-y-4">
            {rotateError && (
              <InlineAlert variant="error" message={rotateError} className="p-3 text-xs" />
            )}
            <InlineAlert
              variant="warning"
              message={`Are you sure you want to regenerate the client secret for ${client.name}?`}
              className="p-3.5 text-xs font-medium"
            />

            <DrawerActions
              onCancel={() => setIsRotateSecretOpen(false)}
              onSubmit={handleRotateSecret}
              submitLabel="Yes, Rotate Secret"
              loading={rotatingSecret}
              destructive
            />
          </div>
        </DrawerContent>
      </Drawer>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Redirect URIs Card */}
        <Card>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-lg">Redirect URIs</CardTitle>
              <CardDescription className="mt-1">
                Registered OAuth2 callback endpoints for this client.
              </CardDescription>
            </div>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={handleAddUriRow}
              className="flex items-center gap-1 shrink-0"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Add URL</span>
            </Button>
          </div>

          <div className="space-y-3 mt-4">
            {/* List of itemized URIs */}
            {redirectUris.length === 0 ? (
              <p className="text-xs text-muted py-4 text-center border border-dashed border-line rounded-md">
                No redirect URIs configured. Click &ldquo;Add URL&rdquo; to add a callback endpoint.
              </p>
            ) : (
              <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
                {redirectUris.map((uri, index) => (
                  <div key={index} className="flex items-center gap-2">
                    <Input
                      value={uri}
                      onChange={(e) => handleUriChange(index, e.target.value)}
                      placeholder="https://my-app.com/api/auth/callback/pesu"
                      className="text-xs font-mono flex-1"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => handleRemoveUri(index)}
                      className="text-danger hover:text-danger hover:bg-danger/5 p-2 shrink-0 h-9 w-9"
                      title="Remove URL"
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                ))}
              </div>
            )}

            {/* Quick add new URL input line */}
            <form onSubmit={handleQuickAddUri} className="flex items-center gap-2 pt-1">
              <Input
                value={newUriInput}
                onChange={(e) => setNewUriInput(e.target.value)}
                placeholder="Enter new URI (e.g. https://...)"
                className="text-xs font-mono flex-1"
              />
              <Button
                type="submit"
                size="sm"
                variant="secondary"
                disabled={!newUriInput.trim()}
                className="shrink-0"
              >
                <Plus className="w-3.5 h-3.5 mr-1" />
                Add
              </Button>
            </form>

            <div className="flex items-center justify-between pt-3 border-t border-line">
              <Button
                type="button"
                size="sm"
                onClick={handleSaveUris}
                loading={savingUris}
              >
                Save Changes
              </Button>
              {uriSuccess ? (
                <span className="text-xs text-success flex items-center gap-1 font-medium">
                  <Check className="w-3.5 h-3.5" /> Saved!
                </span>
              ) : null}
            </div>
          </div>
        </Card>

        {/* Testers Management Card */}
        <Card>
          <CardTitle className="text-lg">Authorized Testers</CardTitle>
          <CardDescription className="mt-1">
            In testing mode, only designated PRNs or SRNs can authorize this application.
          </CardDescription>

          <form onSubmit={handleAddTester} className="flex gap-2 mt-4">
            <Input
              placeholder="PRN or SRN (e.g. PES1UG20CS001)"
              value={testerInput}
              onChange={(e) => setTesterInput(e.target.value)}
              className="text-xs"
            />
            <Button type="submit" size="sm" loading={addingTester}>
              <Plus className="w-4 h-4" /> Add
            </Button>
          </form>

          <div className="mt-4 space-y-2 max-h-60 overflow-y-auto">
            {testers.length === 0 ? (
              <p className="text-xs text-muted py-3 text-center">
                No external testers added yet (owner is always authorized).
              </p>
            ) : (
              testers.map((t) => (
                <div
                  key={t.sub}
                  className="flex items-center justify-between p-2.5 rounded-md bg-surface-soft border border-line text-xs font-mono"
                >
                  <span>{t.sub}</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleRemoveTester(t.sub)}
                    className="h-7 w-7 p-0 text-danger hover:text-danger hover:bg-danger/5"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
              ))
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}
