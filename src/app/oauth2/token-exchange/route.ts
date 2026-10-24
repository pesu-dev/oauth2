import { NextRequest, NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { connectToDatabase } from '@/lib/db/connection';
import { Consent } from '@/lib/db/models';
import { getConfig } from '@/lib/config';
import { verifyAccessToken } from '@/lib/oidc/jwt';
import { getAcademySession, VaultSessionError, type VaultErrorCode } from '@/lib/academy/session';

const VAULT_ERROR_RESPONSES: Record<VaultErrorCode, { status: number; error: string }> = {
  misconfigured: { status: 503, error: 'misconfigured' },
  no_vault: { status: 403, error: 'forbidden' },
  vault_unreadable: { status: 403, error: 'forbidden' },
  user_missing: { status: 403, error: 'forbidden' },
  academy_unavailable: { status: 502, error: 'academy_unavailable' },
};

function checkExchangeSecret(request: Request, configuredSecret?: string): boolean {
  if (!configuredSecret) return false;

  const headerSecret = request.headers.get('x-token-exchange-secret');
  if (headerSecret) {
    try {
      if (
        crypto.timingSafeEqual(
          Buffer.from(headerSecret, 'utf-8'),
          Buffer.from(configuredSecret, 'utf-8')
        )
      ) {
        return true;
      }
    } catch {
      return false;
    }
  }

  const authHeader = request.headers.get('authorization');
  if (authHeader?.startsWith('Bearer ')) {
    const bearer = authHeader.slice(7).trim();
    try {
      if (
        crypto.timingSafeEqual(
          Buffer.from(bearer, 'utf-8'),
          Buffer.from(configuredSecret, 'utf-8')
        )
      ) {
        return true;
      }
    } catch {
      return false;
    }
  }

  return false;
}

async function extractAccessToken(request: Request): Promise<string | null> {
  const contentType = request.headers.get('content-type') || '';
  if (contentType.includes('application/x-www-form-urlencoded') || contentType.includes('multipart/form-data')) {
    try {
      const formData = await request.formData();
      return (formData.get('access_token') as string) || null;
    } catch {
      return null;
    }
  }

  if (contentType.includes('application/json')) {
    try {
      const body = await request.json();
      return (body.access_token as string) || null;
    } catch {
      return null;
    }
  }

  try {
    const text = await request.text();
    const params = new URLSearchParams(text);
    return params.get('access_token');
  } catch {
    return null;
  }
}

function requireFirstPartyClient(configClientId: string, tokenClientId: string): boolean {
  try {
    const a = Buffer.from(tokenClientId);
    const b = Buffer.from(configClientId);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

function sessionResponse(data: { token: string; access_token?: string | null; user_id?: string | null }) {
  const body: Record<string, string> = { token: data.token };
  if (data.access_token) body.access_token = data.access_token;
  if (data.user_id) body.user_id = data.user_id;
  return NextResponse.json(body, {
    headers: {
      'Cache-Control': 'no-store',
      Pragma: 'no-cache',
    },
  });
}

export async function POST(request: NextRequest | Request) {
  const config = getConfig();
  if (!checkExchangeSecret(request, config.tokenExchangeSecret)) {
    return NextResponse.json(
      { error: 'unauthorized', error_description: 'Valid token exchange secret required' },
      { status: 401 }
    );
  }

  const accessToken = await extractAccessToken(request);
  if (!accessToken) {
    return NextResponse.json(
      { error: 'invalid_request', error_description: 'access_token is required' },
      { status: 400 }
    );
  }

  let tokenClaims: { sub: string; client_id: string };
  try {
    tokenClaims = await verifyAccessToken(accessToken, config.issuerUrl);
  } catch {
    return NextResponse.json(
      { error: 'unauthorized', error_description: 'Invalid or expired access token' },
      { status: 401 }
    );
  }

  if (!requireFirstPartyClient(config.firstPartyApiClientId, tokenClaims.client_id)) {
    return NextResponse.json(
      { error: 'forbidden', error_description: 'Token client is not the first-party API client' },
      { status: 403 }
    );
  }

  await connectToDatabase();
  const sub = tokenClaims.sub;

  const consent = await Consent.findOne({
    sub,
    client_id: config.firstPartyApiClientId,
  });

  if (!consent || consent.mode !== 'delegated') {
    return NextResponse.json(
      { error: 'forbidden', error_description: 'Delegated consent required' },
      { status: 403 }
    );
  }

  try {
    const { session } = await getAcademySession(sub);
    return sessionResponse(session);
  } catch (err) {
    if (err instanceof VaultSessionError) {
      const { status, error } = VAULT_ERROR_RESPONSES[err.code];
      return NextResponse.json({ error, error_description: err.message }, { status });
    }
    throw err;
  }
}
