import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { setupIntegrationMongo, teardownIntegrationMongo, resetDatabase } from './setup';
import { NextRequest } from 'next/server';
import { GET as getSettings, DELETE as deleteSettings } from '@/app/api/internal/settings/route';
import { User, Client, Consent, RefreshToken, Vault } from '@/lib/db/models';
import { createSessionToken } from '@/lib/session/cookie';

describe('Settings Lifecycle & Account Tombstoning (Integration)', () => {
  beforeAll(async () => {
    await setupIntegrationMongo();
  }, 60000);

  afterAll(async () => {
    await teardownIntegrationMongo();
  });

  beforeEach(async () => {
    await resetDatabase();
  });

  it('manages vault deletion, consent revocation, and account tombstoning with real MongoDB persistence', async () => {
    // 1. Seed user, client, delegated consent, vault, and refresh tokens
    const user = await User.create({
      sub: 'usr_lifecycle_user',
      name: 'Lifecycle Student',
      prn: 'PES1UG20CS555',
      srn: 'PES1202000555',
    });

    const client1 = await Client.create({
      client_id: 'cli_app_1',
      name: 'App One',
      owner_sub: 'usr_owner_1',
      redirect_uris: ['https://app1.pesu.edu/cb'],
      token_endpoint_auth_method: 'none',
      publishing_status: 'production',
      delegated_allowed: true,
    });

    const client2 = await Client.create({
      client_id: 'cli_app_2',
      name: 'App Two',
      owner_sub: 'usr_owner_1',
      redirect_uris: ['https://app2.pesu.edu/cb'],
      token_endpoint_auth_method: 'none',
      publishing_status: 'production',
      delegated_allowed: false,
    });

    await Consent.create({
      sub: user.sub,
      client_id: client1.client_id,
      scopes: ['openid'],
      mode: 'delegated',
      granted_at: new Date(),
    });

    await Consent.create({
      sub: user.sub,
      client_id: client2.client_id,
      scopes: ['openid'],
      mode: 'identity',
      granted_at: new Date(),
    });

    await Vault.create({
      sub: user.sub,
      nonce: Buffer.alloc(12),
      ciphertext: Buffer.alloc(32),
      wrap_nonce: Buffer.alloc(12),
      wrapped_dek: Buffer.alloc(48),
      key_version: 1,
      updated_at: new Date(),
    });

    await RefreshToken.create({
      token_hash: 'token_hash_1',
      client_id: client1.client_id,
      sub: user.sub,
      scopes: ['openid'],
      family_id: 'fam_1',
      expires_at: new Date(Date.now() + 86400 * 1000),
      revoked_at: null,
      created_at: new Date(),
    });

    const sessionCookie = await createSessionToken({ sub: user.sub, name: user.name });

    // 2. GET /api/settings retrieves user info, hasVault: true, and 2 enriched consents
    const getRes = await getSettings(
      new NextRequest('http://localhost:3000/api/settings', {
        headers: { cookie: `pesu_session=${sessionCookie}` },
      })
    );
    expect(getRes.status).toBe(200);
    const getData = await getRes.json();
    expect(getData.hasVault).toBe(true);
    expect(getData.consents.length).toBe(2);

    // 3. DELETE /api/settings?action=consent for client1
    // Revoking client1 (the only delegated consent) should auto-purge the vault row!
    const revokeConsentRes = await deleteSettings(
      new NextRequest(`http://localhost:3000/api/settings?action=consent&client_id=${client1.client_id}`, {
        method: 'DELETE',
        headers: { cookie: `pesu_session=${sessionCookie}` },
      })
    );
    expect(revokeConsentRes.status).toBe(200);

    // Verify Consent for client1 is deleted
    const remainingConsent1 = await Consent.findOne({ sub: user.sub, client_id: client1.client_id });
    expect(remainingConsent1).toBeNull();

    // Verify refresh token for client1 is marked revoked_at in MongoDB
    const revokedToken = await RefreshToken.findOne({ token_hash: 'token_hash_1' });
    expect(revokedToken?.revoked_at).not.toBeNull();

    // Verify Vault row was purged because 0 delegated consents remain
    const vaultAfterRevoke = await Vault.findOne({ sub: user.sub });
    expect(vaultAfterRevoke).toBeNull();

    // 4. DELETE /api/settings?action=account to delete account
    const deleteAccountRes = await deleteSettings(
      new NextRequest('http://localhost:3000/api/settings?action=account&confirm=DELETE', {
        method: 'DELETE',
        headers: { cookie: `pesu_session=${sessionCookie}` },
      })
    );
    expect(deleteAccountRes.status).toBe(200);

    // Verify cookie cleared
    const setCookieHeader = deleteAccountRes.headers.get('set-cookie');
    expect(setCookieHeader).toContain('pesu_session=;');

    // Verify User record is tombstoned (deleted_at is set, never deleted from collection)
    const activeUser = await User.findOne({ sub: user.sub, deleted_at: null });
    expect(activeUser).toBeNull();

    const tombstonedUser = await User.findOne({ sub: user.sub });
    expect(tombstonedUser?.deleted_at).not.toBeNull();

    // Verify all remaining consents are removed
    const allConsents = await Consent.countDocuments({ sub: user.sub });
    expect(allConsents).toBe(0);
  });
});
