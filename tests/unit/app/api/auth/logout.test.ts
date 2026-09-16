import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { POST as postLogout } from '@/app/api/auth/logout/route';
import { pendingCredentialStore } from '@/lib/session/pending-credentials';
import * as cookieHelper from '@/lib/session/cookie';

const mockCookieStore = {
  get: vi.fn(),
  set: vi.fn(),
  delete: vi.fn(),
};

vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => mockCookieStore),
}));

describe('Auth Logout Route (/api/auth/logout)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('clears session and pending cookies on POST', async () => {
    mockCookieStore.get.mockReturnValue(undefined);

    const req = new NextRequest('http://localhost:3000/api/auth/logout', {
      method: 'POST',
    });

    const res = await postLogout(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.redirectTo).toBe('/');

    expect(mockCookieStore.set).toHaveBeenCalledWith(
      'pesu_session',
      '',
      expect.objectContaining({ maxAge: 0, path: '/' })
    );
    expect(mockCookieStore.set).toHaveBeenCalledWith(
      'pesu_pending',
      '',
      expect.objectContaining({ maxAge: 0, path: '/' })
    );
  });

  it('removes pending credential from store if cred_id exists in pending cookie', async () => {
    const credId = pendingCredentialStore.put({
      username: 'logout_user',
      password: 'testpassword',
    });

    mockCookieStore.get.mockReturnValue({ value: 'token_with_cred' });
    vi.spyOn(cookieHelper, 'verifySessionToken').mockResolvedValueOnce({ cred_id: credId });

    expect(pendingCredentialStore.get(credId)).toBeDefined();

    const req = new NextRequest('http://localhost:3000/api/auth/logout', {
      method: 'POST',
    });

    const res = await postLogout(req);
    expect(res.status).toBe(200);
    expect(pendingCredentialStore.get(credId)).toBeNull();
  });

  it('POST returns safe returnTo URL in JSON response', async () => {
    mockCookieStore.get.mockReturnValue(undefined);

    const req = new NextRequest('http://localhost:3000/api/auth/logout?returnTo=/login', {
      method: 'POST',
    });

    const res = await postLogout(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.redirectTo).toBe('/login');
  });

  it('POST ignores open redirect in returnTo and falls back to /', async () => {
    mockCookieStore.get.mockReturnValue(undefined);

    const req = new NextRequest('http://localhost:3000/api/auth/logout?returnTo=https://evil.com', {
      method: 'POST',
    });

    const res = await postLogout(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.redirectTo).toBe('/');
  });

  it('handles token without cred_id or verification error gracefully', async () => {
    // Token without cred_id
    mockCookieStore.get.mockReturnValue({ value: 'token_no_cred' });
    vi.spyOn(cookieHelper, 'verifySessionToken').mockResolvedValueOnce({});

    const req1 = new NextRequest('http://localhost:3000/api/auth/logout', { method: 'POST' });
    const res1 = await postLogout(req1);
    expect(res1.status).toBe(200);

    // Verification error
    vi.spyOn(cookieHelper, 'verifySessionToken').mockRejectedValueOnce(new Error('Invalid token'));
    const req2 = new NextRequest('http://localhost:3000/api/auth/logout', { method: 'POST' });
    const res2 = await postLogout(req2);
    expect(res2.status).toBe(200);
  });

  it('rejects protocol-relative and scheme-containing paths in returnTo', async () => {
    mockCookieStore.get.mockReturnValue(undefined);

    const req1 = new NextRequest('http://localhost:3000/api/auth/logout?returnTo=//evil.com', { method: 'POST' });
    const res1 = await postLogout(req1);
    expect((await res1.json()).redirectTo).toBe('/');

    const req2 = new NextRequest('http://localhost:3000/api/auth/logout?returnTo=/test://bad', { method: 'POST' });
    const res2 = await postLogout(req2);
    expect((await res2.json()).redirectTo).toBe('/');
  });

  it('sets secure cookies in production environment', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    mockCookieStore.get.mockReturnValue(undefined);

    try {
      const req = new NextRequest('http://localhost:3000/api/auth/logout', { method: 'POST' });
      await postLogout(req);

      expect(mockCookieStore.set).toHaveBeenCalledWith(
        'pesu_session',
        '',
        expect.objectContaining({ secure: true })
      );
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
