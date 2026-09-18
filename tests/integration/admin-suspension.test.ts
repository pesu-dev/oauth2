import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { setupIntegrationMongo, teardownIntegrationMongo, resetDatabase } from './setup';
import { NextRequest } from 'next/server';
import { PATCH as patchAdminClients, GET as getAdminClients } from '@/app/api/internal/admin/clients/route';
import { POST as postConsent } from '@/app/api/internal/consent/route';
import { Admin, User, Client } from '@/lib/db/models';
import { createSessionToken } from '@/lib/session/cookie';
import crypto from 'node:crypto';

describe('Admin Client Suspension & Reinstatement (Integration)', () => {
  beforeAll(async () => {
    await setupIntegrationMongo();
  }, 60000);

  afterAll(async () => {
    await teardownIntegrationMongo();
  });

  beforeEach(async () => {
    await resetDatabase();
  });

  it('suspends client, blocks consent authorization, and reinstates client cleanly in MongoDB', async () => {
    // 1. Seed Admin and User
    const adminSub = 'usr_super_admin';
    await Admin.create({ sub: adminSub });
    const adminCookie = await createSessionToken({ sub: adminSub, name: 'Admin User' });

    const user = await User.create({
      sub: 'usr_student_target',
      name: 'Test Student',
      prn: 'PES1UG20CS101',
      srn: 'PES1202000101',
      email: 'student@pesu.edu',
    });
    const userCookie = await createSessionToken({ sub: user.sub, name: user.name });

    // 2. Seed active production client
    const client = await Client.create({
      client_id: 'cli_suspendable_app',
      name: 'Suspendable App',
      owner_sub: 'usr_developer_owner',
      redirect_uris: ['https://suspendable.pesu.edu/callback'],
      token_endpoint_auth_method: 'none',
      publishing_status: 'production',
      delegated_allowed: false,
    });

    const verifier = 'test-pkce-verifier-for-admin-suspension-flow-123';
    const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');

    // 3. User can authorize before suspension
    const preConsentReq = new NextRequest('http://localhost:3000/api/oidc/consent', {
      method: 'POST',
      headers: {
        cookie: `pesu_session=${userCookie}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        clientId: client.client_id,
        redirectUri: 'https://suspendable.pesu.edu/callback',
        action: 'allow',
        mode: 'identity',
        codeChallenge: challenge,
        codeChallengeMethod: 'S256',
      }),
    });
    const preConsentRes = await postConsent(preConsentReq);
    expect(preConsentRes.status).toBe(200);

    // 4. Admin queries clients list via GET /api/internal/admin/clients
    const listReq = new NextRequest('http://localhost:3000/api/internal/admin/clients?q=Suspendable', {
      headers: { cookie: `pesu_session=${adminCookie}` },
    });
    const listRes = await getAdminClients(listReq);
    expect(listRes.status).toBe(200);
    const listData = await listRes.json();
    expect(listData.clients).toHaveLength(1);
    expect(listData.clients[0].publishing_status).toBe('production');

    // 5. Admin suspends the client with reason
    const suspendReq = new NextRequest('http://localhost:3000/api/internal/admin/clients', {
      method: 'PATCH',
      headers: {
        cookie: `pesu_session=${adminCookie}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        clientId: client.client_id,
        action: 'suspend',
        reason: 'Violation of PESU API acceptable use policy',
      }),
    });
    const suspendRes = await patchAdminClients(suspendReq);
    expect(suspendRes.status).toBe(200);

    // Verify DB update directly
    const updatedClientInDb = await Client.findOne({ client_id: client.client_id });
    expect(updatedClientInDb?.publishing_status).toBe('suspended');
    expect(updatedClientInDb?.suspension_reason).toBe('Violation of PESU API acceptable use policy');
    expect(updatedClientInDb?.suspended_by_sub).toBe(adminSub);
    expect(updatedClientInDb?.suspended_at).toBeDefined();

    // 6. User attempts to authorize suspended client -> must be blocked with 403
    const blockedConsentReq = new NextRequest('http://localhost:3000/api/oidc/consent', {
      method: 'POST',
      headers: {
        cookie: `pesu_session=${userCookie}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        clientId: client.client_id,
        redirectUri: 'https://suspendable.pesu.edu/callback',
        action: 'allow',
        mode: 'identity',
        codeChallenge: challenge,
        codeChallengeMethod: 'S256',
      }),
    });
    const blockedRes = await postConsent(blockedConsentReq);
    expect(blockedRes.status).toBe(403);
    const blockedData = await blockedRes.json();
    expect(blockedData.error).toContain('Application is suspended by an administrator');

    // 7. Admin unsuspends client back to production
    const unsuspendReq = new NextRequest('http://localhost:3000/api/internal/admin/clients', {
      method: 'PATCH',
      headers: {
        cookie: `pesu_session=${adminCookie}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        clientId: client.client_id,
        action: 'unsuspend',
        targetStatus: 'production',
      }),
    });
    const unsuspendRes = await patchAdminClients(unsuspendReq);
    expect(unsuspendRes.status).toBe(200);

    // Verify DB update
    const reinstatedClient = await Client.findOne({ client_id: client.client_id });
    expect(reinstatedClient?.publishing_status).toBe('production');
    expect(reinstatedClient?.suspension_reason).toBeNull();
    expect(reinstatedClient?.suspended_at).toBeNull();
    expect(reinstatedClient?.suspended_by_sub).toBeNull();

    // 8. Consent succeeds again after reinstatement
    const postReinstatementReq = new NextRequest('http://localhost:3000/api/oidc/consent', {
      method: 'POST',
      headers: {
        cookie: `pesu_session=${userCookie}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        clientId: client.client_id,
        redirectUri: 'https://suspendable.pesu.edu/callback',
        action: 'allow',
        mode: 'identity',
        codeChallenge: challenge,
        codeChallengeMethod: 'S256',
      }),
    });
    const postReinstatementRes = await postConsent(postReinstatementReq);
    expect(postReinstatementRes.status).toBe(200);
    const finalData = await postReinstatementRes.json();
    expect(finalData.redirectTo).toContain('code=');
  });
});
