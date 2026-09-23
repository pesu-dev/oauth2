import {
  AuthCode,
  Client,
  RefreshToken,
  User,
  type IClient,
} from '@/lib/db/models';
import { sha256Hex, verifyClientSecret } from '@/lib/crypto/hash';
import { verifyPkce } from '@/lib/crypto/pkce';
import { mintAccessToken, mintIdToken } from '@/lib/oidc/jwt';
import { newFamilyId, newRefreshToken } from '@/lib/id/nanoid';
import { withTransaction } from '@/lib/db/transaction';
import type { AppConfig } from '@/lib/config';

const VERIFIER_RE = /^[A-Za-z0-9\-._~]{43,128}$/;

export interface TokenServiceResult {
  status: number;
  body: Record<string, unknown>;
}

export type TokenAuthResult =
  | { ok: true; client: IClient }
  | { ok: false; status: number; error: string; error_description: string };

/**
 * Extracts and decodes parameters from request bodies (urlencoded, multipart, json)
 * and HTTP Basic authentication headers.
 */
export async function parseTokenRequestParams(request: Request): Promise<Record<string, string>> {
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
    try {
      const credentials = Buffer.from(authHeader.slice(6), 'base64').toString('utf-8');
      const colonIdx = credentials.indexOf(':');
      if (colonIdx !== -1) {
        const rawClientId = credentials.slice(0, colonIdx);
        const rawClientSecret = credentials.slice(colonIdx + 1);
        let clientId = rawClientId;
        let clientSecret = rawClientSecret;
        try {
          clientId = decodeURIComponent(rawClientId);
          clientSecret = decodeURIComponent(rawClientSecret);
        } catch {
          // fallback to raw if not URL encoded
        }
        if (clientId && !params.client_id) params.client_id = clientId;
        if (clientSecret && !params.client_secret) params.client_secret = clientSecret;
      }
    } catch {
      // ignore malformed basic auth header
    }
  }

  return params;
}

/**
 * Authenticates client credentials and verifies publishing status.
 */
export async function authenticateClientForToken(
  clientId?: string,
  clientSecret?: string
): Promise<TokenAuthResult> {
  if (!clientId) {
    return {
      ok: false,
      status: 401,
      error: 'invalid_client',
      error_description: 'client_id is required',
    };
  }

  const client = await Client.findOne({ client_id: clientId });
  if (!client) {
    return {
      ok: false,
      status: 401,
      error: 'invalid_client',
      error_description: 'Client not found',
    };
  }

  if (client.token_endpoint_auth_method !== 'none') {
    if (!clientSecret || !client.client_secret_hash) {
      return {
        ok: false,
        status: 401,
        error: 'invalid_client',
        error_description: 'Invalid client credentials',
      };
    }
    const secretMatches = await verifyClientSecret(clientSecret, client.client_secret_hash);
    if (!secretMatches) {
      return {
        ok: false,
        status: 401,
        error: 'invalid_client',
        error_description: 'Invalid client credentials',
      };
    }
  }

  if (client.publishing_status === 'suspended') {
    return {
      ok: false,
      status: 401,
      error: 'invalid_client',
      error_description: 'Client is suspended',
    };
  }

  return { ok: true, client };
}

/**
 * Executes authorization code PKCE exchange and mints initial tokens.
 */
export async function exchangeAuthorizationCode(
  params: Record<string, string>,
  client: IClient,
  config: AppConfig
): Promise<TokenServiceResult> {
  const code = params.code;
  const redirectUri = params.redirect_uri;
  const codeVerifier = params.code_verifier;

  if (!code || !redirectUri || !codeVerifier) {
    return {
      status: 400,
      body: {
        error: 'invalid_request',
        error_description: 'Missing code, redirect_uri, or code_verifier',
      },
    };
  }

  if (!VERIFIER_RE.test(codeVerifier)) {
    return {
      status: 400,
      body: {
        error: 'invalid_request',
        error_description: 'code_verifier must be 43-128 unreserved ASCII characters',
      },
    };
  }

  const codeHash = sha256Hex(code);
  const authCode = await AuthCode.findOneAndDelete({
    code_hash: codeHash,
    expires_at: { $gt: new Date() },
  });

  if (!authCode) {
    return {
      status: 400,
      body: {
        error: 'invalid_grant',
        error_description: 'Authorization code is invalid or expired',
      },
    };
  }

  if (authCode.client_id !== client.client_id) {
    return {
      status: 400,
      body: {
        error: 'invalid_grant',
        error_description: 'Code was issued to a different client',
      },
    };
  }

  if (authCode.redirect_uri !== redirectUri) {
    return {
      status: 400,
      body: {
        error: 'invalid_grant',
        error_description: 'redirect_uri mismatch',
      },
    };
  }

  const pkceValid = verifyPkce(
    codeVerifier,
    authCode.code_challenge,
    authCode.code_challenge_method || 'S256'
  );

  if (!pkceValid) {
    return {
      status: 400,
      body: {
        error: 'invalid_grant',
        error_description: 'PKCE verification failed',
      },
    };
  }

  const user = await User.findOne({ sub: authCode.sub, deleted_at: null });
  if (!user) {
    return {
      status: 400,
      body: {
        error: 'invalid_grant',
        error_description: 'User not found or deleted',
      },
    };
  }

  const scopes = authCode.scopes || [];

  const accessToken = await mintAccessToken({
    issuer: config.issuerUrl,
    sub: user.sub,
    clientId: client.client_id,
    scopes,
    ttlSeconds: config.accessTokenTtlSeconds,
  });

  let idTokenPromise: Promise<string> | undefined;
  if (scopes.includes('openid')) {
    idTokenPromise = mintIdToken({
      issuer: config.issuerUrl,
      sub: user.sub,
      clientId: client.client_id,
      user,
      scopes,
      accessToken,
      nonce: authCode.nonce,
      ttlSeconds: config.idTokenTtlSeconds,
    });
  }

  let refreshToken: string | undefined;
  let refreshTokenPromise: Promise<unknown> | undefined;
  if (scopes.includes('offline_access')) {
    const rawRt = newRefreshToken();
    const familyId = newFamilyId();
    refreshTokenPromise = RefreshToken.create({
      token_hash: sha256Hex(rawRt),
      family_id: familyId,
      client_id: client.client_id,
      sub: user.sub,
      scopes,
      expires_at: new Date(Date.now() + config.refreshTokenTtlSeconds * 1000),
    });
    refreshToken = rawRt;
  }

  const [idToken] = await Promise.all([
    idTokenPromise,
    refreshTokenPromise,
  ]);

  return {
    status: 200,
    body: {
      access_token: accessToken,
      token_type: 'Bearer',
      expires_in: config.accessTokenTtlSeconds,
      id_token: idToken,
      refresh_token: refreshToken,
      scope: scopes.join(' '),
    },
  };
}

/**
 * Rotates an existing refresh token with MongoDB multi-document transaction guarantees
 * and automated token family revocation upon reuse detection.
 */
export async function exchangeRefreshToken(
  params: Record<string, string>,
  client: IClient,
  config: AppConfig
): Promise<TokenServiceResult> {
  const rawRt = params.refresh_token;
  if (!rawRt) {
    return {
      status: 400,
      body: {
        error: 'invalid_request',
        error_description: 'Missing refresh_token',
      },
    };
  }

  const tokenHash = sha256Hex(rawRt);
  const now = new Date();

  return withTransaction(async (session) => {
    const existing = await RefreshToken.findOne(
      { token_hash: tokenHash },
      null,
      { session }
    );

    if (!existing) {
      return {
        status: 400,
        body: { error: 'invalid_grant', error_description: 'Invalid refresh token' },
      };
    }

    if (existing.client_id !== client.client_id) {
      return {
        status: 400,
        body: { error: 'invalid_grant', error_description: 'Token was issued to a different client' },
      };
    }

    // Reused revoked or expired token: revoke family immediately
    if (existing.revoked_at || existing.expires_at <= now) {
      await RefreshToken.updateMany(
        { family_id: existing.family_id, revoked_at: null },
        { $set: { revoked_at: now } },
        { session }
      );

      return {
        status: 400,
        body: { error: 'invalid_grant', error_description: 'Refresh token reuse detected; family revoked' },
      };
    }

    const newRt = newRefreshToken();
    const newRtHash = sha256Hex(newRt);

    // Atomic CAS to claim old token
    const claimed = await RefreshToken.findOneAndUpdate(
      {
        token_hash: tokenHash,
        client_id: client.client_id,
        revoked_at: null,
        expires_at: { $gt: now },
      },
      {
        $set: {
          revoked_at: now,
          successor_hash: newRtHash,
        },
      },
      { returnDocument: 'before', session }
    );

    if (!claimed) {
      await RefreshToken.updateMany(
        { family_id: existing.family_id, revoked_at: null },
        { $set: { revoked_at: now } },
        { session }
      );

      return {
        status: 400,
        body: { error: 'invalid_grant', error_description: 'Refresh token reuse detected; family revoked' },
      };
    }

    const user = await User.findOne({ sub: claimed.sub, deleted_at: null }, null, { session });

    if (!user) {
      return {
        status: 400,
        body: { error: 'invalid_grant', error_description: 'User not found or deleted' },
      };
    }

    const scopes = claimed.scopes || [];

    // Create the rotated token preserving original family expiration
    await RefreshToken.create(
      [
        {
          token_hash: newRtHash,
          family_id: claimed.family_id,
          client_id: client.client_id,
          sub: user.sub,
          scopes,
          expires_at: claimed.expires_at,
          created_at: now,
          revoked_at: null,
        },
      ],
      { session }
    );

    const accessToken = await mintAccessToken({
      issuer: config.issuerUrl,
      sub: user.sub,
      clientId: client.client_id,
      scopes,
      ttlSeconds: config.accessTokenTtlSeconds,
    });

    let idToken: string | undefined;
    if (scopes.includes('openid')) {
      idToken = await mintIdToken({
        issuer: config.issuerUrl,
        sub: user.sub,
        clientId: client.client_id,
        user,
        scopes,
        accessToken,
        ttlSeconds: config.idTokenTtlSeconds,
      });
    }

    return {
      status: 200,
      body: {
        access_token: accessToken,
        token_type: 'Bearer',
        expires_in: config.accessTokenTtlSeconds,
        id_token: idToken,
        refresh_token: newRt,
        scope: scopes.join(' '),
      },
    };
  });
}
