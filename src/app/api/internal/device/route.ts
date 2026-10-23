import { NextRequest, NextResponse } from 'next/server';
import { connectToDatabase } from '@/lib/db/connection';
import { withTransaction } from '@/lib/db/transaction';
import { Client, ClientTester, Consent, DeviceCode, Vault } from '@/lib/db/models';
import { verifySessionToken } from '@/lib/session/cookie';
import { pendingCredentialStore } from '@/lib/session/pending-credentials';
import { sealPendingCredentials } from '@/lib/session/vault-seal';
import { normalizeUserCode } from '@/lib/id/nanoid';
import { requiresDelegated, unapprovedScopes } from '@/lib/oidc/scopes';
import { getConfig } from '@/lib/config';
import { notifySubQuietly } from '@/lib/mailer';

/** Approves or denies a pending RFC 8628 device code for the signed-in student. */
export async function POST(request: NextRequest) {
  try {
    const config = getConfig();
    const sessionCookie = request.cookies.get('pesu_session')?.value;
    const session = sessionCookie ? await verifySessionToken<{ sub: string }>(sessionCookie) : null;
    if (!session?.sub) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { userCode, action } = await request.json();
    if (action !== 'allow' && action !== 'deny') {
      return NextResponse.json({ error: 'Invalid action: must be allow or deny' }, { status: 400 });
    }
    const code = normalizeUserCode(userCode);
    if (!code) {
      return NextResponse.json({ error: 'Enter the 8-character code shown on your device' }, { status: 400 });
    }

    await connectToDatabase();
    const device = await DeviceCode.findOne({ user_code: code, status: 'pending', expires_at: { $gt: new Date() } });
    if (!device) {
      return NextResponse.json({ error: 'This code is invalid, already used, or expired' }, { status: 404 });
    }

    const client = await Client.findOne({ client_id: device.client_id });
    if (!client || client.publishing_status === 'suspended') {
      return NextResponse.json({ error: 'Application is unavailable or suspended.' }, { status: 403 });
    }

    if (client.publishing_status === 'testing' || client.publishing_status === 'pending_production') {
      const isOwner = client.owner_sub === session.sub;
      const isTester = await ClientTester.findOne({ client_id: client.client_id, sub: session.sub });
      if (!isOwner && !isTester) {
        return NextResponse.json(
          { error: 'Application in testing mode. Only the owner and designated testers can authorize it.' },
          { status: 403 }
        );
      }
    }

    const pendingCookie = request.cookies.get('pesu_pending')?.value;
    const rawPending = pendingCookie ? await verifySessionToken<{ sub: string; cred_id?: string }>(pendingCookie) : null;
    const credId = rawPending && rawPending.sub === session.sub ? rawPending.cred_id : undefined;

    if (action === 'deny') {
      if (credId) pendingCredentialStore.pop(credId);
      await DeviceCode.updateOne({ _id: device._id, status: 'pending' }, { $set: { status: 'denied', sub: session.sub } });
      return NextResponse.json({ status: 'denied' });
    }

    // Approvals may have been withdrawn since the device started the flow
    const blocked = unapprovedScopes(device.scopes, client.allowed_scopes);
    if (blocked.length > 0) {
      return NextResponse.json(
        { error: 'invalid_scope', error_description: `Client is not approved for: ${blocked.join(', ')}` },
        { status: 400 }
      );
    }

    const mode = requiresDelegated(device.scopes) || client.delegated_allowed ? 'delegated' : 'identity';
    let vaultUpdate: Record<string, unknown> | null = null;
    if (mode === 'delegated') {
      if (!client.delegated_allowed) {
        return NextResponse.json({ error: 'Client is not approved for delegated access' }, { status: 403 });
      }
      const pending = credId ? pendingCredentialStore.pop(credId) : null;
      if (pending?.password) {
        if (!config.vaultMasterKey) {
          return NextResponse.json(
            { error: 'Vault master key unavailable. Delegated consent cannot be stored.' },
            { status: 503 }
          );
        }
        vaultUpdate = sealPendingCredentials(session.sub, pending, config.vaultMasterKey);
      } else if (!(await Vault.findOne({ sub: session.sub }))) {
        return NextResponse.json(
          { error: 'Session expired or credentials missing. Sign in again to approve this device.' },
          { status: 400 }
        );
      }
    } else if (credId) {
      // Identity mode: discard any captured credentials
      pendingCredentialStore.pop(credId);
    }

    const approved = await withTransaction(async (dbSession) => {
      const updated = await DeviceCode.findOneAndUpdate(
        { _id: device._id, status: 'pending' },
        { $set: { status: 'approved', sub: session.sub, mode } },
        { returnDocument: 'after', session: dbSession }
      );
      if (!updated) return false;

      await Consent.findOneAndUpdate(
        { sub: session.sub, client_id: client.client_id },
        { sub: session.sub, client_id: client.client_id, scopes: device.scopes, mode, granted_at: new Date() },
        { upsert: true, session: dbSession }
      );
      if (vaultUpdate) {
        await Vault.findOneAndUpdate({ sub: session.sub }, vaultUpdate, { upsert: true, session: dbSession });
      }
      return true;
    });

    if (!approved) {
      return NextResponse.json({ error: 'This code was already used' }, { status: 409 });
    }

    notifySubQuietly({
      sub: session.sub,
      subject: `Device signed in to ${client.name}`,
      body: `You approved a device sign-in for ${client.name} (${client.client_id}) with ${mode} access. You can revoke it anytime in Settings.`,
    });

    return NextResponse.json({ status: 'approved' });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Device approval failed';
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
