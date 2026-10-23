// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { NextRequest } from 'next/server';
import AuthorizePage from '@/app/oauth2/authorize/page';
import { ConsentClient } from '@/app/oauth2/authorize/consent-client';
import { POST as postConsent } from '@/app/api/internal/consent/route';
import { Client, Consent, Vault } from '@/lib/db/models';
import * as cookieHelper from '@/lib/session/cookie';

vi.mock('@/lib/db/connection', () => ({ connectToDatabase: vi.fn().mockResolvedValue(null) }));
vi.mock('@/lib/db/transaction', () => ({
  withTransaction: vi.fn(async (fn: (session: unknown) => Promise<unknown>) => fn({ id: 'mock-session' })),
}));
vi.mock('@/lib/mailer', () => ({ notifySubQuietly: vi.fn() }));
vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({ get: vi.fn(() => ({ value: 'session' })), set: vi.fn() })),
}));
vi.mock('next/navigation', () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
}));

const CHALLENGE = 'E9Melhoa2OwvFrGMTJguCH5ZiXV68OSTXb0Pl5C_D7g';
const REDIRECT = 'https://app.pesu.edu/callback';

function client(fields: Record<string, unknown> = {}) {
  vi.spyOn(Client, 'findOne').mockResolvedValue({
    client_id: 'cli_api',
    name: 'Attendance Buddy',
    owner_sub: 'usr_dev',
    redirect_uris: [REDIRECT],
    publishing_status: 'production',
    delegated_allowed: true,
    allowed_scopes: ['attendance:read'],
    ...fields,
  } as never);
}

function authorize(scope: string, extra: Record<string, string> = {}) {
  return AuthorizePage({
    searchParams: Promise.resolve({
      client_id: 'cli_api',
      redirect_uri: REDIRECT,
      response_type: 'code',
      code_challenge: CHALLENGE,
      code_challenge_method: 'S256',
      scope,
      ...extra,
    }),
  });
}

describe('authorize with resource scopes', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(cookieHelper, 'verifySessionToken').mockResolvedValue({ sub: 'usr_student', name: 'Student' });
  });

  it('rejects resource scopes the client is not approved for', async () => {
    client({ allowed_scopes: [] });
    const { container } = render((await authorize('openid results:read')) as React.ReactElement);
    expect(container.textContent).toContain('invalid_scope');
    expect(container.textContent).toContain('results:read');
  });

  it('rejects mode=identity combined with a resource scope', async () => {
    client();
    const { container } = render((await authorize('openid attendance:read', { mode: 'identity' })) as React.ReactElement);
    expect(container.textContent).toContain('need delegated mode');
  });

  it('derives delegated mode from approved resource scopes and asks for consent', async () => {
    client();
    vi.spyOn(Vault, 'findOne').mockResolvedValue({ sub: 'usr_student' } as never);
    vi.spyOn(Consent, 'findOne').mockResolvedValue(null);
    const element = (await authorize('openid attendance:read')) as React.ReactElement<{ mode: string; requestedScopes: string[] }>;
    expect(element.props.mode).toBe('delegated');
    expect(element.props.requestedScopes).toEqual(['openid', 'attendance:read']);
  });
});

describe('consent screen resource scopes', () => {
  it('lists PESU Academy data scopes with their plain-language labels', () => {
    render(
      <ConsentClient
        client={{ clientId: 'cli_api', name: 'Attendance Buddy', publishingStatus: 'production', delegatedAllowed: true }}
        userName="Student"
        requestedScopes={['openid', 'attendance:read', 'results:read', 'bogus']}
        mode="delegated"
        redirectUri={REDIRECT}
        codeChallenge={CHALLENGE}
        codeChallengeMethod="S256"
      />
    );
    expect(screen.getByText('PESU Academy data, read on your behalf:')).toBeDefined();
    expect(screen.getByText('Read your attendance')).toBeDefined();
    expect(screen.getByText('Read your results')).toBeDefined();
    expect(screen.getByText('Delegated Credential Vault:')).toBeDefined();
  });

  it('omits the data group for identity-only requests', () => {
    render(
      <ConsentClient
        client={{ clientId: 'cli_id', name: 'Club Site', publishingStatus: 'production', delegatedAllowed: false }}
        userName="Student"
        requestedScopes={['openid', 'profile']}
        mode="identity"
        redirectUri={REDIRECT}
        codeChallenge={CHALLENGE}
        codeChallengeMethod="S256"
      />
    );
    expect(screen.queryByText('PESU Academy data, read on your behalf:')).toBeNull();
  });
});

describe('consent API with resource scopes', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(cookieHelper, 'verifySessionToken').mockResolvedValue({ sub: 'usr_student' });
  });

  function consent(body: Record<string, unknown>) {
    return postConsent(
      new NextRequest('http://localhost:3000/api/internal/consent', {
        method: 'POST',
        headers: { cookie: 'pesu_session=valid', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientId: 'cli_api',
          redirectUri: REDIRECT,
          codeChallenge: CHALLENGE,
          codeChallengeMethod: 'S256',
          action: 'allow',
          ...body,
        }),
      })
    );
  }

  it('rejects identity mode with a resource scope', async () => {
    client();
    const res = await consent({ scope: 'openid attendance:read', mode: 'identity' });
    expect(res.status).toBe(400);
    expect((await res.json()).error_description).toContain('delegated mode');
  });

  it('rejects resource scopes the client is not approved for', async () => {
    client({ allowed_scopes: [] });
    const res = await consent({ scope: 'openid seating:read' });
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBe('invalid_scope');
    expect(data.error_description).toContain('seating:read');
  });
});
