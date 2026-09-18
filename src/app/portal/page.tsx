'use client';

import * as React from 'react';
import Link from 'next/link';
import { Card, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { PageHeader } from '@/components/ui/page-header';
import { PageLoader } from '@/components/ui/page-loader';
import { EmptyState } from '@/components/ui/empty-state';
import { InlineAlert } from '@/components/ui/inline-alert';
import { CopyableField } from '@/components/ui/copyable-field';
import { DrawerActions } from '@/components/ui/drawer-actions';
import {
  Drawer,
  DrawerTrigger,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerDescription,
} from '@/components/ui/drawer';
import { Plus, AppWindow, ArrowUpRight, ShieldAlert } from 'lucide-react';

interface ClientItem {
  client_id: string;
  name: string;
  publishing_status: 'testing' | 'pending_production' | 'production' | 'suspended';
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
  const [acceptedTerms, setAcceptedTerms] = React.useState(false);
  const [createLoading, setCreateLoading] = React.useState(false);
  const [createError, setCreateError] = React.useState<string | null>(null);

  // Created secret callout state
  const [createdSecret, setCreatedSecret] = React.useState<{
    clientId: string;
    secret: string;
  } | null>(null);

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

    if (!acceptedTerms) {
      setCreateError('You must accept the Terms of Service and Privacy Policy.');
      return;
    }

    setCreateLoading(true);

    try {
      const res = await fetch('/api/portal/clients', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
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
      setAcceptedTerms(false);
      setIsDrawerOpen(false);
      fetchClients();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error creating app';
      setCreateError(msg);
    } finally {
      setCreateLoading(false);
    }
  };

  return (
    <div className="space-y-8 py-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <PageHeader
          title="Developer Portal"
          description="Manage your registered OAuth2 applications and publishing status."
        />

        <Drawer
          open={isDrawerOpen}
          onOpenChange={(open) => {
            setIsDrawerOpen(open);
            if (!open) {
              setAcceptedTerms(false);
              setCreateError(null);
            }
          }}
        >
          <DrawerTrigger asChild>
            <Button className="shadow-md">
              <Plus className="w-4 h-4 mr-1.5" /> Register Application
            </Button>
          </DrawerTrigger>
          <DrawerContent className="max-w-xl mx-auto">
            <DrawerHeader>
              <DrawerTitle>Register New Application</DrawerTitle>
              <DrawerDescription>
                Register your client application to obtain OAuth2 credentials.
              </DrawerDescription>
            </DrawerHeader>

            <form onSubmit={handleCreate} className="space-y-4 px-4 pb-6">
              {createError ? (
                <InlineAlert variant="error" message={createError} className="p-3 text-xs" />
              ) : null}

              <Input
                label="Application Name"
                placeholder="e.g. PESU Club Portal"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />

              <div className="flex items-start gap-2.5 pt-1">
                <input
                  type="checkbox"
                  id="acceptedTerms"
                  checked={acceptedTerms}
                  onChange={(e) => setAcceptedTerms(e.target.checked)}
                  className="mt-0.5 rounded border-zinc-300 dark:border-zinc-700 text-blue-600 focus:ring-blue-500 w-4 h-4 cursor-pointer shrink-0"
                  required
                />
                <label
                  htmlFor="acceptedTerms"
                  className="text-xs text-zinc-600 dark:text-zinc-400 select-none cursor-pointer leading-relaxed"
                >
                  I accept the{' '}
                  <Link
                    href="/terms"
                    target="_blank"
                    className="text-blue-600 dark:text-blue-400 font-medium underline hover:opacity-80"
                  >
                    Terms of Service
                  </Link>{' '}
                  and{' '}
                  <Link
                    href="/privacy"
                    target="_blank"
                    className="text-blue-600 dark:text-blue-400 font-medium underline hover:opacity-80"
                  >
                    Privacy Policy
                  </Link>
                  .
                </label>
              </div>

              <div className="rounded-xl bg-black/[0.02] dark:bg-white/[0.02] border border-black/5 dark:border-white/5 p-3 text-xs text-zinc-500 dark:text-zinc-400">
                All applications start with Identity mode in testing. Delegated credential vault access can be requested when submitting for production review. Redirect URIs can be configured in your application settings.
              </div>

              <DrawerActions
                onCancel={() => setIsDrawerOpen(false)}
                submitLabel="Create Application"
                loading={createLoading}
              />
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
            <CopyableField value={createdSecret.clientId} />
            <CopyableField value={createdSecret.secret} />
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
        <PageLoader message="Loading applications..." />
      ) : clients.length === 0 ? (
        <Card className="text-center py-16 px-4">
          <EmptyState
            icon={<AppWindow className="w-8 h-8" />}
            title="No applications registered yet"
            description="Create your first application to obtain OAuth2 client credentials and start integrating Sign in with PESU."
            action={
              <Button onClick={() => setIsDrawerOpen(true)} size="sm">
                Register your first app
              </Button>
            }
          />
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
                    <Badge variant={app.publishing_status}>
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
