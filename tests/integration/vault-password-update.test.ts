import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { setupIntegrationMongo, teardownIntegrationMongo, resetDatabase } from './setup';
import { NextRequest } from 'next/server';
import { POST as postConsent } from '@/app/api/internal/consent/route';
import { POST as postToken } from '@/app/oauth2/token/route';
import { POST as postTokenExchange } from '@/app/oauth2/token-exchange/route';
import { PATCH as patchSettings } from '@/app/api/internal/settings/route';
import { User, Client, Vault } from '@/lib/db/models';
import { createSessionToken } from '@/lib/session/cookie';
import { pendingCredentialStore } from '@/lib/session/pending-credentials';
import { AcademyClient } from '@/lib/academy/client';
import { masterKeyFromSecret, open, unpackVaultPlaintext } from '@/lib/crypto/envelope';
import { getConfig } from '@/lib/config';
import crypto from 'node:crypto';

describe('Vault Resealing on Password Update (Integration)', () => {
  beforeAll(async () => {
    process.env.FIRST_PARTY_API_CLIENT_ID = 'cli_delegated_update_service';
    await setupIntegrationMongo();
  }, 60000);

  afterAll(async () => {
    await teardownIntegrationMongo();
  });

  beforeEach(async () => {
    await resetDatabase();
  });

  it('updates vault ciphertext and decrypts newly updated credentials end-to-end', async () => {
    const user = await User.create({
      sub: 'usr_vault_updater',
      name: 'Vault Student',
      prn: 'PES1UG20CS555',
      srn: 'PES1202000555',
      email: 'student555@pesu.edu',
    });

    const delegatedClient = await Client.create({
      client_id: 'cli_delegated_update_service',
      name: 'PESU Academy Sync Update Service',
      owner_sub: 'usr_dev_owner',
      redirect_uris: ['https://service.pesu.edu/cb'],
      token_endpoint_auth_method: 'none',
      publishing_status: 'production',
      delegated_allowed: true,
    });

    const sessionCookie = await createSessionToken({ sub: user.sub, name: user.name });

    // 1. Initial delegated consent with Password V1
    const credId = pendingCredentialStore.put({
      username: user.prn,
      password: 'initial_raw_password_v1',
      sessionToken: 'initial_session_token_v1',
      accessToken: 'initial_access_v1',
      userId: 'u_555',
    });
    const pendingCookie = await createSessionToken({ sub: user.sub, cred_id: credId }, 600);

    const verifier = 'test-verifier-for-vault-update-flow-43-chars-long';
    const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');

    const consentReq = new NextRequest('http://localhost:3000/api/oidc/consent', {
      method: 'POST',
      headers: {
        cookie: `pesu_session=${sessionCookie}; pesu_pending=${pendingCookie}`,
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
    const code = new URL(consentData.redirectTo).searchParams.get('code')!;

    // Exchange code for access token
    const tokenParams = new URLSearchParams();
    tokenParams.set('client_id', delegatedClient.client_id);
    tokenParams.set('grant_type', 'authorization_code');
    tokenParams.set('code', code);
    tokenParams.set('redirect_uri', 'https://service.pesu.edu/cb');
    tokenParams.set('code_verifier', verifier);

    const tokenRes = await postToken(
      new Request('http://localhost:3000/oauth2/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: tokenParams.toString(),
      })
    );
    expect(tokenRes.status).toBe(200);
    const tokens = await tokenRes.json();
    const accessToken = tokens.access_token;

    // 2. Token exchange returns initial session token V1
    const exchangeReq1 = new NextRequest('http://localhost:3000/oauth2/token-exchange', {
      method: 'POST',
      headers: {
        'X-Token-Exchange-Secret': process.env.TOKEN_EXCHANGE_SECRET!,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ access_token: accessToken }),
    });
    const exchangeRes1 = await postTokenExchange(exchangeReq1);
    expect(exchangeRes1.status).toBe(200);
    const exchangeData1 = await exchangeRes1.json();
    expect(exchangeData1.token).toBe('initial_session_token_v1');

    // Inspect initial vault ciphertext in MongoDB
    const initialVaultInDb = await Vault.findOne({ sub: user.sub });
    expect(initialVaultInDb).not.toBeNull();
    const initialCiphertext = initialVaultInDb!.ciphertext;

    // 3. User changes Academy password in Settings: PATCH /api/internal/settings
    vi.spyOn(AcademyClient.prototype, 'login').mockResolvedValueOnce({
      session: {
        token: 'new_updated_session_token_v2',
        accessToken: 'new_access_v2',
        userId: 'u_555',
        expiresAt: new Date(Date.now() + 7200 * 1000),
      },
      profile: { prn: user.prn, srn: user.srn, name: user.name, email: user.email },
    } as never);

    const patchReq = new NextRequest('http://localhost:3000/api/internal/settings', {
      method: 'PATCH',
      headers: {
        cookie: `pesu_session=${sessionCookie}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ newPassword: 'brand_new_raw_password_v2' }),
    });
    const patchRes = await patchSettings(patchReq);
    expect(patchRes.status).toBe(200);

    // 4. Verify MongoDB Vault document has updated ciphertext
    const updatedVaultInDb = await Vault.findOne({ sub: user.sub });
    expect(updatedVaultInDb).not.toBeNull();
    expect(updatedVaultInDb!.ciphertext).not.toBe(initialCiphertext);

    // Decrypt the raw envelope using master key to verify plaintext contains new password
    const config = getConfig();
    const masterKey = masterKeyFromSecret(config.vaultMasterKey!);
    const unsealed = open(masterKey, {
      nonce: updatedVaultInDb!.nonce,
      ciphertext: updatedVaultInDb!.ciphertext,
      wrapNonce: updatedVaultInDb!.wrap_nonce,
      wrappedDek: updatedVaultInDb!.wrapped_dek,
      keyVersion: updatedVaultInDb!.key_version,
    });
    const unpacked = unpackVaultPlaintext(unsealed);
    expect(unpacked.password).toBe('brand_new_raw_password_v2');

    // 5. Subsequent token exchange with existing access token immediately returns new session token V2
    const exchangeReq2 = new NextRequest('http://localhost:3000/oauth2/token-exchange', {
      method: 'POST',
      headers: {
        'X-Token-Exchange-Secret': process.env.TOKEN_EXCHANGE_SECRET!,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ access_token: accessToken }),
    });
    const exchangeRes2 = await postTokenExchange(exchangeReq2);
    expect(exchangeRes2.status).toBe(200);
    const exchangeData2 = await exchangeRes2.json();
    expect(exchangeData2.token).toBe('new_updated_session_token_v2');
  });
});
