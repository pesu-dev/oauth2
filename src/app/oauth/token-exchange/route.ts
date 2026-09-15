import { NextRequest, NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { connectToDatabase } from '@/lib/db/connection';
import { Consent, User, Vault } from '@/lib/db/models';
import { getConfig } from '@/lib/config';
import { verifyAccessToken } from '@/lib/oidc/jwt';
import { masterKeyFromSecret, open, seal, SealedBlob } from '@/lib/crypto/envelope';
import { AcademyClient } from '@/lib/academy/client';

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

  // Verify delegated consent exists for the first party client
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

  if (!config.vaultMasterKey) {
    return NextResponse.json(
      { error: 'misconfigured', error_description: 'Vault master key unavailable' },
      { status: 503 }
    );
  }

  const vaultDoc = await Vault.findOne({ sub });
  if (!vaultDoc) {
    return NextResponse.json(
      { error: 'forbidden', error_description: 'No vault credentials for subject' },
      { status: 403 }
    );
  }

  const masterKey = masterKeyFromSecret(config.vaultMasterKey);

  // Check cached session validity (at least 60s remaining)
  const now = Date.now();
  if (
    vaultDoc.encrypted_session &&
    vaultDoc.session_nonce &&
    vaultDoc.session_wrap_nonce &&
    vaultDoc.session_wrapped_dek &&
    vaultDoc.session_expires_at &&
    vaultDoc.session_expires_at.getTime() > now + 60000
  ) {
    try {
      const sessionBlob: SealedBlob = {
        nonce: Buffer.from(vaultDoc.session_nonce, 'base64'),
        ciphertext: Buffer.from(vaultDoc.encrypted_session, 'base64'),
        wrapNonce: Buffer.from(vaultDoc.session_wrap_nonce, 'base64'),
        wrappedDek: Buffer.from(vaultDoc.session_wrapped_dek, 'base64'),
        keyVersion: vaultDoc.key_version,
      };
      const sessionDecrypted = open(masterKey, sessionBlob).toString('utf-8');
      let sessionData: { token: string; access_token?: string | null; user_id?: string | null };
      try {
        sessionData = JSON.parse(sessionDecrypted);
      } catch {
        sessionData = { token: sessionDecrypted };
      }
      return sessionResponse(sessionData);
    } catch {
      // If decryption fails, fall through to refresh with Academy
    }
  }

  // Decrypt user password from vault
  let decryptedPassword = '';
  try {
    const passwordBlob: SealedBlob = {
      nonce: Buffer.from(vaultDoc.password_nonce, 'base64'),
      ciphertext: Buffer.from(vaultDoc.encrypted_password, 'base64'),
      wrapNonce: Buffer.from(vaultDoc.password_wrap_nonce, 'base64'),
      wrappedDek: Buffer.from(vaultDoc.password_wrapped_dek, 'base64'),
      keyVersion: vaultDoc.key_version,
    };
    decryptedPassword = open(masterKey, passwordBlob).toString('utf-8');
  } catch {
    return NextResponse.json(
      { error: 'forbidden', error_description: 'Vault credentials unreadable' },
      { status: 403 }
    );
  }

  const user = await User.findOne({ sub, deleted_at: null });
  if (!user) {
    return NextResponse.json(
      { error: 'forbidden', error_description: 'User not found or deleted' },
      { status: 403 }
    );
  }

  // Refresh Academy session using stored username if available
  const loginIdentifier = vaultDoc.username || user.prn || user.srn;
  const academy = new AcademyClient();
  try {
    const authResult = await academy.login(loginIdentifier, decryptedPassword);

    const sessionData = {
      token: authResult.session.token,
      access_token: authResult.session.accessToken,
      user_id: authResult.session.userId,
    };

    const sessionBlob = seal(
      masterKey,
      Buffer.from(JSON.stringify(sessionData), 'utf-8'),
      1
    );

    vaultDoc.encrypted_session = sessionBlob.ciphertext.toString('base64');
    vaultDoc.session_nonce = sessionBlob.nonce.toString('base64');
    vaultDoc.session_wrap_nonce = sessionBlob.wrapNonce.toString('base64');
    vaultDoc.session_wrapped_dek = sessionBlob.wrappedDek.toString('base64');
    vaultDoc.session_expires_at = authResult.session.expiresAt || new Date(Date.now() + 24 * 3600 * 1000);
    vaultDoc.updated_at = new Date();
    await vaultDoc.save();

    return sessionResponse(sessionData);
  } catch {
    return NextResponse.json(
      {
        error: 'academy_unavailable',
        error_description: 'Could not refresh Academy session',
      },
      { status: 502 }
    );
  }
}
