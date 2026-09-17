'use client';

import * as React from 'react';
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
import { Plus, AppWindow, ArrowUpRight, Copy, Check, ShieldAlert } from 'lucide-react';

interface ClientItem {
  client_id: string;
  name: string;
  publishing_status: 'testing' | 'pending_production' | 'production';
  redirect_uris: string[];
  delegated_allowed: boolean;
  created_at: string;
}

export default function PortalPage() {
  const [clients, setClients] = React.useState<ClientItem[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [isDrawerOpen, setIsDrawerOpen] = React.useState(false);

  // Creation form state
  const [name, setName] = React.useState('');
  const [redirectUris, setRedirectUris] = React.useState('');
  const [createLoading, setCreateLoading] = React.useState(false);
  const [createError, setCreateError] = React.useState<string | null>(null);

  // Created secret callout state
  const [createdSecret, setCreatedSecret] = React.useState<{
    clientId: string;
    secret: string;
  } | null>(null);
  const [copied, setCopied] = React.useState(false);

  const fetchClients = async () => {
    try {
      const res = await fetch('/api/portal/clients');
      const data = await res.json();
      if (res.ok && data.clients) {
        setClients(data.clients);
      }
    } finally {
      setLoading(false);
    }
  };

  React.useEffect(() => {
    fetchClients();
  }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreateError(null);
    setCreateLoading(true);

    const uris = redirectUris
      .split('\n')
      .map((u) => u.trim())
      .filter(Boolean);

    try {
      const res = await fetch('/api/portal/clients', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          redirectUris: uris,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to create application');
      }

      setCreatedSecret({
        clientId: data.client.client_id,
        secret: data.rawSecret,
      });

      setName('');
      setRedirectUris('');
      setIsDrawerOpen(false);
      fetchClients();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error creating app';
      setCreateError(msg);
    } finally {
      setCreateLoading(false);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="space-y-8 py-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
            Developer Portal
          </h1>
          <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
            Manage your registered OAuth2 applications and publishing status.
          </p>
        </div>

        <Drawer open={isDrawerOpen} onOpenChange={setIsDrawerOpen}>
          <DrawerTrigger asChild>
            <Button className="shadow-md">
              <Plus className="w-4 h-4 mr-1.5" /> Register Application
            </Button>
          </DrawerTrigger>
          <DrawerContent className="max-w-xl mx-auto">
            <DrawerHeader>
              <DrawerTitle>Register New Application</DrawerTitle>
              <DrawerDescription>
                Configure your OAuth2 client credentials and redirect URIs.
              </DrawerDescription>
            </DrawerHeader>

            <form onSubmit={handleCreate} className="space-y-4 px-4 pb-6">
              {createError ? (
                <div className="p-3 rounded-xl bg-red-500/10 text-red-600 text-xs">
                  {createError}
                </div>
              ) : null}

              <Input
                label="Application Name"
                placeholder="e.g. PESU Club Portal"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />

              <div className="space-y-1.5">
                <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300">
                  Redirect URIs (one per line)
                </label>
                <textarea
                  className="w-full px-3.5 py-2.5 rounded-xl text-sm bg-black/[0.03] dark:bg-white/[0.05] border border-black/10 dark:border-white/15 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  rows={3}
                  placeholder="https://example.com/api/auth/callback&#10;http://localhost:3000/callback"
                  value={redirectUris}
                  onChange={(e) => setRedirectUris(e.target.value)}
                  required
                />
              </div>

              <div className="rounded-xl bg-black/[0.02] dark:bg-white/[0.02] border border-black/5 dark:border-white/5 p-3 text-xs text-zinc-500 dark:text-zinc-400">
                All applications start with Identity mode in testing. Delegated credential vault access can be requested when submitting for production review.
              </div>

              <div className="pt-4 flex gap-3">
                <Button
                  type="button"
                  variant="secondary"
                  className="flex-1"
                  onClick={() => setIsDrawerOpen(false)}
                >
                  Cancel
                </Button>
                <Button type="submit" className="flex-1" loading={createLoading}>
                  Create Application
                </Button>
              </div>
            </form>
          </DrawerContent>
        </Drawer>
      </div>

      {/* Secret Generation Callout */}
      {createdSecret ? (
        <Card className="bg-amber-500/10 border-amber-500/20 text-amber-900 dark:text-amber-200 p-6 space-y-4">
          <div className="flex items-start gap-3">
            <ShieldAlert className="w-5 h-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <h4 className="font-semibold text-sm">Save your Client Secret immediately</h4>
              <p className="text-xs text-amber-800/90 dark:text-amber-300/90 leading-relaxed">
                This secret will never be shown again. Store it securely in your environment variables.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
            <div className="p-3 rounded-xl bg-black/5 dark:bg-black/30 border border-black/10 dark:border-white/10 font-mono text-xs break-all flex items-center justify-between">
              <span>{createdSecret.clientId}</span>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => copyToClipboard(createdSecret.clientId)}
                className="ml-2 h-7 w-7 p-0 hover:opacity-70"
              >
                <Copy className="w-3.5 h-3.5" />
              </Button>
            </div>
            <div className="p-3 rounded-xl bg-black/5 dark:bg-black/30 border border-black/10 dark:border-white/10 font-mono text-xs break-all flex items-center justify-between">
              <span>{createdSecret.secret}</span>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => copyToClipboard(createdSecret.secret)}
                className="ml-2 h-7 w-7 p-0 hover:opacity-70"
              >
                {copied ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
              </Button>
            </div>
          </div>

          <Button
            size="sm"
            variant="outline"
            className="text-xs mt-2"
            onClick={() => setCreatedSecret(null)}
          >
            I have saved the secret
          </Button>
        </Card>
      ) : null}

      {/* Apps list */}
      {loading ? (
        <div className="text-center py-12 text-sm text-zinc-400">Loading applications...</div>
      ) : clients.length === 0 ? (
        <Card className="text-center py-16 px-4 space-y-4">
          <div className="w-12 h-12 rounded-2xl bg-black/5 dark:bg-white/5 flex items-center justify-center mx-auto text-zinc-400">
            <AppWindow className="w-6 h-6" />
          </div>
          <div>
            <h3 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
              No applications registered yet
            </h3>
            <p className="text-xs text-zinc-500 dark:text-zinc-400 max-w-sm mx-auto mt-1">
              Create your first application to obtain OAuth2 client credentials and start integrating Sign in with PESU.
            </p>
          </div>
          <Button onClick={() => setIsDrawerOpen(true)} size="sm">
            Register your first app
          </Button>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {clients.map((app) => (
            <Link key={app.client_id} href={`/portal/${app.client_id}`}>
              <Card className="hover:border-black/20 dark:hover:border-white/25 transition-all cursor-pointer h-full flex flex-col justify-between group">
                <div>
                  <div className="flex items-start justify-between gap-2">
                    <CardTitle className="group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">
                      {app.name}
                    </CardTitle>
                    <Badge
                      variant={
                        app.publishing_status === 'production'
                          ? 'production'
                          : app.publishing_status === 'pending_production'
                          ? 'pending'
                          : 'testing'
                      }
                    >
                      {app.publishing_status.replace('_', ' ')}
                    </Badge>
                  </div>
                  <CardDescription className="font-mono text-xs mt-2">
                    {app.client_id}
                  </CardDescription>
                </div>

                <div className="pt-6 flex items-center justify-between text-xs text-zinc-400">
                  <span>{app.redirect_uris.length} redirect URI(s)</span>
                  <span className="flex items-center text-zinc-600 dark:text-zinc-300 font-medium group-hover:translate-x-0.5 transition-transform">
                    Manage <ArrowUpRight className="w-3.5 h-3.5 ml-0.5" />
                  </span>
                </div>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
