import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { GET, PATCH } from '@/app/api/internal/admin/clients/route';
import { Admin, Client } from '@/lib/db/models';
import * as cookieHelper from '@/lib/session/cookie';
import * as mailer from '@/lib/mailer';

vi.mock('@/lib/db/connection', () => ({
  connectToDatabase: vi.fn().mockResolvedValue(null),
}));

vi.mock('@/lib/mailer', () => ({
  notifySubQuietly: vi.fn(),
}));

describe('Admin Clients API (/api/admin/clients)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('GET /api/admin/clients', () => {
    it('returns 403 when session is missing', async () => {
      const req = new NextRequest('http://localhost:3000/api/admin/clients');
      const res = await GET(req);
      expect(res.status).toBe(403);
    });

    it('returns 403 when user is not an admin', async () => {
      vi.spyOn(cookieHelper, 'verifySessionToken').mockResolvedValueOnce({ sub: 'usr_student' });
      vi.spyOn(Admin, 'findOne').mockResolvedValueOnce(null);

      const req = new NextRequest('http://localhost:3000/api/admin/clients', {
        headers: { cookie: 'pesu_session=valid' },
      });
      const res = await GET(req);
      expect(res.status).toBe(403);
    });

    it('returns clients list for admin', async () => {
      vi.spyOn(cookieHelper, 'verifySessionToken').mockResolvedValueOnce({ sub: 'usr_admin' });
      vi.spyOn(Admin, 'findOne').mockResolvedValueOnce({ sub: 'usr_admin' } as never);

      const mockClients = [
        {
          client_id: 'cli_1',
          name: 'App One',
          owner_sub: 'usr_dev',
          publishing_status: 'testing',
          delegated_allowed: false,
          redirect_uris: ['http://localhost:3000/cb'],
          suspension_reason: null,
          suspended_at: null,
          suspended_by_sub: null,
          created_at: new Date('2026-01-01'),
          updated_at: new Date('2026-01-01'),
        },
        {
          client_id: 'cli_2',
          name: 'App Two',
          owner_sub: 'usr_dev2',
          publishing_status: 'suspended',
          delegated_allowed: true,
          redirect_uris: ['https://example.com/cb'],
          suspension_reason: 'Terms violation',
          suspended_at: new Date('2026-02-01'),
          suspended_by_sub: 'usr_admin',
          created_at: new Date('2026-01-02'),
          updated_at: new Date('2026-02-01'),
        },
      ];

      vi.spyOn(Client, 'find').mockReturnValueOnce({
        sort: vi.fn().mockReturnValueOnce({
          limit: vi.fn().mockReturnValueOnce({
            lean: vi.fn().mockResolvedValueOnce(mockClients),
          }),
        }),
      } as never);

      const req = new NextRequest('http://localhost:3000/api/admin/clients', {
        headers: { cookie: 'pesu_session=valid' },
      });
      const res = await GET(req);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.clients).toHaveLength(2);
      expect(data.clients[1].publishing_status).toBe('suspended');
      expect(data.clients[1].suspension_reason).toBe('Terms violation');
    });

    it('supports search query filter', async () => {
      vi.spyOn(cookieHelper, 'verifySessionToken').mockResolvedValueOnce({ sub: 'usr_admin' });
      vi.spyOn(Admin, 'findOne').mockResolvedValueOnce({ sub: 'usr_admin' } as never);

      const findSpy = vi.spyOn(Client, 'find').mockReturnValueOnce({
        sort: vi.fn().mockReturnValueOnce({
          limit: vi.fn().mockReturnValueOnce({
            lean: vi.fn().mockResolvedValueOnce([]),
          }),
        }),
      } as never);

      const req = new NextRequest('http://localhost:3000/api/admin/clients?q=testapp', {
        headers: { cookie: 'pesu_session=valid' },
      });
      const res = await GET(req);
      expect(res.status).toBe(200);
      expect(findSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          $or: expect.any(Array),
        })
      );
    });
  });

  describe('PATCH /api/admin/clients', () => {
    it('returns 403 if not admin', async () => {
      vi.spyOn(cookieHelper, 'verifySessionToken').mockResolvedValueOnce(null);

      const req = new NextRequest('http://localhost:3000/api/admin/clients', {
        method: 'PATCH',
        headers: { cookie: 'pesu_session=valid', 'content-type': 'application/json' },
        body: JSON.stringify({ clientId: 'cli_1', action: 'suspend', reason: 'Abuse' }),
      });
      const res = await PATCH(req);
      expect(res.status).toBe(403);
    });

    it('returns 400 for invalid action or missing clientId', async () => {
      vi.spyOn(cookieHelper, 'verifySessionToken').mockResolvedValueOnce({ sub: 'usr_admin' });
      vi.spyOn(Admin, 'findOne').mockResolvedValueOnce({ sub: 'usr_admin' } as never);

      const req = new NextRequest('http://localhost:3000/api/admin/clients', {
        method: 'PATCH',
        headers: { cookie: 'pesu_session=valid', 'content-type': 'application/json' },
        body: JSON.stringify({ clientId: '', action: 'suspend' }),
      });
      const res = await PATCH(req);
      expect(res.status).toBe(400);
    });

    it('returns 404 if client not found', async () => {
      vi.spyOn(cookieHelper, 'verifySessionToken').mockResolvedValueOnce({ sub: 'usr_admin' });
      vi.spyOn(Admin, 'findOne').mockResolvedValueOnce({ sub: 'usr_admin' } as never);
      vi.spyOn(Client, 'findOne').mockResolvedValueOnce(null);

      const req = new NextRequest('http://localhost:3000/api/admin/clients', {
        method: 'PATCH',
        headers: { cookie: 'pesu_session=valid', 'content-type': 'application/json' },
        body: JSON.stringify({ clientId: 'cli_unknown', action: 'suspend', reason: 'Bad' }),
      });
      const res = await PATCH(req);
      expect(res.status).toBe(404);
    });

    it('returns 400 if suspending without a reason', async () => {
      vi.spyOn(cookieHelper, 'verifySessionToken').mockResolvedValueOnce({ sub: 'usr_admin' });
      vi.spyOn(Admin, 'findOne').mockResolvedValueOnce({ sub: 'usr_admin' } as never);
      vi.spyOn(Client, 'findOne').mockResolvedValueOnce({
        client_id: 'cli_1',
        name: 'App',
        save: vi.fn(),
      } as never);

      const req = new NextRequest('http://localhost:3000/api/admin/clients', {
        method: 'PATCH',
        headers: { cookie: 'pesu_session=valid', 'content-type': 'application/json' },
        body: JSON.stringify({ clientId: 'cli_1', action: 'suspend', reason: '   ' }),
      });
      const res = await PATCH(req);
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain('Suspension reason is required');
    });

    it('successfully suspends a client with reason and notifies owner', async () => {
      vi.spyOn(cookieHelper, 'verifySessionToken').mockResolvedValueOnce({ sub: 'usr_admin' });
      vi.spyOn(Admin, 'findOne').mockResolvedValueOnce({ sub: 'usr_admin' } as never);

      const mockClient = {
        client_id: 'cli_1',
        name: 'Evil App',
        owner_sub: 'usr_dev',
        publishing_status: 'production',
        suspension_reason: null,
        suspended_at: null,
        suspended_by_sub: null,
        updated_at: new Date('2026-01-01'),
        save: vi.fn().mockResolvedValue(true),
      };
      vi.spyOn(Client, 'findOne').mockResolvedValueOnce(mockClient as never);

      const req = new NextRequest('http://localhost:3000/api/admin/clients', {
        method: 'PATCH',
        headers: { cookie: 'pesu_session=valid', 'content-type': 'application/json' },
        body: JSON.stringify({
          clientId: 'cli_1',
          action: 'suspend',
          reason: 'Security vulnerability detected in redirect URI',
        }),
      });
      const res = await PATCH(req);
      expect(res.status).toBe(200);
      expect(mockClient.publishing_status).toBe('suspended');
      expect(mockClient.suspension_reason).toBe('Security vulnerability detected in redirect URI');
      expect(mockClient.suspended_by_sub).toBe('usr_admin');
      expect(mockClient.save).toHaveBeenCalled();
      expect(mailer.notifySubQuietly).toHaveBeenCalledWith(
        expect.objectContaining({
          sub: 'usr_dev',
          subject: expect.stringContaining('suspended'),
          body: expect.stringContaining('Security vulnerability detected'),
        })
      );
    });

    it('successfully unsuspends a client and notifies owner', async () => {
      vi.spyOn(cookieHelper, 'verifySessionToken').mockResolvedValueOnce({ sub: 'usr_admin' });
      vi.spyOn(Admin, 'findOne').mockResolvedValueOnce({ sub: 'usr_admin' } as never);

      const mockClient = {
        client_id: 'cli_1',
        name: 'Fixed App',
        owner_sub: 'usr_dev',
        publishing_status: 'suspended',
        suspension_reason: 'Fixed now',
        suspended_at: new Date(),
        suspended_by_sub: 'usr_admin',
        updated_at: new Date('2026-01-01'),
        save: vi.fn().mockResolvedValue(true),
      };
      vi.spyOn(Client, 'findOne').mockResolvedValueOnce(mockClient as never);

      const req = new NextRequest('http://localhost:3000/api/admin/clients', {
        method: 'PATCH',
        headers: { cookie: 'pesu_session=valid', 'content-type': 'application/json' },
        body: JSON.stringify({
          clientId: 'cli_1',
          action: 'unsuspend',
          targetStatus: 'testing',
        }),
      });
      const res = await PATCH(req);
      expect(res.status).toBe(200);
      expect(mockClient.publishing_status).toBe('testing');
      expect(mockClient.suspension_reason).toBeNull();
      expect(mockClient.suspended_at).toBeNull();
      expect(mockClient.suspended_by_sub).toBeNull();
      expect(mockClient.save).toHaveBeenCalled();
      expect(mailer.notifySubQuietly).toHaveBeenCalledWith(
        expect.objectContaining({
          sub: 'usr_dev',
          subject: expect.stringContaining('reinstated'),
        })
      );
    });

    it('unsuspends with targetStatus production or fallback to testing', async () => {
      vi.spyOn(cookieHelper, 'verifySessionToken').mockResolvedValue({ sub: 'usr_admin' });
      vi.spyOn(Admin, 'findOne').mockResolvedValue({ sub: 'usr_admin' } as never);

      const mockClient = {
        client_id: 'cli_1',
        name: 'Prod App',
        owner_sub: 'usr_dev',
        publishing_status: 'suspended',
        save: vi.fn().mockResolvedValue(true),
      };
      vi.spyOn(Client, 'findOne').mockResolvedValue(mockClient as never);

      // targetStatus: production
      const req1 = new NextRequest('http://localhost:3000/api/admin/clients', {
        method: 'PATCH',
        headers: { cookie: 'pesu_session=valid', 'content-type': 'application/json' },
        body: JSON.stringify({
          clientId: 'cli_1',
          action: 'unsuspend',
          targetStatus: 'production',
        }),
      });
      const res1 = await PATCH(req1);
      expect(res1.status).toBe(200);
      expect(mockClient.publishing_status).toBe('production');

      // targetStatus: omitted (falls back to testing)
      const req2 = new NextRequest('http://localhost:3000/api/admin/clients', {
        method: 'PATCH',
        headers: { cookie: 'pesu_session=valid', 'content-type': 'application/json' },
        body: JSON.stringify({
          clientId: 'cli_1',
          action: 'unsuspend',
        }),
      });
      const res2 = await PATCH(req2);
      expect(res2.status).toBe(200);
      expect(mockClient.publishing_status).toBe('testing');
    });
  });
});
