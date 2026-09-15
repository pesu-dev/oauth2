import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { connectToDatabase } from '@/lib/db/connection';
import { Client, ClientTester, Consent, AuthCode, Vault } from '@/lib/db/models';
import { verifySessionToken } from '@/lib/session/cookie';
import { pendingCredentialStore } from '@/lib/session/pending-credentials';
import { newAuthCode } from '@/lib/id/nanoid';
import { sha256Hex } from '@/lib/crypto/hash';
import { getConfig } from '@/lib/config';
import { masterKeyFromSecret, seal } from '@/lib/crypto/envelope';
import { ConsentClient } from './consent-client';

const PKCE_CHALLENGE_RE = /^[A-Za-z0-9\-_]{43,128}$/;

interface AuthorizePageProps {
  searchParams: Promise<{
    client_id?: string;
    redirect_uri?: string;
    response_type?: string;
    scope?: string;
    state?: string;
    nonce?: string;
    code_challenge?: string;
    code_challenge_method?: string;
    mode?: string;
  }>;
}

export default async function AuthorizePage({ searchParams }: AuthorizePageProps) {
  const params = await searchParams;
  const {
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: responseType,
    scope = '',
    state,
    nonce,
    code_challenge: codeChallenge,
    code_challenge_method: codeChallengeMethod,
  } = params;

  if (!clientId || !redirectUri || responseType !== 'code') {
    return (
      <div className="max-w-md mx-auto my-12 p-6 rounded-2xl bg-red-500/10 border border-red-500/20 text-red-600 text-sm">
        Invalid authorization request. Required: client_id, redirect_uri, and response_type=code.
      </div>
    );
  }

  // PKCE is strictly required (RFC 7636)
  if (!codeChallenge || !codeChallengeMethod) {
    return (
      <div className="max-w-md mx-auto my-12 p-6 rounded-2xl bg-red-500/10 border border-red-500/20 text-red-600 text-sm">
        Authorization requires PKCE with code_challenge and code_challenge_method=S256.
      </div>
    );
  }

  if (codeChallengeMethod !== 'S256') {
    return (
      <div className="max-w-md mx-auto my-12 p-6 rounded-2xl bg-red-500/10 border border-red-500/20 text-red-600 text-sm">
        Only code_challenge_method=S256 is supported.
      </div>
    );
  }

  if (!PKCE_CHALLENGE_RE.test(codeChallenge)) {
    return (
      <div className="max-w-md mx-auto my-12 p-6 rounded-2xl bg-red-500/10 border border-red-500/20 text-red-600 text-sm">
        code_challenge must be a valid BASE64URL (S256) string (43–128 characters).
      </div>
    );
  }

  const requestedScopes = (scope || '').split(' ').filter(Boolean);
  if (!requestedScopes.includes('openid')) {
    return (
      <div className="max-w-md mx-auto my-12 p-6 rounded-2xl bg-red-500/10 border border-red-500/20 text-red-600 text-sm">
        A valid openid scope is required in the scope parameter.
      </div>
    );
  }

  await connectToDatabase();
  const client = await Client.findOne({ client_id: clientId });
  if (!client) {
    return (
      <div className="max-w-md mx-auto my-12 p-6 rounded-2xl bg-red-500/10 border border-red-500/20 text-red-600 text-sm">
        Client application not found.
      </div>
    );
  }

  if (!client.redirect_uris.includes(redirectUri)) {
    return (
      <div className="max-w-md mx-auto my-12 p-6 rounded-2xl bg-red-500/10 border border-red-500/20 text-red-600 text-sm">
        Redirect URI is not registered for this client application.
      </div>
    );
  }

  // Check user authentication
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get('pesu_session')?.value;
  const session = sessionCookie ? await verifySessionToken<{ sub: string; name: string }>(sessionCookie) : null;

  if (!session?.sub) {
    const returnUrl = `/authorize?${new URLSearchParams(params as Record<string, string>).toString()}`;
    redirect(`/login?return_to=${encodeURIComponent(returnUrl)}`);
  }

  // Check Publishing Gate: testing and pending_production restrict authorization to owner and testers
  if (client.publishing_status === 'testing' || client.publishing_status === 'pending_production') {
    const isOwner = client.owner_sub === session.sub;
    const isTester = await ClientTester.findOne({ client_id: clientId, sub: session.sub });
    if (!isOwner && !isTester) {
      return (
        <div className="max-w-md mx-auto my-12 p-6 rounded-2xl bg-amber-500/10 border border-amber-500/20 text-amber-700 dark:text-amber-300 text-sm space-y-2">
          <h3 className="font-semibold text-base">Application in Testing Mode</h3>
          <p>
            This application is currently in development. Only the owner or designated testers can authorize it.
          </p>
        </div>
      );
    }
  }

  // Mode is determined by client's delegated_allowed permissions
  const targetMode = client.delegated_allowed ? 'delegated' : 'identity';

  // Check existing consent
  const existingConsent = await Consent.findOne({
    sub: session.sub,
    client_id: clientId,
  });

  const coversScopes =
    existingConsent &&
    requestedScopes.every((s) => existingConsent.scopes.includes(s));
  const coversMode =
    existingConsent &&
    (targetMode === 'identity' || existingConsent.mode === 'delegated');

  // If already consented, reseal fresh credentials if delegated, auto-issue code and redirect
  if (coversScopes && coversMode) {
    if (existingConsent.mode === 'delegated') {
      const vaultExists = await Vault.findOne({ sub: session.sub });
      const pendingCookie = cookieStore.get('pesu_pending')?.value;
      const pendingToken = pendingCookie
        ? await verifySessionToken<{ sub: string; cred_id?: string }>(pendingCookie)
        : null;
      if (pendingToken?.cred_id) {
        const pending = pendingCredentialStore.pop(pendingToken.cred_id);
        const config = getConfig();
        if (pending?.password && config.vaultMasterKey) {
          const masterKey = masterKeyFromSecret(config.vaultMasterKey);
          const passBlob = seal(masterKey, Buffer.from(pending.password, 'utf-8'), 1);
          let sessionBlob;
          let sessionExpiresAt: Date | undefined;
          if (pending.sessionToken) {
            const sessionData = {
              token: pending.sessionToken,
              access_token: pending.accessToken || null,
              user_id: pending.userId || null,
            };
            sessionBlob = seal(masterKey, Buffer.from(JSON.stringify(sessionData), 'utf-8'), 1);
            sessionExpiresAt = pending.expiresAt ? new Date(pending.expiresAt) : undefined;
          }
          await Vault.findOneAndUpdate(
            { sub: session.sub },
            {
              sub: session.sub,
              username: pending.username,
              encrypted_password: passBlob.ciphertext.toString('base64'),
              password_nonce: passBlob.nonce.toString('base64'),
              password_wrap_nonce: passBlob.wrapNonce.toString('base64'),
              password_wrapped_dek: passBlob.wrappedDek.toString('base64'),
              encrypted_session: sessionBlob?.ciphertext.toString('base64'),
              session_nonce: sessionBlob?.nonce.toString('base64'),
              session_wrap_nonce: sessionBlob?.wrapNonce.toString('base64'),
              session_wrapped_dek: sessionBlob?.wrappedDek.toString('base64'),
              session_expires_at: sessionExpiresAt,
              key_version: 1,
              updated_at: new Date(),
            },
            { upsert: true }
          );
        }
      } else if (!vaultExists) {
        const returnUrl = `/authorize?${new URLSearchParams(params as Record<string, string>).toString()}`;
        redirect(`/login?return_to=${encodeURIComponent(returnUrl)}`);
      }
    }

    const rawCode = newAuthCode();
    await AuthCode.create({
      code_hash: sha256Hex(rawCode),
      client_id: clientId,
      sub: session.sub,
      scopes: requestedScopes,
      mode: existingConsent.mode,
      redirect_uri: redirectUri,
      code_challenge: codeChallenge,
      code_challenge_method: codeChallengeMethod,
      nonce,
    });

    const targetUrl = new URL(redirectUri);
    targetUrl.searchParams.set('code', rawCode);
    if (state) targetUrl.searchParams.set('state', state);
    redirect(targetUrl.toString());
  }

  return (
    <ConsentClient
      client={{
        clientId: client.client_id,
        name: client.name,
        publishingStatus: client.publishing_status,
        delegatedAllowed: client.delegated_allowed,
      }}
      userName={session.name}
      requestedScopes={requestedScopes}
      mode={targetMode}
      redirectUri={redirectUri}
      state={state}
      nonce={nonce}
      codeChallenge={codeChallenge}
      codeChallengeMethod={codeChallengeMethod}
    />
  );
}
