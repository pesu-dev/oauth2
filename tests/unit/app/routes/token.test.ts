import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST as postToken } from '@/app/token/route';
import { AuthCode, Client, RefreshToken, User } from '@/lib/db/models';
import { sha256Hex } from '@/lib/crypto/hash';
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

      vi.spyOn(AuthCode, 'findOne').mockResolvedValueOnce({
        code_hash: codeHash,
        client_id: 'cli_test',
        sub: 'usr_test',
        scopes: ['openid', 'profile', 'offline_access'],
        mode: 'identity',
        redirect_uri: 'http://localhost:3000/callback',
        code_challenge: challenge,
        code_challenge_method: 'S256',
      } as unknown as InstanceType<typeof AuthCode>);

      vi.spyOn(AuthCode, 'deleteOne').mockResolvedValueOnce({ acknowledged: true, deletedCount: 1 });

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

      vi.spyOn(AuthCode, 'findOne').mockResolvedValueOnce({
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
      formData.set('code_verifier', 'wrong_verifier');

      const req = new Request('http://localhost:3000/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: formData.toString(),
      });

      const resp = await postToken(req);
      expect(resp.status).toBe(400);
      const data = await resp.json();
      expect(data.error).toBe('invalid_grant');
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
        client_secret_hash: sha256Hex('correct_secret'),
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

    it('decodes URL-encoded basic auth credentials with colon in secret', async () => {
      const secretWithColon = 'secret:with:colons%26special!';
      const secretHash = sha256Hex(secretWithColon);

      vi.spyOn(Client, 'findOne').mockResolvedValueOnce({
        client_id: 'cli_special',
        client_secret_hash: secretHash,
        token_endpoint_auth_method: 'client_secret_basic',
      } as unknown as InstanceType<typeof Client>);
      vi.spyOn(AuthCode, 'findOne').mockResolvedValueOnce(null);

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
  });
});
