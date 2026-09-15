import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { GET as getClients, POST as postClient } from '@/app/api/portal/clients/route';
import { GET as getClient, PATCH as updateClient } from '@/app/api/portal/clients/[clientId]/route';
import { Client, ClientTester } from '@/lib/db/models';
import * as cookieHelper from '@/lib/session/cookie';

vi.mock('@/lib/db/connection', () => ({
  connectToDatabase: vi.fn().mockResolvedValue(null),
}));

describe('Portal Clients API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('GET /api/portal/clients', () => {
    it('returns 401 when unauthenticated', async () => {
      const req = new NextRequest('http://localhost:3000/api/portal/clients');
      const res = await getClients(req);
      expect(res.status).toBe(401);
    });

    it('returns list of clients for authenticated owner', async () => {
      vi.spyOn(cookieHelper, 'verifySessionToken').mockResolvedValueOnce({ sub: 'usr_owner' });
      vi.spyOn(Client, 'find').mockReturnValueOnce({
        sort: vi.fn().mockResolvedValueOnce([
          { client_id: 'cli_1', name: 'App One', owner_sub: 'usr_owner' },
        ]),
      } as never);

      const req = new NextRequest('http://localhost:3000/api/portal/clients', {
        headers: { cookie: 'pesu_session=valid' },
      });
      const res = await getClients(req);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.clients).toHaveLength(1);
      expect(data.clients[0].client_id).toBe('cli_1');
    });
  });

  describe('POST /api/portal/clients', () => {
    it('returns 401 when unauthenticated', async () => {
      const req = new NextRequest('http://localhost:3000/api/portal/clients', {
        method: 'POST',
        body: JSON.stringify({ name: 'App', redirectUris: ['https://app.com/cb'] }),
      });
      const res = await postClient(req);
      expect(res.status).toBe(401);
    });

    it('returns 400 when name is missing', async () => {
      vi.spyOn(cookieHelper, 'verifySessionToken').mockResolvedValueOnce({ sub: 'usr_owner' });

      const req = new NextRequest('http://localhost:3000/api/portal/clients', {
        method: 'POST',
        headers: { cookie: 'pesu_session=valid', 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: '', redirectUris: ['https://app.com/cb'] }),
      });
      const res = await postClient(req);
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain('name is required');
    });

    it('returns 400 when redirectUris is invalid', async () => {
      vi.spyOn(cookieHelper, 'verifySessionToken').mockResolvedValueOnce({ sub: 'usr_owner' });

      const req = new NextRequest('http://localhost:3000/api/portal/clients', {
        method: 'POST',
        headers: { cookie: 'pesu_session=valid', 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'App', redirectUris: ['invalid-uri'] }),
      });
      const res = await postClient(req);
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain('Invalid redirect URI');
    });

    it('successfully creates client with rawSecret returned once', async () => {
      vi.spyOn(cookieHelper, 'verifySessionToken').mockResolvedValueOnce({ sub: 'usr_dev_1' });
      vi.spyOn(Client, 'create').mockImplementationOnce(async (doc: unknown) => doc as never);

      const req = new NextRequest('http://localhost:3000/api/portal/clients', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          cookie: 'pesu_session=valid_token',
        },
        body: JSON.stringify({
          name: 'My Valid Client',
          redirectUris: ['https://valid.com/cb'],
        }),
      });

      const res = await postClient(req);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.client.client_id).toMatch(/^cli_/);
      expect(data.rawSecret).toMatch(/^sec_/);
    });

    it('forces delegated_allowed to false regardless of input', async () => {
      vi.spyOn(cookieHelper, 'verifySessionToken').mockResolvedValueOnce({ sub: 'usr_dev_1' });
      const createSpy = vi.spyOn(Client, 'create').mockImplementationOnce(async (doc: unknown) => doc as never);

      const req = new NextRequest('http://localhost:3000/api/portal/clients', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          cookie: 'pesu_session=valid_token',
        },
        body: JSON.stringify({
          name: 'Exploit Client',
          redirectUris: ['https://attacker.com/cb'],
          delegatedAllowed: true, // Malicious attempt to escalate privilege
        }),
      });

      const res = await postClient(req);
      expect(res.status).toBe(200);

      expect(createSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          delegated_allowed: false,
          publishing_status: 'testing',
        })
      );
    });
  });

  describe('GET /api/portal/clients/[clientId]', () => {
    it('returns 401 when unauthenticated', async () => {
      const req = new NextRequest('http://localhost:3000/api/portal/clients/cli_123');
      const res = await getClient(req, { params: Promise.resolve({ clientId: 'cli_123' }) });
      expect(res.status).toBe(401);
    });

    it('returns 404 when client not found', async () => {
      vi.spyOn(cookieHelper, 'verifySessionToken').mockResolvedValueOnce({ sub: 'usr_owner' });
      vi.spyOn(Client, 'findOne').mockResolvedValueOnce(null);

      const req = new NextRequest('http://localhost:3000/api/portal/clients/cli_123', {
        headers: { cookie: 'pesu_session=valid' },
      });
      const res = await getClient(req, { params: Promise.resolve({ clientId: 'cli_123' }) });
      expect(res.status).toBe(404);
    });

    it('returns client and its testers when found', async () => {
      vi.spyOn(cookieHelper, 'verifySessionToken').mockResolvedValueOnce({ sub: 'usr_owner' });
      vi.spyOn(Client, 'findOne').mockResolvedValueOnce({
        client_id: 'cli_123',
        name: 'My App',
        owner_sub: 'usr_owner',
      } as never);
      vi.spyOn(ClientTester, 'find').mockResolvedValueOnce([
        { client_id: 'cli_123', sub: 'usr_tester1' },
      ] as never);

      const req = new NextRequest('http://localhost:3000/api/portal/clients/cli_123', {
        headers: { cookie: 'pesu_session=valid' },
      });
      const res = await getClient(req, { params: Promise.resolve({ clientId: 'cli_123' }) });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.client.client_id).toBe('cli_123');
      expect(data.testers).toHaveLength(1);
    });
  });

  describe('PATCH /api/portal/clients/[clientId]', () => {
    it('returns 401 when unauthenticated', async () => {
      const req = new NextRequest('http://localhost:3000/api/portal/clients/cli_123', {
        method: 'PATCH',
        body: JSON.stringify({ redirectUris: ['https://app.com/cb'] }),
      });
      const res = await updateClient(req, { params: Promise.resolve({ clientId: 'cli_123' }) });
      expect(res.status).toBe(401);
    });

    it('returns 400 when redirectUris is not an array', async () => {
      vi.spyOn(cookieHelper, 'verifySessionToken').mockResolvedValueOnce({ sub: 'user_1' });

      const req = new NextRequest('http://localhost:3000/api/portal/clients/cli_123', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          cookie: 'pesu_session=valid_token',
        },
        body: JSON.stringify({ redirectUris: 'not-an-array' }),
      });
      const res = await updateClient(req, { params: Promise.resolve({ clientId: 'cli_123' }) });
      expect(res.status).toBe(400);
    });

    it('returns 404 when client to update is not found', async () => {
      vi.spyOn(cookieHelper, 'verifySessionToken').mockResolvedValueOnce({ sub: 'user_1' });
      vi.spyOn(Client, 'findOneAndUpdate').mockResolvedValueOnce(null);

      const req = new NextRequest('http://localhost:3000/api/portal/clients/cli_123', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          cookie: 'pesu_session=valid_token',
        },
        body: JSON.stringify({ redirectUris: ['https://app.com/cb'] }),
      });
      const res = await updateClient(req, { params: Promise.resolve({ clientId: 'cli_123' }) });
      expect(res.status).toBe(404);
    });

    it('updates redirect URIs successfully', async () => {
      vi.spyOn(cookieHelper, 'verifySessionToken').mockResolvedValueOnce({ sub: 'user_1' });
      vi.spyOn(Client, 'findOneAndUpdate').mockResolvedValueOnce({
        client_id: 'cli_123',
        redirect_uris: ['https://app.com/callback'],
      } as unknown as InstanceType<typeof Client>);

      const req = new NextRequest('http://localhost:3000/api/portal/clients/cli_123', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          cookie: 'pesu_session=valid_token',
        },
        body: JSON.stringify({ redirectUris: ['https://app.com/callback'] }),
      });
      const res = await updateClient(req, { params: Promise.resolve({ clientId: 'cli_123' }) });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.client.redirect_uris).toEqual(['https://app.com/callback']);
    });
  });
});
