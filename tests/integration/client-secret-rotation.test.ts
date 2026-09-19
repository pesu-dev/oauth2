import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { setupIntegrationMongo, teardownIntegrationMongo, resetDatabase } from './setup';
import { NextRequest } from 'next/server';
import { POST as postRotateSecret } from '@/app/api/internal/portal/clients/[clientId]/rotate-secret/route';
import { POST as postRevoke } from '@/app/oauth2/revoke/route';
import { Client, RefreshToken } from '@/lib/db/models';
import { createSessionToken } from '@/lib/session/cookie';
import { hashClientSecret, sha256Hex } from '@/lib/crypto/hash';

describe('Client Secret Rotation & Live Invalidation (Integration)', () => {
  beforeAll(async () => {
    await setupIntegrationMongo();
  }, 60000);

  afterAll(async () => {
    await teardownIntegrationMongo();
  });

  beforeEach(async () => {
    await resetDatabase();
  });

  it('rotates client secret in MongoDB, immediately rejecting the old secret and accepting the new one', async () => {
    const ownerSub = 'usr_developer_rotator';
    const devCookie = await createSessionToken({ sub: ownerSub, name: 'Developer User' });

    // 1. Seed confidential client with old secret
    const oldSecret = 'old_secret_1234567890abcdef_initial';
    const initialHash = await hashClientSecret(oldSecret);

    const client = await Client.create({
      client_id: 'cli_rotatable_app',
      name: 'Rotatable App',
      owner_sub: ownerSub,
      redirect_uris: ['https://rotatable.pesu.edu/cb'],
      token_endpoint_auth_method: 'client_secret_basic',
      client_secret_hash: initialHash,
      publishing_status: 'production',
      delegated_allowed: false,
    });

    // 2. Seed an active refresh token owned by this client
    const testToken = 'rt_secret_rotation_test_token_999';
    await RefreshToken.create({
      token_hash: sha256Hex(testToken),
      family_id: 'fam_rot_1',
      client_id: client.client_id,
      sub: 'usr_student_rot',
      scopes: ['openid', 'offline_access'],
      expires_at: new Date(Date.now() + 86400 * 1000),
      created_at: new Date(),
    });

    // 3. Verify old secret works with client_secret_basic at /oauth2/revoke
    const oldBasicAuth = Buffer.from(`${client.client_id}:${oldSecret}`).toString('base64');
    const oldRevokeReq = new NextRequest('http://localhost:3000/oauth2/revoke', {
      method: 'POST',
      headers: {
        Authorization: `Basic ${oldBasicAuth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        token: testToken,
        token_type_hint: 'refresh_token',
      }).toString(),
    });
    const oldRevokeRes = await postRevoke(oldRevokeReq);
    expect(oldRevokeRes.status).toBe(200);

    // 4. Developer calls portal endpoint to rotate client secret
    const rotateReq = new NextRequest(
      `http://localhost:3000/api/internal/portal/clients/${client.client_id}/rotate-secret`,
      {
        method: 'POST',
        headers: { cookie: `pesu_session=${devCookie}` },
      }
    );
    const rotateRes = await postRotateSecret(rotateReq, {
      params: Promise.resolve({ clientId: client.client_id }),
    });
    expect(rotateRes.status).toBe(200);
    const rotateData = await rotateRes.json();
    const newSecret = rotateData.clientSecret;
    expect(newSecret).toBeDefined();
    expect(newSecret).not.toBe(oldSecret);

    // Verify hash changed in MongoDB
    const updatedClientInDb = await Client.findOne({ client_id: client.client_id });
    expect(updatedClientInDb?.client_secret_hash).not.toBe(initialHash);

    // 5. Old secret must immediately fail authentication (401 invalid_client)
    const failedOldAuthReq = new NextRequest('http://localhost:3000/oauth2/revoke', {
      method: 'POST',
      headers: {
        Authorization: `Basic ${oldBasicAuth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        token: 'any_dummy_token',
      }).toString(),
    });
    const failedOldAuthRes = await postRevoke(failedOldAuthReq);
    expect(failedOldAuthRes.status).toBe(401);
    const failedData = await failedOldAuthRes.json();
    expect(failedData.error).toBe('invalid_client');
    expect(failedData.error_description).toContain('Invalid client credentials');

    // 6. New secret must succeed authentication
    const newBasicAuth = Buffer.from(`${client.client_id}:${newSecret}`).toString('base64');
    const newAuthReq = new NextRequest('http://localhost:3000/oauth2/revoke', {
      method: 'POST',
      headers: {
        Authorization: `Basic ${newBasicAuth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        token: 'any_dummy_token',
      }).toString(),
    });
    const newAuthRes = await postRevoke(newAuthReq);
    expect(newAuthRes.status).toBe(200);
  });
});
