'use client';

import * as React from 'react';
import Link from 'next/link';
import { Card, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input, controlStyles, labelStyles } from '@/components/ui/input';
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
  owner_type?: 'user' | 'team';
  owner_team_id?: string | null;
  created_at: string;
}

interface TeamItem {
  team_id: string;
  name: string;
  slug: string;
  role: 'owner' | 'admin' | 'developer';
  member_count: number;
  client_count: number;
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
  const [ownerTeamId, setOwnerTeamId] = React.useState('');

  // Teams
  const [teams, setTeams] = React.useState<TeamItem[]>([]);
  const [newTeamName, setNewTeamName] = React.useState('');
  const [teamError, setTeamError] = React.useState<string | null>(null);
  const [teamLoading, setTeamLoading] = React.useState(false);

  // Created secret callout state
  const [createdSecret, setCreatedSecret] = React.useState<{
    clientId: string;
    secret: string;
  } | null>(null);

  const fetchClients = async () => {
    try {
      const res = await fetch('/api/internal/portal/clients');
      const data = await res.json();
      if (res.ok && data.clients) {
        setClients(data.clients);
      }
    } finally {
      setLoading(false);
    }
  };

  const fetchTeams = async () => {
    try {
      const res = await fetch('/api/internal/teams');
      const data = await res.json();
      if (res.ok && data.teams) setTeams(data.teams);
    } catch {
      // teams are optional; ignore
    }
  };

  React.useEffect(() => {
    fetchClients();
    let active = true;
    fetch('/api/internal/teams')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (active && data?.teams) setTeams(data.teams);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  const handleCreateTeam = async (e: React.FormEvent) => {
    e.preventDefault();
    setTeamError(null);
    setTeamLoading(true);
    try {
      const res = await fetch('/api/internal/teams', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newTeamName }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to create team');
      setNewTeamName('');
      fetchTeams();
    } catch (err: unknown) {
      setTeamError(err instanceof Error ? err.message : 'Failed to create team');
    } finally {
      setTeamLoading(false);
    }
  };

  const managedTeams = teams.filter((t) => t.role === 'owner' || t.role === 'admin');
  const teamName = (id?: string | null) => teams.find((t) => t.team_id === id)?.name;

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreateError(null);

    if (!acceptedTerms) {
      setCreateError('You must accept the Terms of Service and Privacy Policy.');
      return;
    }

    setCreateLoading(true);

    try {
      const res = await fetch('/api/internal/portal/clients', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          ...(ownerTeamId ? { teamId: ownerTeamId } : {}),
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
      setOwnerTeamId('');
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
            <Button className="">
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

            <form onSubmit={handleCreate} className="space-y-4">
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

              {managedTeams.length > 0 ? (
                <div className="space-y-1.5">
                  <label htmlFor="ownerTeam" className={labelStyles}>Owner</label>
                  <select
                    id="ownerTeam"
                    value={ownerTeamId}
                    onChange={(e) => setOwnerTeamId(e.target.value)}
                    className={controlStyles}
                  >
                    <option value="">Just me</option>
                    {managedTeams.map((t) => (
                      <option key={t.team_id} value={t.team_id}>
                        Team: {t.name}
                      </option>
                    ))}
                  </select>
                </div>
              ) : null}

              <div className="flex items-start gap-2.5 pt-1">
                <input
                  type="checkbox"
                  id="acceptedTerms"
                  checked={acceptedTerms}
                  onChange={(e) => setAcceptedTerms(e.target.checked)}
                  className="mt-0.5 rounded border-line-strong text-get focus:ring-line-strong w-4 h-4 cursor-pointer shrink-0"
                  required
                />
                <label
                  htmlFor="acceptedTerms"
                  className="text-xs text-soft select-none cursor-pointer leading-relaxed"
                >
                  I accept the{' '}
                  <Link
                    href="/terms"
                    target="_blank"
                    className="text-get font-medium underline hover:opacity-80"
                  >
                    Terms of Service
                  </Link>{' '}
                  and{' '}
                  <Link
                    href="/privacy"
                    target="_blank"
                    className="text-get font-medium underline hover:opacity-80"
                  >
                    Privacy Policy
                  </Link>
                  .
                </label>
              </div>

              <div className="rounded-md bg-surface-soft border border-line p-3 text-xs text-muted">
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
        <Card className="bg-warning/5 border-warning/40 text-warning p-6 space-y-4">
          <div className="flex items-start gap-3">
            <ShieldAlert className="w-5 h-5 text-warning shrink-0 mt-0.5" />
            <div className="space-y-1">
              <h4 className="font-semibold text-sm">Save your Client Secret immediately</h4>
              <p className="text-xs text-warning leading-relaxed">
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
            className="mt-2"
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
              <Card className="hover:border-line-strong transition-all cursor-pointer h-full flex flex-col justify-between group">
                <div>
                  <div className="flex items-start justify-between gap-2">
                    <CardTitle className="group-hover:text-get transition-colors">
                      {app.name}
                    </CardTitle>
                    <div className="flex flex-wrap justify-end gap-1.5">
                      {app.owner_type === 'team' ? (
                        <Badge variant="neutral">{teamName(app.owner_team_id) ?? 'Team'}</Badge>
                      ) : null}
                      <Badge variant={app.publishing_status}>
                        {app.publishing_status.replace('_', ' ')}
                      </Badge>
                    </div>
                  </div>
                  <CardDescription className="font-mono text-xs mt-2">
                    {app.client_id}
                  </CardDescription>
                </div>

                <div className="pt-6 flex items-center justify-between text-xs text-muted">
                  <span>{app.redirect_uris.length} redirect URI(s)</span>
                  <span className="flex items-center text-soft font-medium group-hover:translate-x-0.5 transition-transform">
                    Manage <ArrowUpRight className="w-3.5 h-3.5 ml-0.5" />
                  </span>
                </div>
              </Card>
            </Link>
          ))}
                </div>
      )}

      {/* Teams */}
      <section aria-labelledby="teams-heading" className="space-y-4 pt-4 border-t border-line">
        <div className="flex flex-col min-[701px]:flex-row min-[701px]:items-end justify-between gap-4">
          <div className="space-y-1">
            <h2 id="teams-heading" className="font-serif text-[27px] font-normal">Teams</h2>
            <p className="text-sm text-soft">Share apps with your club: members can manage them together.</p>
          </div>
          <form onSubmit={handleCreateTeam} className="flex gap-2 w-full min-[701px]:w-auto">
            <Input
              aria-label="New team name"
              placeholder="e.g. Robotics Club"
              value={newTeamName}
              onChange={(e) => setNewTeamName(e.target.value)}
              required
            />
            <Button type="submit" variant="secondary" loading={teamLoading} className="shrink-0">
              <Plus className="w-3.5 h-3.5" /> New team
            </Button>
          </form>
        </div>
        {teamError ? <InlineAlert variant="error" message={teamError} className="text-xs" /> : null}
        {teams.length === 0 ? (
          <p className="text-sm text-muted">You are not on any teams yet.</p>
        ) : (
          <ul className="grid grid-cols-1 md:grid-cols-3 gap-3 list-none p-0">
            {teams.map((t) => (
              <li key={t.team_id}>
                <Link
                  href={`/portal/teams/${t.team_id}`}
                  className="block p-4 rounded-md border border-line bg-surface hover:border-line-strong transition-colors no-underline"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-serif text-lg text-fg">{t.name}</span>
                    <Badge variant="neutral">{t.role}</Badge>
                  </div>
                  <p className="eyebrow mt-2">
                    {t.member_count} member{t.member_count === 1 ? '' : 's'} · {t.client_count} app{t.client_count === 1 ? '' : 's'}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
