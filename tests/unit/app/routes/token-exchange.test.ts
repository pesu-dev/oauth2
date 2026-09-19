import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST as postExchange } from '@/app/oauth2/token-exchange/route';
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
      nonce: Buffer.alloc(12),
      ciphertext: Buffer.alloc(32),
      wrap_nonce: Buffer.alloc(12),
      wrapped_dek: Buffer.alloc(48),
      session_expires_at: new Date(Date.now() + 3600000),
      key_version: 1,
    } as unknown as InstanceType<typeof Vault>);

    mockEnvelopeOpen.mockReturnValue(
      Buffer.from(
        JSON.stringify({
          username: 'PES1UG20CS001',
          password: 'pass',
          session: { token: 'sess_tok_123' },
        })
      )
    );

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
      nonce: Buffer.alloc(12),
      ciphertext: Buffer.alloc(32),
      wrap_nonce: Buffer.alloc(12),
      wrapped_dek: Buffer.alloc(48),
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
      nonce: Buffer.alloc(12),
      ciphertext: Buffer.alloc(32),
      wrap_nonce: Buffer.alloc(12),
      wrapped_dek: Buffer.alloc(48),
      key_version: 1,
      session_expires_at: new Date(Date.now() - 10000), // Expired!
    } as unknown as InstanceType<typeof Vault>);

    mockEnvelopeOpen.mockReturnValue(
      Buffer.from(
        JSON.stringify({
          username: 'PES1UG20CS001',
          password: 'UserPassword123',
        })
      )
    );
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
      nonce: Buffer.alloc(12),
      ciphertext: Buffer.alloc(32),
      wrap_nonce: Buffer.alloc(12),
      wrapped_dek: Buffer.alloc(48),
      key_version: 1,
      session_expires_at: new Date(Date.now() - 10000),
      save: vi.fn().mockResolvedValue(true),
    };
    vi.spyOn(Vault, 'findOne').mockResolvedValueOnce(mockVaultDoc as unknown as InstanceType<typeof Vault>);

    mockEnvelopeOpen.mockReturnValue(
      Buffer.from(
        JSON.stringify({
          username: 'PES1UG20CS001',
          password: 'UserPassword123',
        })
      )
    );
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
      nonce: Buffer.alloc(12),
      ciphertext: Buffer.alloc(32),
      wrap_nonce: Buffer.alloc(12),
      wrapped_dek: Buffer.alloc(48),
      key_version: 1,
      session_expires_at: new Date(Date.now() - 10000),
      save: vi.fn(),
    };
    vi.spyOn(Vault, 'findOne').mockResolvedValueOnce(mockVaultDoc as unknown as InstanceType<typeof Vault>);

    mockEnvelopeOpen.mockReturnValue(
      Buffer.from(
        JSON.stringify({
          username: 'PES1UG20CS001',
          password: 'UserPassword123',
        })
      )
    );
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

  it('returns valid cached session from single-envelope vault', async () => {
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
      nonce: Buffer.alloc(12),
      ciphertext: Buffer.alloc(32),
      wrap_nonce: Buffer.alloc(12),
      wrapped_dek: Buffer.alloc(48),
      session_expires_at: new Date(Date.now() + 3600000),
      key_version: 1,
    } as unknown as InstanceType<typeof Vault>);

    mockEnvelopeOpen.mockReturnValue(
      Buffer.from(
        JSON.stringify({
          username: 'PES1UG20CS001',
          password: 'pass',
          session: { token: 'raw_plain_session_cookie' },
        })
      )
    );

    const req = new Request('http://localhost:3000/oauth/token-exchange', {
      method: 'POST',
      headers: {
        'x-token-exchange-secret': 'valid-secret',
        'Content-Type': 'text/plain',
      },
      body: 'access_token=valid_jwt',
    });

    const res = await postExchange(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.token).toBe('raw_plain_session_cookie');
  });

  it('handles body extraction errors gracefully (invalid JSON and formData rejection)', async () => {
    process.env.TOKEN_EXCHANGE_SECRET = 'valid-secret';

    // 1. Invalid JSON body
    const reqJson = new Request('http://localhost:3000/oauth/token-exchange', {
      method: 'POST',
      headers: {
        'x-token-exchange-secret': 'valid-secret',
        'Content-Type': 'application/json',
      },
      body: 'not valid json {{{',
    });
    const resJson = await postExchange(reqJson);
    expect(resJson.status).toBe(400);

    // 2. Invalid formData body
    const reqForm = new Request('http://localhost:3000/oauth/token-exchange', {
      method: 'POST',
      headers: {
        'x-token-exchange-secret': 'valid-secret',
        'Content-Type': 'multipart/form-data; boundary=invalid',
      },
      body: 'bad boundary content',
    });
    const resForm = await postExchange(reqForm);
    expect(resForm.status).toBe(400);
  });

  it('authenticates via Authorization Bearer header', async () => {
    process.env.TOKEN_EXCHANGE_SECRET = 'valid-secret';

    // 1. Bearer header matching secret length but wrong characters
    const reqWrongEqualLen = new Request('http://localhost:3000/oauth/token-exchange', {
      method: 'POST',
      headers: {
        authorization: 'Bearer wrong-secre!',
      },
    });
    expect((await postExchange(reqWrongEqualLen)).status).toBe(401);

    // 2. Bearer header with different length (timingSafeEqual throws caught error)
    const reqWrongDiffLen = new Request('http://localhost:3000/oauth/token-exchange', {
      method: 'POST',
      headers: {
        authorization: 'Bearer short',
      },
    });
    expect((await postExchange(reqWrongDiffLen)).status).toBe(401);

    // 3. Valid Bearer header
    const reqValid = new Request('http://localhost:3000/oauth/token-exchange', {
      method: 'POST',
      headers: {
        authorization: 'Bearer valid-secret',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({}),
    });
    // Missing access token results in 400 instead of 401
    expect((await postExchange(reqValid)).status).toBe(400);

    // 4. x-token-exchange-secret matching length but wrong characters
    const reqHeaderEqualLen = new Request('http://localhost:3000/oauth/token-exchange', {
      method: 'POST',
      headers: {
        'x-token-exchange-secret': 'wrong-secre!',
      },
    });
    expect((await postExchange(reqHeaderEqualLen)).status).toBe(401);

    // 5. x-token-exchange-secret different length
    const reqHeaderDiffLen = new Request('http://localhost:3000/oauth/token-exchange', {
      method: 'POST',
      headers: {
        'x-token-exchange-secret': 'short',
      },
    });
    expect((await postExchange(reqHeaderDiffLen)).status).toBe(401);
  });

  it('rejects when token payload has missing/undefined client_id', async () => {
    process.env.TOKEN_EXCHANGE_SECRET = 'valid-secret';
    process.env.FIRST_PARTY_API_CLIENT_ID = 'cli_pesu_api';

    vi.spyOn(jwtHelper, 'verifyAccessToken').mockResolvedValueOnce({
      sub: 'usr_1',
      scope: 'openid',
    } as never);

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
    expect(data.error_description).toContain('first-party API client');
  });

  it('handles request body stream failure when extracting access token', async () => {
    process.env.TOKEN_EXCHANGE_SECRET = 'valid-secret';

    const brokenReq = {
      headers: new Headers({
        'x-token-exchange-secret': 'valid-secret',
        'Content-Type': 'text/plain',
      }),
      text: vi.fn().mockRejectedValueOnce(new Error('Stream read failed')),
    } as unknown as Request;

    const res = await postExchange(brokenReq);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error_description).toBe('access_token is required');
  });

  it('handles token extraction edge cases: no Content-Type, formData error/empty, json error/empty', async () => {
    process.env.TOKEN_EXCHANGE_SECRET = 'valid-secret';

    // 1. Missing Content-Type
    const req1 = new Request('http://localhost:3000/oauth/token-exchange', {
      method: 'POST',
      headers: { 'x-token-exchange-secret': 'valid-secret' },
      body: 'access_token=token1',
    });
    // Will fail at invalid token or later, but extractAccessToken succeeds
    expect((await postExchange(req1)).status).toBe(401);

    // 2. FormData without access_token
    const fd = new FormData();
    fd.set('other', 'value');
    const req2 = new Request('http://localhost:3000/oauth/token-exchange', {
      method: 'POST',
      headers: { 'x-token-exchange-secret': 'valid-secret' },
      body: fd,
    });
    expect((await postExchange(req2)).status).toBe(400);

    // 3. FormData throwing
    const brokenFdReq = {
      headers: new Headers({
        'x-token-exchange-secret': 'valid-secret',
        'content-type': 'multipart/form-data',
      }),
      formData: vi.fn().mockRejectedValueOnce(new Error('Parse error')),
    } as unknown as Request;
    expect((await postExchange(brokenFdReq)).status).toBe(400);

    // 4. JSON throwing
    const brokenJsonReq = new Request('http://localhost:3000/oauth/token-exchange', {
      method: 'POST',
      headers: {
        'x-token-exchange-secret': 'valid-secret',
        'content-type': 'application/json',
      },
      body: 'not a json',
    });
    expect((await postExchange(brokenJsonReq)).status).toBe(400);

    // 5. JSON without access_token
    const emptyJsonReq = new Request('http://localhost:3000/oauth/token-exchange', {
      method: 'POST',
      headers: {
        'x-token-exchange-secret': 'valid-secret',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ other: 'val' }),
    });
    expect((await postExchange(emptyJsonReq)).status).toBe(400);
  });

  it('refreshes session using user.srn when username and prn are missing, and handles authResult.session.expiresAt', async () => {
    process.env.TOKEN_EXCHANGE_SECRET = 'valid-secret';
    process.env.FIRST_PARTY_API_CLIENT_ID = 'cli_pesu_api';
    process.env.VAULT_MASTER_KEY = 'vkey-32-chars-long-test-key-here!';

    vi.spyOn(jwtHelper, 'verifyAccessToken').mockResolvedValueOnce({
      sub: 'usr_srn_only',
      client_id: 'cli_pesu_api',
      scope: 'openid',
    });

    vi.spyOn(Consent, 'findOne').mockResolvedValueOnce({
      sub: 'usr_srn_only',
      client_id: 'cli_pesu_api',
      scopes: ['openid'],
      mode: 'delegated',
    } as never);

    const mockSave = vi.fn().mockResolvedValue(true);
    vi.spyOn(Vault, 'findOne').mockResolvedValueOnce({
      sub: 'usr_srn_only',
      nonce: Buffer.alloc(12),
      ciphertext: Buffer.alloc(32),
      wrap_nonce: Buffer.alloc(12),
      wrapped_dek: Buffer.alloc(48),
      key_version: 1,
      save: mockSave,
    } as never);

    vi.spyOn(User, 'findOne').mockResolvedValueOnce({
      sub: 'usr_srn_only',
      prn: undefined,
      srn: 'PES1202099999',
      deleted_at: null,
    } as never);

    mockEnvelopeOpen.mockReturnValue(
      Buffer.from(
        JSON.stringify({
          username: '',
          password: 'decrypted_pass',
        })
      )
    );
    mockAcademyLogin.mockResolvedValueOnce({
      session: {
        token: 'new_tok',
        accessToken: 'new_acc',
        userId: 'usr_srn',
        expiresAt: undefined,
      },
    });

    const req = new Request('http://localhost:3000/oauth/token-exchange', {
      method: 'POST',
      headers: {
        'x-token-exchange-secret': 'valid-secret',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ access_token: 'valid_token' }),
    });

    const res = await postExchange(req);
    expect(res.status).toBe(200);
    expect(mockAcademyLogin).toHaveBeenCalledWith('PES1202099999', 'decrypted_pass');
  });

  it('extracts access_token from multipart/form-data request', async () => {
    const formData = new FormData();
    formData.set('access_token', 'token_from_multipart');
    const req = {
      headers: new Headers({
        'content-type': 'multipart/form-data; boundary=something',
      }),
      formData: vi.fn().mockResolvedValue(formData),
    } as unknown as Request;

    const res = await postExchange(req);
    expect(res.status).toBe(401);
  });

  it('handles request with no Content-Type header', async () => {
    process.env.TOKEN_EXCHANGE_SECRET = 'valid-secret';
    const req = new Request('http://localhost:3000/oauth/token-exchange', {
      method: 'POST',
      headers: {
        'x-token-exchange-secret': 'valid-secret',
      },
    });

    const res = await postExchange(req);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBe('invalid_request');
  });

  it('handles academy session refresh when accessToken and userId are missing (null fallback)', async () => {
    process.env.TOKEN_EXCHANGE_SECRET = 'valid-secret';
    process.env.FIRST_PARTY_API_CLIENT_ID = 'cli_pesu_api';
    process.env.VAULT_MASTER_KEY = 'valid-vault-master-key-that-is-long-enough-for-hkdf';

    vi.spyOn(jwtHelper, 'verifyAccessToken').mockResolvedValueOnce({
      sub: 'usr_null_fields',
      client_id: 'cli_pesu_api',
      scope: 'openid',
    });
    vi.spyOn(Consent, 'findOne').mockResolvedValueOnce({
      sub: 'usr_null_fields',
      client_id: 'cli_pesu_api',
      mode: 'delegated',
    } as unknown as InstanceType<typeof Consent>);

    const mockVaultDoc = {
      sub: 'usr_null_fields',
      nonce: Buffer.alloc(12),
      ciphertext: Buffer.alloc(32),
      wrap_nonce: Buffer.alloc(12),
      wrapped_dek: Buffer.alloc(48),
      session_expires_at: new Date(Date.now() - 1000), // expired
      key_version: 1,
      save: vi.fn().mockResolvedValue(true),
    };
    vi.spyOn(Vault, 'findOne').mockResolvedValueOnce(mockVaultDoc as unknown as InstanceType<typeof Vault>);

    mockEnvelopeOpen.mockReturnValue(
      Buffer.from(
        JSON.stringify({
          username: 'PES1UG20CS999',
          password: 'UserPassword123',
        })
      )
    );
    vi.spyOn(User, 'findOne').mockResolvedValueOnce({ sub: 'usr_null_fields' } as unknown as InstanceType<typeof User>);

    mockAcademyLogin.mockResolvedValueOnce({
      session: {
        token: 'new_acad_token',
        accessToken: undefined,
        userId: undefined,
        expiresAt: undefined,
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
    expect(data).not.toHaveProperty('access_token');
    expect(data).not.toHaveProperty('user_id');
  });
});



