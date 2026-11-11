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
    delegated_allowed: false,
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

  it('does not need admin approval for resource scopes', async () => {
    client();
    vi.spyOn(Vault, 'findOne').mockResolvedValue({ sub: 'usr_student' } as never);
    vi.spyOn(Consent, 'findOne').mockResolvedValue(null);
    const element = (await authorize('openid results:read', { mode: 'delegated' })) as React.ReactElement<{ mode: string }>;
    expect(element.props.mode).toBe('delegated');
  });

  it('keeps delegated mode without a resource scope admin-gated', async () => {
    client();
    const { container } = render((await authorize('openid', { mode: 'delegated' })) as React.ReactElement);
    expect(container.textContent).toContain('not approved for delegated vault access');
  });

  it('rejects mode=identity combined with a resource scope', async () => {
    client();
    const { container } = render((await authorize('openid attendance:read', { mode: 'identity' })) as React.ReactElement);
    expect(container.textContent).toContain('need delegated mode');
  });

  it('derives delegated mode from resource scopes and asks for consent', async () => {
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
        client={{ clientId: 'cli_api', name: 'Attendance Buddy', publishingStatus: 'production', delegatedAllowed: false }}
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

  it('keeps delegated mode without a resource scope admin-gated', async () => {
    client();
    const res = await consent({ scope: 'openid', mode: 'delegated' });
    expect(res.status).toBe(403);
    expect((await res.json()).error).toContain('not approved for delegated');
  });
});
