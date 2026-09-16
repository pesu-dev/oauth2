import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { setupIntegrationMongo, teardownIntegrationMongo, resetDatabase } from './setup';
import { User, Client, Consent, AuthCode, RefreshToken } from '@/lib/db/models';

describe('MongoDB Real Indexes and Uniqueness Constraints', () => {
  beforeAll(async () => {
    await setupIntegrationMongo();
  }, 60000);

  afterAll(async () => {
    await teardownIntegrationMongo();
  });

  beforeEach(async () => {
    await resetDatabase();
  });

  it('enforces unique sub on users collection', async () => {
    await User.create({
      sub: 'usr_unique_1',
      name: 'User 1',
      prn: 'PES1UG20CS001',
      srn: 'PES1202000001',
    });

    let error: unknown = null;
    try {
      await User.create({
        sub: 'usr_unique_1',
        name: 'User 2',
        prn: 'PES1UG20CS002',
        srn: 'PES1202000002',
      });
    } catch (err) {
      error = err;
    }

    expect(error).toBeDefined();
    // Real Mongo E11000 duplicate key error
    expect((error as { code?: number }).code).toBe(11000);
  });

  it('enforces unique client_id on clients collection', async () => {
    await Client.create({
      client_id: 'cli_dup_test',
      name: 'Client 1',
      owner_sub: 'usr_owner_1',
      redirect_uris: ['https://app1.pesu.edu/cb'],
      token_endpoint_auth_method: 'none',
      publishing_status: 'testing',
    });

    let error: unknown = null;
    try {
      await Client.create({
        client_id: 'cli_dup_test',
        name: 'Client 2',
        owner_sub: 'usr_owner_2',
        redirect_uris: ['https://app2.pesu.edu/cb'],
        token_endpoint_auth_method: 'none',
        publishing_status: 'testing',
      });
    } catch (err) {
      error = err;
    }

    expect(error).toBeDefined();
    expect((error as { code?: number }).code).toBe(11000);
  });

  it('enforces compound uniqueness on (sub, client_id) in consents collection', async () => {
    await Consent.create({
      sub: 'usr_student_1',
      client_id: 'cli_target_1',
      scopes: ['openid'],
      mode: 'identity',
      granted_at: new Date(),
    });

    let error: unknown = null;
    try {
      await Consent.create({
        sub: 'usr_student_1',
        client_id: 'cli_target_1',
        scopes: ['openid', 'profile'],
        mode: 'identity',
        granted_at: new Date(),
      });
    } catch (err) {
      error = err;
    }

    expect(error).toBeDefined();
    expect((error as { code?: number }).code).toBe(11000);
  });

  it('verifies TTL indexes exist on auth_codes and refresh_tokens', async () => {
    const authCodeIndexes = await AuthCode.collection.indexes();
    const ttlIndex = authCodeIndexes.find(
      (idx) => idx.key && 'created_at' in idx.key && typeof idx.expireAfterSeconds === 'number'
    );
    expect(ttlIndex).toBeDefined();
    expect(ttlIndex?.expireAfterSeconds).toBe(600);

    const refreshTokenIndexes = await RefreshToken.collection.indexes();
    const familyIndex = refreshTokenIndexes.find(
      (idx) => idx.key && 'family_id' in idx.key
    );
    expect(familyIndex).toBeDefined();
  });
});
