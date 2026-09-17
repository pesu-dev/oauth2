'use client';

import * as React from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { Card, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
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
  publishing_status: 'testing' | 'pending_production' | 'production';
  redirect_uris: string[];
  delegated_allowed: boolean;
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
  const [prodLoading, setProdLoading] = React.useState(false);

  const [copiedId, setCopiedId] = React.useState(false);

  const fetchData = React.useCallback(async () => {
    try {
      const res = await fetch(`/api/portal/clients/${clientId}`);
      const data = await res.json();
      if (res.ok) {
        setClient(data.client);
        setTesters(data.testers || []);
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
      const res = await fetch(`/api/portal/clients/${clientId}`, {
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
      const res = await fetch(`/api/portal/clients/${clientId}/rotate-secret`, {
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
      const res = await fetch(`/api/portal/clients/${clientId}/testers`, {
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
    await fetch(`/api/portal/clients/${clientId}/testers?sub=${encodeURIComponent(sub)}`, {
      method: 'DELETE',
    });
    fetchData();
  };

  const handleRequestProduction = async (e: React.FormEvent) => {
    e.preventDefault();
    setProdLoading(true);

    try {
      const res = await fetch(`/api/portal/clients/${clientId}/request-production`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ justification, delegatedRequested }),
      });
      if (res.ok) {
        setIsProdDrawerOpen(false);
        setJustification('');
        setDelegatedRequested(false);
        fetchData();
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
    return <div className="py-16 text-center text-sm text-zinc-400">Loading details...</div>;
  }

  if (!client) {
    return (
      <div className="py-16 text-center text-sm text-zinc-400">
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
          className="inline-flex items-center text-xs font-medium text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors mb-4"
        >
          <ArrowLeft className="w-3.5 h-3.5 mr-1" /> Back to applications
        </Link>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
                {client.name}
              </h1>
              <Badge
                variant={
                  client.publishing_status === 'production'
                    ? 'production'
                    : client.publishing_status === 'pending_production'
                    ? 'pending'
                    : 'testing'
                }
              >
                {client.publishing_status.replace('_', ' ')}
              </Badge>
              {client.delegated_allowed && (
                <Badge variant="delegated">
                  Delegated Access
                </Badge>
              )}
            </div>
            <div className="flex items-center gap-2 font-mono text-xs text-zinc-500 mt-2">
              <span>Client ID: {client.client_id}</span>
              <Button
                variant="ghost"
                size="sm"
                onClick={copyClientId}
                className="h-6 w-6 p-0 hover:text-zinc-900 dark:hover:text-zinc-100"
                title="Copy Client ID"
              >
                {copiedId ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
              </Button>
            </div>
          </div>

          {client.publishing_status === 'testing' ? (
            <Drawer open={isProdDrawerOpen} onOpenChange={setIsProdDrawerOpen}>
              <DrawerTrigger asChild>
                <Button variant="primary">
                  <Rocket className="w-4 h-4 mr-1.5" /> Request Production
                </Button>
              </DrawerTrigger>
              <DrawerContent className="max-w-xl mx-auto">
                <DrawerHeader>
                  <DrawerTitle>Request Production Publishing</DrawerTitle>
                  <DrawerDescription>
                    Production approval removes tester restrictions so any authenticated student can sign in.
                  </DrawerDescription>
                </DrawerHeader>

                <form onSubmit={handleRequestProduction} className="space-y-4 px-4 pb-6">
                  <div className="space-y-1.5">
                    <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300">
                      Justification & Club / Project Context
                    </label>
                    <textarea
                      className="w-full px-3.5 py-2.5 rounded-xl text-sm bg-black/[0.03] dark:bg-white/[0.05] border border-black/10 dark:border-white/15 focus:outline-none focus:ring-2 focus:ring-blue-500"
                      rows={4}
                      placeholder="Explain your app's purpose, target audience, and why production access is needed..."
                      value={justification}
                      onChange={(e) => setJustification(e.target.value)}
                      required
                    />
                  </div>

                  <div className="flex items-start gap-2.5 pt-1">
                    <input
                      type="checkbox"
                      id="delegatedRequested"
                      checked={delegatedRequested}
                      onChange={(e) => setDelegatedRequested(e.target.checked)}
                      className="mt-0.5 rounded border-zinc-300 dark:border-zinc-700 text-blue-600 focus:ring-blue-500 w-4 h-4"
                    />
                    <label
                      htmlFor="delegatedRequested"
                      className="text-xs text-zinc-700 dark:text-zinc-300 cursor-pointer select-none"
                    >
                      <span className="font-medium text-zinc-900 dark:text-zinc-100">Request Delegated Credential Vault Access</span>
                      <p className="text-zinc-500 dark:text-zinc-400 text-[11px] mt-0.5">
                        Enables token exchange for encrypted Academy student credentials. Requires explicit justification and review.
                      </p>
                    </label>
                  </div>

                  <div className="pt-2 flex gap-3">
                    <Button
                      type="button"
                      variant="secondary"
                      className="flex-1"
                      onClick={() => setIsProdDrawerOpen(false)}
                    >
                      Cancel
                    </Button>
                    <Button type="submit" className="flex-1" loading={prodLoading}>
                      Submit for Review
                    </Button>
                  </div>
                </form>
              </DrawerContent>
            </Drawer>
          ) : null}
        </div>
      </div>

      {/* Rotated Secret Banner */}
      {rotatedSecret && (
        <Card className="p-4 bg-emerald-500/10 border border-emerald-500/30 dark:border-emerald-500/20 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-emerald-800 dark:text-emerald-300 font-semibold text-sm">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
              <span>New Client Secret Generated</span>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setRotatedSecret(null)}
              className="h-auto p-0 text-xs font-medium text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 hover:bg-transparent"
            >
              Dismiss
            </Button>
          </div>
          <p className="text-xs text-emerald-900/80 dark:text-emerald-200/80">
            Please copy your new secret now. For security reasons, it will not be displayed again.
          </p>
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-2.5 rounded-xl bg-white dark:bg-black/40 border border-emerald-500/20 font-mono text-xs">
            <span className="select-all break-all text-zinc-900 dark:text-zinc-100 font-semibold">{rotatedSecret}</span>
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
                  <Check className="w-3.5 h-3.5 text-emerald-500" /> Copied!
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
          <KeyRound className="w-4 h-4 text-blue-500" />
          <span>Client Credentials</span>
        </CardTitle>
        <CardDescription className="mt-1">
          OAuth2 authentication credentials for code exchange and server-to-server calls.
        </CardDescription>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
              Client ID
            </label>
            <div className="flex items-center gap-2">
              <div className="flex-1 p-2.5 rounded-xl bg-black/[0.03] dark:bg-white/[0.05] border border-black/10 dark:border-white/10 font-mono text-xs select-all text-zinc-900 dark:text-zinc-100 truncate">
                {client.client_id}
              </div>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={copyClientId}
                className="shrink-0"
              >
                {copiedId ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
                <span className="ml-1 text-xs">{copiedId ? 'Copied' : 'Copy'}</span>
              </Button>
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
              Client Secret
            </label>
            <div className="flex items-center gap-2">
              <div className="flex-1 p-2.5 rounded-xl bg-black/[0.03] dark:bg-white/[0.05] border border-black/10 dark:border-white/10 font-mono text-xs text-zinc-400 dark:text-zinc-500 tracking-wider select-none">
                ••••••••••••••••••••••••••••••••
              </div>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => setIsRotateSecretOpen(true)}
                className="shrink-0 text-xs flex items-center gap-1.5 text-zinc-700 dark:text-zinc-300"
              >
                <RefreshCw className="w-3.5 h-3.5 text-amber-500" />
                <span>Rotate Secret</span>
              </Button>
            </div>
          </div>
        </div>
      </Card>

      {/* Secret Rotation Confirmation Drawer */}
      <Drawer open={isRotateSecretOpen} onOpenChange={setIsRotateSecretOpen}>
        <DrawerContent className="max-w-xl mx-auto">
          <DrawerHeader>
            <DrawerTitle className="flex items-center gap-2 text-amber-600 dark:text-amber-400">
              <AlertTriangle className="w-5 h-5" />
              <span>Rotate Client Secret</span>
            </DrawerTitle>
            <DrawerDescription>
              Rotating your client secret will immediately invalidate the active secret. Any backend server using the existing secret will fail to exchange codes or refresh tokens until updated.
            </DrawerDescription>
          </DrawerHeader>

          <div className="space-y-4 px-4 pb-6">
            {rotateError && (
              <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-xs text-red-600 dark:text-red-400">
                {rotateError}
              </div>
            )}
            <div className="p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/20 text-xs text-amber-900 dark:text-amber-200">
              Are you sure you want to regenerate the client secret for <strong>{client.name}</strong>?
            </div>

            <div className="flex gap-3">
              <Button
                type="button"
                variant="secondary"
                className="flex-1"
                onClick={() => setIsRotateSecretOpen(false)}
                disabled={rotatingSecret}
              >
                Cancel
              </Button>
              <Button
                type="button"
                className="flex-1 bg-amber-600 hover:bg-amber-700 text-white"
                onClick={handleRotateSecret}
                loading={rotatingSecret}
              >
                Yes, Rotate Secret
              </Button>
            </div>
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
              className="text-xs flex items-center gap-1 shrink-0"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Add URL</span>
            </Button>
          </div>

          <div className="space-y-3 mt-4">
            {/* List of itemized URIs */}
            {redirectUris.length === 0 ? (
              <p className="text-xs text-zinc-400 py-4 text-center border border-dashed border-black/10 dark:border-white/10 rounded-xl">
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
                      className="text-red-500 hover:text-red-600 hover:bg-red-500/10 p-2 shrink-0 h-9 w-9"
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
                className="text-xs shrink-0"
              >
                <Plus className="w-3.5 h-3.5 mr-1" />
                Add
              </Button>
            </form>

            <div className="flex items-center justify-between pt-3 border-t border-black/5 dark:border-white/5">
              <Button
                type="button"
                size="sm"
                onClick={handleSaveUris}
                loading={savingUris}
              >
                Save Changes
              </Button>
              {uriSuccess ? (
                <span className="text-xs text-emerald-600 dark:text-emerald-400 flex items-center gap-1 font-medium">
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
              <p className="text-xs text-zinc-400 py-3 text-center">
                No external testers added yet (owner is always authorized).
              </p>
            ) : (
              testers.map((t) => (
                <div
                  key={t.sub}
                  className="flex items-center justify-between p-2.5 rounded-xl bg-black/[0.02] dark:bg-white/[0.03] border border-black/5 dark:border-white/5 text-xs font-mono"
                >
                  <span>{t.sub}</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleRemoveTester(t.sub)}
                    className="h-7 w-7 p-0 text-red-500 hover:text-red-600 hover:bg-red-500/10"
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
