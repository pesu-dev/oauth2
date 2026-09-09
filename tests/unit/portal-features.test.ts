import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { POST as rotateSecret } from '@/app/api/portal/clients/[clientId]/rotate-secret/route';
import { PATCH as updateClient } from '@/app/api/portal/clients/[clientId]/route';
import { GET as getAuthStatus } from '@/app/api/auth/status/route';
import { Admin, Client } from '@/lib/db/models';
import * as cookieModule from '@/lib/session/cookie';

vi.mock('@/lib/db/connection', () => ({
  connectToDatabase: vi.fn().mockResolvedValue(null),
}));

describe('Portal Features & Auth Status Routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Rotate Client Secret API', () => {
    it('returns 401 when no session cookie is provided', async () => {
      const req = new NextRequest('http://localhost:3000/api/portal/clients/cli_123/rotate-secret', {
        method: 'POST',
      });
      const res = await rotateSecret(req, { params: Promise.resolve({ clientId: 'cli_123' }) });
      expect(res.status).toBe(401);
    });

    it('returns 404 if client not found for owner', async () => {
      vi.spyOn(cookieModule, 'verifySessionToken').mockResolvedValueOnce({ sub: 'user_1' });
      vi.spyOn(Client, 'findOneAndUpdate').mockResolvedValueOnce(null);

      const req = new NextRequest('http://localhost:3000/api/portal/clients/cli_123/rotate-secret', {
        method: 'POST',
        headers: {
          cookie: 'pesu_session=valid_token',
        },
      });
      const res = await rotateSecret(req, { params: Promise.resolve({ clientId: 'cli_123' }) });
      expect(res.status).toBe(404);
    });

    it('successfully rotates secret and returns raw secret', async () => {
      vi.spyOn(cookieModule, 'verifySessionToken').mockResolvedValueOnce({ sub: 'user_1' });
      vi.spyOn(Client, 'findOneAndUpdate').mockResolvedValueOnce({
        client_id: 'cli_123',
        owner_sub: 'user_1',
      } as unknown as InstanceType<typeof Client>);

      const req = new NextRequest('http://localhost:3000/api/portal/clients/cli_123/rotate-secret', {
        method: 'POST',
        headers: {
          cookie: 'pesu_session=valid_token',
        },
      });
      const res = await rotateSecret(req, { params: Promise.resolve({ clientId: 'cli_123' }) });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.clientId).toBe('cli_123');
      expect(data.clientSecret).toMatch(/^sec_/);
    });
  });

  describe('Auth Status API', () => {
    it('returns authenticated: false when no session is present', async () => {
      const req = new NextRequest('http://localhost:3000/api/auth/status');
      const res = await getAuthStatus(req);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.authenticated).toBe(false);
      expect(data.isAdmin).toBe(false);
    });

    it('returns authenticated: true and isAdmin: false when user is not admin', async () => {
      vi.spyOn(cookieModule, 'verifySessionToken').mockResolvedValueOnce({ sub: 'student_1' });
      vi.spyOn(Admin, 'findOne').mockResolvedValueOnce(null);

      const req = new NextRequest('http://localhost:3000/api/auth/status', {
        headers: { cookie: 'pesu_session=valid_student' },
      });
      const res = await getAuthStatus(req);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.authenticated).toBe(true);
      expect(data.sub).toBe('student_1');
      expect(data.isAdmin).toBe(false);
    });

    it('returns authenticated: true and isAdmin: true when user is admin', async () => {
      vi.spyOn(cookieModule, 'verifySessionToken').mockResolvedValueOnce({ sub: 'admin_1' });
      vi.spyOn(Admin, 'findOne').mockResolvedValueOnce({ sub: 'admin_1' } as unknown as InstanceType<typeof Admin>);

      const req = new NextRequest('http://localhost:3000/api/auth/status', {
        headers: { cookie: 'pesu_session=valid_admin' },
      });
      const res = await getAuthStatus(req);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.authenticated).toBe(true);
      expect(data.sub).toBe('admin_1');
      expect(data.isAdmin).toBe(true);
    });
  });

  describe('Update Client Redirect URIs', () => {
    it('returns 400 when redirectUris is not an array', async () => {
      vi.spyOn(cookieModule, 'verifySessionToken').mockResolvedValueOnce({ sub: 'user_1' });

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

    it('updates redirect URIs successfully', async () => {
      vi.spyOn(cookieModule, 'verifySessionToken').mockResolvedValueOnce({ sub: 'user_1' });
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
