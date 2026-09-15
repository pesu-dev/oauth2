import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { GET as getHealth } from '@/app/health/route';
import { buildOpenIdConfiguration } from '@/lib/oidc/discovery';
import { POST as postConsent } from '@/app/api/oidc/consent/route';
import { POST as postToken } from '@/app/token/route';
import { POST as postRevoke } from '@/app/revoke/route';
import { POST as postRequestProduction } from '@/app/api/portal/clients/[clientId]/request-production/route';
import { POST as postTokenExchange } from '@/app/oauth/token-exchange/route';
import { proxy } from '@/proxy';
import { Client, ClientTester, ProductionRequest, Vault, Consent, AuthCode } from '@/lib/db/models';
import * as cookieHelper from '@/lib/session/cookie';
import * as jwtHelper from '@/lib/oidc/jwt';
import { sha256Hex } from '@/lib/crypto/hash';
import { pendingCredentialStore } from '@/lib/session/pending-credentials';

vi.mock('@/lib/db/connection', () => ({
  connectToDatabase: vi.fn().mockResolvedValue(null),
}));

const mockEnvelopeOpen = vi.fn();
vi.mock('@/lib/crypto/envelope', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/crypto/envelope')>();
  return {
    ...actual,
    open: (...args: unknown[]) => mockEnvelopeOpen(...args),
  };
});

describe('Security Remediation & Parity Fixes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    pendingCredentialStore.reset();
  });

  describe('1. Health Check Endpoint (/health)', () => {
    it('returns HTTP 200 and status ok', async () => {
      const res = await getHealth();
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data).toEqual({ status: 'ok' });
    });
  });

  describe('2. OIDC Discovery Document Metadata', () => {
    it('advertises client_secret_basic in token_endpoint_auth_methods_supported', () => {
      const config = buildOpenIdConfiguration('http://localhost:3000');
      expect(config.token_endpoint_auth_methods_supported).toContain('client_secret_basic');
      expect(config.token_endpoint_auth_methods_supported).toContain('client_secret_post');
      expect(config.token_endpoint_auth_methods_supported).toContain('none');
    });
  });

  describe('3. Hardened Consent Endpoint (/api/oidc/consent)', () => {
    it('rejects with 400 when required parameters are missing', async () => {
      vi.spyOn(cookieHelper, 'verifySessionToken').mockResolvedValueOnce({ sub: 'usr_user1' });

      const req = new NextRequest('http://localhost:3000/api/oidc/consent', {
        method: 'POST',
        headers: { cookie: 'pesu_session=valid', 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId: 'cli_test' }), // missing redirectUri & action
      });

      const res = await postConsent(req);
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain('Missing required parameters');
    });

    it('rejects with 400 when redirectUri is not registered, even on deny action', async () => {
      vi.spyOn(cookieHelper, 'verifySessionToken').mockResolvedValueOnce({ sub: 'usr_user1' });
      vi.spyOn(Client, 'findOne').mockResolvedValueOnce({
        client_id: 'cli_test',
        redirect_uris: ['https://legit.example.com/callback'],
        publishing_status: 'production',
      } as unknown as InstanceType<typeof Client>);

      const req = new NextRequest('http://localhost:3000/api/oidc/consent', {
        method: 'POST',
        headers: { cookie: 'pesu_session=valid', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientId: 'cli_test',
          redirectUri: 'https://evil.com/callback',
          action: 'deny',
        }),
      });

      const res = await postConsent(req);
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toBe('Invalid redirect URI');
    });

    it('rejects with 403 when client is in testing mode and user is not owner or tester', async () => {
      vi.spyOn(cookieHelper, 'verifySessionToken').mockResolvedValueOnce({ sub: 'usr_unauthorized' });
      vi.spyOn(Client, 'findOne').mockResolvedValueOnce({
        client_id: 'cli_test',
        owner_sub: 'usr_owner',
        publishing_status: 'testing',
        redirect_uris: ['https://app.example.com/cb'],
      } as unknown as InstanceType<typeof Client>);
      vi.spyOn(ClientTester, 'findOne').mockResolvedValueOnce(null);

      const req = new NextRequest('http://localhost:3000/api/oidc/consent', {
        method: 'POST',
        headers: { cookie: 'pesu_session=valid', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientId: 'cli_test',
          redirectUri: 'https://app.example.com/cb',
          action: 'allow',
        }),
      });

      const res = await postConsent(req);
      expect(res.status).toBe(403);
      const data = await res.json();
      expect(data.error).toContain('Application in testing mode');
    });

    it('rejects with 400 when delegated consent requested but credentials missing and no vault row', async () => {
      vi.spyOn(cookieHelper, 'verifySessionToken').mockResolvedValueOnce({ sub: 'usr_user1' });
      vi.spyOn(Client, 'findOne').mockResolvedValueOnce({
        client_id: 'cli_test',
        owner_sub: 'usr_user1',
        publishing_status: 'production',
        delegated_allowed: true,
        redirect_uris: ['https://app.example.com/cb'],
      } as unknown as InstanceType<typeof Client>);
      vi.spyOn(Consent, 'findOneAndUpdate').mockResolvedValueOnce({} as unknown as InstanceType<typeof Consent>);
      vi.spyOn(Vault, 'findOne').mockResolvedValueOnce(null);

      const req = new NextRequest('http://localhost:3000/api/oidc/consent', {
        method: 'POST',
        headers: { cookie: 'pesu_session=valid', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientId: 'cli_test',
          redirectUri: 'https://app.example.com/cb',
          action: 'allow',
          mode: 'delegated',
        }),
      });

      const res = await postConsent(req);
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain('Session expired or credentials missing');
    });
  });

  describe('4. Token & Revoke Timing Attack & Basic Auth Hardening', () => {
    it('token endpoint returns 401 invalid_client when client_id is missing', async () => {
      const req = new Request('http://localhost:3000/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ grant_type: 'authorization_code' }).toString(),
      });

      const res = await postToken(req);
      expect(res.status).toBe(401);
      const data = await res.json();
      expect(data.error).toBe('invalid_client');
    });

    it('token endpoint decodes URL-encoded basic auth credentials with colon in secret', async () => {
      const secretWithColon = 'secret:with:colons%26special!';
      const secretHash = sha256Hex(secretWithColon);

      vi.spyOn(Client, 'findOne').mockResolvedValueOnce({
        client_id: 'cli_special',
        client_secret_hash: secretHash,
        token_endpoint_auth_method: 'client_secret_basic',
      } as unknown as InstanceType<typeof Client>);
      vi.spyOn(AuthCode, 'findOne').mockResolvedValueOnce(null);

      // Base64 of encodeURIComponent(cli_special) + ":" + encodeURIComponent(secret:with:colons%26special!)
      const authVal = Buffer.from(
        `${encodeURIComponent('cli_special')}:${encodeURIComponent(secretWithColon)}`
      ).toString('base64');

      const req = new Request('http://localhost:3000/token', {
        method: 'POST',
        headers: {
          authorization: `Basic ${authVal}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code: 'invalid_code',
          redirect_uri: 'http://localhost/cb',
          code_verifier: 'a'.repeat(43),
        }).toString(),
      });

      const res = await postToken(req);
      // Client auth passes, moves to auth code verification (400 invalid_grant)
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toBe('invalid_grant');
    });

    it('revoke endpoint validates client secret with timing safety', async () => {
      const correctSecret = 'sec_valid_12345';
      const secretHash = sha256Hex(correctSecret);

      vi.spyOn(Client, 'findOne').mockResolvedValueOnce({
        client_id: 'cli_test',
        client_secret_hash: secretHash,
        token_endpoint_auth_method: 'client_secret_post',
      } as unknown as InstanceType<typeof Client>);

      const req = new Request('http://localhost:3000/revoke', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: 'cli_test',
          client_secret: 'sec_wrong_password',
          token: 'some_token',
        }).toString(),
      });

      const res = await postRevoke(req);
      expect(res.status).toBe(401);
      const data = await res.json();
      expect(data.error).toBe('invalid_client');
    });
  });

  describe('5. CSRF & Cross-Origin Defense in proxy.ts', () => {
    it('blocks mutating API request when sec-fetch-site is cross-site', async () => {
      const req = new NextRequest('http://localhost:3000/api/settings?action=account', {
        method: 'DELETE',
        headers: {
          'sec-fetch-site': 'cross-site',
          cookie: 'pesu_session=valid',
        },
      });

      const res = await proxy(req);
      expect(res.status).toBe(403);
      const data = await res.json();
      expect(data.error).toContain('cross-origin requests are not allowed');
    });

    it('blocks mutating API request when origin does not match host', async () => {
      const req = new NextRequest('http://localhost:3000/api/settings?action=vault', {
        method: 'DELETE',
        headers: {
          origin: 'https://evil-attacker-site.com',
          host: 'localhost:3000',
          cookie: 'pesu_session=valid',
        },
      });

      const res = await proxy(req);
      expect(res.status).toBe(403);
      const data = await res.json();
      expect(data.error).toContain('cross-origin requests are not allowed');
    });

    it('allows mutating API request from same origin', async () => {
      vi.spyOn(cookieHelper, 'verifySessionToken').mockResolvedValueOnce({ sub: 'usr_test' });

      const req = new NextRequest('http://localhost:3000/api/portal/clients', {
        method: 'POST',
        headers: {
          origin: 'http://localhost:3000',
          host: 'localhost:3000',
          cookie: 'pesu_session=valid',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name: 'My App', redirectUris: ['https://app.com/cb'] }),
      });

      const res = await proxy(req);
      // Status 200 indicates proxy allowed it through
      expect(res.status).toBe(200);
    });
  });

  describe('6. Production Request Gating & Duplicate Guard', () => {
    it('rejects production request if client is not in testing status', async () => {
      vi.spyOn(cookieHelper, 'verifySessionToken').mockResolvedValueOnce({ sub: 'usr_owner' });
      vi.spyOn(Client, 'findOne').mockResolvedValueOnce({
        client_id: 'cli_1',
        owner_sub: 'usr_owner',
        publishing_status: 'pending_production',
      } as unknown as InstanceType<typeof Client>);

      const req = new NextRequest('http://localhost:3000/api/portal/clients/cli_1/request-production', {
        method: 'POST',
        headers: { cookie: 'pesu_session=valid', 'Content-Type': 'application/json' },
        body: JSON.stringify({ justification: 'Valid justification with > 10 chars' }),
      });

      const res = await postRequestProduction(req, { params: Promise.resolve({ clientId: 'cli_1' }) });
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain('Only Testing clients can request Production approval');
    });

    it('rejects production request if another request is already pending', async () => {
      vi.spyOn(cookieHelper, 'verifySessionToken').mockResolvedValueOnce({ sub: 'usr_owner' });
      vi.spyOn(Client, 'findOne').mockResolvedValueOnce({
        client_id: 'cli_1',
        owner_sub: 'usr_owner',
        publishing_status: 'testing',
      } as unknown as InstanceType<typeof Client>);
      vi.spyOn(ProductionRequest, 'findOne').mockResolvedValueOnce({
        request_id: 'req_existing',
        status: 'pending',
      } as unknown as InstanceType<typeof ProductionRequest>);

      const req = new NextRequest('http://localhost:3000/api/portal/clients/cli_1/request-production', {
        method: 'POST',
        headers: { cookie: 'pesu_session=valid', 'Content-Type': 'application/json' },
        body: JSON.stringify({ justification: 'Valid justification with > 10 chars' }),
      });

      const res = await postRequestProduction(req, { params: Promise.resolve({ clientId: 'cli_1' }) });
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain('already pending review');
    });
  });

  describe('7. Token Exchange Response Cleaning', () => {
    it('omits absent optional fields (access_token, user_id) when null/undefined', async () => {
      process.env.TOKEN_EXCHANGE_SECRET = 'valid-secret';
      process.env.FIRST_PARTY_API_CLIENT_ID = 'cli_pesu_api';
      process.env.VAULT_MASTER_KEY = 'valid-vault-master-key-that-is-long-enough-for-hkdf';

      vi.spyOn(jwtHelper, 'verifyAccessToken').mockResolvedValueOnce({
        sub: 'usr_sub',
        client_id: 'cli_pesu_api',
        scope: 'openid',
      });
      vi.spyOn(Consent, 'findOne').mockResolvedValueOnce({
        sub: 'usr_sub',
        client_id: 'cli_pesu_api',
        mode: 'delegated',
      } as unknown as InstanceType<typeof Consent>);
      vi.spyOn(Vault, 'findOne').mockResolvedValueOnce({
        sub: 'usr_sub',
        encrypted_session: 'YWJj',
        session_nonce: 'bm9uY2U=',
        session_wrap_nonce: 'd3JhcA==',
        session_wrapped_dek: 'ZGVr',
        session_expires_at: new Date(Date.now() + 3600000),
        key_version: 1,
      } as unknown as InstanceType<typeof Vault>);

      mockEnvelopeOpen.mockReturnValue(Buffer.from(JSON.stringify({ token: 'sess_tok_123' })));

      const req = new Request('http://localhost:3000/oauth/token-exchange', {
        method: 'POST',
        headers: {
          'x-token-exchange-secret': 'valid-secret',
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({ access_token: 'valid_jwt' }).toString(),
      });

      const res = await postTokenExchange(req);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.token).toBe('sess_tok_123');
      expect(data).not.toHaveProperty('access_token');
      expect(data).not.toHaveProperty('user_id');
    });
  });
});
