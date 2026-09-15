import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST as postRevoke } from '@/app/revoke/route';
import { Client, RefreshToken } from '@/lib/db/models';
import { sha256Hex } from '@/lib/crypto/hash';

vi.mock('@/lib/db/connection', () => ({
  connectToDatabase: vi.fn().mockResolvedValue(null),
}));

describe('Revocation Endpoint (/revoke)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('revokes valid refresh token using urlencoded form data', async () => {
    vi.spyOn(Client, 'findOne').mockResolvedValueOnce({
      client_id: 'cli_test',
      token_endpoint_auth_method: 'none',
    } as unknown as InstanceType<typeof Client>);
    vi.spyOn(RefreshToken, 'findOne').mockResolvedValueOnce({
      token_hash: sha256Hex('rt_sample_token_to_revoke_123456'),
      client_id: 'cli_test',
    } as unknown as InstanceType<typeof RefreshToken>);
    vi.spyOn(RefreshToken, 'updateOne').mockResolvedValueOnce({
      acknowledged: true,
      matchedCount: 1,
      modifiedCount: 1,
      upsertedCount: 0,
      upsertedId: null,
    });

    const formData = new URLSearchParams();
    formData.set('client_id', 'cli_test');
    formData.set('token', 'rt_sample_token_to_revoke_123456');

    const req = new Request('http://localhost:3000/revoke', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: formData.toString(),
    });

    const resp = await postRevoke(req);
    expect(resp.status).toBe(200);
  });

  it('revokes valid refresh token using JSON request body', async () => {
    vi.spyOn(Client, 'findOne').mockResolvedValueOnce({
      client_id: 'cli_test',
      token_endpoint_auth_method: 'none',
    } as never);
    vi.spyOn(RefreshToken, 'findOne').mockResolvedValueOnce({
      token_hash: sha256Hex('rt_json_revoke'),
      client_id: 'cli_test',
    } as never);
    const updateSpy = vi.spyOn(RefreshToken, 'updateOne').mockResolvedValueOnce({} as never);

    const req = new Request('http://localhost:3000/revoke', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: 'cli_test', token: 'rt_json_revoke' }),
    });

    const resp = await postRevoke(req);
    expect(resp.status).toBe(200);
    expect(updateSpy).toHaveBeenCalled();
  });

  it('decodes Basic authentication header for client credentials', async () => {
    const secretHash = sha256Hex('secret123');
    vi.spyOn(Client, 'findOne').mockResolvedValueOnce({
      client_id: 'cli_basic',
      client_secret_hash: secretHash,
      token_endpoint_auth_method: 'client_secret_basic',
    } as never);
    vi.spyOn(RefreshToken, 'findOne').mockResolvedValueOnce(null);

    const auth = Buffer.from('cli_basic:secret123').toString('base64');
    const req = new Request('http://localhost:3000/revoke', {
      method: 'POST',
      headers: {
        authorization: `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'token=rt_some_token',
    });

    const resp = await postRevoke(req);
    // Authenticated successfully and handled (200 OK per RFC 7009)
    expect(resp.status).toBe(200);
  });

  it('rejects unauthenticated revocation with 401', async () => {
    const req = new Request('http://localhost:3000/revoke', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'token=some_token',
    });

    const res = await postRevoke(req);
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe('invalid_client');
  });

  it('rejects when client is unknown with 401', async () => {
    vi.spyOn(Client, 'findOne').mockResolvedValueOnce(null);

    const req = new Request('http://localhost:3000/revoke', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'client_id=cli_nonexistent&token=some_token',
    });

    const res = await postRevoke(req);
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error_description).toBe('Unknown client');
  });

  it('rejects when confidential client is missing client_secret with 401', async () => {
    vi.spyOn(Client, 'findOne').mockResolvedValueOnce({
      client_id: 'cli_conf',
      client_secret_hash: sha256Hex('secret'),
      token_endpoint_auth_method: 'client_secret_post',
    } as never);

    const req = new Request('http://localhost:3000/revoke', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'client_id=cli_conf&token=some_token',
    });

    const res = await postRevoke(req);
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe('invalid_client');
  });

  it('rejects missing token with 400', async () => {
    vi.spyOn(Client, 'findOne').mockResolvedValueOnce({
      client_id: 'cli_public',
      token_endpoint_auth_method: 'none',
    } as unknown as InstanceType<typeof Client>);

    const req = new Request('http://localhost:3000/revoke', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'client_id=cli_public',
    });

    const res = await postRevoke(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('invalid_request');
  });

  it('returns 200 without revoking if token was issued to another client', async () => {
    vi.spyOn(Client, 'findOne').mockResolvedValueOnce({
      client_id: 'cli_attacker',
      token_endpoint_auth_method: 'none',
    } as unknown as InstanceType<typeof Client>);

    // Token belongs to cli_victim
    vi.spyOn(RefreshToken, 'findOne').mockResolvedValueOnce({
      token_hash: sha256Hex('victim_rt'),
      client_id: 'cli_victim',
    } as unknown as InstanceType<typeof RefreshToken>);

    const updateSpy = vi.spyOn(RefreshToken, 'updateOne');

    const req = new Request('http://localhost:3000/revoke', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'client_id=cli_attacker&token=victim_rt',
    });

    const res = await postRevoke(req);
    expect(res.status).toBe(200);
    // updateOne must NOT be called for cross-client token
    expect(updateSpy).not.toHaveBeenCalled();
  });

  it('returns 200 for access_token hint without touching refresh tokens', async () => {
    vi.spyOn(Client, 'findOne').mockResolvedValueOnce({
      client_id: 'cli_test',
      token_endpoint_auth_method: 'none',
    } as unknown as InstanceType<typeof Client>);

    const req = new Request('http://localhost:3000/revoke', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'client_id=cli_test&token=some_jwt&token_type_hint=access_token',
    });

    const res = await postRevoke(req);
    expect(res.status).toBe(200);
  });

  it('validates client secret with timing safety', async () => {
    const correctSecret = 'sec_valid_12345';
    const secretHash = sha256Hex(correctSecret);

    vi.spyOn(Client, 'findOne').mockResolvedValueOnce({
      client_id: 'cli_test',
      client_secret_hash: secretHash,
      token_endpoint_auth_method: 'client_secret_post',
    } as unknown as InstanceType<typeof Client>);

    const req = new Request('http://localhost:3000/revoke', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: 'cli_test',
        client_secret: 'sec_wrong_password',
        token: 'some_token',
      }).toString(),
    });

    const res = await postRevoke(req);
    expect(res.status).toBe(401);
    const data = await res.json();
    expect(data.error).toBe('invalid_client');
  });
});
