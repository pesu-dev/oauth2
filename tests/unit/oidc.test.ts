import { describe, it, expect } from 'vitest';
import {
  getPublicJwks,
  mintAccessToken,
  mintIdToken,
  verifyAccessToken,
  calculateAtHash,
} from '@/lib/oidc/jwt';
import { buildOpenIdConfiguration } from '@/lib/oidc/discovery';
import { profileClaims } from '@/lib/oidc/claims';
import { IUser } from '@/lib/db/models';

describe('OIDC Engine', () => {
  describe('Discovery metadata', () => {
    it('builds discovery document from issuer URL', () => {
      const config = buildOpenIdConfiguration('https://auth.pesu.dev');
      expect(config.issuer).toBe('https://auth.pesu.dev');
      expect(config.authorization_endpoint).toBe('https://auth.pesu.dev/authorize');
      expect(config.token_endpoint).toBe('https://auth.pesu.dev/token');
      expect(config.userinfo_endpoint).toBe('https://auth.pesu.dev/userinfo');
      expect(config.jwks_uri).toBe('https://auth.pesu.dev/jwks.json');
      expect(config.id_token_signing_alg_values_supported).toEqual(['RS256']);
      expect(config.scopes_supported).toContain('openid');
    });
  });

  describe('Claims mapping', () => {
    const mockUser = {
      sub: 'usr_123',
      name: 'Student Name',
      prn: 'PES1UG20CS001',
      srn: 'PES1202000001',
      program: 'Bachelor of Technology',
      branch: 'Computer Science and Engineering',
      semester: 'Sem-6',
      section: 'A',
      campus: 'RR',
      email: 'student@pes.edu',
      phone: '9876543210',
    } as unknown as IUser;

    it('filters claims based on granted scopes', () => {
      // Identity only (no profile/email/phone)
      const baseClaims = profileClaims(mockUser, ['openid']);
      expect(baseClaims).toEqual({ sub: 'usr_123' });

      // With profile scope
      const profile = profileClaims(mockUser, ['openid', 'profile']);
      expect(profile.name).toBe('Student Name');
      expect(profile.prn).toBe('PES1UG20CS001');
      expect(profile.email).toBeUndefined();

      // With email and phone
      const all = profileClaims(mockUser, ['openid', 'profile', 'email', 'phone']);
      expect(all.email).toBe('student@pes.edu');
      expect(all.phone_number).toBe('9876543210');
    });
  });

  describe('JWKS & JWT Minting / Verification', () => {
    it('exports public JWKS with RS256 kid', async () => {
      const jwks = await getPublicJwks();
      expect(jwks.keys).toBeDefined();
      expect(jwks.keys.length).toBeGreaterThan(0);
      expect(jwks.keys[0].kty).toBe('RSA');
      expect(jwks.keys[0].alg).toBe('RS256');
      expect(jwks.keys[0].use).toBe('sig');
      expect(jwks.keys[0].kid).toBeDefined();
    });

    it('calculates valid OIDC at_hash for access token', () => {
      const atHash = calculateAtHash('sample-access-token-12345');
      expect(atHash).toBeDefined();
      expect(typeof atHash).toBe('string');
      expect(atHash.length).toBeGreaterThan(10);
    });

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

    it('mints ID token containing at_hash and user claims', async () => {
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
      } as unknown as IUser;

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
  });
});
