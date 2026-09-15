import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { POST as rotateSecret } from '@/app/api/portal/clients/[clientId]/rotate-secret/route';
import { Client } from '@/lib/db/models';
import * as cookieModule from '@/lib/session/cookie';

vi.mock('@/lib/db/connection', () => ({
  connectToDatabase: vi.fn().mockResolvedValue(null),
}));

describe('Rotate Client Secret API (/api/portal/clients/[clientId]/rotate-secret)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

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
