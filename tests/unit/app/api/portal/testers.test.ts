import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { POST, DELETE } from '@/app/api/internal/portal/clients/[clientId]/testers/route';
import { Client, ClientTester, User } from '@/lib/db/models';
import * as cookieHelper from '@/lib/session/cookie';

vi.mock('@/lib/db/connection', () => ({
  connectToDatabase: vi.fn().mockResolvedValue(null),
}));

describe('Portal Client Testers API (/api/portal/clients/[clientId]/testers)', () => {
  const params = Promise.resolve({ clientId: 'cli_test' });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('POST', () => {
    it('returns 401 when unauthenticated', async () => {
      const req = new NextRequest('http://localhost:3000/api/portal/clients/cli_test/testers', {
        method: 'POST',
        body: JSON.stringify({ identifier: 'PES1202000001' }),
      });
      const res = await POST(req, { params });
      expect(res.status).toBe(401);
    });

    it('returns 400 when identifier is missing', async () => {
      vi.spyOn(cookieHelper, 'verifySessionToken').mockResolvedValueOnce({ sub: 'usr_owner' });

      const req = new NextRequest('http://localhost:3000/api/portal/clients/cli_test/testers', {
        method: 'POST',
        headers: { cookie: 'pesu_session=valid', 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const res = await POST(req, { params });
      expect(res.status).toBe(400);
    });

    it('returns 404 when client is not found for current user', async () => {
      vi.spyOn(cookieHelper, 'verifySessionToken').mockResolvedValueOnce({ sub: 'usr_owner' });
      vi.spyOn(Client, 'findOne').mockResolvedValueOnce(null);

      const req = new NextRequest('http://localhost:3000/api/portal/clients/cli_test/testers', {
        method: 'POST',
        headers: { cookie: 'pesu_session=valid', 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier: 'PES1202000001' }),
      });
      const res = await POST(req, { params });
      expect(res.status).toBe(404);
    });

    it('returns 400 when user with given PRN/SRN has not registered yet', async () => {
      vi.spyOn(cookieHelper, 'verifySessionToken').mockResolvedValueOnce({ sub: 'usr_owner' });
      vi.spyOn(Client, 'findOne').mockResolvedValueOnce({
        client_id: 'cli_test',
        owner_sub: 'usr_owner',
      } as never);
      vi.spyOn(User, 'findOne').mockResolvedValueOnce(null);

      const req = new NextRequest('http://localhost:3000/api/portal/clients/cli_test/testers', {
        method: 'POST',
        headers: { cookie: 'pesu_session=valid', 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier: 'PES1202000999' }),
      });
      const res = await POST(req, { params });
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain('has not signed in yet');
    });

    it('successfully adds tester with PRN/SRN', async () => {
      vi.spyOn(cookieHelper, 'verifySessionToken').mockResolvedValueOnce({ sub: 'usr_owner' });
      vi.spyOn(Client, 'findOne').mockResolvedValueOnce({
        client_id: 'cli_test',
        owner_sub: 'usr_owner',
      } as never);
      vi.spyOn(User, 'findOne').mockResolvedValueOnce({
        sub: 'usr_tester_1',
        prn: 'PES1UG20CS001',
      } as never);

      const upsertSpy = vi.spyOn(ClientTester, 'findOneAndUpdate').mockResolvedValueOnce({
        client_id: 'cli_test',
        sub: 'usr_tester_1',
      } as never);

      const req = new NextRequest('http://localhost:3000/api/portal/clients/cli_test/testers', {
        method: 'POST',
        headers: { cookie: 'pesu_session=valid', 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier: 'PES1UG20CS001' }),
      });
      const res = await POST(req, { params });
      expect(res.status).toBe(200);
      expect(upsertSpy).toHaveBeenCalledWith(
        { client_id: 'cli_test', sub: 'usr_tester_1' },
        expect.objectContaining({ client_id: 'cli_test', sub: 'usr_tester_1' }),
        expect.any(Object)
      );
    });

    it('successfully adds tester with direct usr_ sub without looking up User', async () => {
      vi.spyOn(cookieHelper, 'verifySessionToken').mockResolvedValueOnce({ sub: 'usr_owner' });
      vi.spyOn(Client, 'findOne').mockResolvedValueOnce({
        client_id: 'cli_test',
        owner_sub: 'usr_owner',
      } as never);
      const userFindSpy = vi.spyOn(User, 'findOne');

      vi.spyOn(ClientTester, 'findOneAndUpdate').mockResolvedValueOnce({
        client_id: 'cli_test',
        sub: 'usr_direct_tester',
      } as never);

      const req = new NextRequest('http://localhost:3000/api/portal/clients/cli_test/testers', {
        method: 'POST',
        headers: { cookie: 'pesu_session=valid', 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier: 'usr_direct_tester' }),
      });
      const res = await POST(req, { params });
      expect(res.status).toBe(200);
      expect(userFindSpy).not.toHaveBeenCalled();
    });
  });

  describe('DELETE', () => {
    it('returns 401 when unauthenticated', async () => {
      const req = new NextRequest('http://localhost:3000/api/portal/clients/cli_test/testers?sub=usr_1', {
        method: 'DELETE',
      });
      const res = await DELETE(req, { params });
      expect(res.status).toBe(401);
    });

    it('returns 400 when sub param is missing', async () => {
      vi.spyOn(cookieHelper, 'verifySessionToken').mockResolvedValueOnce({ sub: 'usr_owner' });

      const req = new NextRequest('http://localhost:3000/api/portal/clients/cli_test/testers', {
        method: 'DELETE',
        headers: { cookie: 'pesu_session=valid' },
      });
      const res = await DELETE(req, { params });
      expect(res.status).toBe(400);
    });

    it('returns 404 when client not found', async () => {
      vi.spyOn(cookieHelper, 'verifySessionToken').mockResolvedValueOnce({ sub: 'usr_owner' });
      vi.spyOn(Client, 'findOne').mockResolvedValueOnce(null);

      const req = new NextRequest('http://localhost:3000/api/portal/clients/cli_test/testers?sub=usr_1', {
        method: 'DELETE',
        headers: { cookie: 'pesu_session=valid' },
      });
      const res = await DELETE(req, { params });
      expect(res.status).toBe(404);
    });

    it('deletes tester successfully', async () => {
      vi.spyOn(cookieHelper, 'verifySessionToken').mockResolvedValueOnce({ sub: 'usr_owner' });
      vi.spyOn(Client, 'findOne').mockResolvedValueOnce({
        client_id: 'cli_test',
        owner_sub: 'usr_owner',
      } as never);
      const deleteSpy = vi.spyOn(ClientTester, 'deleteOne').mockResolvedValueOnce({ acknowledged: true, deletedCount: 1 });

      const req = new NextRequest('http://localhost:3000/api/portal/clients/cli_test/testers?sub=usr_1', {
        method: 'DELETE',
        headers: { cookie: 'pesu_session=valid' },
      });
      const res = await DELETE(req, { params });
      expect(res.status).toBe(200);
      expect(deleteSpy).toHaveBeenCalledWith({ client_id: 'cli_test', sub: 'usr_1' });
    });
  });
});
