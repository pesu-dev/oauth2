import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Client, Consent, User } from '@/lib/db/models';
import * as jwt from '@/lib/oidc/jwt';
import { apiLimiter } from '@/lib/rate-limit';
import { requireScope } from '@/lib/api/guard';
import { createResourceHandler } from '@/lib/api/resource-route';
import { VaultSessionError } from '@/lib/academy/session';
import { AcademyRequestError, AcademySessionExpiredError } from '@/lib/academy/client';
import { ResourceUnavailableError } from '@/lib/academy/resources';
import { GET as getAttendance } from '@/app/api/v1/attendance/route';
import { GET as getEsa } from '@/app/api/v1/results/esa/route';

vi.mock('@/lib/db/connection', () => ({ connectToDatabase: vi.fn().mockResolvedValue(null) }));

const mockWithSession = vi.fn();
vi.mock('@/lib/academy/session', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/academy/session')>();
  return { ...actual, withAcademySession: (...args: unknown[]) => mockWithSession(...args) };
});

const lean = <T,>(value: T) => ({ lean: () => Promise.resolve(value) }) as never;

function request(path: string, token: string | null = 'tok') {
  return new Request(`http://localhost:3000${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
}

function allowAll(scope = 'attendance:read') {
  vi.spyOn(jwt, 'verifyAccessToken').mockResolvedValue({ sub: 'usr_1', client_id: 'cli_1', scope: `openid ${scope}` });
  vi.spyOn(User, 'findOne').mockReturnValue(lean({ sub: 'usr_1' }));
  vi.spyOn(Client, 'findOne').mockReturnValue(
    lean({ client_id: 'cli_1', publishing_status: 'production', allowed_scopes: [scope] })
  );
  vi.spyOn(Consent, 'findOne').mockReturnValue(lean({ mode: 'delegated', scopes: ['openid', scope] }));
}

describe('requireScope', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    apiLimiter.reset();
  });

  it('rejects a missing or malformed bearer token', async () => {
    for (const header of [null, 'Basic abc', 'Bearer']) {
      const req = new Request('http://x/api/v1/attendance', { headers: header ? { Authorization: header } : {} });
      const result = await requireScope(req, 'attendance:read');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.response.status).toBe(401);
        expect(result.response.headers.get('WWW-Authenticate')).toContain('error="invalid_token"');
      }
    }
  });

  it('rejects an invalid JWT', async () => {
    vi.spyOn(jwt, 'verifyAccessToken').mockRejectedValue(new Error('bad sig'));
    const result = await requireScope(request('/x'), 'attendance:read');
    expect(!result.ok && result.response.status).toBe(401);
  });

  it('returns insufficient_scope when the token lacks the scope', async () => {
    vi.spyOn(jwt, 'verifyAccessToken').mockResolvedValue({ sub: 'usr_1', client_id: 'cli_1', scope: 'openid profile' });
    const result = await requireScope(request('/x'), 'attendance:read');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(403);
      expect(result.response.headers.get('WWW-Authenticate')).toContain('scope="attendance:read"');
      expect(await result.response.json()).toMatchObject({ error: 'insufficient_scope' });
    }
  });

  it('treats an empty scope claim as no scopes', async () => {
    vi.spyOn(jwt, 'verifyAccessToken').mockResolvedValue({ sub: 'usr_1', client_id: 'cli_1', scope: '' });
    const result = await requireScope(request('/x'), 'attendance:read');
    expect(!result.ok && result.response.status).toBe(403);
  });

  it('enforces live revocation: deleted user, suspended client, withdrawn approval, revoked consent', async () => {
    const cases: [() => void, number, string][] = [
      [() => vi.spyOn(User, 'findOne').mockReturnValue(lean(null)), 401, 'User not found'],
      [() => vi.spyOn(Client, 'findOne').mockReturnValue(lean(null)), 401, 'unknown or suspended'],
      [
        () => vi.spyOn(Client, 'findOne').mockReturnValue(lean({ publishing_status: 'suspended', allowed_scopes: ['attendance:read'] })),
        401,
        'unknown or suspended',
      ],
      [() => vi.spyOn(Client, 'findOne').mockReturnValue(lean({ publishing_status: 'production' })), 403, 'no longer approved'],
      [() => vi.spyOn(Consent, 'findOne').mockReturnValue(lean(null)), 401, 'revoked'],
      [() => vi.spyOn(Consent, 'findOne').mockReturnValue(lean({ mode: 'identity', scopes: ['attendance:read'] })), 401, 'revoked'],
      [() => vi.spyOn(Consent, 'findOne').mockReturnValue(lean({ mode: 'delegated', scopes: ['openid'] })), 401, 'revoked'],
    ];
    for (const [override, status, text] of cases) {
      vi.restoreAllMocks();
      apiLimiter.reset();
      allowAll();
      override();
      const result = await requireScope(request('/x'), 'attendance:read');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.response.status).toBe(status);
        expect((await result.response.json()).error_description).toContain(text);
      }
    }
  });

  it('allows a fully authorized call and then rate-limits per student and app', async () => {
    allowAll();
    const first = await requireScope(request('/x'), 'attendance:read');
    expect(first).toEqual({ ok: true, sub: 'usr_1', clientId: 'cli_1', scopes: ['openid', 'attendance:read'] });

    for (let i = 0; i < 29; i++) await requireScope(request('/x'), 'attendance:read');
    const limited = await requireScope(request('/x'), 'attendance:read');
    expect(!limited.ok && limited.response.status).toBe(429);
  });
});

describe('resource route handlers', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    apiLimiter.reset();
    mockWithSession.mockReset();
  });

  it('returns normalized rows with no-store caching', async () => {
    allowAll();
    mockWithSession.mockImplementation(async (sub: string, fn: (...a: unknown[]) => unknown) =>
      fn({ dispatch: vi.fn().mockResolvedValue([{ subjectCode: 'C1', FatherName: 'x' }]) }, { token: 't' }, 'PES1')
    );
    process.env.ACADEMY_MENU_IDS = '{"attendance":"5"}';
    try {
      const res = await getAttendance(request('/api/v1/attendance?semester=3'));
      expect(res.status).toBe(200);
      expect(res.headers.get('Cache-Control')).toBe('no-store');
      const body = await res.json();
      expect(body).toMatchObject({ resource: 'attendance', data: [{ code: 'C1' }] });
      expect(JSON.stringify(body)).not.toContain('FatherName');
      expect(mockWithSession.mock.calls[0][0]).toBe('usr_1');
    } finally {
      delete process.env.ACADEMY_MENU_IDS;
    }
  });

  it('passes guard failures straight through', async () => {
    const res = await getAttendance(request('/api/v1/attendance', null));
    expect(res.status).toBe(401);
    expect(mockWithSession).not.toHaveBeenCalled();
  });

  it('validates query parameters', async () => {
    allowAll();
    expect((await getAttendance(request('/api/v1/attendance?day=mon'))).status).toBe(400);
    allowAll();
    const bad = await getAttendance(request('/api/v1/attendance?semester=1;drop'));
    expect(bad.status).toBe(400);
    expect((await bad.json()).error_description).toBe('Invalid value for semester');
    allowAll('results:read');
    expect((await getEsa(request('/api/v1/results/esa?semester=1'))).status).toBe(400);
  });

  it.each([
    [new ResourceUnavailableError('attendance'), 501, 'resource_unavailable'],
    [new VaultSessionError('misconfigured', 'x'), 503, 'temporarily_unavailable'],
    [new VaultSessionError('academy_unavailable', 'x'), 502, 'academy_unavailable'],
    [new VaultSessionError('no_vault', 'x'), 403, 'consent_required'],
    [new VaultSessionError('vault_unreadable', 'x'), 403, 'consent_required'],
    [new AcademySessionExpiredError(), 502, 'academy_unavailable'],
    [new AcademyRequestError('Menu ID is required'), 502, 'academy_unavailable'],
  ])('maps %s to %i', async (error, status, code) => {
    allowAll();
    mockWithSession.mockRejectedValue(error);
    const res = await getAttendance(request('/api/v1/attendance'));
    expect(res.status).toBe(status);
    expect((await res.json()).error).toBe(code);
  });

  it('rethrows unexpected errors', async () => {
    allowAll('seating:read');
    mockWithSession.mockRejectedValue(new TypeError('bug'));
    const handler = createResourceHandler('seating');
    await expect(handler(request('/api/v1/seating'))).rejects.toThrow('bug');
  });
});
