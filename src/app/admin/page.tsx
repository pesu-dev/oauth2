'use client';

import * as React from 'react';
import { Card, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { getScope } from '@/lib/oidc/scopes';
import { Badge } from '@/components/ui/badge';
import { PageHeader } from '@/components/ui/page-header';
import { PageLoader } from '@/components/ui/page-loader';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerDescription,
  DrawerClose,
} from '@/components/ui/drawer';
import {
  ShieldAlert,
  CheckCircle2,
  XCircle,
  Clock,
  Search,
  Ban,
  RotateCcw,
  Layers,
  Inbox,
  Image as ImageIcon,
} from 'lucide-react';

interface RequestItem {
  request_id: string;
  client_id: string;
  client_name: string;
  owner_sub: string;
  status: string;
  delegated_requested: boolean;
  production_requested?: boolean;
  requested_scopes?: string[];
  justification: string;
  created_at: string;
}

interface ClientItem {
  client_id: string;
  name: string;
  logo_image_id?: string | null;
  owner_sub: string;
  publishing_status: 'testing' | 'pending_production' | 'production' | 'suspended';
  delegated_allowed: boolean;
  redirect_uris: string[];
  suspension_reason?: string | null;
  suspended_at?: string | null;
  suspended_by_sub?: string | null;
  created_at: string;
  updated_at: string;
}

export default function AdminPage() {
  const [activeTab, setActiveTab] = React.useState<'requests' | 'clients' | 'logos'>('requests');
  const [pendingLogos, setPendingLogos] = React.useState<ClientItem[]>([]);

  const fetchLogos = async () => {
    try {
      const res = await fetch('/api/internal/admin/clients?logos=pending');
      const data = await res.json();
      if (res.ok) setPendingLogos(data.clients || []);
    } catch {
      // ignore
    }
  };

  const reviewLogo = async (clientId: string, approve: boolean) => {
    const res = await fetch('/api/internal/admin/clients', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId, action: approve ? 'approve_logo' : 'reject_logo' }),
    });
    if (res.ok) setPendingLogos((prev) => prev.filter((c) => c.client_id !== clientId));
  };
  const [requests, setRequests] = React.useState<RequestItem[]>([]);
  const [clients, setClients] = React.useState<ClientItem[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [delegatedToggles, setDelegatedToggles] = React.useState<Record<string, boolean>>({});
  // Per-request scope approvals; everything requested starts approved and admins untick
  const [scopeApprovals, setScopeApprovals] = React.useState<Record<string, string[]>>({});

  // Client search & suspension drawer state
  const [searchQuery, setSearchQuery] = React.useState('');
  const [selectedClientToSuspend, setSelectedClientToSuspend] = React.useState<ClientItem | null>(null);
  const [suspensionReason, setSuspensionReason] = React.useState('');
  const [submittingAction, setSubmittingAction] = React.useState(false);

  const fetchRequests = async () => {
    try {
      const res = await fetch('/api/internal/admin/requests');
      const data = await res.json();
      if (res.ok) {
        const reqs: RequestItem[] = data.requests || [];
        setRequests(reqs);

        const initialToggles: Record<string, boolean> = {};
        for (const r of reqs) {
          initialToggles[r.request_id] = Boolean(r.delegated_requested);
        }
        setDelegatedToggles(initialToggles);
        setScopeApprovals(Object.fromEntries(reqs.map((r) => [r.request_id, r.requested_scopes ?? []])));
      } else {
        setError(data.error || 'Access restricted to administrators');
      }
    } catch {
      // ignore
    }
  };

  const fetchClients = async (query = '') => {
    try {
      const url = query ? `/api/internal/admin/clients?q=${encodeURIComponent(query)}` : '/api/internal/admin/clients';
      const res = await fetch(url);
      const data = await res.json();
      if (res.ok) {
        setClients(data.clients || []);
      }
    } catch {
      // ignore
    }
  };

  React.useEffect(() => {
    const init = async () => {
      setLoading(true);
      await Promise.all([fetchRequests(), fetchClients()]);
      setLoading(false);
    };
    init();
  }, []);

  const handleAction = async (requestId: string, action: 'approve' | 'reject') => {
    try {
      const allowDelegated = Boolean(delegatedToggles[requestId]);
      const res = await fetch('/api/internal/admin/requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requestId,
          action,
          allowDelegated,
          approvedScopes: scopeApprovals[requestId] ?? [],
        }),
      });
      if (res.ok) {
        await Promise.all([fetchRequests(), fetchClients()]);
      }
    } catch {
      // ignore
    }
  };

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    fetchClients(searchQuery);
  };

  const handleSuspendSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedClientToSuspend || !suspensionReason.trim()) return;

    setSubmittingAction(true);
    try {
      const res = await fetch('/api/internal/admin/clients', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientId: selectedClientToSuspend.client_id,
          action: 'suspend',
          reason: suspensionReason.trim(),
        }),
      });
      if (res.ok) {
        setSelectedClientToSuspend(null);
        setSuspensionReason('');
        await fetchClients(searchQuery);
      }
    } finally {
      setSubmittingAction(false);
    }
  };

  const handleUnsuspend = async (client: ClientItem) => {
    setSubmittingAction(true);
    try {
      const res = await fetch('/api/internal/admin/clients', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientId: client.client_id,
          action: 'unsuspend',
          targetStatus: 'testing',
        }),
      });
      if (res.ok) {
        await fetchClients(searchQuery);
      }
    } finally {
      setSubmittingAction(false);
    }
  };

  if (loading) {
    return <PageLoader message="Loading admin queue..." />;
  }

  if (error) {
    return (
      <div className="max-w-md mx-auto my-16 p-6 rounded-md bg-danger/5 border border-danger/40 text-danger text-sm text-center">
        <ShieldAlert className="w-8 h-8 mx-auto mb-2 opacity-80" />
        <h3 className="font-serif text-xl font-normal mb-1">Access Denied</h3>
        <p>{error}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 py-4 max-w-4xl mx-auto">
      <PageHeader
        title="Admin Control Center"
        description="Review production requests and manage registered client applications."
      />

      {/* Tabs */}
      <div className="flex items-center gap-2 border-b border-line pb-3">
        <button
          type="button"
          onClick={() => setActiveTab('requests')}
          className={`flex items-center gap-2 px-4 py-2 rounded-md border text-sm transition-colors cursor-pointer ${
            activeTab === 'requests'
              ? 'bg-surface-soft text-fg border-line-strong'
              : 'border-transparent text-soft hover:text-fg'
          }`}
        >
          <Inbox className="w-4 h-4" />
          Production Queue
          {requests.length > 0 && (
            <span className="ml-1 px-2 py-0.5 text-xs rounded-full bg-button text-button-fg font-mono">
              {requests.length}
            </span>
          )}
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('clients')}
          className={`flex items-center gap-2 px-4 py-2 rounded-md border text-sm transition-colors cursor-pointer ${
            activeTab === 'clients'
              ? 'bg-surface-soft text-fg border-line-strong'
              : 'border-transparent text-soft hover:text-fg'
          }`}
        >
          <Layers className="w-4 h-4" />
          All Clients
          {clients.length > 0 && (
            <span className="ml-1 px-2 py-0.5 text-xs rounded-full bg-surface-soft text-soft font-mono">
              {clients.length}
            </span>
          )}
        </button>
        <button
          type="button"
          onClick={() => {
            setActiveTab('logos');
            fetchLogos();
          }}
          className={`flex items-center gap-2 px-4 py-2 rounded-md border text-sm transition-colors cursor-pointer ${
            activeTab === 'logos'
              ? 'bg-surface-soft text-fg border-line-strong'
              : 'border-transparent text-soft hover:text-fg'
          }`}
        >
          <ImageIcon className="w-4 h-4" />
          Logo Reviews
        </button>
      </div>

      {activeTab === 'logos' && (
        <div className="space-y-4">
          {pendingLogos.length === 0 ? (
            <Card className="text-center py-16">
              <EmptyState
                icon={<ImageIcon className="w-10 h-10 opacity-60" />}
                title="No logos to review"
                description="New and replaced app logos appear here before students can see them."
              />
            </Card>
          ) : (
            <ul className="grid grid-cols-1 md:grid-cols-2 gap-4 list-none p-0">
              {pendingLogos.map((c) => (
                <li key={c.client_id}>
                  <Card className="flex items-center gap-4">
                    {c.logo_image_id ? (
                      // eslint-disable-next-line @next/next/no-img-element -- same-origin uploaded logo under review
                      <img
                        src={`/img/${c.logo_image_id}`}
                        alt={`${c.name} logo`}
                        className="w-20 h-20 rounded-md border border-line object-cover shrink-0"
                      />
                    ) : null}
                    <div className="flex-1 min-w-0 space-y-2">
                      <p className="font-serif text-lg text-fg truncate">{c.name}</p>
                      <p className="font-mono text-[11px] text-muted truncate">{c.client_id}</p>
                      <p className="text-[11px] text-soft">Reject logos that imitate PESU, PES University or another club.</p>
                      <div className="flex gap-2">
                        <Button size="sm" variant="destructive" onClick={() => reviewLogo(c.client_id, false)}>
                          Reject
                        </Button>
                        <Button size="sm" onClick={() => reviewLogo(c.client_id, true)}>
                          Approve
                        </Button>
                      </div>
                    </div>
                  </Card>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Tab: Requests */}
      {activeTab === 'requests' && (
        <div className="space-y-4">
          {requests.length === 0 ? (
            <Card className="text-center py-16 space-y-2">
              <EmptyState
                icon={<Clock className="w-10 h-10 opacity-60" />}
                title="No Pending Requests"
                description="All production publishing requests have been reviewed."
              />
            </Card>
          ) : (
            <div className="space-y-4">
              {requests.map((r) => (
                <Card key={r.request_id} className="p-6">
                  <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
                    <div className="space-y-1">
                      <div className="flex items-center gap-3">
                        <CardTitle className="text-lg">{r.client_name}</CardTitle>
                        <Badge variant="pending">
                          {r.production_requested === false ? 'API Access Review' : 'Pending Review'}
                        </Badge>
                        <Badge variant={r.delegated_requested ? 'delegated' : 'identity'}>
                          {r.delegated_requested ? 'Delegated Requested' : 'Identity Only'}
                        </Badge>
                      </div>
                      <div className="font-mono text-xs text-muted">
                        Client: {r.client_id} • Owner: {r.owner_sub}
                      </div>
                    </div>

                    <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                      <label className="flex items-center gap-2 text-xs text-soft select-none cursor-pointer">
                        <input
                          type="checkbox"
                          checked={Boolean(delegatedToggles[r.request_id])}
                          onChange={(e) =>
                            setDelegatedToggles((prev) => ({
                              ...prev,
                              [r.request_id]: e.target.checked,
                            }))
                          }
                          className="rounded border-line-strong text-get focus:ring-line-strong"
                        />
                        <span>Allow Delegated</span>
                      </label>

                      <div className="flex items-center gap-2">
                        <Button
                          size="sm"
                          variant="destructive"
                          onClick={() => handleAction(r.request_id, 'reject')}
                        >
                          <XCircle className="w-4 h-4 mr-1" /> Reject
                        </Button>
                        <Button
                          size="sm"
                          variant="primary"
                          onClick={() => handleAction(r.request_id, 'approve')}
                        >
                          <CheckCircle2 className="w-4 h-4 mr-1" /> Approve
                        </Button>
                      </div>
                    </div>
                  </div>

                  {(r.requested_scopes ?? []).length > 0 ? (
                    <fieldset className="mt-4 space-y-2">
                      <legend className="eyebrow mb-1">Requested PESU Academy scopes</legend>
                      <div className="flex flex-wrap gap-2">
                        {(r.requested_scopes ?? []).map((name) => {
                          const checked = (scopeApprovals[r.request_id] ?? []).includes(name);
                          return (
                            <label
                              key={name}
                              className="flex items-center gap-2 px-2 py-1 rounded-[5px] border border-line text-xs cursor-pointer"
                              title={getScope(name)?.description}
                            >
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={(e) =>
                                  setScopeApprovals((prev) => ({
                                    ...prev,
                                    [r.request_id]: e.target.checked
                                      ? [...(prev[r.request_id] ?? []), name]
                                      : (prev[r.request_id] ?? []).filter((s) => s !== name),
                                  }))
                                }
                              />
                              <code className={`font-mono ${getScope(name)?.sensitive ? 'text-warning' : 'text-fg'}`}>{name}</code>
                            </label>
                          );
                        })}
                      </div>
                    </fieldset>
                  ) : null}

                  <div className="mt-4 p-3.5 rounded-md bg-surface-soft border border-line text-xs text-soft leading-relaxed">
                    <span className="font-semibold block mb-1 text-fg">
                      Justification:
                    </span>
                    {r.justification || 'None provided'}
                  </div>
                </Card>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Tab: Clients */}
      {activeTab === 'clients' && (
        <div className="space-y-4">
          <form onSubmit={handleSearchSubmit} className="flex gap-2">
            <div className="relative flex-1">
              <Input
                placeholder="Search clients by name, ID, or owner..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9"
              />
              <Search className="w-4 h-4 text-muted absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            </div>
            <Button type="submit" variant="secondary">
              Search
            </Button>
          </form>

          {clients.length === 0 ? (
            <Card className="text-center py-16 space-y-2">
              <EmptyState
                icon={<Layers className="w-10 h-10 opacity-60" />}
                title="No Clients Found"
                description="No client applications match your search criteria."
              />
            </Card>
          ) : (
            <div className="space-y-3">
              {clients.map((c) => (
                <Card key={c.client_id} className="p-5">
                  <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
                    <div className="space-y-1.5">
                      <div className="flex items-center gap-3">
                        <CardTitle className="text-base">{c.name}</CardTitle>
                        <Badge variant={c.publishing_status}>
                          {c.publishing_status.replace('_', ' ')}
                        </Badge>
                        {c.delegated_allowed && (
                          <Badge variant="delegated">Delegated</Badge>
                        )}
                      </div>
                      <div className="font-mono text-xs text-muted">
                        ID: {c.client_id} • Owner: {c.owner_sub}
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      {c.publishing_status === 'suspended' ? (
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => handleUnsuspend(c)}
                          disabled={submittingAction}
                        >
                          <RotateCcw className="w-4 h-4 mr-1" /> Unsuspend
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          variant="destructive"
                          onClick={() => {
                            setSelectedClientToSuspend(c);
                            setSuspensionReason('');
                          }}
                          disabled={submittingAction}
                        >
                          <Ban className="w-4 h-4 mr-1" /> Suspend
                        </Button>
                      )}
                    </div>
                  </div>

                  {c.publishing_status === 'suspended' && c.suspension_reason && (
                    <div className="mt-3.5 p-3 rounded-md bg-danger/5 border border-danger/40 text-xs text-danger">
                      <span className="font-semibold block mb-0.5">Suspension Reason:</span>
                      {c.suspension_reason}
                    </div>
                  )}
                </Card>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Suspend Reason Drawer */}
      <Drawer
        open={Boolean(selectedClientToSuspend)}
        onOpenChange={(open) => !open && setSelectedClientToSuspend(null)}
      >
        <DrawerContent className="max-w-xl mx-auto">
          <DrawerHeader>
            <DrawerTitle>Suspend Application</DrawerTitle>
            <DrawerDescription>
              Provide an official reason for suspending &quot;{selectedClientToSuspend?.name}&quot;. The application owner will see this explanation in their developer portal.
            </DrawerDescription>
          </DrawerHeader>

          <form onSubmit={handleSuspendSubmit} className="space-y-4">
            <Textarea
              label="Suspension Reason"
              rows={3}
              placeholder="e.g. Terms violation, abusive traffic pattern, compromised credentials..."
              value={suspensionReason}
              onChange={(e) => setSuspensionReason(e.target.value)}
              required
            />

            <div className="flex items-center justify-end gap-3 pt-2">
              <DrawerClose asChild>
                <Button variant="secondary" type="button" disabled={submittingAction}>
                  Cancel
                </Button>
              </DrawerClose>
              <Button
                variant="destructive"
                type="submit"
                disabled={submittingAction || !suspensionReason.trim()}
              >
                <Ban className="w-4 h-4 mr-1.5" />
                {submittingAction ? 'Suspending...' : 'Confirm Suspension'}
              </Button>
            </div>
          </form>
        </DrawerContent>
      </Drawer>
    </div>
  );
}
