import { NextRequest, NextResponse } from 'next/server';
import { connectToDatabase } from '@/lib/db/connection';
import { User, Vault } from '@/lib/db/models';
import { getConfig } from '@/lib/config';
import { verifyAccessToken } from '@/lib/oidc/jwt';
import { masterKeyFromSecret, open, seal, SealedBlob } from '@/lib/crypto/envelope';
import { AcademyClient } from '@/lib/academy/client';

export async function POST(request: NextRequest | Request) {
  const config = getConfig();

  // Validate internal authentication
  const authHeader = request.headers.get('authorization');
  const secretHeader = request.headers.get('x-token-exchange-secret');

  let targetSub: string | null = null;

  if (secretHeader && config.tokenExchangeSecret && secretHeader === config.tokenExchangeSecret) {
    try {
      const body = await request.json();
      targetSub = body.sub || null;
    } catch {
      return NextResponse.json(
        { error: 'invalid_request', error_description: 'Malformed JSON payload' },
        { status: 400 }
      );
    }
  } else if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.slice(7).trim();
    try {
      const payload = await verifyAccessToken(token, config.issuerUrl);
      if (payload.client_id !== config.firstPartyApiClientId) {
        return NextResponse.json(
          { error: 'unauthorized_client', error_description: 'Client unauthorized for token exchange' },
          { status: 403 }
        );
      }
      targetSub = payload.sub;
    } catch {
      return NextResponse.json(
        { error: 'invalid_token', error_description: 'Invalid bearer token' },
        { status: 401 }
      );
    }
  } else {
    return NextResponse.json(
      { error: 'access_denied', error_description: 'Unauthorized access to token exchange' },
      { status: 401 }
    );
  }

  if (!targetSub) {
    return NextResponse.json(
      { error: 'invalid_request', error_description: 'Missing target subject sub' },
      { status: 400 }
    );
  }

  if (!config.vaultMasterKey) {
    return NextResponse.json(
      { error: 'server_error', error_description: 'Vault master key unconfigured' },
      { status: 500 }
    );
  }

  await connectToDatabase();
  const vaultDoc = await Vault.findOne({ sub: targetSub });
  if (!vaultDoc) {
    return NextResponse.json(
      { error: 'not_found', error_description: 'User has no delegated vault credentials' },
      { status: 404 }
    );
  }

  const masterKey = masterKeyFromSecret(config.vaultMasterKey);

  // Decrypt password
  const passwordBlob: SealedBlob = {
    nonce: Buffer.from(vaultDoc.password_nonce, 'base64'),
    ciphertext: Buffer.from(vaultDoc.encrypted_password, 'base64'),
    wrapNonce: Buffer.from(vaultDoc.password_wrap_nonce, 'base64'),
    wrappedDek: Buffer.from(vaultDoc.password_wrapped_dek, 'base64'),
    keyVersion: vaultDoc.key_version,
  };

  let decryptedPassword = '';
  try {
    decryptedPassword = open(masterKey, passwordBlob).toString('utf-8');
  } catch {
    return NextResponse.json(
      { error: 'server_error', error_description: 'Failed to decrypt vault credentials' },
      { status: 500 }
    );
  }

  const user = await User.findOne({ sub: targetSub, deleted_at: null });
  if (!user) {
    return NextResponse.json(
      { error: 'invalid_grant', error_description: 'User not found' },
      { status: 404 }
    );
  }

  // Obtain or refresh Academy session material
  const academy = new AcademyClient();
  try {
    const authResult = await academy.login(user.prn || user.srn, decryptedPassword);

    // Encrypt fresh session and save to vaultDoc
    if (authResult.session.token) {
      const sessionBlob = seal(masterKey, Buffer.from(authResult.session.token, 'utf-8'), 1);
      vaultDoc.encrypted_session = sessionBlob.ciphertext.toString('base64');
      vaultDoc.session_nonce = sessionBlob.nonce.toString('base64');
      vaultDoc.session_wrap_nonce = sessionBlob.wrapNonce.toString('base64');
      vaultDoc.session_wrapped_dek = sessionBlob.wrappedDek.toString('base64');
      vaultDoc.updated_at = new Date();
      await vaultDoc.save();
    }

    return NextResponse.json({
      token: authResult.session.token,
      access_token: authResult.session.accessToken,
      user_id: authResult.session.userId,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Academy login failed';
    return NextResponse.json(
      { error: 'invalid_grant', error_description: msg },
      { status: 400 }
    );
  }
}
