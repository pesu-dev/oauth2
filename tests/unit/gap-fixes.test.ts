import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SlidingWindowRateLimiter } from '@/lib/rate-limit';
import { mintIdToken, getPublicJwks } from '@/lib/oidc/jwt';
import { IUser, Client, RefreshToken, User, Consent, Vault } from '@/lib/db/models';
import { POST as postRevoke } from '@/app/revoke/route';
import { POST as postExchange } from '@/app/oauth/token-exchange/route';
import { POST as postClient } from '@/app/api/portal/clients/route';
import { DELETE as deleteSettings } from '@/app/api/settings/route';
import { LogMailer, sendQuietly, notifySubQuietly } from '@/lib/mailer';
import * as cookieHelper from '@/lib/session/cookie';
import * as jwtHelper from '@/lib/oidc/jwt';
import { sha256Hex } from '@/lib/crypto/hash';
import { NextRequest } from 'next/server';

vi.mock('@/lib/db/connection', () => ({
  connectToDatabase: vi.fn().mockResolvedValue(null),
}));

describe('Comprehensive Gap Fixes Verification', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Gap 3: SlidingWindowRateLimiter', () => {
    it('allows requests within limit and rejects when exceeded', () => {
      const limiter = new SlidingWindowRateLimiter({ limit: 3, windowSeconds: 60 });
      expect(limiter.allow('ip-1')).toBe(true);
      expect(limiter.allow('ip-1')).toBe(true);
      expect(limiter.allow('ip-1')).toBe(true);
      expect(limiter.allow('ip-1')).toBe(false);

      // Key isolation
      expect(limiter.allow('ip-2')).toBe(true);
    });

    it('resets hits correctly', () => {
      const limiter = new SlidingWindowRateLimiter({ limit: 1, windowSeconds: 60 });
      expect(limiter.allow('ip-1')).toBe(true);
      expect(limiter.allow('ip-1')).toBe(false);

      limiter.reset();
      expect(limiter.allow('ip-1')).toBe(true);
    });
  });

  describe('Gap 4: OIDC Nonce Support', () => {
    const mockUser = {
      sub: 'usr_nonce_123',
      name: 'Test Student',
      prn: 'PES1202000001',
    } as unknown as IUser;

    it('embeds nonce into ID token claims when provided', async () => {
      const tokenWithNonce = await mintIdToken({
        issuer: 'http://localhost:3000',
        sub: 'usr_nonce_123',
        clientId: 'cli_abc',
        user: mockUser,
        scopes: ['openid', 'profile'],
        nonce: 'client-nonce-xyz-789',
      });

      const parts = tokenWithNonce.split('.');
      const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf-8'));
      expect(payload.nonce).toBe('client-nonce-xyz-789');
    });

    it('omits nonce from ID token claims when not provided', async () => {
      const tokenWithoutNonce = await mintIdToken({
        issuer: 'http://localhost:3000',
        sub: 'usr_nonce_123',
        clientId: 'cli_abc',
        user: mockUser,
        scopes: ['openid'],
      });

      const parts = tokenWithoutNonce.split('.');
      const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf-8'));
      expect(payload.nonce).toBeUndefined();
    });
  });

  describe('Gap 1: JWKS Security (No Private Key Component Leakage)', () => {
    it('JWKS exports only public RSA components', async () => {
      const jwks = await getPublicJwks();
      expect(jwks.keys.length).toBeGreaterThan(0);
      const key = jwks.keys[0];

      // Public fields present
      expect(key.kty).toBe('RSA');
      expect(key.n).toBeDefined();
      expect(key.e).toBeDefined();

      // Private fields MUST NOT exist
      expect((key as Record<string, unknown>).d).toBeUndefined();
      expect((key as Record<string, unknown>).p).toBeUndefined();
      expect((key as Record<string, unknown>).q).toBeUndefined();
      expect((key as Record<string, unknown>).dp).toBeUndefined();
      expect((key as Record<string, unknown>).dq).toBeUndefined();
      expect((key as Record<string, unknown>).qi).toBeUndefined();
    });
  });

  describe('Gap 2: Developer Client Creation Privilege Escalation Prevention', () => {
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

  describe('Gap 6: RFC 7009 /revoke Authentication & Isolation', () => {
    it('rejects unauthenticated revocation with 401', async () => {
      const req = new Request('http://localhost:3000/revoke', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'token=some_token',
      });

      const res = await postRevoke(req);
      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.error).toBe('invalid_client');
    });

    it('rejects missing token with 400', async () => {
      vi.spyOn(Client, 'findOne').mockResolvedValueOnce({
        client_id: 'cli_public',
        token_endpoint_auth_method: 'none',
      } as unknown as InstanceType<typeof Client>);

      const req = new Request('http://localhost:3000/revoke', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'client_id=cli_public',
      });

      const res = await postRevoke(req);
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe('invalid_request');
    });

    it('returns 200 without revoking if token was issued to another client', async () => {
      vi.spyOn(Client, 'findOne').mockResolvedValueOnce({
        client_id: 'cli_attacker',
        token_endpoint_auth_method: 'none',
      } as unknown as InstanceType<typeof Client>);

      // Token belongs to cli_victim
      vi.spyOn(RefreshToken, 'findOne').mockResolvedValueOnce({
        token_hash: sha256Hex('victim_rt'),
        client_id: 'cli_victim',
      } as unknown as InstanceType<typeof RefreshToken>);

      const updateSpy = vi.spyOn(RefreshToken, 'updateOne');

      const req = new Request('http://localhost:3000/revoke', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'client_id=cli_attacker&token=victim_rt',
      });

      const res = await postRevoke(req);
      expect(res.status).toBe(200);
      // updateOne must NOT be called for cross-client token
      expect(updateSpy).not.toHaveBeenCalled();
    });

    it('returns 200 for access_token hint without touching refresh tokens', async () => {
      vi.spyOn(Client, 'findOne').mockResolvedValueOnce({
        client_id: 'cli_test',
        token_endpoint_auth_method: 'none',
      } as unknown as InstanceType<typeof Client>);

      const req = new Request('http://localhost:3000/revoke', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'client_id=cli_test&token=some_jwt&token_type_hint=access_token',
      });

      const res = await postRevoke(req);
      expect(res.status).toBe(200);
    });
  });

  describe('Gap 7: Token Exchange Security & Caching', () => {
    it('rejects missing or invalid token exchange secret with 401', async () => {
      const req = new Request('http://localhost:3000/oauth/token-exchange', {
        method: 'POST',
        headers: { 'x-token-exchange-secret': 'wrong-secret' },
      });

      const res = await postExchange(req);
      expect(res.status).toBe(401);
    });

    it('rejects exchange when caller client is not first-party client with 403', async () => {
      process.env.TOKEN_EXCHANGE_SECRET = 'correct-secret';
      process.env.FIRST_PARTY_API_CLIENT_ID = 'cli_pesu_api';

      vi.spyOn(jwtHelper, 'verifyAccessToken').mockResolvedValueOnce({
        sub: 'usr_1',
        client_id: 'cli_third_party',
        scope: 'openid',
      });

      const req = new Request('http://localhost:3000/oauth/token-exchange', {
        method: 'POST',
        headers: {
          'x-token-exchange-secret': 'correct-secret',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ access_token: 'valid_jwt' }),
      });

      const res = await postExchange(req);
      expect(res.status).toBe(403);
      const data = await res.json();
      expect(data.error_description).toContain('first-party API client');
    });

    it('rejects exchange when delegated consent is absent', async () => {
      process.env.TOKEN_EXCHANGE_SECRET = 'correct-secret';
      process.env.FIRST_PARTY_API_CLIENT_ID = 'cli_pesu_api';

      vi.spyOn(jwtHelper, 'verifyAccessToken').mockResolvedValueOnce({
        sub: 'usr_1',
        client_id: 'cli_pesu_api',
        scope: 'openid',
      });
      vi.spyOn(Consent, 'findOne').mockResolvedValueOnce(null);

      const req = new Request('http://localhost:3000/oauth/token-exchange', {
        method: 'POST',
        headers: {
          'x-token-exchange-secret': 'correct-secret',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ access_token: 'valid_jwt' }),
      });

      const res = await postExchange(req);
      expect(res.status).toBe(403);
      const data = await res.json();
      expect(data.error_description).toBe('Delegated consent required');
    });
  });

  describe('Gap 8: Transactional Mailer Service', () => {
    it('LogMailer executes send without throwing', async () => {
      const mailer = new LogMailer();
      await expect(
        mailer.send({
          to: 'student@pesu.edu',
          subject: 'Test Subject',
          body: 'Test Body',
        })
      ).resolves.toBeUndefined();
    });

    it('sendQuietly catches and swallows errors', async () => {
      const failingMailer = {
        send: vi.fn().mockRejectedValue(new Error('SMTP connection timed out')),
      };
      await expect(
        sendQuietly(failingMailer, {
          to: 'student@pesu.edu',
          subject: 'Test',
          body: 'Test',
        })
      ).resolves.toBeUndefined();
    });

    it('notifySubQuietly handles non-existent user safely', async () => {
      vi.spyOn(User, 'findOne').mockResolvedValueOnce(null);
      await expect(
        notifySubQuietly({
          sub: 'usr_ghost',
          subject: 'Notification',
          body: 'Message',
        })
      ).resolves.toBeUndefined();
    });
  });

  describe('Gap 9 & 10: Account Deletion and Consent Revocation Cleanup', () => {
    it('consent revocation revokes refresh tokens and deletes vault when no delegated consents remain', async () => {
      vi.spyOn(cookieHelper, 'verifySessionToken').mockResolvedValueOnce({ sub: 'usr_test_del' });
      const deleteConsentSpy = vi.spyOn(Consent, 'deleteOne').mockResolvedValueOnce({ acknowledged: true, deletedCount: 1 });
      const revokeTokensSpy = vi.spyOn(RefreshToken, 'updateMany').mockResolvedValueOnce({
        acknowledged: true,
        matchedCount: 2,
        modifiedCount: 2,
        upsertedCount: 0,
        upsertedId: null,
      });
      vi.spyOn(Consent, 'countDocuments').mockResolvedValueOnce(0); // 0 delegated consents remain
      const deleteVaultSpy = vi.spyOn(Vault, 'deleteOne').mockResolvedValueOnce({ acknowledged: true, deletedCount: 1 });
      vi.spyOn(Client, 'findOne').mockResolvedValueOnce({ client_id: 'cli_1', name: 'App One' } as unknown as InstanceType<typeof Client>);
      vi.spyOn(User, 'findOne').mockResolvedValueOnce(null);

      const req = new NextRequest('http://localhost:3000/api/settings?action=consent&client_id=cli_1', {
        method: 'DELETE',
        headers: { cookie: 'pesu_session=valid' },
      });

      const res = await deleteSettings(req);
      expect(res.status).toBe(200);
      expect(deleteConsentSpy).toHaveBeenCalledWith({ sub: 'usr_test_del', client_id: 'cli_1' });
      expect(revokeTokensSpy).toHaveBeenCalledWith(
        { sub: 'usr_test_del', client_id: 'cli_1', revoked_at: null },
        expect.any(Object)
      );
      expect(deleteVaultSpy).toHaveBeenCalledWith({ sub: 'usr_test_del' });
    });

    it('account deletion requires DELETE confirmation string', async () => {
      vi.spyOn(cookieHelper, 'verifySessionToken').mockResolvedValueOnce({ sub: 'usr_test_del' });

      const req = new NextRequest('http://localhost:3000/api/settings?action=account', {
        method: 'DELETE',
        headers: {
          cookie: 'pesu_session=valid',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ confirm: 'NO' }),
      });

      const res = await deleteSettings(req);
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toBe('Type DELETE to confirm account deletion');
    });

    it('account deletion tombstones user, revokes all tokens, deletes vault and consents', async () => {
      vi.spyOn(cookieHelper, 'verifySessionToken').mockResolvedValueOnce({ sub: 'usr_test_del' });
      const userUpdateSpy = vi.spyOn(User, 'updateOne').mockResolvedValueOnce({
        acknowledged: true,
        matchedCount: 1,
        modifiedCount: 1,
        upsertedCount: 0,
        upsertedId: null,
      });
      const revokeTokensSpy = vi.spyOn(RefreshToken, 'updateMany').mockResolvedValueOnce({
        acknowledged: true,
        matchedCount: 5,
        modifiedCount: 5,
        upsertedCount: 0,
        upsertedId: null,
      });
      const deleteConsentsSpy = vi.spyOn(Consent, 'deleteMany').mockResolvedValueOnce({ acknowledged: true, deletedCount: 3 });
      const deleteVaultSpy = vi.spyOn(Vault, 'deleteOne').mockResolvedValueOnce({ acknowledged: true, deletedCount: 1 });
      vi.spyOn(User, 'findOne').mockResolvedValueOnce(null);

      const req = new NextRequest('http://localhost:3000/api/settings?action=account', {
        method: 'DELETE',
        headers: {
          cookie: 'pesu_session=valid',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ confirm: 'DELETE' }),
      });

      const res = await deleteSettings(req);
      expect(res.status).toBe(200);
      expect(userUpdateSpy).toHaveBeenCalledWith(
        { sub: 'usr_test_del', deleted_at: null },
        expect.objectContaining({ $set: { deleted_at: expect.any(Date) } })
      );
      expect(revokeTokensSpy).toHaveBeenCalledWith(
        { sub: 'usr_test_del', revoked_at: null },
        expect.any(Object)
      );
      expect(deleteConsentsSpy).toHaveBeenCalledWith({ sub: 'usr_test_del' });
      expect(deleteVaultSpy).toHaveBeenCalledWith({ sub: 'usr_test_del' });

      // Session cookie is cleared
      const setCookie = res.headers.get('set-cookie');
      expect(setCookie).toContain('pesu_session=;');
    });
  });
});
