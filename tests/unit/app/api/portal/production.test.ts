import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { POST as postRequestProduction } from '@/app/api/portal/clients/[clientId]/request-production/route';
import { Client, ProductionRequest } from '@/lib/db/models';
import * as cookieHelper from '@/lib/session/cookie';

vi.mock('@/lib/db/connection', () => ({
  connectToDatabase: vi.fn().mockResolvedValue(null),
}));

vi.mock('@/lib/mailer', () => ({
  notifySubQuietly: vi.fn(),
}));

describe('Production Request Gating & Duplicate Guard (/api/portal/clients/[clientId]/request-production)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(cookieHelper, 'verifySessionToken').mockResolvedValue({ sub: 'usr_owner' });
  });

  it('rejects production request if client is not in testing status', async () => {
    vi.spyOn(Client, 'findOne').mockResolvedValueOnce({
      client_id: 'cli_1',
      owner_sub: 'usr_owner',
      publishing_status: 'pending_production',
    } as unknown as InstanceType<typeof Client>);

    const req = new NextRequest('http://localhost:3000/api/portal/clients/cli_1/request-production', {
      method: 'POST',
      headers: { cookie: 'pesu_session=valid', 'Content-Type': 'application/json' },
      body: JSON.stringify({ justification: 'Valid justification with > 10 chars' }),
    });

    const res = await postRequestProduction(req, { params: Promise.resolve({ clientId: 'cli_1' }) });
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain('Only Testing clients can request Production approval');
  });

  it('rejects production request if another request is already pending', async () => {
    vi.spyOn(Client, 'findOne').mockResolvedValueOnce({
      client_id: 'cli_1',
      owner_sub: 'usr_owner',
      publishing_status: 'testing',
    } as unknown as InstanceType<typeof Client>);
    vi.spyOn(ProductionRequest, 'findOne').mockResolvedValueOnce({
      request_id: 'req_existing',
      status: 'pending',
    } as unknown as InstanceType<typeof ProductionRequest>);

    const req = new NextRequest('http://localhost:3000/api/portal/clients/cli_1/request-production', {
      method: 'POST',
      headers: { cookie: 'pesu_session=valid', 'Content-Type': 'application/json' },
      body: JSON.stringify({ justification: 'Valid justification with > 10 chars' }),
    });

    const res = await postRequestProduction(req, { params: Promise.resolve({ clientId: 'cli_1' }) });
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain('already pending review');
  });

  it('rejects unauthenticated request with 401', async () => {
    const req = new NextRequest('http://localhost:3000/api/portal/clients/cli_1/request-production', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ justification: 'Valid justification with > 10 chars' }),
    });

    const res = await postRequestProduction(req, { params: Promise.resolve({ clientId: 'cli_1' }) });
    expect(res.status).toBe(401);
  });

  it('rejects short or missing justification with 400', async () => {
    const req = new NextRequest('http://localhost:3000/api/portal/clients/cli_1/request-production', {
      method: 'POST',
      headers: { cookie: 'pesu_session=valid', 'Content-Type': 'application/json' },
      body: JSON.stringify({ justification: 'short' }),
    });

    const res = await postRequestProduction(req, { params: Promise.resolve({ clientId: 'cli_1' }) });
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain('at least 10 characters');
  });

  it('returns 404 when client is not found or user is not owner', async () => {
    vi.spyOn(Client, 'findOne').mockResolvedValueOnce(null);

    const req = new NextRequest('http://localhost:3000/api/portal/clients/cli_1/request-production', {
      method: 'POST',
      headers: { cookie: 'pesu_session=valid', 'Content-Type': 'application/json' },
      body: JSON.stringify({ justification: 'Valid justification with > 10 chars' }),
    });

    const res = await postRequestProduction(req, { params: Promise.resolve({ clientId: 'cli_1' }) });
    expect(res.status).toBe(404);
  });

  it('successfully creates production request and updates client status', async () => {
    const mockClient = {
      client_id: 'cli_1',
      name: 'Test Client App',
      owner_sub: 'usr_owner',
      publishing_status: 'testing',
      save: vi.fn().mockResolvedValue(true),
    };
    vi.spyOn(Client, 'findOne').mockResolvedValueOnce(mockClient as unknown as InstanceType<typeof Client>);
    vi.spyOn(ProductionRequest, 'findOne').mockResolvedValueOnce(null);
    vi.spyOn(ProductionRequest, 'create').mockResolvedValueOnce({
      request_id: 'req_new_1',
      client_id: 'cli_1',
      status: 'pending',
    } as never);

    const req = new NextRequest('http://localhost:3000/api/portal/clients/cli_1/request-production', {
      method: 'POST',
      headers: { cookie: 'pesu_session=valid', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        justification: 'This app is ready for university production use.',
        delegatedRequested: true,
      }),
    });

    const res = await postRequestProduction(req, { params: Promise.resolve({ clientId: 'cli_1' }) });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.request.request_id).toBe('req_new_1');
    expect(mockClient.publishing_status).toBe('pending_production');
    expect(mockClient.save).toHaveBeenCalled();
  });

  it('performs compensating deletion of production request if client.save fails', async () => {
    const mockClient = {
      client_id: 'cli_1',
      name: 'Test Client App',
      owner_sub: 'usr_owner',
      publishing_status: 'testing',
      save: vi.fn().mockRejectedValueOnce(new Error('Save failed')),
    };
    vi.spyOn(Client, 'findOne').mockResolvedValueOnce(mockClient as unknown as InstanceType<typeof Client>);
    vi.spyOn(ProductionRequest, 'findOne').mockResolvedValueOnce(null);
    vi.spyOn(ProductionRequest, 'create').mockResolvedValueOnce({
      request_id: 'req_new_rollback',
      client_id: 'cli_1',
      status: 'pending',
    } as never);
    const deleteSpy = vi.spyOn(ProductionRequest, 'deleteOne').mockResolvedValueOnce({} as never);

    const req = new NextRequest('http://localhost:3000/api/portal/clients/cli_1/request-production', {
      method: 'POST',
      headers: { cookie: 'pesu_session=valid', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        justification: 'This app is ready for university production use.',
      }),
    });

    await expect(
      postRequestProduction(req, { params: Promise.resolve({ clientId: 'cli_1' }) })
    ).rejects.toThrow('Save failed');

    expect(deleteSpy).toHaveBeenCalledWith({ request_id: 'req_new_rollback' });
  });
});
