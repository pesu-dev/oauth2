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
  });
});
