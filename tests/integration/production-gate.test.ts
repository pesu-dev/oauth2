import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { setupIntegrationMongo, teardownIntegrationMongo, resetDatabase } from './setup';
import { NextRequest } from 'next/server';
import { POST as postConsent } from '@/app/api/internal/consent/route';
import { POST as postTester } from '@/app/api/internal/portal/clients/[clientId]/testers/route';
import { POST as postRequestProd } from '@/app/api/internal/portal/clients/[clientId]/request-production/route';
import { POST as postAdminReview } from '@/app/api/internal/admin/requests/route';
import { Admin, User, Client, ClientTester, ProductionRequest } from '@/lib/db/models';
import { createSessionToken } from '@/lib/session/cookie';

describe('Production Gate & Publishing Review Queue (Integration)', () => {
  beforeAll(async () => {
    await setupIntegrationMongo();
  }, 60000);

  afterAll(async () => {
    await teardownIntegrationMongo();
  });

  beforeEach(async () => {
    await resetDatabase();
  });

  it('enforces testing mode gate, tester addition, and production approval with delegated access', async () => {
    // 1. Seed owner and unauthorized external student
    const owner = await User.create({
      sub: 'usr_owner_dev',
      name: 'Owner Developer',
      prn: 'PES1UG20CS001',
      srn: 'PES1202000001',
    });

    const student = await User.create({
      sub: 'usr_normal_student',
      name: 'Normal Student',
      prn: 'PES1UG20CS002',
      srn: 'PES1202000002',
    });

    const client = await Client.create({
      client_id: 'cli_gated_app',
      name: 'Campus Events App',
      owner_sub: owner.sub,
      redirect_uris: ['https://events.pesu.edu/callback'],
      token_endpoint_auth_method: 'none',
      publishing_status: 'testing',
      delegated_allowed: false,
    });

    const studentSession = await createSessionToken({ sub: student.sub });
    const ownerSession = await createSessionToken({ sub: owner.sub });

    // 2. Normal student tries to authorize testing app -> must be blocked with 403
    const blockedRes = await postConsent(
      new NextRequest('http://localhost:3000/api/oidc/consent', {
        method: 'POST',
        headers: {
          cookie: `pesu_session=${studentSession}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          clientId: client.client_id,
          redirectUri: 'https://events.pesu.edu/callback',
          action: 'allow',
          codeChallenge: 'E9Melhoa2OwvFrGMTJguCH5rtx64LxU408W3P65czvc',
          codeChallengeMethod: 'S256',
        }),
      })
    );
    expect(blockedRes.status).toBe(403);

    // 3. Owner adds normal student as an authorized tester
    const addTesterRes = await postTester(
      new NextRequest(`http://localhost:3000/api/portal/clients/${client.client_id}/testers`, {
        method: 'POST',
        headers: {
          cookie: `pesu_session=${ownerSession}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ identifier: student.prn }),
      }),
      { params: Promise.resolve({ clientId: client.client_id }) }
    );
    expect(addTesterRes.status).toBe(200);

    // Verify tester row created in real MongoDB
    const testerDoc = await ClientTester.findOne({ client_id: client.client_id, sub: student.sub });
    expect(testerDoc).not.toBeNull();

    // 4. Now the tester can authorize the testing app
    const allowedRes = await postConsent(
      new NextRequest('http://localhost:3000/api/oidc/consent', {
        method: 'POST',
        headers: {
          cookie: `pesu_session=${studentSession}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          clientId: client.client_id,
          redirectUri: 'https://events.pesu.edu/callback',
          action: 'allow',
          codeChallenge: 'E9Melhoa2OwvFrGMTJguCH5rtx64LxU408W3P65czvc',
          codeChallengeMethod: 'S256',
        }),
      })
    );
    expect(allowedRes.status).toBe(200);
    const allowedData = await allowedRes.json();
    expect(allowedData.redirectTo).toContain('https://events.pesu.edu/callback?code=code_');

    // 5. Owner requests production publishing with delegated access
    const reqProdRes = await postRequestProd(
      new NextRequest(`http://localhost:3000/api/portal/clients/${client.client_id}/request-production`, {
        method: 'POST',
        headers: {
          cookie: `pesu_session=${ownerSession}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          justification: 'This is an official university event calendar used across campuses.',
          delegatedRequested: true,
        }),
      }),
      { params: Promise.resolve({ clientId: client.client_id }) }
    );
    expect(reqProdRes.status).toBe(200);

    // Verify MongoDB status transitioned to pending_production
    const clientPending = await Client.findOne({ client_id: client.client_id });
    expect(clientPending?.publishing_status).toBe('pending_production');

    const prodReq = await ProductionRequest.findOne({ client_id: client.client_id, status: 'pending' });
    expect(prodReq).not.toBeNull();
    expect(prodReq?.delegated_requested).toBe(true);

    // 6. Admin reviews and approves the production request
    await Admin.create({ sub: 'usr_admin_pesu' });
    const adminSession = await createSessionToken({ sub: 'usr_admin_pesu' });

    const reviewRes = await postAdminReview(
      new NextRequest('http://localhost:3000/api/admin/requests', {
        method: 'POST',
        headers: {
          cookie: `pesu_session=${adminSession}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          requestId: prodReq?.request_id,
          action: 'approve',
          allowDelegated: true,
        }),
      })
    );
    expect(reviewRes.status).toBe(200);

    // 7. Verify Client in MongoDB is now in production with delegated_allowed: true
    const clientApproved = await Client.findOne({ client_id: client.client_id });
    expect(clientApproved?.publishing_status).toBe('production');
    expect(clientApproved?.delegated_allowed).toBe(true);

    // Allow fire-and-forget mailer notification to complete before teardown
    await new Promise((r) => setTimeout(r, 100));
  });
});
