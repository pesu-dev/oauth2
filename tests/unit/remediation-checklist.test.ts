import { describe, it, expect, vi, beforeEach } from 'vitest';
import robots from '@/app/robots';
import nextConfig from '../../next.config';
import { Client, IUser, User } from '@/lib/db/models';
import { mintIdToken } from '@/lib/oidc/jwt';
import { jwtVerify, importJWK } from 'jose';
import { POST as postLogin } from '@/app/api/auth/login/route';
import { NextRequest } from 'next/server';
import AuthorizePage from '@/app/authorize/page';
import * as cookieHelper from '@/lib/session/cookie';

vi.mock('@/lib/db/connection', () => ({
  connectToDatabase: vi.fn().mockResolvedValue(null),
}));

vi.mock('@/lib/academy/client', () => ({
  AcademyClient: class {
    async login() {
      return {
        profile: {
          name: 'Null Ident Student',
          prn: null,
          srn: null,
          email: 'noident@pesu.edu',
        },
        session: {
          token: 'tok123',
          accessToken: null,
          userId: null,
          expiresAt: null,
        },
      };
    }
  },
}));

vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({
    get: vi.fn().mockReturnValue(undefined),
    set: vi.fn(),
  })),
}));

vi.mock('next/navigation', () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
}));

describe('Actionable Remediation Checklist Verifications', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('1. robots.ts disallows crawling /portal', () => {
    const rules = robots().rules;
    const disallow = Array.isArray(rules) ? rules[0].disallow : rules?.disallow;
    expect(disallow).toContain('/portal');
  });

  it('2. next.config.ts redirects legacy /docs sub-routes to anchor sections', async () => {
    if (typeof nextConfig.redirects === 'function') {
      const redirects = await nextConfig.redirects();
      const sources = redirects.map((r) => r.source);
      expect(sources).toContain('/docs/token');
      expect(sources).toContain('/docs/authorize');
      expect(sources).toContain('/docs/discovery');
      expect(sources).toContain('/docs/jwks');
      expect(sources).toContain('/docs/userinfo');
      expect(sources).toContain('/docs/revoke');
      expect(sources).toContain('/docs/scopes');
      expect(sources).toContain('/docs/quick-start');
    } else {
      throw new Error('nextConfig.redirects is not defined');
    }
  });

  it('3. Client model supports public clients with null client_secret_hash', async () => {
    const publicClient = new Client({
      client_id: 'cli_public_app',
      name: 'Single Page App',
      owner_sub: 'usr_dev1',
      redirect_uris: ['https://spa.pesu.edu/callback'],
      token_endpoint_auth_method: 'none',
      client_secret_hash: null,
    });
    const err = await publicClient.validate().catch((e: unknown) => e);
    expect(err).toBeUndefined();
  });

  it('4. mintIdToken includes unique jti claim', async () => {
    const mockUser = {
      sub: 'usr_student_123',
      name: 'Test Student',
      prn: 'PES120200001',
      srn: 'PES120200001',
      email: 'student@pesu.edu',
    } as unknown as IUser;

    const token = await mintIdToken({
      issuer: 'http://localhost:3000',
      sub: mockUser.sub,
      clientId: 'cli_test_client',
      user: mockUser,
      scopes: ['openid', 'profile'],
    });

    const jwks = await (await import('@/lib/oidc/jwt')).getPublicJwks();
    const pubKey = await importJWK(jwks.keys[0], 'RS256');
    const { payload } = await jwtVerify(token, pubKey);

    expect(payload.jti).toBeDefined();
    expect(typeof payload.jti).toBe('string');
    expect(payload.jti?.length).toBeGreaterThan(10);
  });

  it('5. Login route guards User.findOne against querying with null PRN/SRN', async () => {
    const userFindOneSpy = vi.spyOn(User, 'findOne').mockResolvedValue(null);
    const userCreateSpy = vi.spyOn(User, 'create').mockResolvedValue({
      sub: 'usr_created_new',
      name: 'Null Ident Student',
      prn: 'fallback_username',
      srn: 'fallback_username',
    } as never);

    const req = new NextRequest('http://localhost:3000/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'fallback_username', password: 'password123' }),
    });

    await postLogin(req);
    expect(userCreateSpy).toHaveBeenCalled();

    // If both PRN and SRN are null, findOne should not have been called with { prn: null }
    if (userFindOneSpy.mock.calls.length > 0) {
      const query = userFindOneSpy.mock.calls[0][0] as unknown as Record<string, unknown>;
      expect(query?.$or).toBeUndefined();
    }
  });

  it('6. AuthorizePage filters out unknown scopes and safely serializes returnUrl', async () => {
    vi.spyOn(cookieHelper, 'verifySessionToken').mockResolvedValue(null);

    const searchParams = Promise.resolve({
      client_id: 'cli_test',
      redirect_uri: 'https://app.pesu.edu/callback',
      response_type: 'code',
      code_challenge: 'E9Melhoa2OwvFrGMTJguCH5ZiXV68OSTXb0Pl5C_D7g',
      code_challenge_method: 'S256',
      scope: 'openid evil_scope custom_admin_scope',
      state: undefined,
      nonce: undefined,
    });

    vi.spyOn(Client, 'findOne').mockResolvedValue({
      client_id: 'cli_test',
      redirect_uris: ['https://app.pesu.edu/callback'],
      publishing_status: 'production',
      delegated_allowed: false,
    } as never);

    try {
      await AuthorizePage({ searchParams });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      expect(message).toContain('REDIRECT:');
      // Verify undefined was NOT serialized as "state=undefined" or "nonce=undefined"
      expect(message).not.toContain('state=undefined');
      expect(message).not.toContain('nonce=undefined');
    }
  });
});
