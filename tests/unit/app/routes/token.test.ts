import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST as postToken } from '@/app/oauth2/token/route';
import { AuthCode, Client, RefreshToken, User } from '@/lib/db/models';
import { sha256Hex, hashClientSecret } from '@/lib/crypto/hash';
import crypto from 'node:crypto';

vi.mock('@/lib/db/connection', () => ({
  connectToDatabase: vi.fn().mockResolvedValue(null),
}));

describe('Token Endpoint (/token)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Authorization Code Grant', () => {
    it('handles valid authorization code and PKCE exchange', async () => {
      const verifier = 'code-verifier-string-1234567890-test-pkce-valid';
      const challenge = crypto
        .createHash('sha256')
        .update(verifier)
        .digest('base64url');

      const rawCode = 'code_test12345678901234567890123456';
      const codeHash = sha256Hex(rawCode);

      vi.spyOn(Client, 'findOne').mockResolvedValueOnce({
        client_id: 'cli_test',
        publishing_status: 'testing',
        token_endpoint_auth_method: 'none',
      } as unknown as InstanceType<typeof Client>);

      vi.spyOn(AuthCode, 'findOneAndDelete').mockResolvedValueOnce({
        code_hash: codeHash,
        client_id: 'cli_test',
        sub: 'usr_test',
        scopes: ['openid', 'profile', 'offline_access'],
        mode: 'identity',
        redirect_uri: 'http://localhost:3000/callback',
        code_challenge: challenge,
        code_challenge_method: 'S256',
      } as unknown as InstanceType<typeof AuthCode>);

      vi.spyOn(User, 'findOne').mockResolvedValueOnce({
        sub: 'usr_test',
        name: 'Test Student',
        prn: 'PES1UG20CS001',
        srn: 'PES1202000001',
      } as unknown as InstanceType<typeof User>);

      vi.spyOn(RefreshToken, 'create').mockImplementation(
        (async () => ({})) as unknown as typeof RefreshToken.create
      );

      const formData = new URLSearchParams();
      formData.set('grant_type', 'authorization_code');
      formData.set('client_id', 'cli_test');
      formData.set('code', rawCode);
      formData.set('redirect_uri', 'http://localhost:3000/callback');
      formData.set('code_verifier', verifier);

      const req = new Request('http://localhost:3000/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: formData.toString(),
      });

      const resp = await postToken(req);
      expect(resp.status).toBe(200);
      const data = await resp.json();
      expect(data.access_token).toBeDefined();
      expect(data.id_token).toBeDefined();
      expect(data.refresh_token).toBeDefined();
      expect(data.token_type).toBe('Bearer');
    });

    it('rejects invalid PKCE verifier', async () => {
      const challenge = 'valid_challenge_base64url';
      const rawCode = 'code_invalid_pkce';
      const codeHash = sha256Hex(rawCode);

      vi.spyOn(Client, 'findOne').mockResolvedValueOnce({
        client_id: 'cli_test',
        token_endpoint_auth_method: 'none',
      } as unknown as InstanceType<typeof Client>);

      vi.spyOn(AuthCode, 'findOneAndDelete').mockResolvedValueOnce({
        code_hash: codeHash,
        client_id: 'cli_test',
        sub: 'usr_test',
        scopes: ['openid'],
        redirect_uri: 'http://localhost:3000/cb',
        code_challenge: challenge,
        code_challenge_method: 'S256',
      } as unknown as InstanceType<typeof AuthCode>);

      const formData = new URLSearchParams();
      formData.set('grant_type', 'authorization_code');
      formData.set('client_id', 'cli_test');
      formData.set('code', rawCode);
      formData.set('redirect_uri', 'http://localhost:3000/cb');
      formData.set('code_verifier', 'wrong_verifier'.padEnd(43, 'x'));

      const req = new Request('http://localhost:3000/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: formData.toString(),
      });

      const resp = await postToken(req);
      expect(resp.status).toBe(400);
      const data = await resp.json();
      expect(data.error).toBe('invalid_grant');
      expect(data.error_description).toBe('PKCE verification failed');
    });

    it('verifies PKCE with default S256 when authCode.code_challenge_method is omitted', async () => {
      const verifier = 'my-secret-code-verifier-43-characters-long-valid';
      const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
      const rawCode = 'code_default_method1234567890123456789';
      const codeHash = sha256Hex(rawCode);

      vi.spyOn(Client, 'findOne').mockResolvedValueOnce({
        client_id: 'cli_test',
        publishing_status: 'testing',
        token_endpoint_auth_method: 'none',
      } as never);

      vi.spyOn(AuthCode, 'findOneAndDelete').mockResolvedValueOnce({
        code_hash: codeHash,
        client_id: 'cli_test',
        sub: 'usr_test',
        scopes: [],
        redirect_uri: 'http://localhost:3000/cb',
        code_challenge: challenge,
        code_challenge_method: undefined,
      } as never);

      vi.spyOn(User, 'findOne').mockResolvedValueOnce({
        sub: 'usr_test',
        name: 'Test Student',
        prn: 'PES1UG20CS001',
        srn: 'PES1202000001',
      } as never);

      const formData = new URLSearchParams();
      formData.set('grant_type', 'authorization_code');
      formData.set('client_id', 'cli_test');
      formData.set('code', rawCode);
      formData.set('redirect_uri', 'http://localhost:3000/cb');
      formData.set('code_verifier', verifier);

      const req = new Request('http://localhost:3000/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: formData.toString(),
      });

      const resp = await postToken(req);
      expect(resp.status).toBe(200);
    });

    it('rejects expired or already redeemed authorization code', async () => {
      const rawCode = 'code_already_redeemed';

      vi.spyOn(Client, 'findOne').mockResolvedValueOnce({
        client_id: 'cli_test',
        token_endpoint_auth_method: 'none',
      } as unknown as InstanceType<typeof Client>);

      // findOneAndDelete returns null when code does not exist or expired past TTL cutoff
      const findAndDeleteSpy = vi.spyOn(AuthCode, 'findOneAndDelete').mockResolvedValueOnce(null);

      const formData = new URLSearchParams();
      formData.set('grant_type', 'authorization_code');
      formData.set('client_id', 'cli_test');
      formData.set('code', rawCode);
      formData.set('redirect_uri', 'http://localhost:3000/cb');
      formData.set('code_verifier', 'a'.repeat(43));

      const req = new Request('http://localhost:3000/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: formData.toString(),
      });

      const resp = await postToken(req);
      expect(resp.status).toBe(400);
      const data = await resp.json();
      expect(data.error).toBe('invalid_grant');
      expect(data.error_description).toBe('Authorization code is invalid or expired');
      expect(findAndDeleteSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          code_hash: sha256Hex(rawCode),
          expires_at: expect.objectContaining({ $gt: expect.any(Date) }),
        })
      );
    });
  });

  describe('Client Authentication & Request Validation', () => {
    it('returns 401 invalid_client when client_id is missing', async () => {
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

    it('returns 400 invalid_request when grant_type is missing', async () => {
      const req = new Request('http://localhost:3000/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ client_id: 'cli_test' }).toString(),
      });

      const res = await postToken(req);
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toBe('invalid_request');
    });

    it('returns 401 when confidential client credentials are wrong', async () => {
      vi.spyOn(Client, 'findOne').mockResolvedValueOnce({
        client_id: 'cli_conf',
        client_secret_hash: await hashClientSecret('correct_secret'),
        token_endpoint_auth_method: 'client_secret_post',
      } as never);

      const req = new Request('http://localhost:3000/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          client_id: 'cli_conf',
          client_secret: 'wrong_secret',
        }).toString(),
      });

      const res = await postToken(req);
      expect(res.status).toBe(401);
      const data = await res.json();
      expect(data.error).toBe('invalid_client');
    });

    it('returns 401 when client is suspended', async () => {
      vi.spyOn(Client, 'findOne').mockResolvedValueOnce({
        client_id: 'cli_suspended',
        token_endpoint_auth_method: 'none',
        publishing_status: 'suspended',
      } as never);

      const req = new Request('http://localhost:3000/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          client_id: 'cli_suspended',
          code: 'some_code',
          redirect_uri: 'http://localhost/cb',
          code_verifier: 'a'.repeat(43),
        }).toString(),
      });

      const res = await postToken(req);
      expect(res.status).toBe(401);
      const data = await res.json();
      expect(data.error).toBe('invalid_client');
      expect(data.error_description).toContain('Client is suspended');
    });

    it('decodes URL-encoded basic auth credentials with colon in secret', async () => {
      const secretWithColon = 'secret:with:colons%26special!';
      const secretHash = await hashClientSecret(secretWithColon);

      vi.spyOn(Client, 'findOne').mockResolvedValueOnce({
        client_id: 'cli_special',
        client_secret_hash: secretHash,
        token_endpoint_auth_method: 'client_secret_basic',
      } as unknown as InstanceType<typeof Client>);
      vi.spyOn(AuthCode, 'findOneAndDelete').mockResolvedValueOnce(null);

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
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toBe('invalid_grant');
    });
  });

  describe('Refresh Token Grant', () => {
    it('returns 400 when refresh_token parameter is missing', async () => {
      vi.spyOn(Client, 'findOne').mockResolvedValueOnce({
        client_id: 'cli_test',
        token_endpoint_auth_method: 'none',
      } as never);

      const req = new Request('http://localhost:3000/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          client_id: 'cli_test',
        }).toString(),
      });

      const res = await postToken(req);
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toBe('invalid_request');
    });

    it('returns 400 invalid_grant when token is not found', async () => {
      vi.spyOn(Client, 'findOne').mockResolvedValueOnce({
        client_id: 'cli_test',
        token_endpoint_auth_method: 'none',
      } as never);
      vi.spyOn(RefreshToken, 'findOneAndUpdate').mockResolvedValueOnce(null);
      vi.spyOn(RefreshToken, 'findOne').mockResolvedValueOnce(null);

      const req = new Request('http://localhost:3000/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          client_id: 'cli_test',
          refresh_token: 'rt_nonexistent',
        }).toString(),
      });

      const res = await postToken(req);
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toBe('invalid_grant');
    });

    it('detects token reuse and revokes entire family', async () => {
      vi.spyOn(Client, 'findOne').mockResolvedValueOnce({
        client_id: 'cli_test',
        token_endpoint_auth_method: 'none',
      } as never);
      vi.spyOn(RefreshToken, 'findOneAndUpdate').mockResolvedValueOnce(null);
      vi.spyOn(RefreshToken, 'findOne').mockResolvedValueOnce({
        client_id: 'cli_test',
        family_id: 'fam_compromised',
        revoked_at: new Date('2026-01-01'),
      } as never);
      const revokeFamilySpy = vi.spyOn(RefreshToken, 'updateMany').mockResolvedValueOnce({} as never);

      const req = new Request('http://localhost:3000/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          client_id: 'cli_test',
          refresh_token: 'rt_reused',
        }).toString(),
      });

      const res = await postToken(req);
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error_description).toContain('Refresh token reuse detected');
      expect(revokeFamilySpy).toHaveBeenCalledWith(
        { family_id: 'fam_compromised', revoked_at: null },
        expect.any(Object)
      );
    });

    it('rotates refresh token and returns new access/refresh tokens on valid grant', async () => {
      vi.spyOn(Client, 'findOne').mockResolvedValueOnce({
        client_id: 'cli_test',
        token_endpoint_auth_method: 'none',
      } as never);

      const expiresAt = new Date(Date.now() + 30 * 86400 * 1000);
      vi.spyOn(RefreshToken, 'findOneAndUpdate').mockResolvedValueOnce({
        family_id: 'fam_valid',
        client_id: 'cli_test',
        sub: 'usr_valid_sub',
        scopes: ['openid', 'profile'],
        expires_at: expiresAt,
      } as never);

      vi.spyOn(User, 'findOne').mockResolvedValueOnce({
        sub: 'usr_valid_sub',
        name: 'Student Name',
      } as never);

      vi.spyOn(RefreshToken, 'create').mockResolvedValueOnce({} as never);
      vi.spyOn(RefreshToken, 'countDocuments').mockResolvedValueOnce(1);

      const req = new Request('http://localhost:3000/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          client_id: 'cli_test',
          refresh_token: 'rt_live_valid',
        }).toString(),
      });

      const res = await postToken(req);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.access_token).toBeDefined();
      expect(data.refresh_token).toBeDefined();
      expect(data.token_type).toBe('Bearer');
    });

    it('rejects refresh token issued to a different client', async () => {
      vi.spyOn(Client, 'findOne').mockResolvedValueOnce({
        client_id: 'cli_attacker',
        token_endpoint_auth_method: 'none',
      } as never);

      vi.spyOn(RefreshToken, 'findOneAndUpdate').mockResolvedValueOnce({
        family_id: 'fam_other',
        client_id: 'cli_victim',
        sub: 'usr_victim',
      } as never);
      vi.spyOn(RefreshToken, 'updateMany').mockResolvedValueOnce({} as never);

      const req = new Request('http://localhost:3000/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          grant_type: 'refresh_token',
          client_id: 'cli_attacker',
          refresh_token: 'rt_stolen',
        }),
      });

      const res = await postToken(req);
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error_description).toContain('Token was issued to a different client');
    });

    it('rejects refresh token when user is not found or deleted', async () => {
      vi.spyOn(Client, 'findOne').mockResolvedValueOnce({
        client_id: 'cli_test',
        token_endpoint_auth_method: 'none',
      } as never);

      vi.spyOn(RefreshToken, 'findOneAndUpdate').mockResolvedValueOnce({
        family_id: 'fam_valid',
        client_id: 'cli_test',
        sub: 'usr_deleted',
      } as never);
      vi.spyOn(User, 'findOne').mockResolvedValueOnce(null);

      const req = new Request('http://localhost:3000/token', {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: 'grant_type=refresh_token&client_id=cli_test&refresh_token=rt_user_deleted',
      });

      const res = await postToken(req);
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error_description).toContain('User not found or deleted');
    });

    it('detects concurrent refresh race condition and revokes family', async () => {
      vi.spyOn(Client, 'findOne').mockResolvedValueOnce({
        client_id: 'cli_test',
        token_endpoint_auth_method: 'none',
      } as never);

      vi.spyOn(RefreshToken, 'findOneAndUpdate').mockResolvedValueOnce({
        family_id: 'fam_race',
        client_id: 'cli_test',
        sub: 'usr_race',
        scopes: [],
        expires_at: new Date(Date.now() + 10000),
      } as never);
      vi.spyOn(User, 'findOne').mockResolvedValueOnce({ sub: 'usr_race' } as never);
      vi.spyOn(RefreshToken, 'create').mockResolvedValueOnce({} as never);
      // Simulate race where multiple live tokens exist
      vi.spyOn(RefreshToken, 'countDocuments').mockResolvedValueOnce(2);
      const updateManySpy = vi.spyOn(RefreshToken, 'updateMany').mockResolvedValueOnce({} as never);

      const req = new Request('http://localhost:3000/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          grant_type: 'refresh_token',
          client_id: 'cli_test',
          refresh_token: 'rt_race',
        }),
      });

      const res = await postToken(req);
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error_description).toContain('Refresh token reuse detected; family revoked');
      expect(updateManySpy).toHaveBeenCalledWith(
        { family_id: 'fam_race', revoked_at: null },
        expect.any(Object)
      );
    });
  });

  describe('Client Authentication & Unsupported Grants', () => {
    it('verifies confidential client secret mismatch and missing secret', async () => {
      const hashedSecret = await hashClientSecret('secret123');

      // 1. Missing secret
      vi.spyOn(Client, 'findOne').mockResolvedValueOnce({
        client_id: 'cli_confidential',
        token_endpoint_auth_method: 'client_secret_post',
        client_secret_hash: hashedSecret,
      } as never);

      let req = new Request('http://localhost:3000/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          grant_type: 'authorization_code',
          client_id: 'cli_confidential',
        }),
      });
      let res = await postToken(req);
      expect(res.status).toBe(401);
      let data = await res.json();
      expect(data.error_description).toBe('Invalid client credentials');

      // 2. Wrong secret
      vi.spyOn(Client, 'findOne').mockResolvedValueOnce({
        client_id: 'cli_confidential',
        token_endpoint_auth_method: 'client_secret_post',
        client_secret_hash: hashedSecret,
      } as never);

      req = new Request('http://localhost:3000/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          grant_type: 'authorization_code',
          client_id: 'cli_confidential',
          client_secret: 'wrong_secret',
        }),
      });
      res = await postToken(req);
      expect(res.status).toBe(401);
      data = await res.json();
      expect(data.error_description).toBe('Invalid client credentials');
    });

    it('rejects unsupported grant types', async () => {
      vi.spyOn(Client, 'findOne').mockResolvedValueOnce({
        client_id: 'cli_test',
        token_endpoint_auth_method: 'none',
      } as never);

      const req = new Request('http://localhost:3000/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          grant_type: 'password',
          client_id: 'cli_test',
        }),
      });

      const res = await postToken(req);
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toBe('unsupported_grant_type');
    });

    it('rejects authorization code when redirect_uri does not match', async () => {
      vi.spyOn(Client, 'findOne').mockResolvedValueOnce({
        client_id: 'cli_test',
        token_endpoint_auth_method: 'none',
      } as never);

      vi.spyOn(AuthCode, 'findOneAndDelete').mockResolvedValueOnce({
        code_hash: 'hash',
        client_id: 'cli_test',
        sub: 'usr_test',
        scopes: ['openid'],
        redirect_uri: 'https://registered.com/cb',
        code_challenge: 'chal',
        code_challenge_method: 'S256',
      } as never);

      const req = new Request('http://localhost:3000/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          grant_type: 'authorization_code',
          client_id: 'cli_test',
          code: 'code_123',
          redirect_uri: 'https://different.com/cb',
          code_verifier: 'verifier_string_at_least_43_chars_long_12345678',
        }),
      });

      const res = await postToken(req);
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error_description).toBe('redirect_uri mismatch');
    });

    it('rejects authorization code when user is not found or deleted', async () => {
      const verifier = 'code-verifier-string-1234567890-test-pkce-valid';
      const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');

      vi.spyOn(Client, 'findOne').mockResolvedValueOnce({
        client_id: 'cli_test',
        token_endpoint_auth_method: 'none',
      } as never);

      vi.spyOn(AuthCode, 'findOneAndDelete').mockResolvedValueOnce({
        code_hash: 'hash',
        client_id: 'cli_test',
        sub: 'usr_deleted',
        scopes: ['openid'],
        redirect_uri: 'https://registered.com/cb',
        code_challenge: challenge,
        code_challenge_method: 'S256',
      } as never);

      vi.spyOn(User, 'findOne').mockResolvedValueOnce(null);

      const req = new Request('http://localhost:3000/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          grant_type: 'authorization_code',
          client_id: 'cli_test',
          code: 'code_123',
          redirect_uri: 'https://registered.com/cb',
          code_verifier: verifier,
        }),
      });

      const res = await postToken(req);
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error_description).toBe('User not found or deleted');
    });

    it('rejects refresh token when existing token was issued to a different client', async () => {
      vi.spyOn(Client, 'findOne').mockResolvedValueOnce({
        client_id: 'cli_requesting',
        token_endpoint_auth_method: 'none',
      } as never);

      vi.spyOn(RefreshToken, 'findOneAndUpdate').mockResolvedValueOnce(null);
      vi.spyOn(RefreshToken, 'findOne').mockResolvedValueOnce({
        token_hash: 'hash',
        client_id: 'cli_different',
      } as never);

      const req = new Request('http://localhost:3000/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          grant_type: 'refresh_token',
          client_id: 'cli_requesting',
          refresh_token: 'rft_12345',
        }),
      });

      const res = await postToken(req);
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error_description).toBe('Token was issued to a different client');
    });

    it('rejects refresh token with fallback invalid or reused message', async () => {
      vi.spyOn(Client, 'findOne').mockResolvedValueOnce({
        client_id: 'cli_requesting',
        token_endpoint_auth_method: 'none',
      } as never);

      vi.spyOn(RefreshToken, 'findOneAndUpdate').mockResolvedValueOnce(null);
      vi.spyOn(RefreshToken, 'findOne').mockResolvedValueOnce({
        token_hash: 'hash',
        client_id: 'cli_requesting',
        revoked_at: null,
        expires_at: new Date(Date.now() + 100000),
      } as never);

      const req = new Request('http://localhost:3000/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          grant_type: 'refresh_token',
          client_id: 'cli_requesting',
          refresh_token: 'rft_12345',
        }),
      });

      const res = await postToken(req);
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error_description).toBe('Invalid or reused refresh token');
    });

    it('rejects with 401 when client is not found in database', async () => {
      vi.spyOn(Client, 'findOne').mockResolvedValueOnce(null);

      const req = new Request('http://localhost:3000/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          grant_type: 'authorization_code',
          client_id: 'cli_unknown',
          code: 'code123',
          redirect_uri: 'https://app.com/cb',
          code_verifier: 'code-verifier-string-1234567890-test-pkce-valid',
        }),
      });

      const res = await postToken(req);
      expect(res.status).toBe(401);
      const data = await res.json();
      expect(data.error).toBe('invalid_client');
      expect(data.error_description).toBe('Client not found');
    });

    it('rejects authorization_code with 400 when missing required parameters', async () => {
      vi.spyOn(Client, 'findOne').mockResolvedValueOnce({
        client_id: 'cli_test',
        token_endpoint_auth_method: 'none',
      } as never);

      const req = new Request('http://localhost:3000/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          grant_type: 'authorization_code',
          client_id: 'cli_test',
          code: 'code123',
          // missing redirect_uri and code_verifier
        }),
      });

      const res = await postToken(req);
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error_description).toBe('Missing code, redirect_uri, or code_verifier');
    });

    it('rejects authorization_code with 400 when code_verifier fails regex validation', async () => {
      vi.spyOn(Client, 'findOne').mockResolvedValueOnce({
        client_id: 'cli_test',
        token_endpoint_auth_method: 'none',
      } as never);

      const req = new Request('http://localhost:3000/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          grant_type: 'authorization_code',
          client_id: 'cli_test',
          code: 'code123',
          redirect_uri: 'https://app.com/cb',
          code_verifier: 'too-short',
        }),
      });

      const res = await postToken(req);
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error_description).toBe('code_verifier must be 43-128 unreserved ASCII characters');
    });

    it('rejects authorization_code when code was issued to a different client', async () => {
      const verifier = 'code-verifier-string-1234567890-test-pkce-valid';
      vi.spyOn(Client, 'findOne').mockResolvedValueOnce({
        client_id: 'cli_test',
        token_endpoint_auth_method: 'none',
      } as never);

      vi.spyOn(AuthCode, 'findOneAndDelete').mockResolvedValueOnce({
        code_hash: 'hash',
        client_id: 'cli_different',
        sub: 'usr_1',
        scopes: ['openid'],
        redirect_uri: 'https://app.com/cb',
      } as never);

      const req = new Request('http://localhost:3000/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          grant_type: 'authorization_code',
          client_id: 'cli_test',
          code: 'code123',
          redirect_uri: 'https://app.com/cb',
          code_verifier: verifier,
        }),
      });

      const res = await postToken(req);
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error_description).toBe('Code was issued to a different client');
    });

    it('handles authorization_code without openid and without offline_access, and with undefined scopes', async () => {
      const verifier = 'code-verifier-string-1234567890-test-pkce-valid';
      const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');

      vi.spyOn(Client, 'findOne').mockResolvedValue({
        client_id: 'cli_test',
        token_endpoint_auth_method: 'none',
      } as never);

      vi.spyOn(User, 'findOne').mockResolvedValue({
        sub: 'usr_test',
        name: 'Test Student',
      } as never);

      // 1. Scopes without openid and without offline_access (profile only)
      vi.spyOn(AuthCode, 'findOneAndDelete').mockResolvedValueOnce({
        code_hash: 'h1',
        client_id: 'cli_test',
        sub: 'usr_test',
        scopes: ['profile'],
        redirect_uri: 'http://localhost:3000/callback',
        code_challenge: challenge,
        code_challenge_method: 'S256',
      } as never);

      const req1 = new Request('http://localhost:3000/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          grant_type: 'authorization_code',
          client_id: 'cli_test',
          code: 'c1',
          redirect_uri: 'http://localhost:3000/callback',
          code_verifier: verifier,
        }),
      });

      const res1 = await postToken(req1);
      expect(res1.status).toBe(200);
      const data1 = await res1.json();
      expect(data1.id_token).toBeUndefined();
      expect(data1.refresh_token).toBeUndefined();

      // 2. Scopes undefined (falls back to [])
      vi.spyOn(AuthCode, 'findOneAndDelete').mockResolvedValueOnce({
        code_hash: 'h2',
        client_id: 'cli_test',
        sub: 'usr_test',
        scopes: undefined,
        redirect_uri: 'http://localhost:3000/callback',
        code_challenge: challenge,
        code_challenge_method: 'S256',
      } as never);

      const req2 = new Request('http://localhost:3000/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          grant_type: 'authorization_code',
          client_id: 'cli_test',
          code: 'c2',
          redirect_uri: 'http://localhost:3000/callback',
          code_verifier: verifier,
        }),
      });

      const res2 = await postToken(req2);
      expect(res2.status).toBe(200);
    });

    it('handles refresh_token grant without openid and with undefined scopes', async () => {
      vi.spyOn(Client, 'findOne').mockResolvedValue({
        client_id: 'cli_test',
        token_endpoint_auth_method: 'none',
      } as never);

      vi.spyOn(User, 'findOne').mockResolvedValue({
        sub: 'usr_test',
      } as never);

      vi.spyOn(RefreshToken, 'create').mockResolvedValue({} as never);
      vi.spyOn(RefreshToken, 'countDocuments').mockResolvedValue(1 as never);

      // 1. Scopes without openid
      vi.spyOn(RefreshToken, 'findOneAndUpdate').mockResolvedValueOnce({
        token_hash: sha256Hex('rt_1'),
        client_id: 'cli_test',
        family_id: 'fam_1',
        sub: 'usr_test',
        scopes: ['profile'],
        expires_at: new Date(Date.now() + 100000),
      } as never);

      const req1 = new Request('http://localhost:3000/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          grant_type: 'refresh_token',
          client_id: 'cli_test',
          refresh_token: 'rt_1',
        }),
      });

      const res1 = await postToken(req1);
      expect(res1.status).toBe(200);
      const data1 = await res1.json();
      expect(data1.id_token).toBeUndefined();

      // 2. Scopes undefined (falls back to [])
      vi.spyOn(RefreshToken, 'findOneAndUpdate').mockResolvedValueOnce({
        token_hash: sha256Hex('rt_2'),
        client_id: 'cli_test',
        family_id: 'fam_2',
        sub: 'usr_test',
        scopes: undefined,
        expires_at: new Date(Date.now() + 100000),
      } as never);

      const req2 = new Request('http://localhost:3000/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          grant_type: 'refresh_token',
          client_id: 'cli_test',
          refresh_token: 'rt_2',
        }),
      });

      const res2 = await postToken(req2);
      expect(res2.status).toBe(200);
    });

    it('handles parseParams branches: missing Content-Type, FormData with non-string, Basic auth edge cases, text stream error', async () => {
      // 1. Missing Content-Type
      const req1 = {
        headers: new Headers(),
        text: vi.fn().mockResolvedValue('grant_type=invalid'),
      } as unknown as Request;
      expect((await postToken(req1)).status).toBe(401);

      // 2. FormData with Blob
      const formDataMock = new Map<string, unknown>([
        ['grant_type', 'invalid'],
        ['file', new Blob(['xyz'])],
      ]);
      const req2 = {
        headers: new Headers({ 'content-type': 'multipart/form-data' }),
        formData: vi.fn().mockResolvedValue(formDataMock),
      } as unknown as Request;
      expect((await postToken(req2)).status).toBe(401);

      // 3. Basic auth without colon
      const req3 = {
        headers: new Headers({
          authorization: `Basic ${Buffer.from('nocolon').toString('base64')}`,
          'content-type': 'application/json',
        }),
        json: vi.fn().mockResolvedValue({ grant_type: 'invalid' }),
      } as unknown as Request;
      expect((await postToken(req3)).status).toBe(401);

      // 4. Basic auth with %ZZ decodeURIComponent throwing
      const req4 = {
        headers: new Headers({
          authorization: `Basic ${Buffer.from('cli%ZZ:sec%ZZ').toString('base64')}`,
          'content-type': 'application/json',
        }),
        json: vi.fn().mockResolvedValue({ grant_type: 'invalid' }),
      } as unknown as Request;
      expect((await postToken(req4)).status).toBe(400);

      // 5. Basic auth when client_id/secret already in body
      const req5 = {
        headers: new Headers({
          authorization: `Basic ${Buffer.from('h_cli:h_sec').toString('base64')}`,
          'content-type': 'application/json',
        }),
        json: vi.fn().mockResolvedValue({
          client_id: 'b_cli',
          client_secret: 'b_sec',
          grant_type: 'invalid',
        }),
      } as unknown as Request;
      expect((await postToken(req5)).status).toBe(400);

      // 6. Text read stream error
      const brokenReq = {
        headers: new Headers(),
        text: vi.fn().mockRejectedValueOnce(new Error('Stream failed')),
      } as unknown as Request;
      expect((await postToken(brokenReq)).status).toBe(401);
    });
  });
});
