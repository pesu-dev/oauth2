import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GET as getDiscovery } from '@/app/.well-known/openid-configuration/route';
import { GET as getJwks } from '@/app/jwks.json/route';
import { POST as postToken } from '@/app/token/route';
import { GET as getUserInfo, POST as postUserInfo } from '@/app/userinfo/route';
import { POST as postRevoke } from '@/app/revoke/route';
import { AuthCode, Client, RefreshToken, User } from '@/lib/db/models';
import { sha256Hex } from '@/lib/crypto/hash';
import { mintAccessToken } from '@/lib/oidc/jwt';
import crypto from 'node:crypto';

vi.mock('@/lib/db/connection', () => ({
  connectToDatabase: vi.fn().mockResolvedValue(null),
}));

describe('OIDC Route Handlers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Discovery endpoint', () => {
    it('returns 200 with OIDC configuration', async () => {
      const resp = await getDiscovery();
      expect(resp.status).toBe(200);
      const data = await resp.json();
      expect(data.issuer).toBeDefined();
      expect(data.authorization_endpoint).toBeDefined();
      expect(data.token_endpoint).toBeDefined();
    });
  });

  describe('JWKS endpoint', () => {
    it('returns 200 with RSA public keys', async () => {
      const resp = await getJwks();
      expect(resp.status).toBe(200);
      const data = await resp.json();
      expect(data.keys).toBeDefined();
      expect(data.keys.length).toBeGreaterThan(0);
      expect(data.keys[0].kty).toBe('RSA');
    });
  });

  describe('Token endpoint - authorization_code', () => {
    it('handles valid authorization code and PKCE exchange', async () => {
      const verifier = 'code-verifier-string-1234567890-test-pkce-valid';
      const challenge = crypto
        .createHash('sha256')
        .update(verifier)
        .digest('base64url');

      const rawCode = 'code_test12345678901234567890123456';
      const codeHash = sha256Hex(rawCode);

      // Mock Client
      vi.spyOn(Client, 'findOne').mockResolvedValueOnce({
        client_id: 'cli_test',
        publishing_status: 'testing',
        token_endpoint_auth_method: 'none',
      } as unknown as InstanceType<typeof Client>);

      // Mock AuthCode findOne
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

      // Mock AuthCode deleteOne
      vi.spyOn(AuthCode, 'deleteOne').mockResolvedValueOnce({ acknowledged: true, deletedCount: 1 });

      // Mock User findOne
      vi.spyOn(User, 'findOne').mockResolvedValueOnce({
        sub: 'usr_test',
        name: 'Test Student',
        prn: 'PES1UG20CS001',
        srn: 'PES1202000001',
      } as unknown as InstanceType<typeof User>);

      // Mock RefreshToken create
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

  describe('Userinfo endpoint', () => {
    it('returns claims for valid Bearer token via GET and POST', async () => {
      const token = await mintAccessToken({
        issuer: 'http://localhost:3000',
        sub: 'usr_test',
        clientId: 'cli_test',
        scopes: ['openid', 'profile'],
      });

      vi.spyOn(User, 'findOne').mockResolvedValue({
        sub: 'usr_test',
        name: 'Test Student',
        prn: 'PES1UG20CS001',
        srn: 'PES1202000001',
        program: 'B.Tech',
        branch: 'CSE',
        semester: 'Sem-6',
        section: 'A',
        campus: 'RR',
      } as unknown as InstanceType<typeof User>);

      const reqGet = new Request('http://localhost:3000/userinfo', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const respGet = await getUserInfo(reqGet);
      expect(respGet.status).toBe(200);

      const reqPost = new Request('http://localhost:3000/userinfo', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      const respPost = await postUserInfo(reqPost);
      expect(respPost.status).toBe(200);
    });

    it('rejects missing Authorization header', async () => {
      const req = new Request('http://localhost:3000/userinfo');
      const resp = await getUserInfo(req);
      expect(resp.status).toBe(401);
    });
  });

  describe('Revocation endpoint', () => {
    it('revokes valid refresh token', async () => {
      vi.spyOn(RefreshToken, 'updateOne').mockResolvedValueOnce({
        acknowledged: true,
        matchedCount: 1,
        modifiedCount: 1,
        upsertedCount: 0,
        upsertedId: null,
      });

      const formData = new URLSearchParams();
      formData.set('token', 'rt_sample_token_to_revoke_123456');

      const req = new Request('http://localhost:3000/revoke', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: formData.toString(),
      });

      const resp = await postRevoke(req);
      expect(resp.status).toBe(200);
      const data = await resp.json();
      expect(data.revoked).toBe(true);
    });
  });
});
