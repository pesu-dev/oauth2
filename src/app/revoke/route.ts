import { NextRequest, NextResponse } from 'next/server';
import { connectToDatabase } from '@/lib/db/connection';
import { Client, RefreshToken } from '@/lib/db/models';
import { sha256Hex } from '@/lib/crypto/hash';

async function parseParams(request: Request): Promise<Record<string, string>> {
  const contentType = request.headers.get('content-type') || '';
  const params: Record<string, string> = {};

  if (contentType.includes('application/x-www-form-urlencoded') || contentType.includes('multipart/form-data')) {
    const formData = await request.formData();
    formData.forEach((value, key) => {
      if (typeof value === 'string') {
        params[key] = value;
      }
    });
  } else if (contentType.includes('application/json')) {
    const json = await request.json();
    for (const [key, value] of Object.entries(json)) {
      params[key] = String(value);
    }
  } else {
    try {
      const text = await request.text();
      const searchParams = new URLSearchParams(text);
      searchParams.forEach((value, key) => {
        params[key] = value;
      });
    } catch {
      // ignore
    }
  }

  // HTTP Basic auth fallback
  const authHeader = request.headers.get('authorization');
  if (authHeader?.startsWith('Basic ')) {
    try {
      const credentials = Buffer.from(authHeader.slice(6), 'base64').toString('utf-8');
      const [clientId, clientSecret] = credentials.split(':');
      if (clientId && !params.client_id) params.client_id = clientId;
      if (clientSecret && !params.client_secret) params.client_secret = clientSecret;
    } catch {
      // ignore
    }
  }

  return params;
}

export async function POST(request: NextRequest | Request) {
  await connectToDatabase();
  const params = await parseParams(request);

  const clientId = params.client_id;
  const clientSecret = params.client_secret;
  const token = params.token;
  const tokenTypeHint = params.token_type_hint;

  if (!clientId) {
    return NextResponse.json(
      { error: 'invalid_client', error_description: 'client_id is required' },
      { status: 401 }
    );
  }

  const client = await Client.findOne({ client_id: clientId });
  if (!client) {
    return NextResponse.json(
      { error: 'invalid_client', error_description: 'Unknown client' },
      { status: 401 }
    );
  }

  // If confidential, verify client secret
  if (client.token_endpoint_auth_method !== 'none') {
    if (!clientSecret || sha256Hex(clientSecret) !== client.client_secret_hash) {
      return NextResponse.json(
        { error: 'invalid_client', error_description: 'Invalid client credentials' },
        { status: 401 }
      );
    }
  }

  if (!token) {
    return NextResponse.json(
      { error: 'invalid_request', error_description: 'token is required' },
      { status: 400 }
    );
  }

  // Access tokens: no denylist — acknowledge and return 200
  if (tokenTypeHint === 'access_token') {
    return new Response(null, { status: 200 });
  }

  // Check if token exists and was issued to THIS authenticated client
  const tokenHash = sha256Hex(token);
  const existing = await RefreshToken.findOne({ token_hash: tokenHash });
  if (existing && existing.client_id === client.client_id) {
    await RefreshToken.updateOne(
      { token_hash: tokenHash, revoked_at: null },
      { $set: { revoked_at: new Date() } }
    );
  }

  // RFC 7009: 200 OK even if already invalid / unowned to prevent probing
  return new Response(null, { status: 200 });
}
