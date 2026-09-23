import { NextRequest, NextResponse } from 'next/server';
import { connectToDatabase } from '@/lib/db/connection';
import { getConfig } from '@/lib/config';
import {
  authenticateClientForToken,
  exchangeAuthorizationCode,
  exchangeRefreshToken,
  parseTokenRequestParams,
} from '@/lib/oidc/token-service';

const TOKEN_HEADERS = {
  'Cache-Control': 'no-store',
  Pragma: 'no-cache',
};

function tokenResponse(data: Record<string, unknown>, status: number = 200) {
  return NextResponse.json(data, { status, headers: TOKEN_HEADERS });
}

export async function POST(request: NextRequest | Request) {
  await connectToDatabase();
  const config = getConfig();
  const params = await parseTokenRequestParams(request);

  const grantType = params.grant_type;
  const clientId = params.client_id;
  const clientSecret = params.client_secret;

  if (!clientId) {
    return tokenResponse(
      { error: 'invalid_client', error_description: 'client_id is required' },
      401
    );
  }

  if (!grantType) {
    return tokenResponse(
      { error: 'invalid_request', error_description: 'Missing grant_type' },
      400
    );
  }

  const authResult = await authenticateClientForToken(clientId, clientSecret);
  if (!authResult.ok) {
    return tokenResponse(
      { error: authResult.error, error_description: authResult.error_description },
      authResult.status
    );
  }

  const client = authResult.client;

  if (grantType === 'authorization_code') {
    const result = await exchangeAuthorizationCode(params, client, config);
    return tokenResponse(result.body, result.status);
  }

  if (grantType === 'refresh_token') {
    const result = await exchangeRefreshToken(params, client, config);
    return tokenResponse(result.body, result.status);
  }

  return tokenResponse(
    { error: 'unsupported_grant_type', error_description: `Unsupported grant_type: ${grantType}` },
    400
  );
}
