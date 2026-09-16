import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST as postLogin } from '@/app/api/auth/login/route';
import { User } from '@/lib/db/models';
import { NextRequest } from 'next/server';
import { AcademyClient } from '@/lib/academy/client';

vi.mock('@/lib/db/connection', () => ({
  connectToDatabase: vi.fn().mockResolvedValue(null),
}));

vi.mock('@/lib/academy/client');

const mockCookieStore = {
  get: vi.fn(),
  set: vi.fn(),
};

vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => mockCookieStore),
}));

describe('Auth Login Route (/api/auth/login)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 400 when username or password is missing', async () => {
    const req = new NextRequest('http://localhost:3000/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'user', password: '' }),
    });

    const res = await postLogin(req);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain('Username and password are required');
  });

  it('returns 400 when Academy login fails', async () => {
    vi.mocked(AcademyClient).prototype.login = vi.fn().mockRejectedValueOnce(
      new Error('Invalid username or password')
    );

    const req = new NextRequest('http://localhost:3000/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'user', password: 'bad_password' }),
    });

    const res = await postLogin(req);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBe('Invalid username or password');
  });

  it('authenticates and creates new user with cookies and safe redirect', async () => {
    vi.mocked(AcademyClient).prototype.login = vi.fn().mockResolvedValueOnce({
      profile: {
        name: 'New Student',
        prn: 'PES1UG20CS001',
        srn: 'PES1202000001',
        email: 'student@pes.edu',
        program: 'B.Tech',
        branch: 'CSE',
        semester: 'Sem-6',
        section: 'A',
        campus: 'RR',
      },
      session: {
        token: 'academy_sess_123',
        accessToken: 'acc_123',
        userId: 'u_123',
        expiresAt: null,
      },
    } as never);

    vi.spyOn(User, 'findOne').mockResolvedValueOnce(null);
    const createSpy = vi.spyOn(User, 'create').mockResolvedValueOnce({
      sub: 'usr_new_student',
      name: 'New Student',
      prn: 'PES1UG20CS001',
    } as never);

    const req = new NextRequest('http://localhost:3000/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'PES1UG20CS001',
        password: 'valid_password',
        returnTo: '/authorize?client_id=cli_1',
      }),
    });

    const res = await postLogin(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.redirectTo).toBe('/authorize?client_id=cli_1');
    expect(createSpy).toHaveBeenCalled();
    expect(mockCookieStore.set).toHaveBeenCalledWith(
      'pesu_session',
      expect.any(String),
      expect.objectContaining({ maxAge: 1800 })
    );
    // Non-delegated login does NOT store ephemeral password or set pesu_pending
    expect(mockCookieStore.set).not.toHaveBeenCalledWith(
      'pesu_pending',
      expect.any(String),
      expect.any(Object)
    );
  });

  it('stores ephemeral pending credentials and sets pesu_pending cookie for delegated auth flow', async () => {
    vi.mocked(AcademyClient).prototype.login = vi.fn().mockResolvedValueOnce({
      profile: {
        name: 'Delegated Student',
        prn: 'PES1UG20CS002',
        srn: 'PES1202000002',
      },
      session: {
        token: 'academy_sess_delegated',
        accessToken: 'acc_del',
        userId: 'u_del',
        expiresAt: null,
      },
    } as never);

    vi.spyOn(User, 'findOne').mockResolvedValueOnce({
      sub: 'usr_delegated_1',
      name: 'Delegated Student',
      prn: 'PES1UG20CS002',
      save: vi.fn().mockResolvedValueOnce(true),
    } as never);

    const req = new NextRequest('http://localhost:3000/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'PES1UG20CS002',
        password: 'vault_delegated_password',
        returnTo: '/authorize?client_id=cli_1&mode=delegated',
      }),
    });

    const res = await postLogin(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.redirectTo).toBe('/authorize?client_id=cli_1&mode=delegated');
    expect(mockCookieStore.set).toHaveBeenCalledWith(
      'pesu_pending',
      expect.any(String),
      expect.objectContaining({ maxAge: 600 })
    );
  });

  it('updates existing user on login and sanitizes unsafe open redirects', async () => {
    vi.mocked(AcademyClient).prototype.login = vi.fn().mockResolvedValueOnce({
      profile: {
        name: 'Existing Student Updated',
        prn: 'PES1UG20CS001',
        srn: 'PES1202000001',
        email: 'updated@pes.edu',
      },
      session: {
        token: 'academy_sess_456',
      },
    } as never);

    const mockExistingUser = {
      sub: 'usr_existing_1',
      name: 'Old Name',
      prn: 'PES1UG20CS001',
      save: vi.fn().mockResolvedValueOnce(true),
    };

    vi.spyOn(User, 'findOne').mockResolvedValueOnce(mockExistingUser as never);

    const req = new NextRequest('http://localhost:3000/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'PES1UG20CS001',
        password: 'valid_password',
        returnTo: 'https://attacker.com/steal', // Unsafe open redirect attempt
      }),
    });

    const res = await postLogin(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    // Sanitized fallback to /portal
    expect(data.redirectTo).toBe('/portal');
    expect(mockExistingUser.save).toHaveBeenCalled();
  });
});
