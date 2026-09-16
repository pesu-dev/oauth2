import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { GET, POST } from '@/app/api/admin/requests/route';
import { Admin, Client, ProductionRequest } from '@/lib/db/models';
import * as cookieHelper from '@/lib/session/cookie';

vi.mock('@/lib/db/connection', () => ({
  connectToDatabase: vi.fn().mockResolvedValue(null),
}));

vi.mock('@/lib/mailer', () => ({
  notifySubQuietly: vi.fn(),
}));

describe('Admin Production Requests API (/api/admin/requests)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('GET /api/admin/requests', () => {
    it('returns 403 when session is missing', async () => {
      const req = new NextRequest('http://localhost:3000/api/admin/requests');
      const res = await GET(req);
      expect(res.status).toBe(403);
    });

    it('returns 403 when user is not an admin', async () => {
      vi.spyOn(cookieHelper, 'verifySessionToken').mockResolvedValueOnce({ sub: 'usr_student' });
      vi.spyOn(Admin, 'findOne').mockResolvedValueOnce(null);

      const req = new NextRequest('http://localhost:3000/api/admin/requests', {
        headers: { cookie: 'pesu_session=valid' },
      });
      const res = await GET(req);
      expect(res.status).toBe(403);
    });

    it('returns enriched pending requests for admin', async () => {
      vi.spyOn(cookieHelper, 'verifySessionToken').mockResolvedValueOnce({ sub: 'usr_admin' });
      vi.spyOn(Admin, 'findOne').mockResolvedValueOnce({ sub: 'usr_admin' } as never);

      vi.spyOn(ProductionRequest, 'find').mockReturnValueOnce({
        sort: vi.fn().mockResolvedValueOnce([
          {
            request_id: 'req_1',
            client_id: 'cli_1',
            requested_by_sub: 'usr_dev',
            status: 'pending',
            delegated_requested: true,
            justification: 'Production justification',
            created_at: new Date('2026-01-01'),
          },
        ]),
      } as never);

      vi.spyOn(Client, 'find').mockResolvedValueOnce([
        { client_id: 'cli_1', name: 'My App', owner_sub: 'usr_dev' },
      ] as never);

      const req = new NextRequest('http://localhost:3000/api/admin/requests', {
        headers: { cookie: 'pesu_session=valid' },
      });
      const res = await GET(req);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.requests).toHaveLength(1);
      expect(data.requests[0].client_name).toBe('My App');
      expect(data.requests[0].delegated_requested).toBe(true);
    });
  });

  describe('POST /api/admin/requests', () => {
    it('returns 403 when not admin', async () => {
      const req = new NextRequest('http://localhost:3000/api/admin/requests', {
        method: 'POST',
        body: JSON.stringify({ requestId: 'req_1', action: 'approve' }),
      });
      const res = await POST(req);
      expect(res.status).toBe(403);
    });

    it('returns 400 when invalid parameters provided', async () => {
      vi.spyOn(cookieHelper, 'verifySessionToken').mockResolvedValueOnce({ sub: 'usr_admin' });
      vi.spyOn(Admin, 'findOne').mockResolvedValueOnce({ sub: 'usr_admin' } as never);

      const req = new NextRequest('http://localhost:3000/api/admin/requests', {
        method: 'POST',
        headers: { cookie: 'pesu_session=valid', 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestId: '', action: 'invalid_action' }),
      });
      const res = await POST(req);
      expect(res.status).toBe(400);
    });

    it('returns 404 when production request is not found or already resolved', async () => {
      vi.spyOn(cookieHelper, 'verifySessionToken').mockResolvedValueOnce({ sub: 'usr_admin' });
      vi.spyOn(Admin, 'findOne').mockResolvedValueOnce({ sub: 'usr_admin' } as never);
      vi.spyOn(ProductionRequest, 'findOneAndUpdate').mockResolvedValueOnce(null);

      const req = new NextRequest('http://localhost:3000/api/admin/requests', {
        method: 'POST',
        headers: { cookie: 'pesu_session=valid', 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestId: 'req_not_found', action: 'approve' }),
      });
      const res = await POST(req);
      expect(res.status).toBe(404);
    });

    it('approves request and enables delegated mode when allowDelegated is true', async () => {
      vi.spyOn(cookieHelper, 'verifySessionToken').mockResolvedValueOnce({ sub: 'usr_admin' });
      vi.spyOn(Admin, 'findOne').mockResolvedValueOnce({ sub: 'usr_admin' } as never);

      vi.spyOn(ProductionRequest, 'findOneAndUpdate').mockResolvedValueOnce({
        request_id: 'req_1',
        client_id: 'cli_1',
        status: 'approved',
        requested_by_sub: 'usr_dev',
      } as never);

      const clientUpdateSpy = vi.spyOn(Client, 'findOneAndUpdate').mockResolvedValueOnce({
        client_id: 'cli_1',
        name: 'My App',
        owner_sub: 'usr_dev',
      } as never);

      const req = new NextRequest('http://localhost:3000/api/admin/requests', {
        method: 'POST',
        headers: { cookie: 'pesu_session=valid', 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestId: 'req_1', action: 'approve', allowDelegated: true }),
      });
      const res = await POST(req);
      expect(res.status).toBe(200);
      expect(clientUpdateSpy).toHaveBeenCalledWith(
        { client_id: 'cli_1' },
        expect.objectContaining({
          $set: expect.objectContaining({
            publishing_status: 'production',
            delegated_allowed: true,
          }),
        }),
        expect.any(Object)
      );
    });

    it('rejects request and resets client to testing status', async () => {
      vi.spyOn(cookieHelper, 'verifySessionToken').mockResolvedValueOnce({ sub: 'usr_admin' });
      vi.spyOn(Admin, 'findOne').mockResolvedValueOnce({ sub: 'usr_admin' } as never);

      vi.spyOn(ProductionRequest, 'findOneAndUpdate').mockResolvedValueOnce({
        request_id: 'req_1',
        client_id: 'cli_1',
        status: 'rejected',
        requested_by_sub: 'usr_dev',
      } as never);

      const clientUpdateSpy = vi.spyOn(Client, 'findOneAndUpdate').mockResolvedValueOnce({
        client_id: 'cli_1',
        name: 'My App',
        owner_sub: 'usr_dev',
      } as never);

      const req = new NextRequest('http://localhost:3000/api/admin/requests', {
        method: 'POST',
        headers: { cookie: 'pesu_session=valid', 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestId: 'req_1', action: 'reject' }),
      });
      const res = await POST(req);
      expect(res.status).toBe(200);
      expect(clientUpdateSpy).toHaveBeenCalledWith(
        { client_id: 'cli_1' },
        expect.objectContaining({
          $set: expect.objectContaining({
            publishing_status: 'testing',
            delegated_allowed: false,
          }),
        }),
        expect.any(Object)
      );
    });

    it('handles requests with missing client details, fallback owner_sub, and empty justification in GET', async () => {
      vi.spyOn(cookieHelper, 'verifySessionToken').mockResolvedValueOnce({ sub: 'usr_admin' });
      vi.spyOn(Admin, 'findOne').mockResolvedValueOnce({ sub: 'usr_admin' } as never);

      vi.spyOn(ProductionRequest, 'find').mockReturnValueOnce({
        sort: vi.fn().mockResolvedValueOnce([
          {
            request_id: 'req_fallback_1',
            client_id: 'cli_unknown',
            requested_by_sub: undefined,
            owner_sub: 'usr_owner_field',
            status: 'pending',
            delegated_requested: false,
            justification: undefined,
            created_at: new Date('2026-01-01'),
          },
          {
            request_id: 'req_fallback_2',
            client_id: 'cli_client_owner',
            requested_by_sub: undefined,
            owner_sub: undefined,
            status: 'pending',
            delegated_requested: false,
            justification: undefined,
            created_at: new Date('2026-01-01'),
          },
          {
            request_id: 'req_fallback_3',
            client_id: 'cli_no_owner',
            requested_by_sub: undefined,
            owner_sub: undefined,
            status: 'pending',
            delegated_requested: false,
            justification: undefined,
            created_at: new Date('2026-01-01'),
          },
        ]),
      } as never);

      vi.spyOn(Client, 'find').mockResolvedValueOnce([
        { client_id: 'cli_client_owner', name: 'App With Owner', owner_sub: 'usr_client_owner' },
        { client_id: 'cli_no_owner', name: 'App No Owner', owner_sub: undefined },
      ] as never);

      const req = new NextRequest('http://localhost:3000/api/admin/requests', {
        headers: { cookie: 'pesu_session=valid' },
      });
      const res = await GET(req);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.requests[0].client_name).toBe('cli_unknown');
      expect(data.requests[0].owner_sub).toBe('usr_owner_field');
      expect(data.requests[0].justification).toBe('');
      expect(data.requests[1].owner_sub).toBe('usr_client_owner');
      expect(data.requests[2].owner_sub).toBe('Unknown');
    });

    it('handles approval without delegated mode, null client on update, and fallback owner_sub in POST', async () => {
      vi.spyOn(cookieHelper, 'verifySessionToken').mockResolvedValue({ sub: 'usr_admin' });
      vi.spyOn(Admin, 'findOne').mockResolvedValue({ sub: 'usr_admin' } as never);

      // 1. Approve without allowDelegated
      vi.spyOn(ProductionRequest, 'findOneAndUpdate').mockResolvedValueOnce({
        request_id: 'req_no_delegated',
        client_id: 'cli_1',
        status: 'approved',
        requested_by_sub: 'usr_fallback',
      } as never);

      vi.spyOn(Client, 'findOneAndUpdate').mockResolvedValueOnce({
        client_id: 'cli_1',
        name: 'My App',
        owner_sub: undefined, // test fallback to prodReq.requested_by_sub
      } as never);

      const req1 = new NextRequest('http://localhost:3000/api/admin/requests', {
        method: 'POST',
        headers: { cookie: 'pesu_session=valid', 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestId: 'req_no_delegated', action: 'approve' }),
      });
      const res1 = await POST(req1);
      expect(res1.status).toBe(200);

      // 2. Client not found during update (null client)
      vi.spyOn(ProductionRequest, 'findOneAndUpdate').mockResolvedValueOnce({
        request_id: 'req_client_gone',
        client_id: 'cli_gone',
        status: 'approved',
      } as never);

      vi.spyOn(Client, 'findOneAndUpdate').mockResolvedValueOnce(null);

      const req2 = new NextRequest('http://localhost:3000/api/admin/requests', {
        method: 'POST',
        headers: { cookie: 'pesu_session=valid', 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestId: 'req_client_gone', action: 'approve' }),
      });
      const res2 = await POST(req2);
      expect(res2.status).toBe(200);
    });

    it('reverts production request to pending when client update fails', async () => {
      vi.spyOn(cookieHelper, 'verifySessionToken').mockResolvedValueOnce({ sub: 'usr_admin' });
      vi.spyOn(Admin, 'findOne').mockResolvedValueOnce({ sub: 'usr_admin' } as never);

      vi.spyOn(ProductionRequest, 'findOneAndUpdate').mockResolvedValueOnce({
        request_id: 'req_1',
        client_id: 'cli_1',
        status: 'approved',
      } as never);

      const rollbackSpy = vi.spyOn(ProductionRequest, 'updateOne').mockResolvedValueOnce({} as never);
      vi.spyOn(Client, 'findOneAndUpdate').mockRejectedValueOnce(new Error('Database write error'));

      const req = new NextRequest('http://localhost:3000/api/admin/requests', {
        method: 'POST',
        headers: { cookie: 'pesu_session=valid', 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestId: 'req_1', action: 'approve' }),
      });

      await expect(POST(req)).rejects.toThrow('Database write error');
      expect(rollbackSpy).toHaveBeenCalledWith(
        { request_id: 'req_1' },
        {
          $set: {
            status: 'pending',
            resolved_at: null,
            resolved_by_sub: null,
            reviewed_at: null,
            reviewer_sub: null,
          },
        }
      );
    });
  });
});
