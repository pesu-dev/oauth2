// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { NextRequest } from 'next/server';
import { Client, ClientTester, Consent, DeviceCode, User, Vault } from '@/lib/db/models';
import * as cookieHelper from '@/lib/session/cookie';
import { pendingCredentialStore } from '@/lib/session/pending-credentials';
import { exchangeDeviceCode } from '@/lib/oidc/token-service';
import { POST as postDeviceAuthorization } from '@/app/oauth2/device_authorization/route';
import { POST as postDecision } from '@/app/api/internal/device/route';
import { PATCH as patchClient } from '@/app/api/internal/portal/clients/[clientId]/route';
import DevicePage from '@/app/device/page';
import { ConsentClient } from '@/app/oauth2/authorize/consent-client';
import { formatUserCode, newDeviceCode, newUserCode, normalizeUserCode } from '@/lib/id/nanoid';
import { buildOpenIdConfiguration } from '@/lib/oidc/discovery';
import { sealPendingCredentials } from '@/lib/session/vault-seal';
import { open, masterKeyFromSecret, unpackVaultPlaintext } from '@/lib/crypto/envelope';
import type { AppConfig } from '@/lib/config';

vi.mock('@/lib/db/connection', () => ({ connectToDatabase: vi.fn().mockResolvedValue(null) }));
vi.mock('@/lib/db/transaction', () => ({
  withTransaction: vi.fn(async (fn: (session: unknown) => Promise<unknown>) => fn({ id: 'tx' })),
}));
vi.mock('@/lib/mailer', () => ({ notifySubQuietly: vi.fn() }));
vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({ get: vi.fn(() => ({ value: 'cookie' })), set: vi.fn() })),
}));
vi.mock('next/navigation', () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
}));

const CONFIG = {
  issuerUrl: 'http://localhost:3000',
  accessTokenTtlSeconds: 3600,
  idTokenTtlSeconds: 3600,
  refreshTokenTtlSeconds: 1209600,
} as AppConfig;

const DEVICE_CLIENT = {
  client_id: 'cli_tv',
  name: 'Club Kiosk',
  owner_sub: 'usr_dev',
  publishing_status: 'production',
  delegated_allowed: false,
  allowed_scopes: [] as string[],
  device_flow_enabled: true,
  token_endpoint_auth_method: 'none',
};

describe('user codes', () => {
  it('generates XXXX-XXXX codes from the unambiguous alphabet and long device codes', () => {
    for (let i = 0; i < 20; i++) expect(newUserCode()).toMatch(/^[BCDFGHJKLMNPQRSTVWXZ]{4}-[BCDFGHJKLMNPQRSTVWXZ]{4}$/);
    expect(newDeviceCode()).toMatch(/^dev_[\w-]{40}$/);
  });

  it('normalizes typed codes and rejects invalid ones', () => {
    expect(normalizeUserCode(' bdfg-hjkl ')).toBe('BDFGHJKL');
    expect(normalizeUserCode('BDFG HJKL')).toBe('BDFGHJKL');
    expect(normalizeUserCode('BDFG-HJK')).toBeNull();
    expect(normalizeUserCode('ABCD-EFGH')).toBeNull(); // vowels are not in the alphabet
    expect(normalizeUserCode(null)).toBeNull();
    expect(formatUserCode('BDFGHJKL')).toBe('BDFG-HJKL');
  });

  it('advertises the device endpoint and grant in discovery', () => {
    const config = buildOpenIdConfiguration('https://auth.pesu.dev/');
    expect(config.device_authorization_endpoint).toBe('https://auth.pesu.dev/oauth2/device_authorization');
    expect(config.grant_types_supported).toContain('urn:ietf:params:oauth:grant-type:device_code');
  });

  it('seals pending credentials into a vault document', () => {
    const doc = sealPendingCredentials('usr_1', { username: '', password: 'pw', sessionToken: 't', expiresAt: new Date(5) }, 'k');
    const plain = unpackVaultPlaintext(
      open(masterKeyFromSecret('k'), {
        nonce: doc.nonce as Buffer,
        ciphertext: doc.ciphertext as Buffer,
        wrapNonce: doc.wrap_nonce as Buffer,
        wrappedDek: doc.wrapped_dek as Buffer,
        keyVersion: 1,
      })
    );
    expect(plain).toEqual({ username: 'usr_1', password: 'pw', session: { token: 't', access_token: null, user_id: null } });
    expect(doc.session_expires_at).toEqual(new Date(5));
    expect(sealPendingCredentials('usr_1', { username: 'u', password: 'p' }, 'k').session_expires_at).toBeUndefined();
  });
});

describe('device access token request', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('requires device_code and device flow on the client', async () => {
    expect((await exchangeDeviceCode({}, DEVICE_CLIENT as never, CONFIG)).body.error).toBe('invalid_request');
    expect(
      (await exchangeDeviceCode({ device_code: 'x' }, { ...DEVICE_CLIENT, device_flow_enabled: false } as never, CONFIG)).body.error
    ).toBe('unauthorized_client');
  });

  it('reports expired codes and races on approved codes', async () => {
    vi.spyOn(DeviceCode, 'findOne').mockResolvedValueOnce({ expires_at: new Date(Date.now() - 1) } as never);
    expect((await exchangeDeviceCode({ device_code: 'x' }, DEVICE_CLIENT as never, CONFIG)).body.error).toBe('expired_token');

    vi.spyOn(DeviceCode, 'findOne').mockResolvedValueOnce({ status: 'approved', expires_at: new Date(Date.now() + 60000) } as never);
    vi.spyOn(DeviceCode, 'findOneAndDelete').mockResolvedValueOnce(null);
    expect((await exchangeDeviceCode({ device_code: 'x' }, DEVICE_CLIENT as never, CONFIG)).body.error_description).toContain('already used');
  });

  it('rejects an approved code whose user was deleted', async () => {
    vi.spyOn(DeviceCode, 'findOne').mockResolvedValueOnce({ status: 'approved', expires_at: new Date(Date.now() + 60000) } as never);
    vi.spyOn(DeviceCode, 'findOneAndDelete').mockResolvedValueOnce({ sub: 'usr_gone', scopes: ['openid'] } as never);
    vi.spyOn(User, 'findOne').mockResolvedValueOnce(null);
    expect((await exchangeDeviceCode({ device_code: 'x' }, DEVICE_CLIENT as never, CONFIG)).body.error).toBe('invalid_grant');
  });

  it('issues tokens with an empty scope list when none were stored', async () => {
    vi.spyOn(DeviceCode, 'findOne').mockResolvedValueOnce({ status: 'approved', expires_at: new Date(Date.now() + 60000) } as never);
    vi.spyOn(DeviceCode, 'findOneAndDelete').mockResolvedValueOnce({ sub: 'usr_1' } as never);
    vi.spyOn(User, 'findOne').mockResolvedValueOnce({ sub: 'usr_1' } as never);
    const result = await exchangeDeviceCode({ device_code: 'x' }, DEVICE_CLIENT as never, CONFIG);
    expect(result.status).toBe(200);
    expect(result.body.scope).toBe('');
    expect(result.body.id_token).toBeUndefined();
  });
});

describe('device authorization endpoint', () => {
  beforeEach(() => vi.restoreAllMocks());

  const start = (fields: Record<string, string>) =>
    postDeviceAuthorization(
      new Request('http://localhost:3000/oauth2/device_authorization', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(fields),
      })
    );

  it('rejects unknown clients, missing openid and unapproved scopes', async () => {
    vi.spyOn(Client, 'findOne').mockResolvedValueOnce(null);
    expect((await start({ client_id: 'nope' })).status).toBe(401);

    vi.spyOn(Client, 'findOne').mockResolvedValue(DEVICE_CLIENT as never);
    expect((await (await start({ client_id: 'cli_tv', scope: 'profile' })).json()).error).toBe('invalid_scope');
    const blocked = await (await start({ client_id: 'cli_tv', scope: 'openid attendance:read' })).json();
    expect(blocked.error_description).toContain('attendance:read');
  });
});

describe('device decision API', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    pendingCredentialStore.reset();
    vi.spyOn(cookieHelper, 'verifySessionToken').mockImplementation(async (token: string) =>
      token === 'pending' ? { sub: 'usr_student', cred_id: currentCred } : { sub: 'usr_student' }
    );
    delete process.env.VAULT_MASTER_KEY;
  });

  let currentCred: string | undefined;
  const pendingDevice = (fields: Record<string, unknown> = {}) =>
    vi.spyOn(DeviceCode, 'findOne').mockResolvedValue({ _id: 'd1', client_id: 'cli_tv', scopes: ['openid'], ...fields } as never);

  async function decide(body: Record<string, unknown>, cookie = 'pesu_session=s') {
    const res = await postDecision(
      new NextRequest('http://localhost:3000/api/internal/device', {
        method: 'POST',
        headers: { cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
    );
    return { status: res.status, body: await res.json() };
  }

  it('requires a session, a valid action and a well-formed code', async () => {
    vi.spyOn(cookieHelper, 'verifySessionToken').mockResolvedValueOnce(null);
    expect((await decide({ userCode: 'BDFG-HJKL', action: 'allow' })).status).toBe(401);
    expect((await decide({ userCode: 'BDFG-HJKL', action: 'maybe' })).status).toBe(400);
    expect((await decide({ userCode: 'nope', action: 'allow' })).body.error).toContain('8-character');
  });

  it('rejects unknown codes, suspended clients and non-testers of testing apps', async () => {
    vi.spyOn(DeviceCode, 'findOne').mockResolvedValueOnce(null);
    expect((await decide({ userCode: 'BDFG-HJKL', action: 'allow' })).status).toBe(404);

    pendingDevice();
    vi.spyOn(Client, 'findOne').mockResolvedValueOnce({ ...DEVICE_CLIENT, publishing_status: 'suspended' } as never);
    expect((await decide({ userCode: 'BDFG-HJKL', action: 'allow' })).status).toBe(403);

    vi.spyOn(Client, 'findOne').mockResolvedValueOnce({ ...DEVICE_CLIENT, publishing_status: 'testing' } as never);
    vi.spyOn(ClientTester, 'findOne').mockResolvedValueOnce(null);
    expect((await decide({ userCode: 'BDFG-HJKL', action: 'allow' })).body.error).toContain('testing mode');
  });

  it('lets a tester of a testing app deny, discarding captured credentials', async () => {
    pendingDevice();
    vi.spyOn(Client, 'findOne').mockResolvedValue({ ...DEVICE_CLIENT, publishing_status: 'pending_production' } as never);
    vi.spyOn(ClientTester, 'findOne').mockResolvedValue({ sub: 'usr_student' } as never);
    const update = vi.spyOn(DeviceCode, 'updateOne').mockResolvedValue({} as never);
    currentCred = pendingCredentialStore.put({ username: 'u', password: 'p' });

    expect((await decide({ userCode: 'BDFG-HJKL', action: 'deny' }, 'pesu_session=s; pesu_pending=pending')).body).toEqual({ status: 'denied' });
    expect(update).toHaveBeenCalledWith({ _id: 'd1', status: 'pending' }, { $set: { status: 'denied', sub: 'usr_student' } });
    expect(pendingCredentialStore.get(currentCred)).toBeNull();
  });

  it('refuses scopes whose approval was withdrawn and delegated mode without approval', async () => {
    pendingDevice({ scopes: ['openid', 'seating:read'] });
    vi.spyOn(Client, 'findOne').mockResolvedValueOnce(DEVICE_CLIENT as never);
    expect((await decide({ userCode: 'BDFG-HJKL', action: 'allow' })).body.error).toBe('invalid_scope');

    vi.spyOn(Client, 'findOne').mockResolvedValueOnce({ ...DEVICE_CLIENT, allowed_scopes: ['seating:read'] } as never);
    expect((await decide({ userCode: 'BDFG-HJKL', action: 'allow' })).body.error).toContain('not approved for delegated');
  });

  it('needs credentials or an existing vault for delegated approval, and a master key to store them', async () => {
    const delegatedClient = { ...DEVICE_CLIENT, delegated_allowed: true };
    pendingDevice();
    vi.spyOn(Client, 'findOne').mockResolvedValue(delegatedClient as never);
    vi.spyOn(Vault, 'findOne').mockResolvedValueOnce(null);
    expect((await decide({ userCode: 'BDFG-HJKL', action: 'allow' })).body.error).toContain('Sign in again');

    currentCred = pendingCredentialStore.put({ username: 'u', password: 'p' });
    expect((await decide({ userCode: 'BDFG-HJKL', action: 'allow' }, 'pesu_session=s; pesu_pending=pending')).status).toBe(503);
  });

  it('approves delegated access by sealing captured credentials with the consent', async () => {
    process.env.VAULT_MASTER_KEY = 'unit-test-key';
    pendingDevice();
    vi.spyOn(Client, 'findOne').mockResolvedValue({ ...DEVICE_CLIENT, delegated_allowed: true } as never);
    vi.spyOn(DeviceCode, 'findOneAndUpdate').mockResolvedValue({ _id: 'd1' } as never);
    const consent = vi.spyOn(Consent, 'findOneAndUpdate').mockResolvedValue({} as never);
    const vault = vi.spyOn(Vault, 'findOneAndUpdate').mockResolvedValue({} as never);
    currentCred = pendingCredentialStore.put({ username: 'u', password: 'p' });

    expect((await decide({ userCode: 'BDFG-HJKL', action: 'allow' }, 'pesu_session=s; pesu_pending=pending')).body).toEqual({ status: 'approved' });
    expect(consent.mock.calls[0][1]).toMatchObject({ mode: 'delegated', scopes: ['openid'] });
    expect(vault.mock.calls[0][0]).toEqual({ sub: 'usr_student' });
  });

  it('approves identity access with an existing vault, discards credentials and detects double use', async () => {
    pendingDevice();
    vi.spyOn(Client, 'findOne').mockResolvedValue(DEVICE_CLIENT as never);
    const vault = vi.spyOn(Vault, 'findOneAndUpdate');
    vi.spyOn(DeviceCode, 'findOneAndUpdate').mockResolvedValueOnce({ _id: 'd1' } as never).mockResolvedValueOnce(null);
    vi.spyOn(Consent, 'findOneAndUpdate').mockResolvedValue({} as never);
    currentCred = pendingCredentialStore.put({ username: 'u', password: 'p' });

    expect((await decide({ userCode: 'BDFG-HJKL', action: 'allow' }, 'pesu_session=s; pesu_pending=pending')).status).toBe(200);
    expect(pendingCredentialStore.get(currentCred)).toBeNull();
    expect(vault).not.toHaveBeenCalled();
    expect((await decide({ userCode: 'BDFG-HJKL', action: 'allow' })).status).toBe(409);
  });

  it('uses an existing vault for delegated approval without new credentials', async () => {
    pendingDevice();
    vi.spyOn(Client, 'findOne').mockResolvedValue({ ...DEVICE_CLIENT, delegated_allowed: true } as never);
    vi.spyOn(Vault, 'findOne').mockResolvedValueOnce({ sub: 'usr_student' } as never);
    vi.spyOn(DeviceCode, 'findOneAndUpdate').mockResolvedValueOnce({ _id: 'd1' } as never);
    vi.spyOn(Consent, 'findOneAndUpdate').mockResolvedValue({} as never);
    expect((await decide({ userCode: 'BDFG-HJKL', action: 'allow' })).body).toEqual({ status: 'approved' });
  });

  it('turns unexpected failures into a 400 with the message', async () => {
    vi.spyOn(DeviceCode, 'findOne').mockRejectedValueOnce(new Error('db down'));
    expect((await decide({ userCode: 'BDFG-HJKL', action: 'allow' })).body.error).toBe('db down');
    vi.spyOn(DeviceCode, 'findOne').mockRejectedValueOnce('weird');
    expect((await decide({ userCode: 'BDFG-HJKL', action: 'allow' })).body.error).toBe('Device approval failed');
  });
});

describe('/device page', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(cookieHelper, 'verifySessionToken').mockResolvedValue({ sub: 'usr_student', name: 'Student' });
  });

  const page = async (user_code?: string) => render((await DevicePage({ searchParams: Promise.resolve({ user_code }) })) as React.ReactElement);

  it('sends signed-out students to login and keeps the code', async () => {
    vi.spyOn(cookieHelper, 'verifySessionToken').mockResolvedValue(null);
    await expect(DevicePage({ searchParams: Promise.resolve({ user_code: 'BDFG-HJKL' }) })).rejects.toThrow(
      `REDIRECT:/login?return_to=${encodeURIComponent('/device?user_code=BDFG-HJKL')}`
    );
    await expect(DevicePage({ searchParams: Promise.resolve({}) })).rejects.toThrow(
      `REDIRECT:/login?return_to=${encodeURIComponent('/device')}`
    );
  });

  it('shows the code form, malformed and expired code errors, and unavailable apps', async () => {
    await page();
    expect(screen.getByLabelText('Device code')).toBeDefined();

    await page('xx');
    expect(screen.getByRole('alert').textContent).toContain('8 letters');

    vi.spyOn(DeviceCode, 'findOne').mockResolvedValueOnce(null);
    await page('bdfg-hjkl');
    expect(screen.getAllByRole('alert').at(-1)?.textContent).toContain('expired');

    vi.spyOn(DeviceCode, 'findOne').mockResolvedValueOnce({ client_id: 'cli_tv', scopes: ['openid'] } as never);
    vi.spyOn(Client, 'findOne').mockResolvedValueOnce(null);
    await page('BDFG-HJKL');
    expect(screen.getAllByRole('alert').at(-1)?.textContent).toContain('unavailable');
  });

  it('renders consent in device mode for a pending code', async () => {
    vi.spyOn(DeviceCode, 'findOne').mockResolvedValueOnce({ client_id: 'cli_tv', scopes: ['openid', 'attendance:read'] } as never);
    vi.spyOn(Client, 'findOne').mockResolvedValueOnce({ ...DEVICE_CLIENT, delegated_allowed: true } as never);
    const element = (await DevicePage({ searchParams: Promise.resolve({ user_code: 'bdfghjkl' }) })) as React.ReactElement<{
      deviceUserCode: string;
      mode: string;
    }>;
    expect(element.props.deviceUserCode).toBe('BDFG-HJKL');
    expect(element.props.mode).toBe('delegated');
  });
});

describe('ConsentClient in device mode', () => {
  const renderDevice = () =>
    render(
      <ConsentClient
        client={{ clientId: 'cli_tv', name: 'Club Kiosk', publishingStatus: 'production', delegatedAllowed: false }}
        userName="Student"
        requestedScopes={['openid']}
        mode="identity"
        redirectUri=""
        codeChallenge=""
        codeChallengeMethod="S256"
        deviceUserCode="BDFG-HJKL"
      />
    );

  it('shows the code instead of a redirect and confirms approval', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ status: 'approved' }) } as Response);
    renderDevice();
    expect(screen.getByText('BDFG-HJKL')).toBeDefined();
    expect(screen.queryByText('Redirects to')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /allow/i }));
    await waitFor(() => expect(screen.getByText('You’re signed in.')).toBeDefined());
    expect(global.fetch).toHaveBeenCalledWith('/api/internal/device', expect.objectContaining({ method: 'POST' }));
  });

  it('confirms a denial and surfaces API errors', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ status: 'denied' }) } as Response);
    const { unmount } = renderDevice();
    fireEvent.click(screen.getByRole('button', { name: /deny/i }));
    await waitFor(() => expect(screen.getByText('Sign-in denied.')).toBeDefined());
    unmount();

    global.fetch = vi.fn().mockResolvedValue({ ok: false, json: async () => ({ error: 'This code was already used' }) } as Response);
    renderDevice();
    fireEvent.click(screen.getByRole('button', { name: /allow/i }));
    await waitFor(() => expect(screen.getByText('This code was already used')).toBeDefined());

    global.fetch = vi.fn().mockResolvedValue({ ok: false, json: async () => ({ error_description: 'Client is not approved for: x' }) } as Response);
    fireEvent.click(screen.getByRole('button', { name: /allow/i }));
    await waitFor(() => expect(screen.getByText('Client is not approved for: x')).toBeDefined());

    global.fetch = vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) } as Response);
    fireEvent.click(screen.getByRole('button', { name: /allow/i }));
    await waitFor(() => expect(screen.getByText('Failed to process device sign-in')).toBeDefined());
  });
});

describe('portal device flow toggle', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(cookieHelper, 'verifySessionToken').mockResolvedValue({ sub: 'usr_dev' });
  });

  const patch = (body: Record<string, unknown>) =>
    patchClient(
      new NextRequest('http://localhost:3000/api/internal/portal/clients/cli_tv', {
        method: 'PATCH',
        headers: { cookie: 'pesu_session=s', 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
      { params: Promise.resolve({ clientId: 'cli_tv' }) }
    );

  it('toggles device flow without touching redirect URIs and never returns the secret hash', async () => {
    vi.spyOn(Client, 'findOne').mockResolvedValueOnce({ client_id: 'cli_tv', owner_sub: 'usr_dev', owner_type: 'user' } as never);
    const update = vi.spyOn(Client, 'findOneAndUpdate').mockResolvedValue({ client_id: 'cli_tv' } as never);
    expect((await patch({ deviceFlowEnabled: true })).status).toBe(200);
    const [, set, options] = update.mock.calls[0];
    expect(set).toMatchObject({ device_flow_enabled: true });
    expect(set).not.toHaveProperty('redirect_uris');
    expect(options).toMatchObject({ projection: { client_secret_hash: 0 } });
  });

  it('validates the toggle type', async () => {
    expect((await patch({ deviceFlowEnabled: 'yes' })).status).toBe(400);
  });
});
