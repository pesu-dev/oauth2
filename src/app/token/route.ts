import { NextRequest, NextResponse } from 'next/server';
import { connectToDatabase } from '@/lib/db/connection';
import {
  AuthCode,
  Client,
  RefreshToken,
  User,
} from '@/lib/db/models';
import { sha256Hex } from '@/lib/crypto/hash';
import { verifyPkce } from '@/lib/crypto/pkce';
import { mintAccessToken, mintIdToken } from '@/lib/oidc/jwt';
import { getConfig } from '@/lib/config';
import { newFamilyId, newRefreshToken } from '@/lib/id/nanoid';

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
    // Attempt form data fallback
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

  // Also check HTTP Basic auth for client credentials if present
  const authHeader = request.headers.get('authorization');
  if (authHeader?.startsWith('Basic ')) {
    const credentials = Buffer.from(authHeader.slice(6), 'base64').toString('utf-8');
    const [clientId, clientSecret] = credentials.split(':');
    if (clientId && !params.client_id) params.client_id = clientId;
    if (clientSecret && !params.client_secret) params.client_secret = clientSecret;
  }

  return params;
}

export async function POST(request: NextRequest | Request) {
  await connectToDatabase();
  const config = getConfig();
  const params = await parseParams(request);

  const grantType = params.grant_type;
  const clientId = params.client_id;
  const clientSecret = params.client_secret;

  if (!grantType || !clientId) {
    return NextResponse.json(
      { error: 'invalid_request', error_description: 'Missing grant_type or client_id' },
      { status: 400 }
    );
  }

  const client = await Client.findOne({ client_id: clientId });
  if (!client) {
    return NextResponse.json(
      { error: 'invalid_client', error_description: 'Client not found' },
      { status: 401 }
    );
  }

  // If client is confidential, verify client secret
  if (client.token_endpoint_auth_method !== 'none') {
    if (!clientSecret || sha256Hex(clientSecret) !== client.client_secret_hash) {
      return NextResponse.json(
        { error: 'invalid_client', error_description: 'Invalid client credentials' },
        { status: 401 }
      );
    }
  }

  // -------------------------------------------------------------
  // 1. authorization_code
  // -------------------------------------------------------------
  if (grantType === 'authorization_code') {
    const code = params.code;
    const redirectUri = params.redirect_uri;
    const codeVerifier = params.code_verifier;

    if (!code || !redirectUri || !codeVerifier) {
      return NextResponse.json(
        { error: 'invalid_request', error_description: 'Missing code, redirect_uri, or code_verifier' },
        { status: 400 }
      );
    }

    const codeHash = sha256Hex(code);
    const authCode = await AuthCode.findOne({ code_hash: codeHash });

    if (!authCode) {
      return NextResponse.json(
        { error: 'invalid_grant', error_description: 'Authorization code is invalid or expired' },
        { status: 400 }
      );
    }

    if (authCode.client_id !== clientId) {
      return NextResponse.json(
        { error: 'invalid_grant', error_description: 'Code was issued to a different client' },
        { status: 400 }
      );
    }

    if (authCode.redirect_uri !== redirectUri) {
      return NextResponse.json(
        { error: 'invalid_grant', error_description: 'redirect_uri mismatch' },
        { status: 400 }
      );
    }

    const pkceValid = verifyPkce(
      codeVerifier,
      authCode.code_challenge,
      authCode.code_challenge_method || 'S256'
    );

    if (!pkceValid) {
      return NextResponse.json(
        { error: 'invalid_grant', error_description: 'PKCE verification failed' },
        { status: 400 }
      );
    }

    // One-time use: consume code immediately
    await AuthCode.deleteOne({ code_hash: codeHash });

    const user = await User.findOne({ sub: authCode.sub, deleted_at: null });
    if (!user) {
      return NextResponse.json(
        { error: 'invalid_grant', error_description: 'User not found or deleted' },
        { status: 400 }
      );
    }

    const scopes = authCode.scopes || [];

    const accessToken = await mintAccessToken({
      issuer: config.issuerUrl,
      sub: user.sub,
      clientId,
      scopes,
      ttlSeconds: config.accessTokenTtlSeconds,
    });

    let idToken: string | undefined;
    if (scopes.includes('openid')) {
      idToken = await mintIdToken({
        issuer: config.issuerUrl,
        sub: user.sub,
        clientId,
        user,
        scopes,
        accessToken,
        nonce: authCode.nonce,
        ttlSeconds: config.idTokenTtlSeconds,
      });
    }

    let refreshToken: string | undefined;
    if (scopes.includes('offline_access')) {
      const rawRt = newRefreshToken();
      const familyId = newFamilyId();
      await RefreshToken.create({
        token_hash: sha256Hex(rawRt),
        family_id: familyId,
        client_id: clientId,
        sub: user.sub,
        scopes,
        expires_at: new Date(Date.now() + config.refreshTokenTtlSeconds * 1000),
      });
      refreshToken = rawRt;
    }

    return NextResponse.json({
      access_token: accessToken,
      token_type: 'Bearer',
      expires_in: config.accessTokenTtlSeconds,
      id_token: idToken,
      refresh_token: refreshToken,
      scope: scopes.join(' '),
    });
  }

  // -------------------------------------------------------------
  // 2. refresh_token
  // -------------------------------------------------------------
  if (grantType === 'refresh_token') {
    const rawRt = params.refresh_token;
    if (!rawRt) {
      return NextResponse.json(
        { error: 'invalid_request', error_description: 'Missing refresh_token' },
        { status: 400 }
      );
    }

    const tokenHash = sha256Hex(rawRt);
    const now = new Date();
    const newRt = newRefreshToken();
    const newRtHash = sha256Hex(newRt);

    // Atomic CAS to claim old token
    const claimed = await RefreshToken.findOneAndUpdate(
      {
        token_hash: tokenHash,
        revoked_at: null,
        expires_at: { $gt: now },
      },
      {
        $set: {
          revoked_at: now,
          successor_hash: newRtHash,
        },
      },
      { returnDocument: 'before' }
    );

    if (!claimed) {
      const existing = await RefreshToken.findOne({ token_hash: tokenHash });
      if (!existing) {
        return NextResponse.json(
          { error: 'invalid_grant', error_description: 'Invalid refresh token' },
          { status: 400 }
        );
      }
      if (existing.client_id !== clientId) {
        return NextResponse.json(
          { error: 'invalid_grant', error_description: 'Token was issued to a different client' },
          { status: 400 }
        );
      }
      // Reused revoked or expired token: revoke family immediately
      if (existing.revoked_at || existing.expires_at <= now) {
        await RefreshToken.updateMany(
          { family_id: existing.family_id, revoked_at: null },
          { $set: { revoked_at: now } }
        );
        return NextResponse.json(
          { error: 'invalid_grant', error_description: 'Refresh token reuse detected; family revoked' },
          { status: 400 }
        );
      }
      return NextResponse.json(
        { error: 'invalid_grant', error_description: 'Invalid or reused refresh token' },
        { status: 400 }
      );
    }

    if (claimed.client_id !== clientId) {
      await RefreshToken.updateMany(
        { family_id: claimed.family_id, revoked_at: null },
        { $set: { revoked_at: now } }
      );
      return NextResponse.json(
        { error: 'invalid_grant', error_description: 'Token was issued to a different client' },
        { status: 400 }
      );
    }

    const user = await User.findOne({ sub: claimed.sub, deleted_at: null });
    if (!user) {
      return NextResponse.json(
        { error: 'invalid_grant', error_description: 'User not found or deleted' },
        { status: 400 }
      );
    }

    const scopes = claimed.scopes || [];

    // Create the rotated token preserving original family expiration
    await RefreshToken.create({
      token_hash: newRtHash,
      family_id: claimed.family_id,
      client_id: clientId,
      sub: user.sub,
      scopes,
      expires_at: claimed.expires_at,
      created_at: now,
      revoked_at: null,
    });

    // Check race condition: family must only have 1 active live token
    const liveCount = await RefreshToken.countDocuments({
      family_id: claimed.family_id,
      revoked_at: null,
      expires_at: { $gt: now },
    });
    if (liveCount !== 1) {
      await RefreshToken.updateMany(
        { family_id: claimed.family_id, revoked_at: null },
        { $set: { revoked_at: now } }
      );
      return NextResponse.json(
        { error: 'invalid_grant', error_description: 'Refresh token reuse detected; family revoked' },
        { status: 400 }
      );
    }

    const accessToken = await mintAccessToken({
      issuer: config.issuerUrl,
      sub: user.sub,
      clientId,
      scopes,
      ttlSeconds: config.accessTokenTtlSeconds,
    });

    let idToken: string | undefined;
    if (scopes.includes('openid')) {
      idToken = await mintIdToken({
        issuer: config.issuerUrl,
        sub: user.sub,
        clientId,
        user,
        scopes,
        accessToken,
        ttlSeconds: config.idTokenTtlSeconds,
      });
    }

    return NextResponse.json({
      access_token: accessToken,
      token_type: 'Bearer',
      expires_in: config.accessTokenTtlSeconds,
      id_token: idToken,
      refresh_token: newRt,
      scope: scopes.join(' '),
    });
  }

  return NextResponse.json(
    { error: 'unsupported_grant_type', error_description: `Unsupported grant_type: ${grantType}` },
    { status: 400 }
  );
}
