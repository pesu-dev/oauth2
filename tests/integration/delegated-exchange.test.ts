import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { setupIntegrationMongo, teardownIntegrationMongo, resetDatabase } from './setup';
import { NextRequest } from 'next/server';
import { POST as postConsent } from '@/app/api/oidc/consent/route';
import { POST as postToken } from '@/app/token/route';
import { POST as postTokenExchange } from '@/app/oauth/token-exchange/route';
import { User, Client, Vault } from '@/lib/db/models';
import { createSessionToken } from '@/lib/session/cookie';
import { pendingCredentialStore } from '@/lib/session/pending-credentials';
import crypto from 'node:crypto';

describe('Delegated Credential Vault & Token Exchange (Integration)', () => {
  beforeAll(async () => {
    process.env.FIRST_PARTY_API_CLIENT_ID = 'cli_delegated_service';
    await setupIntegrationMongo();
  }, 60000);

  afterAll(async () => {
    await teardownIntegrationMongo();
  });

  beforeEach(async () => {
    await resetDatabase();
  });

  it('stores sealed vault credentials on delegated consent and unseals session in token exchange', async () => {
    const user = await User.create({
      sub: 'usr_deleg_user_1',
      name: 'Delegated Student',
      prn: 'PES1UG20CS888',
      srn: 'PES1202000888',
    });

    const delegatedClient = await Client.create({
      client_id: 'cli_delegated_service',
      name: 'PESU Academy Sync Service',
      owner_sub: 'usr_owner_1',
      redirect_uris: ['https://service.pesu.edu/cb'],
      token_endpoint_auth_method: 'none',
      publishing_status: 'production',
      delegated_allowed: true,
    });

    const sessionToken = await createSessionToken({ sub: user.sub, name: user.name });

    // Store ephemeral pending credentials
    const credId = pendingCredentialStore.put({
      username: user.prn,
      password: 'super_secret_raw_password_123',
      sessionToken: 'academy_session_token_xyz_999',
      accessToken: 'acc_token_123',
      userId: 'u_12345',
    });

    const pendingCookieToken = await createSessionToken({ sub: user.sub, cred_id: credId }, 600);

    const verifier = 'test-verifier-for-delegated-flow-43-chars-long';
    const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');

    // 1. Submit delegated consent
    const consentReq = new NextRequest('http://localhost:3000/api/oidc/consent', {
      method: 'POST',
      headers: {
        cookie: `pesu_session=${sessionToken}; pesu_pending=${pendingCookieToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        clientId: delegatedClient.client_id,
        redirectUri: 'https://service.pesu.edu/cb',
        action: 'allow',
        mode: 'delegated',
        codeChallenge: challenge,
        codeChallengeMethod: 'S256',
      }),
    });

    const consentRes = await postConsent(consentReq);
    expect(consentRes.status).toBe(200);
    const consentData = await consentRes.json();
    const rawCode = new URL(consentData.redirectTo).searchParams.get('code');

    // 2. Verify Vault document in real MongoDB: must be encrypted, no raw passwords!
    const vaultDoc = await Vault.findOne({ sub: user.sub });
    expect(vaultDoc).not.toBeNull();
    expect(vaultDoc?.key_version).toBe(1);
    expect(vaultDoc?.ciphertext).toBeDefined();
    expect(vaultDoc?.ciphertext.toString('utf-8')).not.toContain('super_secret_raw_password_123');
    expect(vaultDoc?.nonce).toBeDefined();
    expect(vaultDoc?.wrapped_dek).toBeDefined();

    // 3. Exchange authorization code for delegated access token
    const tokenParams = new URLSearchParams();
    tokenParams.set('grant_type', 'authorization_code');
    tokenParams.set('client_id', delegatedClient.client_id);
    tokenParams.set('code', rawCode!);
    tokenParams.set('redirect_uri', 'https://service.pesu.edu/cb');
    tokenParams.set('code_verifier', verifier);

    const tokenRes = await postToken(
      new Request('http://localhost:3000/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: tokenParams.toString(),
      })
    );

    expect(tokenRes.status).toBe(200);
    const tokens = await tokenRes.json();
    const accessToken = tokens.access_token;
    expect(accessToken).toBeDefined();

    // 4. Token Exchange: Call /oauth/token-exchange with token exchange secret
    const exchangeReq = new NextRequest('http://localhost:3000/oauth/token-exchange', {
      method: 'POST',
      headers: {
        'X-Token-Exchange-Secret': process.env.TOKEN_EXCHANGE_SECRET!,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ access_token: accessToken }),
    });

    const exchangeRes = await postTokenExchange(exchangeReq);
    expect(exchangeRes.status).toBe(200);
    const exchangeData = await exchangeRes.json();
    // Unsealed session token from vault
    expect(exchangeData.token).toBe('academy_session_token_xyz_999');
    expect(exchangeData.password).toBeUndefined(); // Never returns raw password
  });

  it('leaves vault completely empty on identity-only consent flow', async () => {
    const user = await User.create({
      sub: 'usr_identity_only_1',
      name: 'Identity Student',
      prn: 'PES1UG20CS111',
      srn: 'PES1202000111',
    });

    const identityClient = await Client.create({
      client_id: 'cli_identity_only',
      name: 'Identity Only App',
      owner_sub: 'usr_owner_1',
      redirect_uris: ['https://id.pesu.edu/cb'],
      token_endpoint_auth_method: 'none',
      publishing_status: 'production',
      delegated_allowed: false,
    });

    const sessionToken = await createSessionToken({ sub: user.sub, name: user.name });
    const verifier = 'test-verifier-identity-only-flow-43-chars-long';
    const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');

    const consentReq = new NextRequest('http://localhost:3000/api/oidc/consent', {
      method: 'POST',
      headers: {
        cookie: `pesu_session=${sessionToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        clientId: identityClient.client_id,
        redirectUri: 'https://id.pesu.edu/cb',
        action: 'allow',
        mode: 'identity',
        codeChallenge: challenge,
        codeChallengeMethod: 'S256',
      }),
    });

    const consentRes = await postConsent(consentReq);
    expect(consentRes.status).toBe(200);

    // Vault in MongoDB must have 0 documents
    const vaultCount = await Vault.countDocuments({});
    expect(vaultCount).toBe(0);
  });

  it('rejects token exchange with invalid or missing secret', async () => {
    const exchangeReq = new NextRequest('http://localhost:3000/oauth/token-exchange', {
      method: 'POST',
      headers: {
        'X-Token-Exchange-Secret': 'wrong-secret',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ access_token: 'some_access_token' }),
    });

    const exchangeRes = await postTokenExchange(exchangeReq);
    expect(exchangeRes.status).toBe(401);
  });
});
