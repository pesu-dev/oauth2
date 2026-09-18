import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { setupIntegrationMongo, teardownIntegrationMongo, resetDatabase } from './setup';
import { NextRequest } from 'next/server';
import { POST as postConsent } from '@/app/api/internal/consent/route';
import { POST as postToken } from '@/app/oauth2/token/route';
import { User, Client, RefreshToken } from '@/lib/db/models';
import { createSessionToken } from '@/lib/session/cookie';
import crypto from 'node:crypto';

describe('Concurrency & Race Conditions Defense (Integration)', () => {
  beforeAll(async () => {
    await setupIntegrationMongo();
  }, 60000);

  afterAll(async () => {
    await teardownIntegrationMongo();
  });

  beforeEach(async () => {
    await resetDatabase();
  });

  it('guarantees atomic single-use authorization code exchange when requested simultaneously', async () => {
    const user = await User.create({
      sub: 'usr_race_student',
      name: 'Race Student',
      prn: 'PES1UG20CS303',
      srn: 'PES1202000303',
      email: 'student@pesu.edu',
    });
    const userCookie = await createSessionToken({ sub: user.sub, name: user.name });

    const client = await Client.create({
      client_id: 'cli_race_app',
      name: 'Race App',
      owner_sub: 'usr_dev_race',
      redirect_uris: ['https://race.pesu.edu/callback'],
      token_endpoint_auth_method: 'none',
      publishing_status: 'production',
      delegated_allowed: false,
    });

    const verifier = 'test-pkce-verifier-for-concurrency-race-test-43chars';
    const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');

    // Issue authorization code
    const consentReq = new NextRequest('http://localhost:3000/api/oidc/consent', {
      method: 'POST',
      headers: {
        cookie: `pesu_session=${userCookie}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        clientId: client.client_id,
        redirectUri: 'https://race.pesu.edu/callback',
        action: 'allow',
        mode: 'identity',
        scope: 'openid profile offline_access',
        codeChallenge: challenge,
        codeChallengeMethod: 'S256',
      }),
    });
    const consentRes = await postConsent(consentReq);
    expect(consentRes.status).toBe(200);
    const consentData = await consentRes.json();
    const rawCode = new URL(consentData.redirectTo).searchParams.get('code')!;

    // Create 2 identical requests with the same code
    const makeExchangeReq = () =>
      new NextRequest('http://localhost:3000/oauth2/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: client.client_id,
          grant_type: 'authorization_code',
          code: rawCode,
          redirect_uri: 'https://race.pesu.edu/callback',
          code_verifier: verifier,
        }).toString(),
      });

    // Fire both simultaneously against MongoDB
    const [res1, res2] = await Promise.all([
      postToken(makeExchangeReq()),
      postToken(makeExchangeReq()),
    ]);

    const statuses = [res1.status, res2.status].sort();
    // Exactly one 200 and one 400
    expect(statuses).toEqual([200, 400]);

    const successRes = res1.status === 200 ? res1 : res2;
    const failRes = res1.status === 400 ? res1 : res2;

    const successData = await successRes.json();
    expect(successData.access_token).toBeDefined();
    expect(successData.refresh_token).toBeDefined();

    const failData = await failRes.json();
    expect(failData.error).toBe('invalid_grant');
    expect(failData.error_description).toContain('invalid or expired');

    // A 3rd request also fails
    const res3 = await postToken(makeExchangeReq());
    expect(res3.status).toBe(400);
  });

  it('guarantees atomic CAS on concurrent refresh token exchange', async () => {
    const user = await User.create({
      sub: 'usr_refresh_race',
      name: 'Refresh Race Student',
      prn: 'PES1UG20CS304',
      srn: 'PES1202000304',
      email: 'student2@pesu.edu',
    });

    const client = await Client.create({
      client_id: 'cli_refresh_race_app',
      name: 'Refresh Race App',
      owner_sub: 'usr_dev_race_2',
      redirect_uris: ['https://race2.pesu.edu/callback'],
      token_endpoint_auth_method: 'none',
      publishing_status: 'production',
      delegated_allowed: false,
    });

    const rawRt = 'rt_concurrency_initial_token_1234567890';
    const rawRtHash = crypto.createHash('sha256').update(rawRt).digest('hex');

    await RefreshToken.create({
      token_hash: rawRtHash,
      family_id: 'fam_race_test_1',
      client_id: client.client_id,
      sub: user.sub,
      scopes: ['openid', 'profile', 'offline_access'],
      expires_at: new Date(Date.now() + 86400 * 1000),
      created_at: new Date(),
    });

    const makeRefreshReq = () =>
      new NextRequest('http://localhost:3000/oauth2/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: client.client_id,
          grant_type: 'refresh_token',
          refresh_token: rawRt,
        }).toString(),
      });

    // Fire 2 simultaneous refresh requests
    const [res1, res2] = await Promise.all([
      postToken(makeRefreshReq()),
      postToken(makeRefreshReq()),
    ]);

    // When concurrent refresh race occurs, the server detects the race and revokes the family
    // Both requests or at least one is denied with invalid_grant, and no unrevoked tokens remain
    const statuses = [res1.status, res2.status];
    expect(statuses).toContain(400);

    // Verify all tokens in the family are completely revoked in MongoDB
    const liveTokens = await RefreshToken.countDocuments({
      family_id: 'fam_race_test_1',
      revoked_at: null,
    });
    expect(liveTokens).toBe(0);
  });
});
