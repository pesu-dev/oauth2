import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { POST as postRequestAccess } from '@/app/api/internal/portal/clients/[clientId]/request-production/route';
import { POST as postReview } from '@/app/api/internal/admin/requests/route';
import { Admin, Client, ProductionRequest } from '@/lib/db/models';
import * as cookieHelper from '@/lib/session/cookie';
import { notifySubQuietly } from '@/lib/mailer';

vi.mock('@/lib/db/connection', () => ({ connectToDatabase: vi.fn().mockResolvedValue(null) }));
vi.mock('@/lib/db/transaction', () => ({
  withTransaction: vi.fn(async (fn: (session: unknown) => Promise<unknown>) => fn({ id: 'mock-session' })),
}));
vi.mock('@/lib/mailer', () => ({ notifySubQuietly: vi.fn() }));

const JUSTIFICATION = 'Attendance tracker for the robotics club members';

function accessRequest(body: Record<string, unknown>) {
  return postRequestAccess(
    new NextRequest('http://localhost:3000/api/internal/portal/clients/cli_1/request-production', {
      method: 'POST',
      headers: { cookie: 'pesu_session=valid', 'Content-Type': 'application/json' },
      body: JSON.stringify({ justification: JUSTIFICATION, ...body }),
    }),
    { params: Promise.resolve({ clientId: 'cli_1' }) }
  );
}

function review(body: Record<string, unknown>) {
  return postReview(
    new NextRequest('http://localhost:3000/api/internal/admin/requests', {
      method: 'POST',
      headers: { cookie: 'pesu_session=valid', 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  );
}

function mockClient(fields: Record<string, unknown>) {
  const save = vi.fn().mockResolvedValue(undefined);
  vi.spyOn(Client, 'findOne').mockResolvedValueOnce({
    client_id: 'cli_1',
    name: 'Tracker',
    owner_sub: 'usr_owner',
    allowed_scopes: [],
    save,
    ...fields,
  } as never);
  return save;
}

describe('scoped API access requests (portal)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    vi.spyOn(cookieHelper, 'verifySessionToken').mockResolvedValue({ sub: 'usr_owner' });
    vi.spyOn(ProductionRequest, 'findOne').mockResolvedValue(null);
  });

  it('rejects non-resource or malformed scope lists', async () => {
    for (const requestedScopes of [['email'], ['attendance:write'], 'attendance:read', [7]]) {
      const res = await accessRequest({ requestedScopes });
      expect(res.status).toBe(400);
      expect((await res.json()).error).toContain('resource scopes');
    }
  });

  it('requires production or at least one scope', async () => {
    const res = await accessRequest({ productionRequested: false, requestedScopes: [] });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain('at least one API scope');
  });

  it('creates a production request with deduplicated scopes and marks it delegated', async () => {
    const save = mockClient({ publishing_status: 'testing' });
    const create = vi.spyOn(ProductionRequest, 'create').mockResolvedValueOnce([{ request_id: 'req_1' }] as never);

    const res = await accessRequest({ requestedScopes: ['attendance:read', 'attendance:read', 'results:read'] });
    expect(res.status).toBe(200);
    expect(create.mock.calls[0][0]).toEqual([
      expect.objectContaining({
        production_requested: true,
        requested_scopes: ['attendance:read', 'results:read'],
        delegated_requested: true,
      }),
    ]);
    expect(save).toHaveBeenCalled();
    expect(vi.mocked(notifySubQuietly).mock.calls[0][0].body).toContain('scopes: attendance:read, results:read');
  });

  it('lets a production client ask for extra scopes without changing its status', async () => {
    const save = mockClient({ publishing_status: 'production', allowed_scopes: ['attendance:read'] });
    const create = vi.spyOn(ProductionRequest, 'create').mockResolvedValueOnce([{ request_id: 'req_2' }] as never);

    const res = await accessRequest({ productionRequested: false, requestedScopes: ['attendance:read', 'seating:read'] });
    expect(res.status).toBe(200);
    expect(create.mock.calls[0][0]).toEqual([
      expect.objectContaining({ production_requested: false, requested_scopes: ['seating:read'] }),
    ]);
    expect(save).not.toHaveBeenCalled();
    expect(vi.mocked(notifySubQuietly).mock.calls[0][0].subject).toContain('API access review');
  });

  it('refuses scope requests that add nothing new, and suspended clients', async () => {
    mockClient({ publishing_status: 'production', allowed_scopes: ['seating:read'] });
    let res = await accessRequest({ productionRequested: false, requestedScopes: ['seating:read'] });
    expect((await res.json()).error).toContain('already approved');

    mockClient({ publishing_status: 'suspended' });
    res = await accessRequest({ productionRequested: false, requestedScopes: ['seating:read'] });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain('Suspended');
  });
});

describe('scoped API access review (admin)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    vi.spyOn(cookieHelper, 'verifySessionToken').mockResolvedValue({ sub: 'usr_admin' });
    vi.spyOn(Admin, 'findOne').mockResolvedValue({ sub: 'usr_admin' } as never);
  });

  function pending(fields: Record<string, unknown>) {
    vi.spyOn(ProductionRequest, 'findOneAndUpdate').mockResolvedValueOnce({
      request_id: 'req_1',
      client_id: 'cli_1',
      requested_by_sub: 'usr_owner',
      status: 'approved',
      ...fields,
    } as never);
  }

  it('rejects a malformed approvedScopes list', async () => {
    const res = await review({ requestId: 'req_1', action: 'approve', approvedScopes: 'attendance:read' });
    expect(res.status).toBe(400);
  });

  it('approves only the ticked scopes and enables delegated mode', async () => {
    pending({ production_requested: true, requested_scopes: ['attendance:read', 'results:read'] });
    vi.spyOn(Client, 'findOne').mockResolvedValueOnce({ allowed_scopes: [] } as never);
    const recordScopes = vi.spyOn(ProductionRequest, 'updateOne').mockResolvedValueOnce({} as never);
    const update = vi.spyOn(Client, 'findOneAndUpdate').mockResolvedValueOnce({
      client_id: 'cli_1',
      name: 'Tracker',
      owner_sub: 'usr_owner',
      delegated_allowed: true,
    } as never);

    const res = await review({ requestId: 'req_1', action: 'approve', approvedScopes: ['attendance:read'] });
    expect(res.status).toBe(200);
    expect(recordScopes).toHaveBeenCalledWith(
      { request_id: 'req_1' },
      { $set: { approved_scopes: ['attendance:read'] } },
      expect.any(Object)
    );
    expect(update.mock.calls[0][1]).toEqual({
      $set: expect.objectContaining({
        publishing_status: 'production',
        allowed_scopes: ['attendance:read'],
        delegated_allowed: true,
      }),
    });
    expect(vi.mocked(notifySubQuietly).mock.calls[0][0].body).toContain('Approved API scopes: attendance:read');
  });

  it('approves every requested scope when approvedScopes is omitted, keeping status for scope-only requests', async () => {
    pending({ production_requested: false, requested_scopes: ['seating:read'] });
    vi.spyOn(Client, 'findOne').mockResolvedValueOnce({ allowed_scopes: ['attendance:read'], delegated_allowed: true } as never);
    vi.spyOn(ProductionRequest, 'updateOne').mockResolvedValueOnce({} as never);
    const update = vi.spyOn(Client, 'findOneAndUpdate').mockResolvedValueOnce({
      client_id: 'cli_1',
      name: 'Tracker',
      owner_sub: 'usr_owner',
      delegated_allowed: true,
    } as never);

    await review({ requestId: 'req_1', action: 'approve' });
    const set = (update.mock.calls[0][1] as { $set: Record<string, unknown> }).$set;
    expect(set).not.toHaveProperty('publishing_status');
    expect(set.allowed_scopes).toEqual(['attendance:read', 'seating:read']);
    expect(set.delegated_allowed).toBe(true);
    expect(vi.mocked(notifySubQuietly).mock.calls[0][0].subject).toBe('API access approved for Tracker');
  });

  it('rejects a scope-only request without touching the client status', async () => {
    pending({ production_requested: false, requested_scopes: ['seating:read'], status: 'rejected' });
    vi.spyOn(Client, 'findOne').mockResolvedValueOnce({ allowed_scopes: [], delegated_allowed: false } as never);
    const update = vi.spyOn(Client, 'findOneAndUpdate').mockResolvedValueOnce({
      client_id: 'cli_1',
      name: 'Tracker',
      owner_sub: 'usr_owner',
    } as never);

    await review({ requestId: 'req_1', action: 'reject' });
    const set = (update.mock.calls[0][1] as { $set: Record<string, unknown> }).$set;
    expect(set).not.toHaveProperty('publishing_status');
    expect(set.delegated_allowed).toBe(false);
    expect(vi.mocked(notifySubQuietly).mock.calls[0][0].body).toContain('current scopes are unchanged');
  });

  it('keeps delegated mode on a production rejection when scopes were approved earlier', async () => {
    pending({ production_requested: true, requested_scopes: [], status: 'rejected' });
    vi.spyOn(Client, 'findOne').mockResolvedValueOnce({ allowed_scopes: ['attendance:read'] } as never);
    const update = vi.spyOn(Client, 'findOneAndUpdate').mockResolvedValueOnce(null as never);

    await review({ requestId: 'req_1', action: 'reject' });
    const set = (update.mock.calls[0][1] as { $set: Record<string, unknown> }).$set;
    expect(set).toMatchObject({ publishing_status: 'testing', delegated_allowed: true });
  });
});
