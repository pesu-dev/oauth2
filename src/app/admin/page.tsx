'use client';

import * as React from 'react';
import { Card, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ShieldAlert, CheckCircle2, XCircle, Clock } from 'lucide-react';

interface RequestItem {
  request_id: string;
  client_id: string;
  client_name: string;
  owner_sub: string;
  status: string;
  justification: string;
  created_at: string;
}

export default function AdminPage() {
  const [requests, setRequests] = React.useState<RequestItem[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  const fetchRequests = async () => {
    try {
      const res = await fetch('/api/admin/requests');
      const data = await res.json();
      if (res.ok) {
        setRequests(data.requests || []);
      } else {
        setError(data.error || 'Access restricted to administrators');
      }
    } finally {
      setLoading(false);
    }
  };

  React.useEffect(() => {
    fetchRequests();
  }, []);

  const handleAction = async (requestId: string, action: 'approve' | 'reject') => {
    try {
      const res = await fetch('/api/admin/requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestId, action }),
      });
      if (res.ok) {
        fetchRequests();
      }
    } catch {
      // ignore
    }
  };

  if (loading) {
    return <div className="py-16 text-center text-sm text-zinc-400">Loading admin queue...</div>;
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
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
          Admin Review Queue
        </h1>
        <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
          Review and approve production publishing requests for third-party client apps.
        </p>
      </div>

      {requests.length === 0 ? (
        <Card className="text-center py-16 space-y-2">
          <Clock className="w-10 h-10 mx-auto text-zinc-400 opacity-60 mb-2" />
          <CardTitle className="text-lg">No Pending Requests</CardTitle>
          <CardDescription>
            All production publishing requests have been reviewed.
          </CardDescription>
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
                  </div>
                  <div className="font-mono text-xs text-zinc-400">
                    Client: {r.client_id} • Owner: {r.owner_sub}
                  </div>
                </div>

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

              <div className="mt-4 p-3.5 rounded-xl bg-black/[0.02] dark:bg-white/[0.04] border border-black/5 dark:border-white/10 text-xs text-zinc-700 dark:text-zinc-300 leading-relaxed">
                <span className="font-semibold block mb-1 text-zinc-900 dark:text-zinc-100">
                  Justification:
                </span>
                {r.justification}
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
