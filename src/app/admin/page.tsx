'use client';

import * as React from 'react';
import { Card, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
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
} from 'lucide-react';

interface RequestItem {
  request_id: string;
  client_id: string;
  client_name: string;
  owner_sub: string;
  status: string;
  delegated_requested: boolean;
  justification: string;
  created_at: string;
}

interface ClientItem {
  client_id: string;
  name: string;
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
  const [activeTab, setActiveTab] = React.useState<'requests' | 'clients'>('requests');
  const [requests, setRequests] = React.useState<RequestItem[]>([]);
  const [clients, setClients] = React.useState<ClientItem[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [delegatedToggles, setDelegatedToggles] = React.useState<Record<string, boolean>>({});

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
      const allowDelegated = delegatedToggles[requestId] ?? false;
      const res = await fetch('/api/internal/admin/requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestId, action, allowDelegated }),
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
      <div className="max-w-md mx-auto my-16 p-6 rounded-2xl bg-red-500/10 border border-red-500/20 text-red-600 text-sm text-center">
        <ShieldAlert className="w-8 h-8 mx-auto mb-2 opacity-80" />
        <h3 className="font-semibold text-base mb-1">Access Denied</h3>
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
      <div className="flex items-center gap-2 border-b border-black/5 dark:border-white/10 pb-3">
        <button
          type="button"
          onClick={() => setActiveTab('requests')}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-colors ${
            activeTab === 'requests'
              ? 'bg-zinc-900 text-white dark:bg-white dark:text-zinc-900'
              : 'text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100'
          }`}
        >
          <Inbox className="w-4 h-4" />
          Production Queue
          {requests.length > 0 && (
            <span className="ml-1 px-2 py-0.5 text-xs rounded-full bg-blue-500 text-white font-mono">
              {requests.length}
            </span>
          )}
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('clients')}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-colors ${
            activeTab === 'clients'
              ? 'bg-zinc-900 text-white dark:bg-white dark:text-zinc-900'
              : 'text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100'
          }`}
        >
          <Layers className="w-4 h-4" />
          All Clients
          {clients.length > 0 && (
            <span className="ml-1 px-2 py-0.5 text-xs rounded-full bg-zinc-200 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 font-mono">
              {clients.length}
            </span>
          )}
        </button>
      </div>

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
                        <Badge variant="pending">Pending Review</Badge>
                        <Badge variant={r.delegated_requested ? 'delegated' : 'identity'}>
                          {r.delegated_requested ? 'Delegated Requested' : 'Identity Only'}
                        </Badge>
                      </div>
                      <div className="font-mono text-xs text-zinc-400">
                        Client: {r.client_id} • Owner: {r.owner_sub}
                      </div>
                    </div>

                    <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                      <label className="flex items-center gap-2 text-xs text-zinc-600 dark:text-zinc-300 select-none cursor-pointer">
                        <input
                          type="checkbox"
                          checked={Boolean(delegatedToggles[r.request_id])}
                          onChange={(e) =>
                            setDelegatedToggles((prev) => ({
                              ...prev,
                              [r.request_id]: e.target.checked,
                            }))
                          }
                          className="rounded border-zinc-300 dark:border-zinc-700 text-blue-600 focus:ring-blue-500"
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

                  <div className="mt-4 p-3.5 rounded-xl bg-black/[0.02] dark:bg-white/[0.04] border border-black/5 dark:border-white/10 text-xs text-zinc-700 dark:text-zinc-300 leading-relaxed">
                    <span className="font-semibold block mb-1 text-zinc-900 dark:text-zinc-100">
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
              <Search className="w-4 h-4 text-zinc-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
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
                      <div className="font-mono text-xs text-zinc-400">
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
                    <div className="mt-3.5 p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-xs text-red-700 dark:text-red-400">
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

          <form onSubmit={handleSuspendSubmit} className="space-y-4 px-4 pb-6">
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
