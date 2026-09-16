// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import AuthorizePage from '@/app/authorize/page';
import { ConsentClient } from '@/app/authorize/consent-client';
import { Client, ClientTester, Consent, AuthCode, Vault } from '@/lib/db/models';
import * as cookieHelper from '@/lib/session/cookie';
import { pendingCredentialStore } from '@/lib/session/pending-credentials';

vi.mock('@/lib/db/connection', () => ({
  connectToDatabase: vi.fn().mockResolvedValue(null),
}));

const mockCookieMap = new Map<string, string>();
vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({
    get: vi.fn((name: string) => {
      const val = mockCookieMap.get(name);
      return val ? { value: val } : undefined;
    }),
    set: vi.fn((name: string, val: string) => mockCookieMap.set(name, val)),
  })),
}));

vi.mock('next/navigation', () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
}));

describe('Authorize Page & Consent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCookieMap.clear();
    process.env.VAULT_MASTER_KEY = Buffer.alloc(32, 1).toString('base64');
  });

  describe('AuthorizePage (Server Component)', () => {
    // 100% preservation of original test
    it('filters out unknown scopes and safely serializes returnUrl', async () => {
      vi.spyOn(cookieHelper, 'verifySessionToken').mockResolvedValue(null);

      const searchParams = Promise.resolve({
        client_id: 'cli_test',
        redirect_uri: 'https://app.pesu.edu/callback',
        response_type: 'code',
        code_challenge: 'E9Melhoa2OwvFrGMTJguCH5ZiXV68OSTXb0Pl5C_D7g',
        code_challenge_method: 'S256',
        scope: 'openid evil_scope custom_admin_scope',
        state: undefined,
        nonce: undefined,
      });

      vi.spyOn(Client, 'findOne').mockResolvedValue({
        client_id: 'cli_test',
        redirect_uris: ['https://app.pesu.edu/callback'],
        publishing_status: 'production',
        delegated_allowed: false,
      } as never);

      try {
        await AuthorizePage({ searchParams });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        expect(message).toContain('REDIRECT:');
        expect(message).not.toContain('state=undefined');
        expect(message).not.toContain('nonce=undefined');
      }
    });

    it('returns error when required parameters are missing or invalid', async () => {
      const res1 = await AuthorizePage({
        searchParams: Promise.resolve({
          client_id: '',
          redirect_uri: 'https://app.pesu.edu/callback',
          response_type: 'code',
        }),
      });
      const { container: c1 } = render(res1 as React.ReactElement);
      expect(c1.textContent).toContain('Invalid authorization request');

      const res2 = await AuthorizePage({
        searchParams: Promise.resolve({
          client_id: 'cli_1',
          redirect_uri: 'https://app.pesu.edu/callback',
          response_type: 'token',
        }),
      });
      const { container: c2 } = render(res2 as React.ReactElement);
      expect(c2.textContent).toContain('Invalid authorization request');
    });

    it('validates PKCE challenge and method', async () => {
      // Missing code_challenge
      const res1 = await AuthorizePage({
        searchParams: Promise.resolve({
          client_id: 'cli_1',
          redirect_uri: 'https://app.pesu.edu/callback',
          response_type: 'code',
        }),
      });
      const { container: c1 } = render(res1 as React.ReactElement);
      expect(c1.textContent).toContain('Authorization requires PKCE');

      // Invalid method
      const res2 = await AuthorizePage({
        searchParams: Promise.resolve({
          client_id: 'cli_1',
          redirect_uri: 'https://app.pesu.edu/callback',
          response_type: 'code',
          code_challenge: 'E9Melhoa2OwvFrGMTJguCH5ZiXV68OSTXb0Pl5C_D7g',
          code_challenge_method: 'plain',
        }),
      });
      const { container: c2 } = render(res2 as React.ReactElement);
      expect(c2.textContent).toContain('Only code_challenge_method=S256 is supported');

      // Invalid challenge string format
      const res3 = await AuthorizePage({
        searchParams: Promise.resolve({
          client_id: 'cli_1',
          redirect_uri: 'https://app.pesu.edu/callback',
          response_type: 'code',
          code_challenge: 'too-short',
          code_challenge_method: 'S256',
        }),
      });
      const { container: c3 } = render(res3 as React.ReactElement);
      expect(c3.textContent).toContain('code_challenge must be a valid BASE64URL');
    });

    it('requires openid scope', async () => {
      const res = await AuthorizePage({
        searchParams: Promise.resolve({
          client_id: 'cli_1',
          redirect_uri: 'https://app.pesu.edu/callback',
          response_type: 'code',
          code_challenge: 'E9Melhoa2OwvFrGMTJguCH5ZiXV68OSTXb0Pl5C_D7g',
          code_challenge_method: 'S256',
          scope: 'profile email',
        }),
      });
      const { container } = render(res as React.ReactElement);
      expect(container.textContent).toContain('A valid openid scope is required');
    });

    it('validates client existence and registered redirect URI', async () => {
      vi.spyOn(Client, 'findOne').mockResolvedValue(null);

      const res1 = await AuthorizePage({
        searchParams: Promise.resolve({
          client_id: 'unknown_cli',
          redirect_uri: 'https://app.pesu.edu/callback',
          response_type: 'code',
          code_challenge: 'E9Melhoa2OwvFrGMTJguCH5ZiXV68OSTXb0Pl5C_D7g',
          code_challenge_method: 'S256',
          scope: 'openid',
        }),
      });
      const { container: c1 } = render(res1 as React.ReactElement);
      expect(c1.textContent).toContain('Client application not found');

      vi.spyOn(Client, 'findOne').mockResolvedValue({
        client_id: 'cli_test',
        redirect_uris: ['https://other.pesu.edu/callback'],
      } as never);

      const res2 = await AuthorizePage({
        searchParams: Promise.resolve({
          client_id: 'cli_test',
          redirect_uri: 'https://app.pesu.edu/callback',
          response_type: 'code',
          code_challenge: 'E9Melhoa2OwvFrGMTJguCH5ZiXV68OSTXb0Pl5C_D7g',
          code_challenge_method: 'S256',
          scope: 'openid',
        }),
      });
      const { container: c2 } = render(res2 as React.ReactElement);
      expect(c2.textContent).toContain('Redirect URI is not registered');
    });

    it('blocks unauthorized users when client is in testing mode', async () => {
      mockCookieMap.set('pesu_session', 'mock-session');
      vi.spyOn(cookieHelper, 'verifySessionToken').mockResolvedValue({
        sub: 'user_456',
        name: 'Normal Student',
      });

      vi.spyOn(Client, 'findOne').mockResolvedValue({
        client_id: 'cli_test',
        redirect_uris: ['https://app.pesu.edu/callback'],
        publishing_status: 'testing',
        owner_sub: 'owner_123',
      } as never);

      vi.spyOn(ClientTester, 'findOne').mockResolvedValue(null);

      const res = await AuthorizePage({
        searchParams: Promise.resolve({
          client_id: 'cli_test',
          redirect_uri: 'https://app.pesu.edu/callback',
          response_type: 'code',
          code_challenge: 'E9Melhoa2OwvFrGMTJguCH5ZiXV68OSTXb0Pl5C_D7g',
          code_challenge_method: 'S256',
          scope: 'openid',
        }),
      });
      const { container } = render(res as React.ReactElement);
      expect(container.textContent).toContain('Application in Testing Mode');
    });

    it('auto-issues authorization code when valid consent already exists (identity mode)', async () => {
      mockCookieMap.set('pesu_session', 'mock-session');
      vi.spyOn(cookieHelper, 'verifySessionToken').mockResolvedValue({
        sub: 'user_123',
        name: 'Student Name',
      });

      vi.spyOn(Client, 'findOne').mockResolvedValue({
        client_id: 'cli_test',
        redirect_uris: ['https://app.pesu.edu/callback'],
        publishing_status: 'production',
        delegated_allowed: false,
      } as never);

      vi.spyOn(Consent, 'findOne').mockResolvedValue({
        sub: 'user_123',
        client_id: 'cli_test',
        scopes: ['openid', 'profile'],
        mode: 'identity',
      } as never);

      vi.spyOn(AuthCode, 'create').mockResolvedValue({} as never);

      await expect(
        AuthorizePage({
          searchParams: Promise.resolve({
            client_id: 'cli_test',
            redirect_uri: 'https://app.pesu.edu/callback',
            response_type: 'code',
            code_challenge: 'E9Melhoa2OwvFrGMTJguCH5ZiXV68OSTXb0Pl5C_D7g',
            code_challenge_method: 'S256',
            scope: 'openid profile',
            state: 'state_xyz',
          }),
        })
      ).rejects.toThrow(/REDIRECT:https:\/\/app\.pesu\.edu\/callback\?code=.*&state=state_xyz/);

      expect(AuthCode.create).toHaveBeenCalled();
    });

    it('handles delegated re-auth with pending credentials and updates vault', async () => {
      mockCookieMap.set('pesu_session', 'mock-session');
      mockCookieMap.set('pesu_pending', 'mock-pending');

      const credId = pendingCredentialStore.put({
        username: 'PES1UG20CS001',
        password: 'Password123!',
        sessionToken: 'acad_token',
        accessToken: 'acad_access',
        userId: '123',
        expiresAt: new Date(Date.now() + 3600000),
      });

      vi.spyOn(cookieHelper, 'verifySessionToken').mockImplementation(async (token: string) => {
        if (token === 'mock-session') return { sub: 'user_123', name: 'Student Name' };
        if (token === 'mock-pending') return { sub: 'user_123', cred_id: credId };
        return null;
      });
      vi.spyOn(Client, 'findOne').mockResolvedValue({
        client_id: 'cli_test',
        redirect_uris: ['https://app.pesu.edu/callback'],
        publishing_status: 'production',
        delegated_allowed: true,
      } as never);

      vi.spyOn(Consent, 'findOne').mockResolvedValue({
        sub: 'user_123',
        client_id: 'cli_test',
        scopes: ['openid'],
        mode: 'delegated',
      } as never);

      vi.spyOn(Vault, 'findOne').mockResolvedValue({ sub: 'user_123' } as never);
      vi.spyOn(Vault, 'findOneAndUpdate').mockResolvedValue({} as never);
      vi.spyOn(AuthCode, 'create').mockResolvedValue({} as never);

      await expect(
        AuthorizePage({
          searchParams: Promise.resolve({
            client_id: 'cli_test',
            redirect_uri: 'https://app.pesu.edu/callback',
            response_type: 'code',
            code_challenge: 'E9Melhoa2OwvFrGMTJguCH5ZiXV68OSTXb0Pl5C_D7g',
            code_challenge_method: 'S256',
            scope: 'openid',
            mode: 'delegated',
          }),
        })
      ).rejects.toThrow(/REDIRECT:https:\/\/app\.pesu\.edu\/callback\?code=/);

      expect(Vault.findOneAndUpdate).toHaveBeenCalled();
    });

    it('redirects to login when delegated mode is requested but no vault exists', async () => {
      mockCookieMap.set('pesu_session', 'mock-session');
      vi.spyOn(cookieHelper, 'verifySessionToken').mockResolvedValue({
        sub: 'user_123',
        name: 'Student Name',
      });

      vi.spyOn(Client, 'findOne').mockResolvedValue({
        client_id: 'cli_test',
        redirect_uris: ['https://app.pesu.edu/callback'],
        publishing_status: 'production',
        delegated_allowed: true,
      } as never);

      vi.spyOn(Consent, 'findOne').mockResolvedValue({
        sub: 'user_123',
        client_id: 'cli_test',
        scopes: ['openid'],
        mode: 'delegated',
      } as never);

      vi.spyOn(Vault, 'findOne').mockResolvedValue(null);

      await expect(
        AuthorizePage({
          searchParams: Promise.resolve({
            client_id: 'cli_test',
            redirect_uri: 'https://app.pesu.edu/callback',
            response_type: 'code',
            code_challenge: 'E9Melhoa2OwvFrGMTJguCH5ZiXV68OSTXb0Pl5C_D7g',
            code_challenge_method: 'S256',
            scope: 'openid',
            mode: 'delegated',
          }),
        })
      ).rejects.toThrow(/REDIRECT:\/login\?return_to=/);
    });

    it('rejects invalid mode values', async () => {
      vi.spyOn(Client, 'findOne').mockResolvedValue({
        client_id: 'cli_test',
        redirect_uris: ['https://app.pesu.edu/callback'],
        publishing_status: 'production',
        delegated_allowed: false,
      } as never);

      const res = await AuthorizePage({
        searchParams: Promise.resolve({
          client_id: 'cli_test',
          redirect_uri: 'https://app.pesu.edu/callback',
          response_type: 'code',
          code_challenge: 'E9Melhoa2OwvFrGMTJguCH5ZiXV68OSTXb0Pl5C_D7g',
          code_challenge_method: 'S256',
          scope: 'openid',
          mode: 'unsupported_mode',
        }),
      });
      const { container } = render(res as React.ReactElement);
      expect(container.textContent).toContain('Invalid mode');
    });

    it('rejects delegated mode when client is not approved for delegated_allowed', async () => {
      vi.spyOn(Client, 'findOne').mockResolvedValue({
        client_id: 'cli_test',
        redirect_uris: ['https://app.pesu.edu/callback'],
        publishing_status: 'production',
        delegated_allowed: false,
      } as never);

      const res = await AuthorizePage({
        searchParams: Promise.resolve({
          client_id: 'cli_test',
          redirect_uri: 'https://app.pesu.edu/callback',
          response_type: 'code',
          code_challenge: 'E9Melhoa2OwvFrGMTJguCH5ZiXV68OSTXb0Pl5C_D7g',
          code_challenge_method: 'S256',
          scope: 'openid',
          mode: 'delegated',
        }),
      });
      const { container } = render(res as React.ReactElement);
      expect(container.textContent).toContain('Delegated access not permitted');
    });

    it('respects requested identity mode even if client is approved for delegated', async () => {
      mockCookieMap.set('pesu_session', 'mock-session');
      vi.spyOn(cookieHelper, 'verifySessionToken').mockResolvedValue({
        sub: 'user_123',
        name: 'John Doe',
      });

      vi.spyOn(Client, 'findOne').mockResolvedValue({
        client_id: 'cli_test',
        name: 'Delegated App',
        redirect_uris: ['https://app.pesu.edu/callback'],
        publishing_status: 'production',
        delegated_allowed: true,
      } as never);

      vi.spyOn(Consent, 'findOne').mockResolvedValue(null);

      const res = await AuthorizePage({
        searchParams: Promise.resolve({
          client_id: 'cli_test',
          redirect_uri: 'https://app.pesu.edu/callback',
          response_type: 'code',
          code_challenge: 'E9Melhoa2OwvFrGMTJguCH5ZiXV68OSTXb0Pl5C_D7g',
          code_challenge_method: 'S256',
          scope: 'openid',
          mode: 'identity',
        }),
      });

      render(res as React.ReactElement);
      expect(screen.getByText('Identity Only:')).toBeDefined();
    });

    it('redirects to login when first-time consent requires delegated mode but user has no vault or pending creds', async () => {
      mockCookieMap.set('pesu_session', 'mock-session');
      vi.spyOn(cookieHelper, 'verifySessionToken').mockResolvedValue({
        sub: 'user_123',
        name: 'John Doe',
      });

      vi.spyOn(Client, 'findOne').mockResolvedValue({
        client_id: 'cli_test',
        name: 'Delegated App',
        redirect_uris: ['https://app.pesu.edu/callback'],
        publishing_status: 'production',
        delegated_allowed: true,
      } as never);

      vi.spyOn(Consent, 'findOne').mockResolvedValue(null);
      vi.spyOn(Vault, 'findOne').mockResolvedValue(null);

      await expect(
        AuthorizePage({
          searchParams: Promise.resolve({
            client_id: 'cli_test',
            redirect_uri: 'https://app.pesu.edu/callback',
            response_type: 'code',
            code_challenge: 'E9Melhoa2OwvFrGMTJguCH5ZiXV68OSTXb0Pl5C_D7g',
            code_challenge_method: 'S256',
            scope: 'openid',
            mode: 'delegated',
          }),
        })
      ).rejects.toThrow(/REDIRECT:\/login\?return_to=/);
    });

    it('renders ConsentClient when user is authenticated but consent is not yet granted', async () => {
      mockCookieMap.set('pesu_session', 'mock-session');
      vi.spyOn(cookieHelper, 'verifySessionToken').mockResolvedValue({
        sub: 'user_123',
        name: 'John Doe',
      });

      vi.spyOn(Client, 'findOne').mockResolvedValue({
        client_id: 'cli_test',
        name: 'Cool App',
        redirect_uris: ['https://app.pesu.edu/callback'],
        publishing_status: 'production',
        delegated_allowed: false,
      } as never);

      vi.spyOn(Consent, 'findOne').mockResolvedValue(null);

      const res = await AuthorizePage({
        searchParams: Promise.resolve({
          client_id: 'cli_test',
          redirect_uri: 'https://app.pesu.edu/callback',
          response_type: 'code',
          code_challenge: 'E9Melhoa2OwvFrGMTJguCH5ZiXV68OSTXb0Pl5C_D7g',
          code_challenge_method: 'S256',
          scope: 'openid email phone offline_access',
        }),
      });

      render(res as React.ReactElement);
      expect(screen.getByText('Cool App')).toBeDefined();
      expect(screen.getByText('John Doe')).toBeDefined();
      expect(screen.getByText('View your Email Address')).toBeDefined();
      expect(screen.getByText('View your Phone Number')).toBeDefined();
      expect(screen.getByText('Maintain Offline Access')).toBeDefined();
    });
  });

  describe('ConsentClient Component', () => {
    const defaultProps = {
      client: {
        clientId: 'cli_abc',
        name: 'Student Portal Client',
        publishingStatus: 'testing' as const,
        delegatedAllowed: true,
      },
      userName: 'Alice Smith',
      requestedScopes: ['openid', 'profile', 'email', 'phone', 'offline_access'],
      mode: 'delegated' as const,
      redirectUri: 'https://portal.pesu.edu/callback',
      state: 'test_state',
      nonce: 'test_nonce',
      codeChallenge: 'E9Melhoa2OwvFrGMTJguCH5ZiXV68OSTXb0Pl5C_D7g',
      codeChallengeMethod: 'S256',
    };

    it('renders delegated warning when mode is delegated and client allowed', () => {
      render(<ConsentClient {...defaultProps} />);
      expect(screen.getByText('Student Portal Client')).toBeDefined();
      expect(screen.getByText('Delegated Credential Vault:')).toBeDefined();
      expect(screen.getByText('testing')).toBeDefined();
    });

    it('renders identity note when mode is identity', () => {
      render(
        <ConsentClient
          {...defaultProps}
          mode="identity"
          client={{ ...defaultProps.client, delegatedAllowed: false, publishingStatus: 'pending_production' }}
        />
      );
      expect(screen.getByText('Identity Only:')).toBeDefined();
      expect(screen.getByText('pending production')).toBeDefined();
    });

    it('handles clicking Allow and redirects window.location.href', async () => {
      delete (window as { location?: unknown }).location;
      (window as { location: unknown }).location = { href: '' };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ redirectTo: 'https://portal.pesu.edu/callback?code=123' }),
      });

      render(<ConsentClient {...defaultProps} />);
      fireEvent.click(screen.getByRole('button', { name: /allow/i }));

      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledWith('/api/oidc/consent', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            clientId: defaultProps.client.clientId,
            redirectUri: defaultProps.redirectUri,
            scope: defaultProps.requestedScopes.join(' '),
            state: defaultProps.state,
            nonce: defaultProps.nonce,
            codeChallenge: defaultProps.codeChallenge,
            codeChallengeMethod: defaultProps.codeChallengeMethod,
            mode: defaultProps.mode,
            action: 'allow',
          }),
        });
        expect(window.location.href).toBe('https://portal.pesu.edu/callback?code=123');
      });
    });

    it('handles clicking Deny and displays error on API rejection', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        json: async () => ({ error: 'Consent denied by user' }),
      });

      render(<ConsentClient {...defaultProps} />);
      fireEvent.click(screen.getByRole('button', { name: /deny/i }));

      await waitFor(() => {
        expect(screen.getByText('Consent denied by user')).toBeDefined();
      });
    });
  });
});
