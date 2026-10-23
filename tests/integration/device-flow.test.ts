import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { setupIntegrationMongo, teardownIntegrationMongo, resetDatabase } from './setup';
import { POST as postDeviceAuthorization } from '@/app/oauth2/device_authorization/route';
import { POST as postToken } from '@/app/oauth2/token/route';
import { POST as postDeviceDecision } from '@/app/api/internal/device/route';
import { GET as getUserInfo } from '@/app/api/v1/userinfo/route';
import { Client, Consent, DeviceCode, User, Vault } from '@/lib/db/models';
import { createSessionToken } from '@/lib/session/cookie';

const GRANT = 'urn:ietf:params:oauth:grant-type:device_code';

function form(url: string, fields: Record<string, string>) {
  return new NextRequest(`http://localhost:3000${url}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(fields),
  });
}

async function poll(deviceCode: string) {
  const res = await postToken(form('/oauth2/token', { grant_type: GRANT, device_code: deviceCode, client_id: 'cli_tv' }));
  return { status: res.status, body: await res.json() };
}

async function decide(userCode: string, action: 'allow' | 'deny') {
  const cookie = `pesu_session=${await createSessionToken({ sub: 'usr_student', name: 'Student' })}`;
  const res = await postDeviceDecision(
    new NextRequest('http://localhost:3000/api/internal/device', {
      method: 'POST',
      headers: { cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ userCode, action }),
    })
  );
  return { status: res.status, body: await res.json() };
}

describe('Device Authorization Grant, RFC 8628 (Integration)', () => {
  beforeAll(async () => {
    await setupIntegrationMongo();
  }, 60000);

  afterAll(async () => {
    await teardownIntegrationMongo();
  });

  beforeEach(async () => {
    await resetDatabase();
    await User.create({ sub: 'usr_student', name: 'Student', prn: 'PES1UG20CS300', srn: 'PES1UG20CS300', email: 's@pesu.pes.edu' });
    await Client.create({
      client_id: 'cli_tv',
      name: 'Club Kiosk',
      owner_sub: 'usr_dev',
      redirect_uris: [],
      token_endpoint_auth_method: 'none',
      publishing_status: 'production',
      device_flow_enabled: true,
    });
  });

  it('runs start → pending → slow_down → approve → tokens, and the code is single-use', async () => {
    const startRes = await postDeviceAuthorization(form('/oauth2/device_authorization', { client_id: 'cli_tv', scope: 'openid email' }));
    expect(startRes.status).toBe(200);
    const start = await startRes.json();
    expect(start.user_code).toMatch(/^[BCDFGHJKLMNPQRSTVWXZ]{4}-[BCDFGHJKLMNPQRSTVWXZ]{4}$/);
    expect(start.verification_uri_complete).toContain(`/device?user_code=${start.user_code}`);
    expect(start).toMatchObject({ expires_in: 900, interval: 5 });

    // Only a hash of the device code is stored
    const stored = await DeviceCode.findOne({}).lean();
    expect(stored?.device_code_hash).not.toBe(start.device_code);

    expect((await poll(start.device_code)).body.error).toBe('authorization_pending');
    const fast = await poll(start.device_code);
    expect(fast.body).toMatchObject({ error: 'slow_down', interval: 10 });

    // Student types the code in any format
    const approved = await decide(start.user_code.toLowerCase().replace('-', ' '), 'allow');
    expect(approved).toEqual({ status: 200, body: { status: 'approved' } });
    expect((await Consent.findOne({ sub: 'usr_student', client_id: 'cli_tv' }).lean())?.mode).toBe('identity');
    expect(await Vault.countDocuments()).toBe(0);

    const tokens = await poll(start.device_code);
    expect(tokens.status).toBe(200);
    expect(tokens.body.scope).toBe('openid email');
    expect(tokens.body.id_token).toBeTruthy();

    const info = await getUserInfo(
      new Request('http://localhost:3000/api/v1/userinfo', { headers: { Authorization: `Bearer ${tokens.body.access_token}` } })
    );
    expect(await info.json()).toMatchObject({ sub: 'usr_student', email: 's@pesu.pes.edu' });

    // Redeemed codes cannot be reused, and approving again fails
    expect((await poll(start.device_code)).body.error).toBe('expired_token');
    expect((await decide(start.user_code, 'allow')).status).toBe(404);
  });

  it('reports access_denied once when the student denies', async () => {
    const start = await (await postDeviceAuthorization(form('/oauth2/device_authorization', { client_id: 'cli_tv' }))).json();
    expect((await decide(start.user_code, 'deny')).body).toEqual({ status: 'denied' });
    expect((await poll(start.device_code)).body.error).toBe('access_denied');
    expect((await poll(start.device_code)).body.error).toBe('expired_token');
    expect(await Consent.countDocuments()).toBe(0);
  });

  it('refuses clients without device flow and unknown device codes', async () => {
    await Client.updateOne({ client_id: 'cli_tv' }, { $set: { device_flow_enabled: false } });
    const res = await postDeviceAuthorization(form('/oauth2/device_authorization', { client_id: 'cli_tv' }));
    expect((await res.json()).error).toBe('unauthorized_client');

    await Client.updateOne({ client_id: 'cli_tv' }, { $set: { device_flow_enabled: true } });
    expect((await poll('dev_not_a_real_code')).body.error).toBe('expired_token');
  });
});
