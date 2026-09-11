import { NextRequest, NextResponse } from 'next/server';
import { connectToDatabase } from '@/lib/db/connection';
import {
  AuthCode,
  Client,
  Consent,
  Vault,
} from '@/lib/db/models';
import { verifySessionToken } from '@/lib/session/cookie';
import { newAuthCode } from '@/lib/id/nanoid';
import { sha256Hex } from '@/lib/crypto/hash';
import { getConfig } from '@/lib/config';
import { masterKeyFromSecret, seal } from '@/lib/crypto/envelope';
import { notifySubQuietly } from '@/lib/mailer';

export async function POST(request: NextRequest) {
  try {
    const sessionCookie = request.cookies.get('pesu_session')?.value;
    const session = sessionCookie ? await verifySessionToken<{ sub: string }>(sessionCookie) : null;

    if (!session?.sub) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const {
      clientId,
      redirectUri,
      scope,
      state,
      nonce,
      codeChallenge,
      codeChallengeMethod,
      mode = 'identity',
      action, // 'allow' | 'deny'
    } = body;

    if (action === 'deny') {
      const targetUrl = new URL(redirectUri);
      targetUrl.searchParams.set('error', 'access_denied');
      targetUrl.searchParams.set('error_description', 'User denied consent');
      if (state) targetUrl.searchParams.set('state', state);
      return NextResponse.json({ redirectTo: targetUrl.toString() });
    }

    await connectToDatabase();
    const client = await Client.findOne({ client_id: clientId });
    if (!client) {
      return NextResponse.json({ error: 'Client not found' }, { status: 404 });
    }

    const scopes = (scope || 'openid').split(' ').filter(Boolean);

    // Save or update Consent
    await Consent.findOneAndUpdate(
      { sub: session.sub, client_id: clientId },
      {
        sub: session.sub,
        client_id: clientId,
        scopes,
        mode: mode === 'delegated' && client.delegated_allowed ? 'delegated' : 'identity',
        granted_at: new Date(),
      },
      { upsert: true }
    );

    // If delegated mode, process vault storage using pending credentials cookie
    if (mode === 'delegated' && client.delegated_allowed) {
      const config = getConfig();
      const pendingCookie = request.cookies.get('pesu_pending')?.value;
      const pending = pendingCookie
        ? await verifySessionToken<{ password?: string; session_token?: string; user_id?: string }>(pendingCookie)
        : null;

      if (pending?.password && config.vaultMasterKey) {
        const masterKey = masterKeyFromSecret(config.vaultMasterKey);
        const passBlob = seal(masterKey, Buffer.from(pending.password, 'utf-8'), 1);

        let sessionBlob;
        if (pending.session_token) {
          sessionBlob = seal(masterKey, Buffer.from(pending.session_token, 'utf-8'), 1);
        }

        await Vault.findOneAndUpdate(
          { sub: session.sub },
          {
            sub: session.sub,
            encrypted_password: passBlob.ciphertext.toString('base64'),
            password_nonce: passBlob.nonce.toString('base64'),
            password_wrap_nonce: passBlob.wrapNonce.toString('base64'),
            password_wrapped_dek: passBlob.wrappedDek.toString('base64'),
            encrypted_session: sessionBlob?.ciphertext.toString('base64'),
            session_nonce: sessionBlob?.nonce.toString('base64'),
            session_wrap_nonce: sessionBlob?.wrapNonce.toString('base64'),
            session_wrapped_dek: sessionBlob?.wrappedDek.toString('base64'),
            key_version: 1,
            updated_at: new Date(),
          },
          { upsert: true }
        );
      }
    }

    // Generate AuthCode
    const rawCode = newAuthCode();
    await AuthCode.create({
      code_hash: sha256Hex(rawCode),
      client_id: clientId,
      sub: session.sub,
      scopes,
      mode: mode === 'delegated' && client.delegated_allowed ? 'delegated' : 'identity',
      redirect_uri: redirectUri,
      code_challenge: codeChallenge,
      code_challenge_method: codeChallengeMethod || 'S256',
      nonce,
    });

    const effectiveMode = mode === 'delegated' && client.delegated_allowed ? 'delegated' : 'identity';
    notifySubQuietly({
      sub: session.sub,
      subject: `Access granted to ${client.name}`,
      body: `You granted ${effectiveMode} access to ${client.name} (${client.client_id}). You can revoke this anytime in Settings.`,
    });

    const targetUrl = new URL(redirectUri);
    targetUrl.searchParams.set('code', rawCode);
    if (state) targetUrl.searchParams.set('state', state);

    return NextResponse.json({ redirectTo: targetUrl.toString() });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Consent processing failed';
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
