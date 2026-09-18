import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { setupIntegrationMongo, teardownIntegrationMongo, resetDatabase } from './setup';
import { POST as postToken } from '@/app/oauth2/token/route';
import { User, Client, RefreshToken } from '@/lib/db/models';
import { sha256Hex } from '@/lib/crypto/hash';
import { newFamilyId, newRefreshToken } from '@/lib/id/nanoid';

describe('Refresh Token Rotation & Compromise Detection (Integration)', () => {
  beforeAll(async () => {
    await setupIntegrationMongo();
  }, 60000);

  afterAll(async () => {
    await teardownIntegrationMongo();
  });

  beforeEach(async () => {
    await resetDatabase();
  });

  it('rotates refresh token and revokes entire family on token reuse', async () => {
    const user = await User.create({
      sub: 'usr_refresh_user_1',
      name: 'Refresh Test Student',
      prn: 'PES1UG20CS777',
      srn: 'PES1202000777',
    });

    const client = await Client.create({
      client_id: 'cli_refresh_app',
      name: 'Mobile Client',
      owner_sub: 'usr_owner_1',
      redirect_uris: ['https://mobile.pesu.edu/cb'],
      token_endpoint_auth_method: 'none',
      publishing_status: 'production',
    });

    // 1. Seed initial active refresh token R1
    const rawR1 = newRefreshToken();
    const familyId = newFamilyId();

    await RefreshToken.create({
      token_hash: sha256Hex(rawR1),
      client_id: client.client_id,
      sub: user.sub,
      scopes: ['openid', 'offline_access'],
      family_id: familyId,
      expires_at: new Date(Date.now() + 30 * 86400 * 1000),
      revoked_at: null,
      created_at: new Date(),
    });

    // 2. Perform legitimate token rotation with R1
    const rotateParams = new URLSearchParams();
    rotateParams.set('grant_type', 'refresh_token');
    rotateParams.set('client_id', client.client_id);
    rotateParams.set('refresh_token', rawR1);

    const rotateRes = await postToken(
      new Request('http://localhost:3000/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: rotateParams.toString(),
      })
    );

    expect(rotateRes.status).toBe(200);
    const rotateData = await rotateRes.json();
    const rawR2 = rotateData.refresh_token;
    expect(rawR2).toBeDefined();
    expect(rawR2).not.toBe(rawR1);

    // 3. Verify in MongoDB: R1 is revoked, R2 is active with same family_id
    const r1Doc = await RefreshToken.findOne({ token_hash: sha256Hex(rawR1) });
    expect(r1Doc?.revoked_at).not.toBeNull();

    const r2Doc = await RefreshToken.findOne({ token_hash: sha256Hex(rawR2) });
    expect(r2Doc?.revoked_at).toBeNull();
    expect(r2Doc?.family_id).toBe(familyId);

    // 4. Token Reuse Attack: Attacker replays already-revoked token R1
    const replayRes = await postToken(
      new Request('http://localhost:3000/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: rotateParams.toString(), // replaying R1
      })
    );

    expect(replayRes.status).toBe(400);
    const replayData = await replayRes.json();
    expect(replayData.error).toBe('invalid_grant');
    expect(replayData.error_description).toContain('family revoked');

    // 5. Verify entire family is now revoked in real MongoDB (including R2!)
    const unrevokedTokens = await RefreshToken.countDocuments({
      family_id: familyId,
      revoked_at: null,
    });
    expect(unrevokedTokens).toBe(0);

    const r2DocAfterReplay = await RefreshToken.findOne({ token_hash: sha256Hex(rawR2) });
    expect(r2DocAfterReplay?.revoked_at).not.toBeNull();

    // 6. Legitimate client tries to use R2; must now be rejected because family was compromised
    const r2Params = new URLSearchParams();
    r2Params.set('grant_type', 'refresh_token');
    r2Params.set('client_id', client.client_id);
    r2Params.set('refresh_token', rawR2);

    const r2Res = await postToken(
      new Request('http://localhost:3000/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: r2Params.toString(),
      })
    );

    expect(r2Res.status).toBe(400);
    const r2Data = await r2Res.json();
    expect(r2Data.error).toBe('invalid_grant');
  });

  it('prevents another client from revoking or invalidating a victim client refresh token family', async () => {
    const victimUser = await User.create({
      sub: 'usr_victim_user',
      name: 'Victim Student',
      prn: 'PES1UG20CS888',
      srn: 'PES1202000888',
    });

    const victimClient = await Client.create({
      client_id: 'cli_victim_app',
      name: 'Victim App',
      owner_sub: 'usr_owner_v',
      redirect_uris: ['https://victim.pesu.edu/cb'],
      token_endpoint_auth_method: 'none',
      publishing_status: 'production',
    });

    const attackerClient = await Client.create({
      client_id: 'cli_attacker_app',
      name: 'Attacker App',
      owner_sub: 'usr_owner_a',
      redirect_uris: ['https://attacker.pesu.edu/cb'],
      token_endpoint_auth_method: 'none',
      publishing_status: 'production',
    });

    const rawVictimToken = newRefreshToken();
    const victimFamilyId = newFamilyId();

    await RefreshToken.create({
      token_hash: sha256Hex(rawVictimToken),
      client_id: victimClient.client_id,
      sub: victimUser.sub,
      scopes: ['openid', 'offline_access'],
      family_id: victimFamilyId,
      expires_at: new Date(Date.now() + 30 * 86400 * 1000),
      revoked_at: null,
      created_at: new Date(),
    });

    // Attacker client attempts to use or rotate victim's refresh token
    const attackParams = new URLSearchParams();
    attackParams.set('grant_type', 'refresh_token');
    attackParams.set('client_id', attackerClient.client_id);
    attackParams.set('refresh_token', rawVictimToken);

    const attackRes = await postToken(
      new Request('http://localhost:3000/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: attackParams.toString(),
      })
    );

    expect(attackRes.status).toBe(400);
    const attackData = await attackRes.json();
    expect(attackData.error).toBe('invalid_grant');
    expect(attackData.error_description).toContain('Token was issued to a different client');

    // Verify victim's token is STILL active and NOT revoked in MongoDB
    const victimDoc = await RefreshToken.findOne({ token_hash: sha256Hex(rawVictimToken) });
    expect(victimDoc?.revoked_at).toBeNull();

    // Verify victim's family is completely intact
    const activeTokens = await RefreshToken.countDocuments({
      family_id: victimFamilyId,
      revoked_at: null,
    });
    expect(activeTokens).toBe(1);

    // Verify victim client can legitimately rotate the token afterwards
    const legitimateParams = new URLSearchParams();
    legitimateParams.set('grant_type', 'refresh_token');
    legitimateParams.set('client_id', victimClient.client_id);
    legitimateParams.set('refresh_token', rawVictimToken);

    const legitRes = await postToken(
      new Request('http://localhost:3000/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: legitimateParams.toString(),
      })
    );

    expect(legitRes.status).toBe(200);
    const legitData = await legitRes.json();
    expect(legitData.refresh_token).toBeDefined();
    expect(legitData.refresh_token).not.toBe(rawVictimToken);
  });
});
