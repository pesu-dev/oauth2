import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { POST as postConsent } from '@/app/api/oidc/consent/route';
import { AuthCode, Client, ClientTester, Consent, Vault } from '@/lib/db/models';
import * as cookieHelper from '@/lib/session/cookie';
import { pendingCredentialStore } from '@/lib/session/pending-credentials';
import { getConfig } from '@/lib/config';

vi.mock('@/lib/db/connection', () => ({
  connectToDatabase: vi.fn().mockResolvedValue(null),
}));

vi.mock('@/lib/config', () => ({
  getConfig: vi.fn(() => ({
    vaultMasterKey: 'super-secret-vault-master-key-32b',
  })),
}));

vi.mock('@/lib/mailer', () => ({
  notifySubQuietly: vi.fn(),
}));

describe('Consent Endpoint (/api/oidc/consent)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Validation & Authorization Checks', () => {
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

    it('rejects with 403 when client is suspended', async () => {
      vi.spyOn(cookieHelper, 'verifySessionToken').mockResolvedValueOnce({ sub: 'usr_owner' });
      vi.spyOn(Client, 'findOne').mockResolvedValueOnce({
        client_id: 'cli_test',
        owner_sub: 'usr_owner',
        redirect_uris: ['https://app.example.com/cb'],
        publishing_status: 'suspended',
        delegated_allowed: false,
      } as unknown as InstanceType<typeof Client>);

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
      expect(data.error).toContain('Application is suspended by an administrator');
    });

    it('rejects with 400 when mode is invalid', async () => {
      vi.spyOn(cookieHelper, 'verifySessionToken').mockResolvedValueOnce({ sub: 'usr_user1' });

      const req = new NextRequest('http://localhost:3000/api/oidc/consent', {
        method: 'POST',
        headers: { cookie: 'pesu_session=valid', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientId: 'cli_test',
          redirectUri: 'https://app.example.com/cb',
          action: 'allow',
          mode: 'superadmin',
        }),
      });

      const res = await postConsent(req);
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain('Invalid mode');
    });

    it('rejects with 403 when delegated mode requested for non-delegated client', async () => {
      vi.spyOn(cookieHelper, 'verifySessionToken').mockResolvedValueOnce({ sub: 'usr_user1' });
      vi.spyOn(Client, 'findOne').mockResolvedValueOnce({
        client_id: 'cli_test',
        redirect_uris: ['https://app.example.com/cb'],
        publishing_status: 'production',
        delegated_allowed: false,
      } as unknown as InstanceType<typeof Client>);

      const req = new NextRequest('http://localhost:3000/api/oidc/consent', {
        method: 'POST',
        headers: { cookie: 'pesu_session=valid', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientId: 'cli_test',
          redirectUri: 'https://app.example.com/cb',
          action: 'allow',
          mode: 'delegated',
          codeChallenge: 'E9Melhoa2OwvFrGMTJguCH5rtx64LxU408W3P65czvc',
        }),
      });

      const res = await postConsent(req);
      expect(res.status).toBe(403);
      const data = await res.json();
      expect(data.error).toContain('Client is not approved for delegated access');
    });

    it('rejects with 400 when codeChallenge is missing or invalid format', async () => {
      vi.spyOn(cookieHelper, 'verifySessionToken').mockResolvedValueOnce({ sub: 'usr_user1' });
      vi.spyOn(Client, 'findOne').mockResolvedValueOnce({
        client_id: 'cli_test',
        redirect_uris: ['https://app.example.com/cb'],
        publishing_status: 'production',
      } as unknown as InstanceType<typeof Client>);

      const req = new NextRequest('http://localhost:3000/api/oidc/consent', {
        method: 'POST',
        headers: { cookie: 'pesu_session=valid', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientId: 'cli_test',
          redirectUri: 'https://app.example.com/cb',
          action: 'allow',
          codeChallenge: 'too-short',
        }),
      });

      const res = await postConsent(req);
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain('code_challenge must be a valid BASE64URL');
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
          codeChallenge: 'E9Melhoa2OwvFrGMTJguCH5rtx64LxU408W3P65czvc',
        }),
      });

      const res = await postConsent(req);
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain('Session expired or credentials missing');
    });
  });

  describe('Deny and Allow Actions', () => {
    it('redirects with access_denied when action is deny', async () => {
      vi.spyOn(cookieHelper, 'verifySessionToken').mockResolvedValueOnce({ sub: 'usr_user1' });
      vi.spyOn(Client, 'findOne').mockResolvedValueOnce({
        client_id: 'cli_test',
        redirect_uris: ['https://app.example.com/cb'],
        publishing_status: 'production',
      } as never);

      const req = new NextRequest('http://localhost:3000/api/oidc/consent', {
        method: 'POST',
        headers: { cookie: 'pesu_session=valid', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientId: 'cli_test',
          redirectUri: 'https://app.example.com/cb',
          action: 'deny',
          state: 'test-state-123',
        }),
      });

      const res = await postConsent(req);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.redirectTo).toContain('error=access_denied');
      expect(data.redirectTo).toContain('state=test-state-123');
    });

    it('grants identity consent, creates AuthCode, and returns redirect with code', async () => {
      vi.spyOn(cookieHelper, 'verifySessionToken').mockResolvedValueOnce({ sub: 'usr_user1' });
      vi.spyOn(Client, 'findOne').mockResolvedValueOnce({
        client_id: 'cli_test',
        name: 'Target App',
        redirect_uris: ['https://app.example.com/cb'],
        publishing_status: 'production',
      } as never);

      const consentSpy = vi.spyOn(Consent, 'findOneAndUpdate').mockResolvedValueOnce({} as never);
      const authCodeSpy = vi.spyOn(AuthCode, 'create').mockResolvedValueOnce({} as never);

      const req = new NextRequest('http://localhost:3000/api/oidc/consent', {
        method: 'POST',
        headers: { cookie: 'pesu_session=valid', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientId: 'cli_test',
          redirectUri: 'https://app.example.com/cb',
          action: 'allow',
          mode: 'identity',
          scope: 'openid profile',
          codeChallenge: 'E9Melhoa2OwvFrGMTJguCH5rtx64LxU408W3P65czvc',
          state: 'abc-state',
        }),
      });

      const res = await postConsent(req);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.redirectTo).toContain('https://app.example.com/cb?code=code_');
      expect(data.redirectTo).toContain('state=abc-state');
      expect(consentSpy).toHaveBeenCalled();
      expect(authCodeSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          client_id: 'cli_test',
          sub: 'usr_user1',
          mode: 'identity',
        })
      );
    });

    it('defaults to delegated mode when mode is omitted and client has delegated_allowed=true', async () => {
      const credId = pendingCredentialStore.put({
        username: 'student1',
        password: 'password_in_memory',
        sessionToken: 'academy_token',
      });

      vi.spyOn(cookieHelper, 'verifySessionToken')
        .mockResolvedValueOnce({ sub: 'usr_user1' }) // session
        .mockResolvedValueOnce({ sub: 'usr_user1', cred_id: credId }); // pending cookie

      vi.spyOn(Client, 'findOne').mockResolvedValueOnce({
        client_id: 'cli_delegated_test',
        name: 'Delegated App',
        redirect_uris: ['https://app.example.com/cb'],
        publishing_status: 'production',
        delegated_allowed: true,
      } as never);

      const consentSpy = vi.spyOn(Consent, 'findOneAndUpdate').mockResolvedValueOnce({} as never);
      const authCodeSpy = vi.spyOn(AuthCode, 'create').mockResolvedValueOnce({} as never);
      vi.spyOn(Vault, 'findOne').mockResolvedValueOnce(null);
      vi.spyOn(Vault, 'findOneAndUpdate').mockResolvedValueOnce({} as never);

      const req = new NextRequest('http://localhost:3000/api/oidc/consent', {
        method: 'POST',
        headers: {
          cookie: 'pesu_session=valid; pesu_pending=pending_val',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          clientId: 'cli_delegated_test',
          redirectUri: 'https://app.example.com/cb',
          action: 'allow',
          // mode is omitted!
          scope: 'openid profile',
          codeChallenge: 'E9Melhoa2OwvFrGMTJguCH5rtx64LxU408W3P65czvc',
          state: 'delegated-state',
        }),
      });

      const res = await postConsent(req);
      expect(res.status).toBe(200);
      expect(consentSpy).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ mode: 'delegated' }),
        expect.anything()
      );
      expect(authCodeSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          client_id: 'cli_delegated_test',
          sub: 'usr_user1',
          mode: 'delegated',
        })
      );
    });

    it('grants delegated consent with pending credentials and stores sealed vault row', async () => {
      const credId = pendingCredentialStore.put({
        username: 'student1',
        password: 'password_in_memory',
        sessionToken: 'academy_token',
      });

      // Session token and pending token mocks
      vi.spyOn(cookieHelper, 'verifySessionToken')
        .mockResolvedValueOnce({ sub: 'usr_user1' }) // for session
        .mockResolvedValueOnce({ sub: 'usr_user1', cred_id: credId }); // for pending cookie

      vi.spyOn(Client, 'findOne').mockResolvedValueOnce({
        client_id: 'cli_test',
        name: 'Target App',
        redirect_uris: ['https://app.example.com/cb'],
        publishing_status: 'production',
        delegated_allowed: true,
      } as never);

      vi.spyOn(Consent, 'findOneAndUpdate').mockResolvedValueOnce({} as never);
      vi.spyOn(Vault, 'findOne').mockResolvedValueOnce(null);
      const vaultSpy = vi.spyOn(Vault, 'findOneAndUpdate').mockResolvedValueOnce({} as never);
      vi.spyOn(AuthCode, 'create').mockResolvedValueOnce({} as never);

      const req = new NextRequest('http://localhost:3000/api/oidc/consent', {
        method: 'POST',
        headers: {
          cookie: 'pesu_session=valid; pesu_pending=pending_token',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          clientId: 'cli_test',
          redirectUri: 'https://app.example.com/cb',
          action: 'allow',
          mode: 'delegated',
          codeChallenge: 'E9Melhoa2OwvFrGMTJguCH5rtx64LxU408W3P65czvc',
        }),
      });

      const res = await postConsent(req);
      expect(res.status).toBe(200);
      expect(vaultSpy).toHaveBeenCalledWith(
        { sub: 'usr_user1' },
        expect.objectContaining({
          sub: 'usr_user1',
          key_version: 1,
        }),
        expect.any(Object)
      );
    });

    it('rejects with 400 when unsupported codeChallengeMethod is passed', async () => {
      vi.spyOn(cookieHelper, 'verifySessionToken').mockResolvedValueOnce({ sub: 'usr_user1' });
      vi.spyOn(Client, 'findOne').mockResolvedValueOnce({
        client_id: 'cli_test',
        redirect_uris: ['https://app.example.com/cb'],
        publishing_status: 'production',
      } as never);

      const req = new NextRequest('http://localhost:3000/api/oidc/consent', {
        method: 'POST',
        headers: { cookie: 'pesu_session=valid', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientId: 'cli_test',
          redirectUri: 'https://app.example.com/cb',
          action: 'allow',
          codeChallenge: 'E9Melhoa2OwvFrGMTJguCH5rtx64LxU408W3P65czvc',
          codeChallengeMethod: 'plain',
        }),
      });

      const res = await postConsent(req);
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toBe('Only code_challenge_method=S256 is supported');
    });

    it('returns 503 when delegated consent requested but vaultMasterKey is missing', async () => {
      vi.mocked(getConfig).mockReturnValueOnce({} as never);

      const credId = pendingCredentialStore.put({
        username: 'student1',
        password: 'password_in_memory',
      });

      vi.spyOn(cookieHelper, 'verifySessionToken')
        .mockResolvedValueOnce({ sub: 'usr_user1' })
        .mockResolvedValueOnce({ sub: 'usr_user1', cred_id: credId });

      vi.spyOn(Client, 'findOne').mockResolvedValueOnce({
        client_id: 'cli_test',
        redirect_uris: ['https://app.example.com/cb'],
        publishing_status: 'production',
        delegated_allowed: true,
      } as never);

      vi.spyOn(Consent, 'findOneAndUpdate').mockResolvedValueOnce({} as never);
      vi.spyOn(Vault, 'findOne').mockResolvedValueOnce(null);

      const req = new NextRequest('http://localhost:3000/api/oidc/consent', {
        method: 'POST',
        headers: { cookie: 'pesu_session=valid; pesu_pending=pending', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientId: 'cli_test',
          redirectUri: 'https://app.example.com/cb',
          action: 'allow',
          mode: 'delegated',
          codeChallenge: 'E9Melhoa2OwvFrGMTJguCH5rtx64LxU408W3P65czvc',
        }),
      });

      const res = await postConsent(req);
      expect(res.status).toBe(503);
      const data = await res.json();
      expect(data.error).toContain('Vault master key unavailable');
    });

    it('clears pending credentials in identity mode when granting consent', async () => {
      const credId = pendingCredentialStore.put({
        username: 'student1',
        password: 'password_in_memory',
      });

      vi.spyOn(cookieHelper, 'verifySessionToken')
        .mockResolvedValueOnce({ sub: 'usr_user1' })
        .mockResolvedValueOnce({ sub: 'usr_user1', cred_id: credId });

      vi.spyOn(Client, 'findOne').mockResolvedValueOnce({
        client_id: 'cli_test',
        name: 'Target App',
        redirect_uris: ['https://app.example.com/cb'],
        publishing_status: 'production',
      } as never);

      vi.spyOn(Consent, 'findOneAndUpdate').mockResolvedValueOnce({} as never);
      vi.spyOn(AuthCode, 'create').mockResolvedValueOnce({} as never);

      const req = new NextRequest('http://localhost:3000/api/oidc/consent', {
        method: 'POST',
        headers: { cookie: 'pesu_session=valid; pesu_pending=pending', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientId: 'cli_test',
          redirectUri: 'https://app.example.com/cb',
          action: 'allow',
          mode: 'identity',
          codeChallenge: 'E9Melhoa2OwvFrGMTJguCH5rtx64LxU408W3P65czvc',
        }),
      });

      const res = await postConsent(req);
      expect(res.status).toBe(200);
      expect(pendingCredentialStore.get(credId)).toBeNull();
    });

    it('handles non-Error exceptions in catch block', async () => {
      vi.spyOn(cookieHelper, 'verifySessionToken').mockResolvedValueOnce({ sub: 'usr_user1' });
      vi.spyOn(Client, 'findOne').mockRejectedValueOnce('raw string error');

      const req = new NextRequest('http://localhost:3000/api/oidc/consent', {
        method: 'POST',
        headers: { cookie: 'pesu_session=valid', 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId: 'c', redirectUri: 'u', action: 'allow' }),
      });

      const res = await postConsent(req);
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toBe('Consent processing failed');
    });

    it('rejects with 401 when session cookie is missing or invalid', async () => {
      const req = new NextRequest('http://localhost:3000/api/oidc/consent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId: 'cli_test', redirectUri: 'https://app.example.com/cb', action: 'allow' }),
      });

      const res = await postConsent(req);
      expect(res.status).toBe(401);
      const data = await res.json();
      expect(data.error).toBe('Unauthorized');
    });

    it('rejects with 404 when client is not found in database', async () => {
      vi.spyOn(cookieHelper, 'verifySessionToken').mockResolvedValueOnce({ sub: 'usr_user1' });
      vi.spyOn(Client, 'findOne').mockResolvedValueOnce(null);

      const req = new NextRequest('http://localhost:3000/api/oidc/consent', {
        method: 'POST',
        headers: { cookie: 'pesu_session=valid', 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId: 'cli_nonexistent', redirectUri: 'https://app.example.com/cb', action: 'allow' }),
      });

      const res = await postConsent(req);
      expect(res.status).toBe(404);
      const data = await res.json();
      expect(data.error).toBe('Client not found');
    });

    it('pops pending credentials when action is deny and pending token has cred_id', async () => {
      vi.spyOn(cookieHelper, 'verifySessionToken')
        .mockResolvedValueOnce({ sub: 'usr_user1' }) // session
        .mockResolvedValueOnce({ sub: 'usr_user1', cred_id: 'pcred_deny123' }); // pending

      vi.spyOn(Client, 'findOne').mockResolvedValueOnce({
        client_id: 'cli_test',
        redirect_uris: ['https://app.example.com/cb'],
        publishing_status: 'production',
      } as unknown as InstanceType<typeof Client>);

      const popSpy = vi.spyOn(pendingCredentialStore, 'pop');

      const req = new NextRequest('http://localhost:3000/api/oidc/consent', {
        method: 'POST',
        headers: { cookie: 'pesu_session=valid; pesu_pending=pending', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientId: 'cli_test',
          redirectUri: 'https://app.example.com/cb',
          action: 'deny',
          state: 'xyz',
        }),
      });

      const res = await postConsent(req);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.redirectTo).toContain('error=access_denied');
      expect(popSpy).toHaveBeenCalledWith('pcred_deny123');
    });

    it('allows owner to authorize application in testing status', async () => {
      vi.spyOn(cookieHelper, 'verifySessionToken').mockResolvedValueOnce({ sub: 'usr_owner' });
      vi.spyOn(Client, 'findOne').mockResolvedValueOnce({
        client_id: 'cli_test',
        owner_sub: 'usr_owner',
        publishing_status: 'testing',
        redirect_uris: ['https://app.example.com/cb'],
      } as never);
      vi.spyOn(ClientTester, 'findOne').mockResolvedValueOnce(null);
      vi.spyOn(Consent, 'findOneAndUpdate').mockResolvedValueOnce({} as never);
      vi.spyOn(AuthCode, 'create').mockResolvedValueOnce({} as never);

      const req = new NextRequest('http://localhost:3000/api/oidc/consent', {
        method: 'POST',
        headers: { cookie: 'pesu_session=valid', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientId: 'cli_test',
          redirectUri: 'https://app.example.com/cb',
          action: 'allow',
          codeChallenge: 'E9Melhoa2OwvFrGMTJguCH5rtx64KA344_3_T1234567890',
        }),
      });

      const res = await postConsent(req);
      expect(res.status).toBe(200);
    });

    it('handles pending credentials with null accessToken, userId, expiresAt, and username', async () => {
      vi.spyOn(cookieHelper, 'verifySessionToken')
        .mockResolvedValueOnce({ sub: 'usr_user1' }) // session
        .mockResolvedValueOnce({ sub: 'usr_user1', cred_id: 'pcred_partial' }); // pending

      vi.spyOn(Client, 'findOne').mockResolvedValueOnce({
        client_id: 'cli_test',
        publishing_status: 'production',
        redirect_uris: ['https://app.example.com/cb'],
        delegated_allowed: true,
      } as never);

      vi.spyOn(pendingCredentialStore, 'pop').mockReturnValueOnce({
        username: '',
        password: 'pass',
        sessionToken: 'sess_only',
        accessToken: undefined,
        userId: undefined,
        expiresAt: undefined,
      });

      vi.spyOn(Vault, 'findOne').mockResolvedValueOnce(null);
      const vaultUpsertSpy = vi.spyOn(Vault, 'findOneAndUpdate').mockResolvedValueOnce({} as never);
      vi.spyOn(Consent, 'findOneAndUpdate').mockResolvedValueOnce({} as never);
      vi.spyOn(AuthCode, 'create').mockResolvedValueOnce({} as never);

      const req = new NextRequest('http://localhost:3000/api/oidc/consent', {
        method: 'POST',
        headers: { cookie: 'pesu_session=valid; pesu_pending=pending', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientId: 'cli_test',
          redirectUri: 'https://app.example.com/cb',
          action: 'allow',
          mode: 'delegated',
          codeChallenge: 'E9Melhoa2OwvFrGMTJguCH5rtx64KA344_3_T1234567890',
        }),
      });

      const res = await postConsent(req);
      expect(res.status).toBe(200);
      expect(vaultUpsertSpy).toHaveBeenCalledWith(
        { sub: 'usr_user1' },
        expect.objectContaining({ sub: 'usr_user1', key_version: 1 }),
        { upsert: true }
      );
    });

    it('handles pending credentials without password', async () => {
      vi.spyOn(cookieHelper, 'verifySessionToken')
        .mockResolvedValueOnce({ sub: 'usr_user1' }) // session
        .mockResolvedValueOnce({ sub: 'usr_user1', cred_id: 'pcred_nopwd' }); // pending

      vi.spyOn(Client, 'findOne').mockResolvedValueOnce({
        client_id: 'cli_test',
        publishing_status: 'production',
        redirect_uris: ['https://app.example.com/cb'],
        delegated_allowed: true,
      } as never);

      vi.spyOn(pendingCredentialStore, 'pop').mockReturnValueOnce({
        username: 'user1',
        password: '',
        sessionToken: '',
        accessToken: undefined,
        userId: undefined,
        expiresAt: undefined,
      });

      vi.spyOn(Vault, 'findOne').mockResolvedValueOnce({ sub: 'usr_user1' } as never);
      vi.spyOn(Consent, 'findOneAndUpdate').mockResolvedValueOnce({} as never);
      vi.spyOn(AuthCode, 'create').mockResolvedValueOnce({} as never);

      const req = new NextRequest('http://localhost:3000/api/oidc/consent', {
        method: 'POST',
        headers: { cookie: 'pesu_session=valid; pesu_pending=pending', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientId: 'cli_test',
          redirectUri: 'https://app.example.com/cb',
          action: 'allow',
          mode: 'delegated',
          codeChallenge: 'E9Melhoa2OwvFrGMTJguCH5rtx64KA344_3_T1234567890',
        }),
      });

      const res = await postConsent(req);
      expect(res.status).toBe(200);
    });

    it('handles pending credentials with password but without sessionToken', async () => {
      vi.spyOn(cookieHelper, 'verifySessionToken')
        .mockResolvedValueOnce({ sub: 'usr_user1' }) // session
        .mockResolvedValueOnce({ sub: 'usr_user1', cred_id: 'pcred_nosess' }); // pending

      vi.spyOn(Client, 'findOne').mockResolvedValueOnce({
        client_id: 'cli_test',
        publishing_status: 'production',
        redirect_uris: ['https://app.example.com/cb'],
        delegated_allowed: true,
      } as never);

      vi.spyOn(pendingCredentialStore, 'pop').mockReturnValueOnce({
        username: 'user1',
        password: 'valid_password',
        sessionToken: '',
        accessToken: undefined,
        userId: undefined,
        expiresAt: undefined,
      });

      vi.spyOn(Vault, 'findOne').mockResolvedValueOnce({ sub: 'usr_user1' } as never);
      vi.spyOn(Vault, 'findOneAndUpdate').mockResolvedValueOnce({} as never);
      vi.spyOn(Consent, 'findOneAndUpdate').mockResolvedValueOnce({} as never);
      vi.spyOn(AuthCode, 'create').mockResolvedValueOnce({} as never);

      const req = new NextRequest('http://localhost:3000/api/oidc/consent', {
        method: 'POST',
        headers: { cookie: 'pesu_session=valid; pesu_pending=pending', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientId: 'cli_test',
          redirectUri: 'https://app.example.com/cb',
          action: 'allow',
          mode: 'delegated',
          codeChallenge: 'E9Melhoa2OwvFrGMTJguCH5rtx64KA344_3_T1234567890',
        }),
      });

      const res = await postConsent(req);
      expect(res.status).toBe(200);
    });

    it('handles non-Error exceptions in catch block', async () => {
      vi.spyOn(cookieHelper, 'verifySessionToken').mockResolvedValueOnce({ sub: 'usr_user1' });
      vi.spyOn(Client, 'findOne').mockRejectedValueOnce('Database crashed');

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
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toBe('Consent processing failed');
    });
  });
});
