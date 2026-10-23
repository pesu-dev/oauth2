import { NextRequest, NextResponse } from 'next/server';
import { connectToDatabase } from '@/lib/db/connection';
import { DeviceCode } from '@/lib/db/models';
import { getConfig } from '@/lib/config';
import { sha256Hex } from '@/lib/crypto/hash';
import { newDeviceCode, newUserCode } from '@/lib/id/nanoid';
import { authenticateClientForToken, parseTokenRequestParams } from '@/lib/oidc/token-service';
import { parseScopes, unapprovedScopes } from '@/lib/oidc/scopes';

const HEADERS = { 'Cache-Control': 'no-store', Pragma: 'no-cache' };
const DEVICE_CODE_TTL_SECONDS = 15 * 60;
const DEVICE_POLL_INTERVAL_SECONDS = 5;

function json(body: Record<string, unknown>, status: number = 200) {
  return NextResponse.json(body, { status, headers: HEADERS });
}

/** RFC 8628 §3.1–3.2 device authorization request. */
export async function POST(request: NextRequest | Request) {
  await connectToDatabase();
  const config = getConfig();
  const params = await parseTokenRequestParams(request);

  const auth = await authenticateClientForToken(params.client_id, params.client_secret);
  if (!auth.ok) {
    return json({ error: auth.error, error_description: auth.error_description }, auth.status);
  }
  const client = auth.client;

  if (!client.device_flow_enabled) {
    return json(
      { error: 'unauthorized_client', error_description: 'Device flow is not enabled for this client' },
      400
    );
  }

  const scopes = parseScopes(params.scope || 'openid');
  if (!scopes.includes('openid')) {
    return json({ error: 'invalid_scope', error_description: 'OIDC requires the openid scope' }, 400);
  }
  const blocked = unapprovedScopes(scopes, client.allowed_scopes);
  if (blocked.length > 0) {
    return json(
      { error: 'invalid_scope', error_description: `Client is not approved for: ${blocked.join(', ')}` },
      400
    );
  }

  const deviceCode = newDeviceCode();
  const userCode = newUserCode();
  await DeviceCode.create({
    device_code_hash: sha256Hex(deviceCode),
    user_code: userCode.replace('-', ''),
    client_id: client.client_id,
    scopes,
    status: 'pending',
    interval: DEVICE_POLL_INTERVAL_SECONDS,
    expires_at: new Date(Date.now() + DEVICE_CODE_TTL_SECONDS * 1000),
  });

  const verificationUri = `${config.issuerUrl.replace(/\/+$/, '')}/device`;
  return json({
    device_code: deviceCode,
    user_code: userCode,
    verification_uri: verificationUri,
    verification_uri_complete: `${verificationUri}?user_code=${encodeURIComponent(userCode)}`,
    expires_in: DEVICE_CODE_TTL_SECONDS,
    interval: DEVICE_POLL_INTERVAL_SECONDS,
  });
}
