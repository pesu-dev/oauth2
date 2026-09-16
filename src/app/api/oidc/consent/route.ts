import { NextRequest, NextResponse } from 'next/server';
import { connectToDatabase } from '@/lib/db/connection';
import {
  AuthCode,
  Client,
  ClientTester,
  Consent,
  Vault,
} from '@/lib/db/models';
import { verifySessionToken } from '@/lib/session/cookie';
import { pendingCredentialStore } from '@/lib/session/pending-credentials';
import { newAuthCode } from '@/lib/id/nanoid';
import { sha256Hex } from '@/lib/crypto/hash';
import { getConfig } from '@/lib/config';
import { masterKeyFromSecret, seal, packVaultPlaintext, VaultPlaintext } from '@/lib/crypto/envelope';
import { notifySubQuietly } from '@/lib/mailer';

export async function POST(request: NextRequest) {
  try {
    const config = getConfig();
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

    if (!clientId || !redirectUri || !action) {
      return NextResponse.json(
        { error: 'Missing required parameters (clientId, redirectUri, action)' },
        { status: 400 }
      );
    }

    if (mode !== 'identity' && mode !== 'delegated') {
      return NextResponse.json(
        { error: 'Invalid mode: must be identity or delegated' },
        { status: 400 }
      );
    }

    await connectToDatabase();
    const client = await Client.findOne({ client_id: clientId });
    if (!client) {
      return NextResponse.json({ error: 'Client not found' }, { status: 404 });
    }

    if (!client.redirect_uris || !client.redirect_uris.includes(redirectUri)) {
      return NextResponse.json({ error: 'Invalid redirect URI' }, { status: 400 });
    }

    // Check Publishing Gate: testing and pending_production restrict authorization to owner and testers
    if (client.publishing_status === 'testing' || client.publishing_status === 'pending_production') {
      const isOwner = client.owner_sub === session.sub;
      const isTester = await ClientTester.findOne({ client_id: clientId, sub: session.sub });
      if (!isOwner && !isTester) {
        return NextResponse.json(
          { error: 'Application in testing mode. Only the owner and designated testers can authorize it.' },
          { status: 403 }
        );
      }
    }

    if (action === 'allow') {
      const PKCE_CHALLENGE_RE = /^[A-Za-z0-9\-_]{43,128}$/;
      if (!codeChallenge || !PKCE_CHALLENGE_RE.test(codeChallenge)) {
        return NextResponse.json(
          { error: 'code_challenge must be a valid BASE64URL (S256) string (43–128 characters)' },
          { status: 400 }
        );
      }

      if (codeChallengeMethod && codeChallengeMethod !== 'S256') {
        return NextResponse.json(
          { error: 'Only code_challenge_method=S256 is supported' },
          { status: 400 }
        );
      }

      if (mode === 'delegated' && !client.delegated_allowed) {
        return NextResponse.json(
          { error: 'Client is not approved for delegated access' },
          { status: 403 }
        );
      }
    }

    const pendingCookie = request.cookies.get('pesu_pending')?.value;
    const pendingToken = pendingCookie
      ? await verifySessionToken<{ sub: string; cred_id?: string; password?: string; session_token?: string; user_id?: string }>(pendingCookie)
      : null;

    if (action === 'deny') {
      if (pendingToken?.cred_id) {
        pendingCredentialStore.pop(pendingToken.cred_id);
      }
      const targetUrl = new URL(redirectUri);
      targetUrl.searchParams.set('error', 'access_denied');
      targetUrl.searchParams.set('error_description', 'User denied consent');
      if (state) targetUrl.searchParams.set('state', state);
      return NextResponse.json({ redirectTo: targetUrl.toString() });
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

    // If delegated mode, process vault storage using pending credentials
    if (mode === 'delegated' && client.delegated_allowed) {
      // Retrieve ephemeral credentials from memory store (or fallback to legacy token fields for backwards compatibility in tests)
      const pending = pendingToken?.cred_id
        ? pendingCredentialStore.pop(pendingToken.cred_id)
        : (pendingToken?.password
            ? {
                username: '',
                password: pendingToken.password,
                sessionToken: pendingToken.session_token,
                userId: pendingToken.user_id,
              }
            : null);

      const existingVault = await Vault.findOne({ sub: session.sub });
      if (!pending?.password && !existingVault) {
        return NextResponse.json(
          { error: 'Session expired or credentials missing. Please start authorization again.' },
          { status: 400 }
        );
      }

      if (pending?.password) {
        if (!config.vaultMasterKey) {
          return NextResponse.json(
            { error: 'Vault master key unavailable. Delegated consent cannot be stored.' },
            { status: 503 }
          );
        }
        const username = pending.username || session.sub;

        const sessionExpiresAt: Date | undefined = pending.expiresAt
          ? new Date(pending.expiresAt)
          : undefined;

        const plaintext: VaultPlaintext = {
          username,
          password: pending.password,
          session: pending.sessionToken
            ? {
                token: pending.sessionToken,
                access_token: pending.accessToken || null,
                user_id: pending.userId || null,
              }
            : null,
        };

        const masterKey = masterKeyFromSecret(config.vaultMasterKey);
        const sealed = seal(masterKey, packVaultPlaintext(plaintext), 1);

        await Vault.findOneAndUpdate(
          { sub: session.sub },
          {
            sub: session.sub,
            nonce: sealed.nonce,
            ciphertext: sealed.ciphertext,
            wrap_nonce: sealed.wrapNonce,
            wrapped_dek: sealed.wrappedDek,
            key_version: sealed.keyVersion,
            session_expires_at: sessionExpiresAt,
            updated_at: new Date(),
          },
          { upsert: true }
        );
      }
    } else {
      // Identity mode: pop and discard any pending credentials
      if (pendingToken?.cred_id) {
        pendingCredentialStore.pop(pendingToken.cred_id);
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
      expires_at: new Date(Date.now() + config.authorizationCodeTtlSeconds * 1000),
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
