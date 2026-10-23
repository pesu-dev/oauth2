import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import crypto from 'node:crypto';
import { NextRequest } from 'next/server';
import { setupIntegrationMongo, teardownIntegrationMongo, resetDatabase } from './setup';
import { POST as postRequestAccess } from '@/app/api/internal/portal/clients/[clientId]/request-production/route';
import { POST as postReview } from '@/app/api/internal/admin/requests/route';
import { POST as postConsent } from '@/app/api/internal/consent/route';
import { POST as postToken } from '@/app/oauth2/token/route';
import { DELETE as deleteSettings } from '@/app/api/internal/settings/route';
import { GET as getAttendance } from '@/app/api/v1/attendance/route';
import { Admin, Client, Consent, User, Vault } from '@/lib/db/models';
import { createSessionToken } from '@/lib/session/cookie';
import { pendingCredentialStore } from '@/lib/session/pending-credentials';
import { apiLimiter } from '@/lib/rate-limit';

// Only the network edge is faked: the dispatcher returns a payload with an extra sensitive field.
const dispatch = vi.fn();
vi.mock('@/lib/academy/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/academy/client')>();
  return {
    ...actual,
    AcademyClient: class {
      dispatch = (...args: unknown[]) => dispatch(...args);
      login = vi.fn();
    },
  };
});

const REDIRECT = 'https://tracker.pesu.dev/cb';
const VERIFIER = 'resource-api-integration-verifier-0123456789abcdef';
const CHALLENGE = crypto.createHash('sha256').update(VERIFIER).digest('base64url');

function json(url: string, method: string, cookie: string, body?: unknown) {
  return new NextRequest(`http://localhost:3000${url}`, {
    method,
    headers: { cookie, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function consentAndToken(studentCookie: string, scope: string): Promise<{ status: number; body: Record<string, unknown> }> {
  const consentRes = await postConsent(
    json('/api/internal/consent', 'POST', studentCookie, {
      clientId: 'cli_tracker',
      redirectUri: REDIRECT,
      scope,
      action: 'allow',
      codeChallenge: CHALLENGE,
      codeChallengeMethod: 'S256',
    })
  );
  const consentBody = await consentRes.json();
  if (consentRes.status !== 200) return { status: consentRes.status, body: consentBody };

  const code = new URL(consentBody.redirectTo).searchParams.get('code')!;
  const tokenRes = await postToken(
    new NextRequest('http://localhost:3000/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: REDIRECT,
        code_verifier: VERIFIER,
        client_id: 'cli_tracker',
      }),
    })
  );
  return { status: tokenRes.status, body: await tokenRes.json() };
}

describe('Resource API: scoped access, delegated consent and live revocation (Integration)', () => {
  beforeAll(async () => {
    process.env.ACADEMY_MENU_IDS = '{"attendance":"424242"}';
    await setupIntegrationMongo();
  }, 60000);

  afterAll(async () => {
    delete process.env.ACADEMY_MENU_IDS;
    await teardownIntegrationMongo();
  });

  beforeEach(async () => {
    await resetDatabase();
    dispatch.mockReset();
    apiLimiter.reset();
    pendingCredentialStore.reset();
  });

  it('gates resource scopes on admin approval and revokes access immediately', async () => {
    await User.create({ sub: 'usr_dev', name: 'Dev', prn: 'PES1UG20CS100', srn: 'PES1UG20CS100' });
    const student = await User.create({ sub: 'usr_student', name: 'Student', prn: 'PES1UG20CS200', srn: 'PES1UG20CS200' });
    await Admin.create({ sub: 'usr_admin' });
    await Client.create({
      client_id: 'cli_tracker',
      name: 'Attendance Tracker',
      owner_sub: 'usr_dev',
      redirect_uris: [REDIRECT],
      token_endpoint_auth_method: 'none',
      publishing_status: 'production',
    });

    const devCookie = `pesu_session=${await createSessionToken({ sub: 'usr_dev' })}`;
    const adminCookie = `pesu_session=${await createSessionToken({ sub: 'usr_admin' })}`;
    const credId = pendingCredentialStore.put({
      username: student.srn,
      password: 'student-password',
      sessionToken: 'academy-mobile-token',
      accessToken: 'academy-access-token',
      userId: 'academy-user-id',
    });
    const studentCookie =
      `pesu_session=${await createSessionToken({ sub: student.sub, name: student.name })}; ` +
      `pesu_pending=${await createSessionToken({ sub: student.sub, cred_id: credId }, 600)}`;

    // 1. Not approved yet: consent refuses the resource scope
    const early = await consentAndToken(studentCookie, 'openid attendance:read');
    expect(early.status).toBe(400);
    expect(early.body.error).toBe('invalid_scope');

    // 2. Developer asks for attendance:read without leaving Production; admin approves it
    const requestRes = await postRequestAccess(
      json('/api/internal/portal/clients/cli_tracker/request-production', 'POST', devCookie, {
        justification: 'Shows club members their attendance before exams',
        productionRequested: false,
        requestedScopes: ['attendance:read'],
      }),
      { params: Promise.resolve({ clientId: 'cli_tracker' }) }
    );
    expect(requestRes.status).toBe(200);
    const { request } = await requestRes.json();

    const reviewRes = await postReview(
      json('/api/internal/admin/requests', 'POST', adminCookie, {
        requestId: request.request_id,
        action: 'approve',
        approvedScopes: ['attendance:read'],
      })
    );
    expect(reviewRes.status).toBe(200);
    const approved = await Client.findOne({ client_id: 'cli_tracker' }).lean();
    expect(approved).toMatchObject({ publishing_status: 'production', delegated_allowed: true, allowed_scopes: ['attendance:read'] });

    // 3. Delegated consent stores the vault; the token carries the scope
    const granted = await consentAndToken(studentCookie, 'openid attendance:read');
    expect(granted.status).toBe(200);
    expect(granted.body.scope).toBe('openid attendance:read');
    expect(await Vault.countDocuments({ sub: student.sub })).toBe(1);
    expect((await Consent.findOne({ sub: student.sub, client_id: 'cli_tracker' }).lean())?.mode).toBe('delegated');

    // 4. The resource API returns only allowlisted fields from Academy's payload
    dispatch.mockResolvedValue({
      ATTENDANCE: [{ subjectCode: 'UE20CS301', subjectName: 'DBMS', totalClasses: 40, attendedClasses: 37, FatherMobileNo: '9999999999' }],
    });
    const call = () =>
      getAttendance(
        new Request('http://localhost:3000/api/v1/attendance', {
          headers: { Authorization: `Bearer ${granted.body.access_token}` },
        })
      );
    const ok = await call();
    expect(ok.status).toBe(200);
    const okBody = await ok.json();
    expect(okBody.data).toEqual([{ code: 'UE20CS301', name: 'DBMS', classesHeld: 40, classesAttended: 37 }]);
    expect(JSON.stringify(okBody)).not.toContain('9999999999');
    const [session, form] = dispatch.mock.calls[0];
    expect(session).toMatchObject({ token: 'academy-mobile-token', accessToken: 'academy-access-token' });
    expect(form).toMatchObject({ action: 18, mode: 6, menuId: '424242' });

    // 5. An identity-only token for the same app cannot read attendance
    const identityCred = pendingCredentialStore.put({ username: student.srn, password: 'student-password' });
    const identityCookie =
      `pesu_session=${await createSessionToken({ sub: student.sub, name: student.name })}; ` +
      `pesu_pending=${await createSessionToken({ sub: student.sub, cred_id: identityCred }, 600)}`;
    const identityOnly = await consentAndToken(identityCookie, 'openid profile');
    const denied = await getAttendance(
      new Request('http://localhost:3000/api/v1/attendance', {
        headers: { Authorization: `Bearer ${identityOnly.body.access_token}` },
      })
    );
    expect(denied.status).toBe(403);
    expect((await denied.json()).error).toBe('insufficient_scope');

    // 6. Revoking consent in Settings blocks the still-unexpired access token
    const revoke = await deleteSettings(
      json('/api/internal/settings?action=consent&client_id=cli_tracker', 'DELETE', `pesu_session=${await createSessionToken({ sub: student.sub })}`)
    );
    expect(revoke.status).toBe(200);
    const afterRevoke = await call();
    expect(afterRevoke.status).toBe(401);
    expect((await afterRevoke.json()).error_description).toContain('revoked');
    expect(dispatch).toHaveBeenCalledTimes(1);
  });
});
