import { NextResponse } from 'next/server';
import { connectToDatabase } from '@/lib/db/connection';
import { Client, Consent, User } from '@/lib/db/models';
import { verifyAccessToken } from '@/lib/oidc/jwt';
import { getConfig } from '@/lib/config';
import { apiLimiter } from '@/lib/rate-limit';

export type GuardResult =
  | { ok: true; sub: string; clientId: string; scopes: string[] }
  | { ok: false; response: NextResponse };

function bearerError(status: number, error: string, description: string, scope?: string): GuardResult {
  const challenge = [`Bearer error="${error}"`, `error_description="${description}"`];
  if (scope) challenge.push(`scope="${scope}"`);
  return {
    ok: false,
    response: NextResponse.json(
      { error, error_description: description },
      { status, headers: { 'WWW-Authenticate': challenge.join(', '), 'Cache-Control': 'no-store' } }
    ),
  };
}

/**
 * Authorizes a resource API call (RFC 6750). Beyond the JWT itself, re-checks live state so a
 * revoked consent, suspended client, withdrawn scope approval or deleted account takes effect
 * immediately rather than when the one-hour access token expires.
 */
export async function requireScope(request: Request, scope: string): Promise<GuardResult> {
  const authHeader = request.headers.get('authorization');
  const parts = authHeader ? authHeader.split(' ') : [];
  if (parts.length < 2 || parts[0].toLowerCase() !== 'bearer' || !parts[1]) {
    return bearerError(401, 'invalid_token', 'Missing or malformed Bearer token');
  }

  let payload;
  try {
    payload = await verifyAccessToken(parts[1].trim(), getConfig().issuerUrl);
  } catch {
    return bearerError(401, 'invalid_token', 'Token signature or expiration invalid');
  }

  const scopes = payload.scope ? payload.scope.split(' ') : [];
  if (!scopes.includes(scope)) {
    return bearerError(403, 'insufficient_scope', `This endpoint requires the ${scope} scope`, scope);
  }

  if (!apiLimiter.allow(`api:${payload.sub}:${payload.client_id}`)) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'rate_limited', error_description: 'Too many requests for this student and app' },
        { status: 429, headers: { 'Retry-After': '60', 'Cache-Control': 'no-store' } }
      ),
    };
  }

  await connectToDatabase();
  const [user, client, consent] = await Promise.all([
    User.findOne({ sub: payload.sub, deleted_at: null }).lean(),
    Client.findOne({ client_id: payload.client_id }).lean(),
    Consent.findOne({ sub: payload.sub, client_id: payload.client_id }).lean(),
  ]);

  if (!user) {
    return bearerError(401, 'invalid_token', 'User not found');
  }
  if (!client || client.publishing_status === 'suspended') {
    return bearerError(401, 'invalid_token', 'Client is unknown or suspended');
  }
  if (!(client.allowed_scopes ?? []).includes(scope)) {
    return bearerError(403, 'insufficient_scope', `Client is no longer approved for ${scope}`, scope);
  }
  if (!consent || consent.mode !== 'delegated' || !consent.scopes.includes(scope)) {
    return bearerError(401, 'invalid_token', 'Consent for this scope was revoked');
  }

  return { ok: true, sub: payload.sub, clientId: payload.client_id, scopes };
}
