import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST as postExchange } from '@/app/oauth/token-exchange/route';
import { Consent, Vault, User } from '@/lib/db/models';
import * as jwtHelper from '@/lib/oidc/jwt';

vi.mock('@/lib/db/connection', () => ({
  connectToDatabase: vi.fn().mockResolvedValue(null),
}));

const mockEnvelopeOpen = vi.fn();
vi.mock('@/lib/crypto/envelope', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/crypto/envelope')>();
  return {
    ...actual,
    open: (...args: unknown[]) => mockEnvelopeOpen(...args),
  };
});

const mockAcademyLogin = vi.fn();
vi.mock('@/lib/academy/client', () => ({
  AcademyClient: class {
    login = (...args: unknown[]) => mockAcademyLogin(...args);
  },
}));

describe('Token Exchange Endpoint (/oauth/token-exchange)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects missing or invalid token exchange secret with 401', async () => {
    const req = new Request('http://localhost:3000/oauth/token-exchange', {
      method: 'POST',
      headers: { 'x-token-exchange-secret': 'wrong-secret' },
    });

    const res = await postExchange(req);
    expect(res.status).toBe(401);
  });

  it('rejects exchange when caller client is not first-party client with 403', async () => {
    process.env.TOKEN_EXCHANGE_SECRET = 'correct-secret';
    process.env.FIRST_PARTY_API_CLIENT_ID = 'cli_pesu_api';

    vi.spyOn(jwtHelper, 'verifyAccessToken').mockResolvedValueOnce({
      sub: 'usr_1',
      client_id: 'cli_third_party',
      scope: 'openid',
    });

    const req = new Request('http://localhost:3000/oauth/token-exchange', {
      method: 'POST',
      headers: {
        'x-token-exchange-secret': 'correct-secret',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ access_token: 'valid_jwt' }),
    });

    const res = await postExchange(req);
    expect(res.status).toBe(403);
    const data = await res.json();
    expect(data.error_description).toContain('first-party API client');
  });

  it('rejects exchange when delegated consent is absent', async () => {
    process.env.TOKEN_EXCHANGE_SECRET = 'correct-secret';
    process.env.FIRST_PARTY_API_CLIENT_ID = 'cli_pesu_api';

    vi.spyOn(jwtHelper, 'verifyAccessToken').mockResolvedValueOnce({
      sub: 'usr_1',
      client_id: 'cli_pesu_api',
      scope: 'openid',
    });
    vi.spyOn(Consent, 'findOne').mockResolvedValueOnce(null);

    const req = new Request('http://localhost:3000/oauth/token-exchange', {
      method: 'POST',
      headers: {
        'x-token-exchange-secret': 'correct-secret',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ access_token: 'valid_jwt' }),
    });

    const res = await postExchange(req);
    expect(res.status).toBe(403);
    const data = await res.json();
    expect(data.error_description).toBe('Delegated consent required');
  });

  it('omits absent optional fields (access_token, user_id) when null/undefined', async () => {
    process.env.TOKEN_EXCHANGE_SECRET = 'valid-secret';
    process.env.FIRST_PARTY_API_CLIENT_ID = 'cli_pesu_api';
    process.env.VAULT_MASTER_KEY = 'valid-vault-master-key-that-is-long-enough-for-hkdf';

    vi.spyOn(jwtHelper, 'verifyAccessToken').mockResolvedValueOnce({
      sub: 'usr_sub',
      client_id: 'cli_pesu_api',
      scope: 'openid',
    });
    vi.spyOn(Consent, 'findOne').mockResolvedValueOnce({
      sub: 'usr_sub',
      client_id: 'cli_pesu_api',
      mode: 'delegated',
    } as unknown as InstanceType<typeof Consent>);
    vi.spyOn(Vault, 'findOne').mockResolvedValueOnce({
      sub: 'usr_sub',
      encrypted_session: 'YWJj',
      session_nonce: 'bm9uY2U=',
      session_wrap_nonce: 'd3JhcA==',
      session_wrapped_dek: 'ZGVr',
      session_expires_at: new Date(Date.now() + 3600000),
      key_version: 1,
    } as unknown as InstanceType<typeof Vault>);

    mockEnvelopeOpen.mockReturnValue(Buffer.from(JSON.stringify({ token: 'sess_tok_123' })));

    const req = new Request('http://localhost:3000/oauth/token-exchange', {
      method: 'POST',
      headers: {
        'x-token-exchange-secret': 'valid-secret',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ access_token: 'valid_jwt' }).toString(),
    });

    const res = await postExchange(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.token).toBe('sess_tok_123');
    expect(data).not.toHaveProperty('access_token');
    expect(data).not.toHaveProperty('user_id');
  });

  it('rejects request without access_token with 400', async () => {
    process.env.TOKEN_EXCHANGE_SECRET = 'valid-secret';

    const req = new Request('http://localhost:3000/oauth/token-exchange', {
      method: 'POST',
      headers: {
        'x-token-exchange-secret': 'valid-secret',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({}),
    });

    const res = await postExchange(req);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBe('invalid_request');
  });

  it('rejects expired or invalid access token with 401', async () => {
    process.env.TOKEN_EXCHANGE_SECRET = 'valid-secret';

    vi.spyOn(jwtHelper, 'verifyAccessToken').mockRejectedValueOnce(new Error('Token expired'));

    const req = new Request('http://localhost:3000/oauth/token-exchange', {
      method: 'POST',
      headers: {
        'x-token-exchange-secret': 'valid-secret',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ access_token: 'bad_token' }),
    });

    const res = await postExchange(req);
    expect(res.status).toBe(401);
    const data = await res.json();
    expect(data.error).toBe('unauthorized');
  });

  it('returns 503 if vault master key is not configured', async () => {
    process.env.TOKEN_EXCHANGE_SECRET = 'valid-secret';
    process.env.FIRST_PARTY_API_CLIENT_ID = 'cli_pesu_api';
    delete process.env.VAULT_MASTER_KEY;

    vi.spyOn(jwtHelper, 'verifyAccessToken').mockResolvedValueOnce({
      sub: 'usr_sub',
      client_id: 'cli_pesu_api',
      scope: 'openid',
    });
    vi.spyOn(Consent, 'findOne').mockResolvedValueOnce({
      sub: 'usr_sub',
      client_id: 'cli_pesu_api',
      mode: 'delegated',
    } as unknown as InstanceType<typeof Consent>);

    const req = new Request('http://localhost:3000/oauth/token-exchange', {
      method: 'POST',
      headers: {
        'x-token-exchange-secret': 'valid-secret',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ access_token: 'valid_jwt' }),
    });

    const res = await postExchange(req);
    expect(res.status).toBe(503);
    const data = await res.json();
    expect(data.error).toBe('misconfigured');
  });

  it('returns 403 if no vault credentials exist for subject', async () => {
    process.env.TOKEN_EXCHANGE_SECRET = 'valid-secret';
    process.env.FIRST_PARTY_API_CLIENT_ID = 'cli_pesu_api';
    process.env.VAULT_MASTER_KEY = 'valid-vault-master-key-that-is-long-enough-for-hkdf';

    vi.spyOn(jwtHelper, 'verifyAccessToken').mockResolvedValueOnce({
      sub: 'usr_sub',
      client_id: 'cli_pesu_api',
      scope: 'openid',
    });
    vi.spyOn(Consent, 'findOne').mockResolvedValueOnce({
      sub: 'usr_sub',
      client_id: 'cli_pesu_api',
      mode: 'delegated',
    } as unknown as InstanceType<typeof Consent>);
    vi.spyOn(Vault, 'findOne').mockResolvedValueOnce(null);

    const req = new Request('http://localhost:3000/oauth/token-exchange', {
      method: 'POST',
      headers: {
        'x-token-exchange-secret': 'valid-secret',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ access_token: 'valid_jwt' }),
    });

    const res = await postExchange(req);
    expect(res.status).toBe(403);
    const data = await res.json();
    expect(data.error_description).toContain('No vault credentials');
  });

  it('returns 403 if vault password credentials cannot be decrypted', async () => {
    process.env.TOKEN_EXCHANGE_SECRET = 'valid-secret';
    process.env.FIRST_PARTY_API_CLIENT_ID = 'cli_pesu_api';
    process.env.VAULT_MASTER_KEY = 'valid-vault-master-key-that-is-long-enough-for-hkdf';

    vi.spyOn(jwtHelper, 'verifyAccessToken').mockResolvedValueOnce({
      sub: 'usr_sub',
      client_id: 'cli_pesu_api',
      scope: 'openid',
    });
    vi.spyOn(Consent, 'findOne').mockResolvedValueOnce({
      sub: 'usr_sub',
      client_id: 'cli_pesu_api',
      mode: 'delegated',
    } as unknown as InstanceType<typeof Consent>);
    vi.spyOn(Vault, 'findOne').mockResolvedValueOnce({
      sub: 'usr_sub',
      encrypted_password: 'YWJj',
      password_nonce: 'bm9uY2U=',
      password_wrap_nonce: 'd3JhcA==',
      password_wrapped_dek: 'ZGVr',
      key_version: 1,
    } as unknown as InstanceType<typeof Vault>);

    mockEnvelopeOpen.mockImplementation(() => {
      throw new Error('Decryption failure');
    });

    const req = new Request('http://localhost:3000/oauth/token-exchange', {
      method: 'POST',
      headers: {
        'x-token-exchange-secret': 'valid-secret',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ access_token: 'valid_jwt' }),
    });

    const res = await postExchange(req);
    expect(res.status).toBe(403);
    const data = await res.json();
    expect(data.error_description).toBe('Vault credentials unreadable');
  });

  it('returns 403 when user is not found or deleted during session refresh', async () => {
    process.env.TOKEN_EXCHANGE_SECRET = 'valid-secret';
    process.env.FIRST_PARTY_API_CLIENT_ID = 'cli_pesu_api';
    process.env.VAULT_MASTER_KEY = 'valid-vault-master-key-that-is-long-enough-for-hkdf';

    vi.spyOn(jwtHelper, 'verifyAccessToken').mockResolvedValueOnce({
      sub: 'usr_sub',
      client_id: 'cli_pesu_api',
      scope: 'openid',
    });
    vi.spyOn(Consent, 'findOne').mockResolvedValueOnce({
      sub: 'usr_sub',
      client_id: 'cli_pesu_api',
      mode: 'delegated',
    } as unknown as InstanceType<typeof Consent>);
    vi.spyOn(Vault, 'findOne').mockResolvedValueOnce({
      sub: 'usr_sub',
      encrypted_password: 'YWJj',
      password_nonce: 'bm9uY2U=',
      password_wrap_nonce: 'd3JhcA==',
      password_wrapped_dek: 'ZGVr',
      key_version: 1,
      session_expires_at: new Date(Date.now() - 10000), // Expired!
    } as unknown as InstanceType<typeof Vault>);

    mockEnvelopeOpen.mockReturnValue(Buffer.from('UserPassword123'));
    vi.spyOn(User, 'findOne').mockResolvedValueOnce(null);

    const req = new Request('http://localhost:3000/oauth/token-exchange', {
      method: 'POST',
      headers: {
        'x-token-exchange-secret': 'valid-secret',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ access_token: 'valid_jwt' }),
    });

    const res = await postExchange(req);
    expect(res.status).toBe(403);
    const data = await res.json();
    expect(data.error_description).toBe('User not found or deleted');
  });

  it('refreshes expired Academy session and returns updated tokens', async () => {
    process.env.TOKEN_EXCHANGE_SECRET = 'valid-secret';
    process.env.FIRST_PARTY_API_CLIENT_ID = 'cli_pesu_api';
    process.env.VAULT_MASTER_KEY = 'valid-vault-master-key-that-is-long-enough-for-hkdf';

    vi.spyOn(jwtHelper, 'verifyAccessToken').mockResolvedValueOnce({
      sub: 'usr_sub',
      client_id: 'cli_pesu_api',
      scope: 'openid',
    });
    vi.spyOn(Consent, 'findOne').mockResolvedValueOnce({
      sub: 'usr_sub',
      client_id: 'cli_pesu_api',
      mode: 'delegated',
    } as unknown as InstanceType<typeof Consent>);

    const mockVaultDoc = {
      sub: 'usr_sub',
      username: 'PES1UG20CS001',
      encrypted_password: 'YWJj',
      password_nonce: 'bm9uY2U=',
      password_wrap_nonce: 'd3JhcA==',
      password_wrapped_dek: 'ZGVr',
      key_version: 1,
      session_expires_at: new Date(Date.now() - 10000),
      save: vi.fn().mockResolvedValue(true),
    };
    vi.spyOn(Vault, 'findOne').mockResolvedValueOnce(mockVaultDoc as unknown as InstanceType<typeof Vault>);

    mockEnvelopeOpen.mockReturnValue(Buffer.from('UserPassword123'));
    vi.spyOn(User, 'findOne').mockResolvedValueOnce({ sub: 'usr_sub' } as unknown as InstanceType<typeof User>);

    mockAcademyLogin.mockResolvedValueOnce({
      session: {
        token: 'new_acad_token',
        accessToken: 'new_access',
        userId: '999',
        expiresAt: new Date(Date.now() + 86400000),
      },
    });

    const req = new Request('http://localhost:3000/oauth/token-exchange', {
      method: 'POST',
      headers: {
        'x-token-exchange-secret': 'valid-secret',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ access_token: 'valid_jwt' }),
    });

    const res = await postExchange(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.token).toBe('new_acad_token');
    expect(data.access_token).toBe('new_access');
    expect(data.user_id).toBe('999');
    expect(mockVaultDoc.save).toHaveBeenCalled();
  });

  it('returns 502 when Academy session refresh fails', async () => {
    process.env.TOKEN_EXCHANGE_SECRET = 'valid-secret';
    process.env.FIRST_PARTY_API_CLIENT_ID = 'cli_pesu_api';
    process.env.VAULT_MASTER_KEY = 'valid-vault-master-key-that-is-long-enough-for-hkdf';

    vi.spyOn(jwtHelper, 'verifyAccessToken').mockResolvedValueOnce({
      sub: 'usr_sub',
      client_id: 'cli_pesu_api',
      scope: 'openid',
    });
    vi.spyOn(Consent, 'findOne').mockResolvedValueOnce({
      sub: 'usr_sub',
      client_id: 'cli_pesu_api',
      mode: 'delegated',
    } as unknown as InstanceType<typeof Consent>);

    const mockVaultDoc = {
      sub: 'usr_sub',
      username: 'PES1UG20CS001',
      encrypted_password: 'YWJj',
      password_nonce: 'bm9uY2U=',
      password_wrap_nonce: 'd3JhcA==',
      password_wrapped_dek: 'ZGVr',
      key_version: 1,
      session_expires_at: new Date(Date.now() - 10000),
      save: vi.fn(),
    };
    vi.spyOn(Vault, 'findOne').mockResolvedValueOnce(mockVaultDoc as unknown as InstanceType<typeof Vault>);

    mockEnvelopeOpen.mockReturnValue(Buffer.from('UserPassword123'));
    vi.spyOn(User, 'findOne').mockResolvedValueOnce({ sub: 'usr_sub' } as unknown as InstanceType<typeof User>);

    mockAcademyLogin.mockRejectedValueOnce(new Error('Academy down'));

    const req = new Request('http://localhost:3000/oauth/token-exchange', {
      method: 'POST',
      headers: {
        'x-token-exchange-secret': 'valid-secret',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ access_token: 'valid_jwt' }),
    });

    const res = await postExchange(req);
    expect(res.status).toBe(502);
    const data = await res.json();
    expect(data.error).toBe('academy_unavailable');
  });
});

