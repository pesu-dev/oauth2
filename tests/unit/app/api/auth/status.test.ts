import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { GET as getAuthStatus } from '@/app/api/auth/status/route';
import { Admin } from '@/lib/db/models';
import * as cookieModule from '@/lib/session/cookie';

vi.mock('@/lib/db/connection', () => ({
  connectToDatabase: vi.fn().mockResolvedValue(null),
}));

describe('Auth Status Route (/api/auth/status)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

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

  it('returns authenticated: false when session cookie is invalid or expired', async () => {
    vi.spyOn(cookieModule, 'verifySessionToken').mockResolvedValueOnce(null);

    const req = new NextRequest('http://localhost:3000/api/auth/status', {
      headers: { cookie: 'pesu_session=expired_token' },
    });
    const res = await getAuthStatus(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.authenticated).toBe(false);
    expect(data.isAdmin).toBe(false);
  });

  it('handles database error gracefully by returning isAdmin: false', async () => {
    vi.spyOn(cookieModule, 'verifySessionToken').mockResolvedValueOnce({ sub: 'user_1' });
    vi.spyOn(Admin, 'findOne').mockRejectedValueOnce(new Error('Mongo connection failure'));

    const req = new NextRequest('http://localhost:3000/api/auth/status', {
      headers: { cookie: 'pesu_session=valid' },
    });
    const res = await getAuthStatus(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.authenticated).toBe(true);
    expect(data.isAdmin).toBe(false);
  });
});
