import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST as postLogin } from '@/app/api/auth/login/route';
import { User, Client } from '@/lib/db/models';
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
    vi.spyOn(Client, 'findOne').mockResolvedValue(null);
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

  it('stores ephemeral pending credentials when returnTo lacks &mode=delegated but client has delegated_allowed', async () => {
    vi.mocked(AcademyClient).prototype.login = vi.fn().mockResolvedValueOnce({
      profile: {
        name: 'Implicit Delegated Student',
        prn: 'PES1UG20CS003',
        srn: 'PES1202000003',
      },
      session: {
        token: 'academy_sess_implicit',
        accessToken: 'acc_imp',
        userId: 'u_imp',
        expiresAt: null,
      },
    } as never);

    vi.spyOn(User, 'findOne').mockResolvedValueOnce({
      sub: 'usr_delegated_2',
      name: 'Implicit Delegated Student',
      prn: 'PES1UG20CS003',
      save: vi.fn().mockResolvedValueOnce(true),
    } as never);

    vi.spyOn(Client, 'findOne').mockResolvedValueOnce({
      client_id: 'cli_delegated_app',
      delegated_allowed: true,
    } as never);

    const req = new NextRequest('http://localhost:3000/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'PES1UG20CS003',
        password: 'vault_implicit_password',
        returnTo: '/authorize?client_id=cli_delegated_app&response_type=code',
      }),
    });

    const res = await postLogin(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.redirectTo).toBe('/authorize?client_id=cli_delegated_app&response_type=code');
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
        phone: '9876543210',
        program: 'B.Tech',
        branch: 'CSE',
        semester: 'Sem-6',
        section: 'B',
        campus: 'RR',
      },
      session: {
        token: 'academy_sess_456',
      },
    } as never);

    const mockExistingUser = {
      sub: 'usr_existing_1',
      name: 'Old Name',
      prn: 'PES1UG20CS001',
      srn: '',
      email: '',
      phone: '',
      program: '',
      branch: '',
      semester: '',
      section: '',
      campus: '',
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
    expect(mockExistingUser.phone).toBe('9876543210');
    expect(mockExistingUser.branch).toBe('CSE');
  });

  it('handles non-Error exceptions gracefully in catch block', async () => {
    vi.mocked(AcademyClient).prototype.login = vi.fn().mockRejectedValueOnce('string error');

    const req = new NextRequest('http://localhost:3000/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'PES1UG20CS001', password: 'password' }),
    });

    const res = await postLogin(req);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBe('Authentication failed');
  });

  it('creates new user when profile has no PRN or SRN (fallback to username and empty fields)', async () => {
    vi.mocked(AcademyClient).prototype.login = vi.fn().mockResolvedValueOnce({
      profile: {
        name: 'Anonymous',
        prn: null,
        srn: null,
        program: null,
        branch: null,
        semester: null,
        section: null,
        campus: null,
        email: null,
        phone: null,
      },
      session: {
        token: 'sess_token',
      },
    } as never);

    const createSpy = vi.spyOn(User, 'create').mockResolvedValueOnce({
      sub: 'usr_anon_1',
      name: 'Anonymous',
      prn: 'anon_user',
    } as never);

    const req = new NextRequest('http://localhost:3000/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'anon_user', password: 'password' }),
    });

    const res = await postLogin(req);
    expect(res.status).toBe(200);
    expect(createSpy).toHaveBeenCalledWith(expect.objectContaining({
      prn: 'anon_user',
      srn: 'anon_user',
      program: '',
      email: undefined,
    }));
  });

  it('updates existing user when profile has empty/falsy optional fields', async () => {
    vi.mocked(AcademyClient).prototype.login = vi.fn().mockResolvedValueOnce({
      profile: {
        name: '', // Empty name falls back to user.name
        prn: null,
        srn: 'PES1202099999',
        program: null,
        branch: null,
        semester: null,
        section: null,
        campus: null,
        email: null,
        phone: null,
      },
      session: {
        token: 'sess_token',
      },
    } as never);

    const mockUser = {
      sub: 'usr_existing_empty_fields',
      name: 'Existing Name',
      prn: 'PES1UG20CS999',
      srn: 'PES1202099999',
      save: vi.fn().mockResolvedValue(true),
    };
    vi.spyOn(User, 'findOne').mockResolvedValueOnce(mockUser as never);

    const req = new NextRequest('http://localhost:3000/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'PES1UG20CS999', password: 'password' }),
    });

    const res = await postLogin(req);
    expect(res.status).toBe(200);
    expect(mockUser.name).toBe('Existing Name');
    expect(mockUser.save).toHaveBeenCalled();
  });

  it('handles /authorize without delegated mode, malformed returnTo, and production cookies', async () => {
    vi.stubEnv('APP_ENV', 'staging');
    vi.stubEnv('VAULT_MASTER_KEY', 'x'.repeat(32));
    vi.stubEnv('TOKEN_EXCHANGE_SECRET', 'x'.repeat(32));
    vi.stubEnv('SESSION_SECRET', 'pesu-oauth2-session-secret-at-least-32-chars!');
    vi.stubEnv('TOKEN_SIGNING_KEY_PEM', '-----BEGIN EC PRIVATE KEY-----\nMHQCAQEEIBkg\n-----END EC PRIVATE KEY-----');

    try {
      vi.mocked(AcademyClient).prototype.login = vi.fn().mockResolvedValue({
        profile: { name: 'User', prn: 'PRN1', srn: 'SRN1' },
        session: { token: 't1' },
      } as never);
      vi.spyOn(User, 'findOne').mockResolvedValue({
        sub: 'usr_prod',
        name: 'User',
        prn: 'PRN1',
        save: vi.fn().mockResolvedValue(true),
      } as never);

      // 1. /authorize with non-delegated mode (e.g. mode=identity)
      const req1 = new NextRequest('http://localhost:3000/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: 'PRN1',
          password: 'pwd',
          returnTo: '/authorize?client_id=c1&mode=identity',
        }),
      });
      const res1 = await postLogin(req1);
      expect(res1.status).toBe(200);
      expect(mockCookieStore.set).toHaveBeenCalledWith(
        'pesu_session',
        expect.any(String),
        expect.objectContaining({ secure: true })
      );
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
