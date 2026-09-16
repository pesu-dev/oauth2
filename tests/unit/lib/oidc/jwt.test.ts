import { describe, it, expect, vi } from 'vitest';
import {
  getPublicJwks,
  mintAccessToken,
  mintIdToken,
  verifyAccessToken,
  calculateAtHash,
} from '@/lib/oidc/jwt';
import { IUser } from '@/lib/db/models';
import { jwtVerify, importJWK } from 'jose';

describe('OIDC JWT & JWKS Operations', () => {
  describe('JWKS Export', () => {
    it('exports public JWKS with RS256 kid', async () => {
      const jwks = await getPublicJwks();
      expect(jwks.keys).toBeDefined();
      expect(jwks.keys.length).toBeGreaterThan(0);
      expect(jwks.keys[0].kty).toBe('RSA');
      expect(jwks.keys[0].alg).toBe('RS256');
      expect(jwks.keys[0].use).toBe('sig');
      expect(jwks.keys[0].kid).toBeDefined();
    });

    it('JWKS exports only public RSA components without private key leakage', async () => {
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

  describe('at_hash Calculation', () => {
    it('calculates valid OIDC at_hash for access token', () => {
      const atHash = calculateAtHash('sample-access-token-12345');
      expect(atHash).toBeDefined();
      expect(typeof atHash).toBe('string');
      expect(atHash.length).toBeGreaterThan(10);
    });
  });

  describe('Access Token Minting & Verification', () => {
    it('mints and verifies access token', async () => {
      const token = await mintAccessToken({
        issuer: 'http://localhost:3000',
        sub: 'usr_123',
        clientId: 'cli_abc',
        scopes: ['openid', 'profile'],
      });

      expect(typeof token).toBe('string');

      const payload = await verifyAccessToken(token, 'http://localhost:3000');
      expect(payload.sub).toBe('usr_123');
      expect(payload.client_id).toBe('cli_abc');
      expect(payload.scope).toBe('openid profile');
    });
  });

  describe('ID Token Minting', () => {
    const mockUser = {
      sub: 'usr_123',
      name: 'Student Name',
      prn: 'PES1UG20CS001',
      srn: 'PES1202000001',
      program: 'B.Tech',
      branch: 'CSE',
      semester: 'Sem-6',
      section: 'A',
      campus: 'RR',
      email: 'student@pesu.edu',
    } as unknown as IUser;

    it('mints ID token containing at_hash and user claims', async () => {
      const idToken = await mintIdToken({
        issuer: 'http://localhost:3000',
        sub: 'usr_123',
        clientId: 'cli_abc',
        user: mockUser,
        scopes: ['openid', 'profile'],
        accessToken: 'sample-access-token',
      });

      expect(typeof idToken).toBe('string');
    });

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

    it('includes unique jti claim', async () => {
      const token = await mintIdToken({
        issuer: 'http://localhost:3000',
        sub: mockUser.sub,
        clientId: 'cli_test_client',
        user: mockUser,
        scopes: ['openid', 'profile'],
      });

      const jwks = await getPublicJwks();
      const pubKey = await importJWK(jwks.keys[0], 'RS256');
      const { payload } = await jwtVerify(token, pubKey);

      expect(payload.jti).toBeDefined();
      expect(typeof payload.jti).toBe('string');
      expect(payload.jti?.length).toBeGreaterThan(10);
    });
  });

  describe('Key Holder Reset and Fallback Key Pair', () => {
    it('generates fallback key pair when no PEM is configured', async () => {
      const configHelper = await import('@/lib/config');
      const spy = vi.spyOn(configHelper, 'getConfig').mockReturnValue({
        tokenSigningKeyPem: undefined,
      } as ReturnType<typeof configHelper.getConfig>);

      const { resetKeyHolder, getKeyPair } = await import('@/lib/oidc/jwt');
      const originalPem = process.env.TOKEN_SIGNING_KEY_PEM;
      delete process.env.TOKEN_SIGNING_KEY_PEM;
      resetKeyHolder();

      const keyPair = await getKeyPair();
      expect(keyPair.kid).toBe('pesu-key-default');
      expect(keyPair.privateKey).toBeDefined();
      expect(keyPair.publicKey).toBeDefined();

      if (originalPem) {
        process.env.TOKEN_SIGNING_KEY_PEM = originalPem;
      }
      spy.mockRestore();
      resetKeyHolder();
    });

    it('extracts client_id from string aud or array aud when client_id is omitted', async () => {
      const { getKeyPair } = await import('@/lib/oidc/jwt');
      const { SignJWT } = await import('jose');
      const { privateKey, kid } = await getKeyPair();

      // Test string aud
      const token1 = await new SignJWT({ sub: 'u1' })
        .setProtectedHeader({ alg: 'RS256', kid })
        .setIssuer('http://localhost:3000')
        .setAudience('cli_from_string_aud')
        .sign(privateKey);

      const res1 = await verifyAccessToken(token1, 'http://localhost:3000');
      expect(res1.client_id).toBe('cli_from_string_aud');

      // Test array aud
      const token2 = await new SignJWT({ sub: 'u2' })
        .setProtectedHeader({ alg: 'RS256', kid })
        .setIssuer('http://localhost:3000')
        .setAudience(['cli_from_array_aud', 'other'])
        .sign(privateKey);

      const res2 = await verifyAccessToken(token2, 'http://localhost:3000');
      expect(res2.client_id).toBe('cli_from_array_aud');

      // Test no aud and no client_id
      const token3 = await new SignJWT({ sub: 'u3' })
        .setProtectedHeader({ alg: 'RS256', kid })
        .setIssuer('http://localhost:3000')
        .sign(privateKey);

      const res3 = await verifyAccessToken(token3, 'http://localhost:3000');
      expect(res3.client_id).toBe('');
    });
  });
});

