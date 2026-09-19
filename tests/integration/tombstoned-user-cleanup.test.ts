import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { setupIntegrationMongo, teardownIntegrationMongo, resetDatabase } from './setup';
import { NextRequest } from 'next/server';
import { POST as postConsent } from '@/app/api/internal/consent/route';
import { POST as postToken } from '@/app/oauth2/token/route';
import { GET as getUserInfo } from '@/app/api/v1/userinfo/route';
import { DELETE as deleteSettings } from '@/app/api/internal/settings/route';
import { User, Client, RefreshToken, Consent, Vault } from '@/lib/db/models';
import { createSessionToken } from '@/lib/session/cookie';
import crypto from 'node:crypto';

describe('Tombstoned User & Account Deletion Protocol Invalidation (Integration)', () => {
  beforeAll(async () => {
    await setupIntegrationMongo();
  }, 60000);

  afterAll(async () => {
    await teardownIntegrationMongo();
  });

  beforeEach(async () => {
    await resetDatabase();
  });

  it('tombstones user in MongoDB and immediately invalidates active access and refresh tokens across all endpoints', async () => {
    // 1. Seed user and production client
    const user = await User.create({
      sub: 'usr_tombstone_target',
      name: 'Tombstone Student',
      prn: 'PES1UG20CS666',
      srn: 'PES1202000666',
      email: 'tombstone@pesu.edu',
    });
    const sessionCookie = await createSessionToken({ sub: user.sub, name: user.name });

    const client = await Client.create({
      client_id: 'cli_tombstone_app',
      name: 'Tombstone Verification App',
      owner_sub: 'usr_dev_tomb',
      redirect_uris: ['https://app.pesu.edu/callback'],
      token_endpoint_auth_method: 'none',
      publishing_status: 'production',
      delegated_allowed: false,
    });

    const verifier = 'test-pkce-verifier-for-tombstone-cleanup-flow-12345';
    const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');

    // 2. Authorize client and generate tokens
    const consentReq = new NextRequest('http://localhost:3000/api/oidc/consent', {
      method: 'POST',
      headers: {
        cookie: `pesu_session=${sessionCookie}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        clientId: client.client_id,
        redirectUri: 'https://app.pesu.edu/callback',
        action: 'allow',
        mode: 'identity',
        scope: 'openid profile email offline_access',
        codeChallenge: challenge,
        codeChallengeMethod: 'S256',
      }),
    });
    const consentRes = await postConsent(consentReq);
    expect(consentRes.status).toBe(200);
    const consentData = await consentRes.json();
    const rawCode = new URL(consentData.redirectTo).searchParams.get('code')!;

    const exchangeReq = new NextRequest('http://localhost:3000/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: client.client_id,
        grant_type: 'authorization_code',
        code: rawCode,
        redirect_uri: 'https://app.pesu.edu/callback',
        code_verifier: verifier,
      }).toString(),
    });
    const exchangeRes = await postToken(exchangeReq);
    expect(exchangeRes.status).toBe(200);
    const tokens = await exchangeRes.json();
    const activeAccessToken = tokens.access_token;
    const activeRefreshToken = tokens.refresh_token;
    expect(activeAccessToken).toBeDefined();
    expect(activeRefreshToken).toBeDefined();

    // 3. Verify access token works at /api/v1/userinfo prior to account deletion
    const preUserInfoReq = new NextRequest('http://localhost:3000/api/v1/userinfo', {
      headers: { Authorization: `Bearer ${activeAccessToken}` },
    });
    const preUserInfoRes = await getUserInfo(preUserInfoReq);
    expect(preUserInfoRes.status).toBe(200);
    const userInfoData = await preUserInfoRes.json();
    expect(userInfoData.sub).toBe(user.sub);
    expect(userInfoData.email).toBe('tombstone@pesu.edu');

    // 4. User performs account deletion: DELETE /api/internal/settings?action=account&confirm=DELETE
    const deleteAccountReq = new NextRequest(
      'http://localhost:3000/api/internal/settings?action=account&confirm=DELETE',
      {
        method: 'DELETE',
        headers: { cookie: `pesu_session=${sessionCookie}` },
      }
    );
    const deleteAccountRes = await deleteSettings(deleteAccountReq);
    expect(deleteAccountRes.status).toBe(200);
    const deleteData = await deleteAccountRes.json();
    expect(deleteData.success).toBe(true);

    // 5. Inspect database state directly in MongoDB
    const tombstonedUser = await User.findOne({ sub: user.sub });
    expect(tombstonedUser?.deleted_at).toBeInstanceOf(Date);

    const revokedToken = await RefreshToken.findOne({ sub: user.sub });
    expect(revokedToken?.revoked_at).toBeInstanceOf(Date);

    const remainingConsents = await Consent.countDocuments({ sub: user.sub });
    expect(remainingConsents).toBe(0);

    const remainingVault = await Vault.countDocuments({ sub: user.sub });
    expect(remainingVault).toBe(0);

    // 6. Access token is rejected at /api/v1/userinfo (401 invalid_token: User not found)
    const postUserInfoReq = new NextRequest('http://localhost:3000/api/v1/userinfo', {
      headers: { Authorization: `Bearer ${activeAccessToken}` },
    });
    const postUserInfoRes = await getUserInfo(postUserInfoReq);
    expect(postUserInfoRes.status).toBe(401);
    const postUserInfoData = await postUserInfoRes.json();
    expect(postUserInfoData.error).toBe('invalid_token');
    expect(postUserInfoData.error_description).toContain('User not found');

    // 7. Refresh token grant is rejected at /oauth2/token
    const postRefreshReq = new NextRequest('http://localhost:3000/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: client.client_id,
        grant_type: 'refresh_token',
        refresh_token: activeRefreshToken,
      }).toString(),
    });
    const postRefreshRes = await postToken(postRefreshReq);
    expect(postRefreshRes.status).toBe(400);
    const postRefreshData = await postRefreshRes.json();
    expect(postRefreshData.error).toBe('invalid_grant');
  });
});
