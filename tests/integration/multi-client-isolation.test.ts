import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { setupIntegrationMongo, teardownIntegrationMongo, resetDatabase } from './setup';
import { NextRequest } from 'next/server';
import { POST as postConsent } from '@/app/api/internal/consent/route';
import { POST as postToken } from '@/app/oauth2/token/route';
import { POST as postRevoke } from '@/app/oauth2/revoke/route';
import { GET as getPortalClient } from '@/app/api/internal/portal/clients/[clientId]/route';
import { User, Client, RefreshToken } from '@/lib/db/models';
import { createSessionToken } from '@/lib/session/cookie';
import { hashClientSecret } from '@/lib/crypto/hash';
import crypto from 'node:crypto';

describe('Multi-Client & Cross-Tenant Isolation (Integration)', () => {
  beforeAll(async () => {
    await setupIntegrationMongo();
  }, 60000);

  afterAll(async () => {
    await teardownIntegrationMongo();
  });

  beforeEach(async () => {
    await resetDatabase();
  });

  it('prevents cross-client authorization code and refresh token theft, and protects tenant resources', async () => {
    // 1. Seed two distinct developers and a student user
    const devAlphaCookie = await createSessionToken({ sub: 'usr_dev_alice', name: 'Alice Dev' });
    const devBetaCookie = await createSessionToken({ sub: 'usr_dev_bob', name: 'Bob Dev' });

    const student = await User.create({
      sub: 'usr_student_cross',
      name: 'Cross Student',
      prn: 'PES1UG20CS202',
      srn: 'PES1202000202',
      email: 'student@pesu.edu',
    });
    const studentCookie = await createSessionToken({ sub: student.sub, name: student.name });

    // 2. Seed Client Alpha (Confidential) and Client Beta (Confidential)
    const secretAlpha = 'secret_alpha_super_random_1234567890';
    const clientAlpha = await Client.create({
      client_id: 'cli_alpha_app',
      name: 'Alpha App',
      owner_sub: 'usr_dev_alice',
      redirect_uris: ['https://alpha.pesu.edu/callback'],
      token_endpoint_auth_method: 'client_secret_basic',
      client_secret_hash: await hashClientSecret(secretAlpha),
      publishing_status: 'production',
      delegated_allowed: false,
    });

    const secretBeta = 'secret_beta_super_random_0987654321';
    const clientBeta = await Client.create({
      client_id: 'cli_beta_app',
      name: 'Beta App',
      owner_sub: 'usr_dev_bob',
      redirect_uris: ['https://beta.pesu.edu/callback'],
      token_endpoint_auth_method: 'client_secret_basic',
      client_secret_hash: await hashClientSecret(secretBeta),
      publishing_status: 'production',
      delegated_allowed: false,
    });

    // 3. User authorizes Client Alpha
    const verifier = 'test-pkce-verifier-for-alpha-isolation-43-chars-long';
    const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');

    const consentReq = new NextRequest('http://localhost:3000/api/oidc/consent', {
      method: 'POST',
      headers: {
        cookie: `pesu_session=${studentCookie}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        clientId: clientAlpha.client_id,
        redirectUri: 'https://alpha.pesu.edu/callback',
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
    const alphaCode = new URL(consentData.redirectTo).searchParams.get('code')!;
    expect(alphaCode).toBeTruthy();

    // 4. Attack 1: Client Beta attempts to exchange Client Alpha's code
    const betaBasicAuth = Buffer.from(`${clientBeta.client_id}:${secretBeta}`).toString('base64');
    const attackExchangeReq = new NextRequest('http://localhost:3000/oauth2/token', {
      method: 'POST',
      headers: {
        Authorization: `Basic ${betaBasicAuth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: alphaCode,
        redirect_uri: 'https://alpha.pesu.edu/callback',
        code_verifier: verifier,
      }).toString(),
    });
    const attackExchangeRes = await postToken(attackExchangeReq);
    expect(attackExchangeRes.status).toBe(400);
    const attackExchangeData = await attackExchangeRes.json();
    expect(attackExchangeData.error).toBe('invalid_grant');
    expect(attackExchangeData.error_description).toContain('different client');

    // 5. Legitimate exchange by Client Alpha: issue fresh authorization code for alpha
    const legitConsentReq = new NextRequest('http://localhost:3000/api/oidc/consent', {
      method: 'POST',
      headers: {
        cookie: `pesu_session=${studentCookie}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        clientId: clientAlpha.client_id,
        redirectUri: 'https://alpha.pesu.edu/callback',
        action: 'allow',
        mode: 'identity',
        scope: 'openid profile offline_access',
        codeChallenge: challenge,
        codeChallengeMethod: 'S256',
      }),
    });
    const legitConsentRes = await postConsent(legitConsentReq);
    expect(legitConsentRes.status).toBe(200);
    const legitConsentData = await legitConsentRes.json();
    const legitAlphaCode = new URL(legitConsentData.redirectTo).searchParams.get('code')!;

    const alphaBasicAuth = Buffer.from(`${clientAlpha.client_id}:${secretAlpha}`).toString('base64');
    const legitExchangeReq = new NextRequest('http://localhost:3000/oauth2/token', {
      method: 'POST',
      headers: {
        Authorization: `Basic ${alphaBasicAuth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: legitAlphaCode,
        redirect_uri: 'https://alpha.pesu.edu/callback',
        code_verifier: verifier,
      }).toString(),
    });
    const legitExchangeRes = await postToken(legitExchangeReq);
    expect(legitExchangeRes.status).toBe(200);
    const legitTokenData = await legitExchangeRes.json();
    const alphaRefreshToken = legitTokenData.refresh_token;
    expect(alphaRefreshToken).toBeTruthy();

    // 6. Attack 2: Client Beta attempts to revoke Client Alpha's refresh token
    const attackRevokeReq = new NextRequest('http://localhost:3000/oauth2/revoke', {
      method: 'POST',
      headers: {
        Authorization: `Basic ${betaBasicAuth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        token: alphaRefreshToken,
        token_type_hint: 'refresh_token',
      }).toString(),
    });
    const attackRevokeRes = await postRevoke(attackRevokeReq);
    // RFC 7009 returns 200 without leaking, but MUST NOT revoke unowned tokens
    expect(attackRevokeRes.status).toBe(200);

    // Verify token was NOT revoked in MongoDB
    const liveTokenInDb = await RefreshToken.findOne({ client_id: clientAlpha.client_id });
    expect(liveTokenInDb?.revoked_at).toBeNull();

    // 7. Attack 3: Client Beta attempts to refresh Client Alpha's refresh token
    const attackRefreshReq = new NextRequest('http://localhost:3000/oauth2/token', {
      method: 'POST',
      headers: {
        Authorization: `Basic ${betaBasicAuth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: alphaRefreshToken,
      }).toString(),
    });
    const attackRefreshRes = await postToken(attackRefreshReq);
    expect(attackRefreshRes.status).toBe(400);
    const attackRefreshData = await attackRefreshRes.json();
    expect(attackRefreshData.error).toBe('invalid_grant');
    expect(attackRefreshData.error_description).toContain('different client');

    // Token theft compromise defense: the entire token family was revoked in MongoDB!
    const revokedTokenInDb = await RefreshToken.findOne({ client_id: clientAlpha.client_id });
    expect(revokedTokenInDb?.revoked_at).not.toBeNull();

    // 8. Replay attempt: Client Alpha can no longer use the compromised token
    const compromisedRefreshReq = new NextRequest('http://localhost:3000/oauth2/token', {
      method: 'POST',
      headers: {
        Authorization: `Basic ${alphaBasicAuth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: alphaRefreshToken,
      }).toString(),
    });
    const compromisedRefreshRes = await postToken(compromisedRefreshReq);
    expect(compromisedRefreshRes.status).toBe(400);
    const compromisedData = await compromisedRefreshRes.json();
    expect(compromisedData.error).toBe('invalid_grant');
    expect(compromisedData.error_description).toContain('reuse detected');

    // 9. Attack 4: Bob attempts to read Alice's client portal details
    const portalAttackReq = new NextRequest(`http://localhost:3000/api/internal/portal/clients/${clientAlpha.client_id}`, {
      headers: { cookie: `pesu_session=${devBetaCookie}` },
    });
    const portalAttackRes = await getPortalClient(portalAttackReq, {
      params: Promise.resolve({ clientId: clientAlpha.client_id }),
    });
    expect(portalAttackRes.status).toBe(404); // Client not found for this developer

    // Legitimate owner Alice can access her own client details
    const aliceReq = new NextRequest(`http://localhost:3000/api/internal/portal/clients/${clientAlpha.client_id}`, {
      headers: { cookie: `pesu_session=${devAlphaCookie}` },
    });
    const aliceRes = await getPortalClient(aliceReq, {
      params: Promise.resolve({ clientId: clientAlpha.client_id }),
    });
    expect(aliceRes.status).toBe(200);
  });
});
