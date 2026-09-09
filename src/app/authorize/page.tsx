import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { connectToDatabase } from '@/lib/db/connection';
import { Client, ClientTester, Consent, AuthCode } from '@/lib/db/models';
import { verifySessionToken } from '@/lib/session/cookie';
import { newAuthCode } from '@/lib/id/nanoid';
import { sha256Hex } from '@/lib/crypto/hash';
import { ConsentClient } from './consent-client';

interface AuthorizePageProps {
  searchParams: Promise<{
    client_id?: string;
    redirect_uri?: string;
    response_type?: string;
    scope?: string;
    state?: string;
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
    scope = 'openid',
    state,
    code_challenge: codeChallenge,
    code_challenge_method: codeChallengeMethod = 'S256',
    mode = 'identity',
  } = params;

  if (!clientId || !redirectUri || responseType !== 'code' || !codeChallenge) {
    return (
      <div className="max-w-md mx-auto my-12 p-6 rounded-2xl bg-red-500/10 border border-red-500/20 text-red-600 text-sm">
        Invalid authorization request. Required: client_id, redirect_uri, response_type=code, and code_challenge.
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

  // Check Publishing Gate
  if (client.publishing_status === 'testing') {
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

  const requestedScopes = scope.split(' ').filter(Boolean);

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
    (mode === 'identity' || existingConsent.mode === 'delegated');

  // If already consented, auto-issue code and redirect
  if (coversScopes && coversMode) {
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
      mode={mode as 'identity' | 'delegated'}
      redirectUri={redirectUri}
      state={state}
      codeChallenge={codeChallenge}
      codeChallengeMethod={codeChallengeMethod}
    />
  );
}
