import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { POST as postLogout, GET as getLogout } from '@/app/api/auth/logout/route';
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

describe('Auth Logout Route', () => {
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

  it('GET performs redirect to safe returnTo URL', async () => {
    mockCookieStore.get.mockReturnValue(undefined);

    const req = new NextRequest('http://localhost:3000/api/auth/logout?returnTo=/login', {
      method: 'GET',
    });

    const res = await getLogout(req);
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe('http://localhost:3000/login');
  });

  it('GET ignores open redirect in returnTo and falls back to /', async () => {
    mockCookieStore.get.mockReturnValue(undefined);

    const req = new NextRequest('http://localhost:3000/api/auth/logout?returnTo=https://evil.com', {
      method: 'GET',
    });

    const res = await getLogout(req);
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe('http://localhost:3000/');
  });
});
