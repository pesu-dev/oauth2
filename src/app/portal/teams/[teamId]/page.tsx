'use client';

import * as React from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, Trash2, UserPlus } from 'lucide-react';
import { Card, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input, controlStyles } from '@/components/ui/input';
import { InlineAlert } from '@/components/ui/inline-alert';
import { PageLoader } from '@/components/ui/page-loader';

type Role = 'owner' | 'admin' | 'developer';

interface TeamDetail {
  team: { team_id: string; name: string; slug: string };
  role: Role;
  members: { sub: string; role: Role; name: string | null; srn: string | null }[];
  clients: { client_id: string; name: string; publishing_status: 'testing' | 'pending_production' | 'production' | 'suspended' }[];
}

const ROLE_HELP: Record<Role, string> = {
  owner: 'Everything, including managing owners',
  admin: 'Manage members, secrets and access requests',
  developer: 'Edit apps, redirect URIs and testers',
};

export default function TeamPage() {
  const { teamId } = useParams<{ teamId: string }>();
  const router = useRouter();
  const [detail, setDetail] = React.useState<TeamDetail | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [identifier, setIdentifier] = React.useState('');
  const [newRole, setNewRole] = React.useState<Role>('developer');
  const [teamName, setTeamName] = React.useState('');
  const [me, setMe] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    const res = await fetch(`/api/internal/teams/${teamId}`);
    const data = await res.json();
    if (!res.ok) {
      setError(data.error || 'Team not found');
    } else {
      setDetail(data);
      setTeamName(data.team.name);
    }
    setLoading(false);
  }, [teamId]);

  React.useEffect(() => {
    let active = true;
    Promise.all([
      fetch(`/api/internal/teams/${teamId}`).then(async (r) => ({ ok: r.ok, data: await r.json() })),
      fetch('/api/internal/auth/status').then((r) => (r.ok ? r.json() : null)).catch(() => null),
    ]).then(([team, status]) => {
      if (!active) return;
      if (!team.ok) setError(team.data.error || 'Team not found');
      else {
        setDetail(team.data);
        setTeamName(team.data.team.name);
      }
      setMe(status?.sub ?? null);
      setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [teamId]);

  const call = async (url: string, init: RequestInit, success: string) => {
    setError(null);
    setNotice(null);
    const res = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...init });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(data.error || 'Something went wrong');
      return false;
    }
    setNotice(success);
    await load();
    return true;
  };

  if (loading) return <PageLoader message="Loading team..." />;
  if (!detail) {
    return (
      <div className="space-y-4 py-4">
        <InlineAlert variant="error" message={error || 'Team not found'} />
        <Link href="/portal" className="eyebrow underline">Back to portal</Link>
      </div>
    );
  }

  const canManage = detail.role === 'owner' || detail.role === 'admin';
  const assignableRoles: Role[] = detail.role === 'owner' ? ['owner', 'admin', 'developer'] : ['admin', 'developer'];

  return (
    <div className="max-w-[1040px] mx-auto space-y-8 py-4">
      <div className="space-y-3">
        <Link href="/portal" className="eyebrow inline-flex items-center gap-1 no-underline hover:text-fg">
          <ArrowLeft className="w-3 h-3" /> Back to portal
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="display text-fg">{detail.team.name}</h1>
          <Badge variant="neutral">{detail.role}</Badge>
        </div>
        <p className="font-mono text-xs text-muted">{detail.team.team_id}</p>
      </div>

      {error ? <InlineAlert variant="error" message={error} /> : null}
      {notice ? <InlineAlert variant="success" message={notice} /> : null}

      {canManage ? (
        <Card>
          <form
            className="flex flex-col min-[701px]:flex-row gap-3 min-[701px]:items-end"
            onSubmit={(e) => {
              e.preventDefault();
              call(`/api/internal/teams/${teamId}`, { method: 'PATCH', body: JSON.stringify({ name: teamName }) }, 'Team renamed');
            }}
          >
            <Input label="Team name" value={teamName} onChange={(e) => setTeamName(e.target.value)} required />
            <Button type="submit" variant="secondary" className="shrink-0">Rename</Button>
          </form>
        </Card>
      ) : null}

      <Card className="p-0">
        <div className="p-6 pb-4">
          <CardTitle>Members</CardTitle>
          <CardDescription className="mt-1">
            Members can manage this team&apos;s apps and count as testers while an app is in Testing.
          </CardDescription>
        </div>
        <ul className="divide-y divide-line border-t border-line list-none p-0">
          {detail.members.map((m) => {
            const editable = canManage && (detail.role === 'owner' || m.role !== 'owner');
            return (
              <li key={m.sub} className="flex flex-col min-[701px]:flex-row min-[701px]:items-center gap-3 justify-between px-6 py-3">
                <div className="min-w-0">
                  <p className="text-sm text-fg">
                    {m.name ?? 'Unknown'}
                    {m.sub === me ? <span className="eyebrow ml-2">You</span> : null}
                  </p>
                  <p className="font-mono text-[11px] text-muted break-all">{m.srn ?? m.sub}</p>
                </div>
                <div className="flex items-center gap-2">
                  {editable ? (
                    <select
                      aria-label={`Role for ${m.name ?? m.sub}`}
                      value={m.role}
                      onChange={(e) =>
                        call(
                          `/api/internal/teams/${teamId}/members`,
                          { method: 'PATCH', body: JSON.stringify({ sub: m.sub, role: e.target.value }) },
                          'Role updated'
                        )
                      }
                      className={`${controlStyles} w-auto py-1.5 text-xs`}
                    >
                      {(m.role === 'owner' || detail.role === 'owner' ? (['owner', 'admin', 'developer'] as Role[]) : assignableRoles).map((r) => (
                        <option key={r} value={r}>{r}</option>
                      ))}
                    </select>
                  ) : (
                    <Badge variant="neutral" title={ROLE_HELP[m.role]}>{m.role}</Badge>
                  )}
                  {(editable || m.sub === me) && (
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={m.sub === me ? 'Leave team' : `Remove ${m.name ?? m.sub}`}
                      title={m.sub === me ? 'Leave team' : 'Remove member'}
                      onClick={async () => {
                        const ok = await call(
                          `/api/internal/teams/${teamId}/members?sub=${encodeURIComponent(m.sub)}`,
                          { method: 'DELETE' },
                          m.sub === me ? 'You left the team' : 'Member removed'
                        );
                        if (ok && m.sub === me) router.push('/portal');
                      }}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
        {canManage ? (
          <form
            className="flex flex-col min-[701px]:flex-row gap-2 p-6 border-t border-line"
            onSubmit={async (e) => {
              e.preventDefault();
              if (
                await call(
                  `/api/internal/teams/${teamId}/members`,
                  { method: 'POST', body: JSON.stringify({ identifier, role: newRole }) },
                  'Member added'
                )
              ) {
                setIdentifier('');
              }
            }}
          >
            <Input
              aria-label="PRN or SRN of the new member"
              placeholder="PRN or SRN (they must have signed in once)"
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              required
            />
            <select
              aria-label="Role for the new member"
              value={newRole}
              onChange={(e) => setNewRole(e.target.value as Role)}
              className={`${controlStyles} min-[701px]:w-40`}
            >
              {assignableRoles.map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
            <Button type="submit" className="shrink-0">
              <UserPlus className="w-3.5 h-3.5" /> Add
            </Button>
          </form>
        ) : null}
      </Card>

      <Card>
        <CardTitle>Apps</CardTitle>
        {detail.clients.length === 0 ? (
          <p className="text-sm text-muted mt-3">
            No apps yet. {canManage ? 'Choose this team as the owner when you register an app.' : ''}
          </p>
        ) : (
          <ul className="divide-y divide-line list-none p-0 mt-3">
            {detail.clients.map((c) => (
              <li key={c.client_id} className="flex items-center justify-between gap-3 py-3">
                <Link href={`/portal/${c.client_id}`} className="text-fg no-underline hover:underline">
                  {c.name}
                  <span className="block font-mono text-[11px] text-muted">{c.client_id}</span>
                </Link>
                <Badge variant={c.publishing_status}>{c.publishing_status.replace('_', ' ')}</Badge>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
