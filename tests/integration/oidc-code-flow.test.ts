import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { setupIntegrationMongo, teardownIntegrationMongo, resetDatabase } from './setup';
import { NextRequest } from 'next/server';
import { POST as postConsent } from '@/app/api/internal/consent/route';
import { POST as postToken } from '@/app/oauth2/token/route';
import { GET as getUserInfo } from '@/app/api/v1/userinfo/route';
import { User, Client, AuthCode, RefreshToken, Consent } from '@/lib/db/models';
import { createSessionToken } from '@/lib/session/cookie';
import crypto from 'node:crypto';

describe('OIDC Authorization Code Flow & PKCE (Integration)', () => {
  beforeAll(async () => {
    await setupIntegrationMongo();
  }, 60000);

  afterAll(async () => {
    await teardownIntegrationMongo();
  });

  beforeEach(async () => {
    await resetDatabase();
  });

  it('completes end-to-end authorization code exchange with real MongoDB persistence', async () => {
    // 1. Seed user and production client
    const user = await User.create({
      sub: 'usr_oidc_student_1',
      name: 'Integration Student',
      prn: 'PES1UG20CS999',
      srn: 'PES1202000999',
      email: 'student@pes.edu',
    });

    const client = await Client.create({
      client_id: 'cli_oidc_app',
      name: 'Campus Schedule App',
      owner_sub: 'usr_owner_1',
      redirect_uris: ['https://app.pesu.edu/callback'],
      token_endpoint_auth_method: 'none',
      publishing_status: 'production',
      delegated_allowed: false,
    });

    // 2. Prepare PKCE verifier and S256 challenge
    const verifier = 'test-pkce-verifier-string-43-chars-long-abcde';
    const challenge = crypto
      .createHash('sha256')
      .update(verifier)
      .digest('base64url');

    // 3. Authenticated session cookie
    const sessionToken = await createSessionToken({ sub: user.sub, name: user.name });

    // 4. Call /api/oidc/consent to allow application
    const consentReq = new NextRequest('http://localhost:3000/api/oidc/consent', {
      method: 'POST',
      headers: {
        cookie: `pesu_session=${sessionToken}`,
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
        state: 'random-state-123',
      }),
    });

    const consentRes = await postConsent(consentReq);
    expect(consentRes.status).toBe(200);
    const consentData = await consentRes.json();
    expect(consentData.redirectTo).toContain('https://app.pesu.edu/callback?code=code_');

    const redirectUrl = new URL(consentData.redirectTo);
    const rawCode = redirectUrl.searchParams.get('code');
    expect(rawCode).toBeTruthy();

    // Verify Consent document in MongoDB
    const consentDoc = await Consent.findOne({ sub: user.sub, client_id: client.client_id });
    expect(consentDoc).not.toBeNull();
    expect(consentDoc?.mode).toBe('identity');

    // Verify AuthCode document exists in real MongoDB
    const authCodeCount = await AuthCode.countDocuments({ client_id: client.client_id });
    expect(authCodeCount).toBe(1);

    // 5. Exchange code at /token with matching PKCE verifier
    const tokenParams = new URLSearchParams();
    tokenParams.set('grant_type', 'authorization_code');
    tokenParams.set('client_id', client.client_id);
    tokenParams.set('code', rawCode!);
    tokenParams.set('redirect_uri', 'https://app.pesu.edu/callback');
    tokenParams.set('code_verifier', verifier);

    const tokenReq = new Request('http://localhost:3000/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: tokenParams.toString(),
    });

    const tokenRes = await postToken(tokenReq);
    expect(tokenRes.status).toBe(200);
    const tokens = await tokenRes.json();
    expect(tokens.access_token).toBeDefined();
    expect(tokens.id_token).toBeDefined();
    expect(tokens.refresh_token).toBeDefined();
    expect(tokens.token_type).toBe('Bearer');

    // Verify AuthCode document was consumed and deleted from MongoDB
    const remainingCodes = await AuthCode.countDocuments({ client_id: client.client_id });
    expect(remainingCodes).toBe(0);

    // Verify RefreshToken document stored in MongoDB
    const refreshDoc = await RefreshToken.findOne({ client_id: client.client_id, sub: user.sub });
    expect(refreshDoc).not.toBeNull();
    expect(refreshDoc?.family_id).toBeDefined();
    expect(refreshDoc?.revoked_at).toBeNull();

    // 6. Access /userinfo with the issued access token
    const userInfoReq = new NextRequest('http://localhost:3000/userinfo', {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });

    const userInfoRes = await getUserInfo(userInfoReq);
    expect(userInfoRes.status).toBe(200);
    const userinfo = await userInfoRes.json();
    expect(userinfo.sub).toBe(user.sub);
    expect(userinfo.name).toBe('Integration Student');
    expect(userinfo.prn).toBe('PES1UG20CS999');

    // 7. Security: Replay attack with the same code must fail with 400 invalid_grant
    const replayRes = await postToken(
      new Request('http://localhost:3000/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: tokenParams.toString(),
      })
    );
    expect(replayRes.status).toBe(400);
    const replayData = await replayRes.json();
    expect(replayData.error).toBe('invalid_grant');
    expect(replayData.error_description).toBe('Authorization code is invalid or expired');
  });

  it('rejects code exchange when PKCE verifier does not match challenge', async () => {
    const client = await Client.create({
      client_id: 'cli_pkce_fail',
      name: 'PKCE Fail App',
      owner_sub: 'usr_owner_1',
      redirect_uris: ['https://app.pesu.edu/callback'],
      token_endpoint_auth_method: 'none',
      publishing_status: 'production',
    });

    const verifier = 'correct-verifier-string-43-chars-long-1234567';
    const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');

    const sessionToken = await createSessionToken({ sub: 'usr_student_pkce' });

    const consentRes = await postConsent(
      new NextRequest('http://localhost:3000/api/oidc/consent', {
        method: 'POST',
        headers: {
          cookie: `pesu_session=${sessionToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          clientId: client.client_id,
          redirectUri: 'https://app.pesu.edu/callback',
          action: 'allow',
          codeChallenge: challenge,
          codeChallengeMethod: 'S256',
        }),
      })
    );

    const redirectUrl = new URL((await consentRes.json()).redirectTo);
    const rawCode = redirectUrl.searchParams.get('code');

    // Attempt exchange with mismatched verifier
    const tokenParams = new URLSearchParams();
    tokenParams.set('grant_type', 'authorization_code');
    tokenParams.set('client_id', client.client_id);
    tokenParams.set('code', rawCode!);
    tokenParams.set('redirect_uri', 'https://app.pesu.edu/callback');
    tokenParams.set('code_verifier', 'wrong-verifier-string-43-chars-long-12345678');

    const tokenRes = await postToken(
      new Request('http://localhost:3000/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: tokenParams.toString(),
      })
    );

    expect(tokenRes.status).toBe(400);
    const data = await tokenRes.json();
    expect(data.error).toBe('invalid_grant');
    expect(data.error_description).toBe('PKCE verification failed');

    // Ensure code was deleted upon failed attempt to prevent brute force
    const codeCount = await AuthCode.countDocuments({ client_id: client.client_id });
    expect(codeCount).toBe(0);
  });
});
