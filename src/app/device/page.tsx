import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { connectToDatabase } from '@/lib/db/connection';
import { Client, DeviceCode } from '@/lib/db/models';
import { verifySessionToken } from '@/lib/session/cookie';
import { formatUserCode, normalizeUserCode } from '@/lib/id/nanoid';
import { requiresDelegated } from '@/lib/oidc/scopes';
import { ConsentClient } from '@/app/oauth2/authorize/consent-client';
import { controlStyles, labelStyles } from '@/components/ui/input';

export const metadata: Metadata = { title: 'Device Sign-in · PESU OAuth' };
export const dynamic = 'force-dynamic';

interface DevicePageProps {
  searchParams: Promise<{ user_code?: string }>;
}

function CodeForm({ error, value }: { error?: string; value?: string }) {
  return (
    <div className="flex justify-center py-6 min-[701px]:py-12">
      <div className="w-full max-w-[420px] space-y-6">
        <div className="space-y-3">
          <p className="eyebrow">Device sign-in</p>
          <h1 className="font-serif text-[36px] font-normal leading-[1.05] text-fg">Connect a device</h1>
          <p className="text-sm text-soft leading-[1.65]">
            Enter the code shown on your TV, terminal or other device to sign it in with your PESU account.
          </p>
        </div>
        <form method="GET" action="/device" className="space-y-4 p-6 rounded-md bg-surface border border-line">
          {error ? (
            <p role="alert" className="px-3 py-2.5 rounded-[5px] border border-danger/40 bg-danger/5 text-danger text-sm">
              {error}
            </p>
          ) : null}
          <div className="space-y-1.5">
            <label htmlFor="user_code" className={labelStyles}>Device code</label>
            <input
              id="user_code"
              name="user_code"
              required
              autoFocus
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              placeholder="XXXX-XXXX"
              defaultValue={value}
              maxLength={12}
              className={`${controlStyles} font-mono text-lg tracking-[0.2em] text-center uppercase`}
            />
          </div>
          <button
            type="submit"
            className="w-full h-12 rounded-[5px] bg-button text-button-fg border border-button font-mono font-bold uppercase text-[11px] tracking-[0.02em] cursor-pointer hover:opacity-90"
          >
            Continue
          </button>
        </form>
      </div>
    </div>
  );
}

export default async function DevicePage({ searchParams }: DevicePageProps) {
  const { user_code: rawCode } = await searchParams;

  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get('pesu_session')?.value;
  const session = sessionCookie ? await verifySessionToken<{ sub: string; name: string }>(sessionCookie) : null;
  if (!session?.sub) {
    const returnTo = rawCode ? `/device?user_code=${encodeURIComponent(rawCode)}` : '/device';
    redirect(`/login?return_to=${encodeURIComponent(returnTo)}`);
  }

  if (!rawCode) return <CodeForm />;

  const code = normalizeUserCode(rawCode);
  if (!code) {
    return <CodeForm value={rawCode} error="That doesn't look like a device code. It has 8 letters, like BDFG-HJKL." />;
  }

  await connectToDatabase();
  const device = await DeviceCode.findOne({ user_code: code, status: 'pending', expires_at: { $gt: new Date() } });
  if (!device) {
    return <CodeForm value={formatUserCode(code)} error="This code is invalid, already used, or expired. Start again on your device." />;
  }

  const client = await Client.findOne({ client_id: device.client_id });
  if (!client || client.publishing_status === 'suspended') {
    return <CodeForm error="This application is unavailable." />;
  }

  const mode = requiresDelegated(device.scopes) || client.delegated_allowed ? 'delegated' : 'identity';

  return (
    <ConsentClient
      client={{
        clientId: client.client_id,
        name: client.name,
        publishingStatus: client.publishing_status,
        delegatedAllowed: client.delegated_allowed,
        ownerSub: client.owner_sub,
      }}
      userName={session.name}
      requestedScopes={device.scopes}
      mode={mode}
      redirectUri=""
      codeChallenge=""
      codeChallengeMethod="S256"
      deviceUserCode={formatUserCode(code)}
    />
  );
}
