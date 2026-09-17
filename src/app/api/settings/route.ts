import { NextRequest, NextResponse } from 'next/server';
import { connectToDatabase } from '@/lib/db/connection';
import { Client, Consent, RefreshToken, User, Vault } from '@/lib/db/models';
import { verifySessionToken } from '@/lib/session/cookie';
import { AcademyClient } from '@/lib/academy/client';
import { getConfig } from '@/lib/config';
import { masterKeyFromSecret, seal, packVaultPlaintext, VaultPlaintext } from '@/lib/crypto/envelope';
import { notifySubQuietly } from '@/lib/mailer';

export async function GET(request: NextRequest) {
  const sessionCookie = request.cookies.get('pesu_session')?.value;
  const session = sessionCookie ? await verifySessionToken<{ sub: string }>(sessionCookie) : null;

  if (!session?.sub) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  await connectToDatabase();
  const user = await User.findOne({ sub: session.sub, deleted_at: null });
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const vault = await Vault.findOne({ sub: session.sub });
  const consents = await Consent.find({ sub: session.sub });

  const clientIds = consents.map((c) => c.client_id);
  const clients = await Client.find({ client_id: { $in: clientIds } });
  const clientMap = new Map(clients.map((c) => [c.client_id, c.name]));

  const enrichedConsents = consents.map((c) => ({
    client_id: c.client_id,
    client_name: clientMap.get(c.client_id) || c.client_id,
    scopes: c.scopes,
    mode: c.mode,
    granted_at: c.granted_at,
  }));

  return NextResponse.json({
    user,
    hasVault: Boolean(vault),
    vaultUpdatedAt: vault?.updated_at || null,
    consents: enrichedConsents,
  });
}

export async function DELETE(request: NextRequest) {
  const sessionCookie = request.cookies.get('pesu_session')?.value;
  const session = sessionCookie ? await verifySessionToken<{ sub: string }>(sessionCookie) : null;

  if (!session?.sub) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const action = searchParams.get('action'); // 'vault' | 'consent' | 'account'
  const clientId = searchParams.get('client_id');

  await connectToDatabase();

  if (action === 'vault') {
    await Vault.deleteOne({ sub: session.sub });

    notifySubQuietly({
      sub: session.sub,
      subject: 'Stored credentials deleted',
      body: 'Your stored PESU Academy credentials were deleted from the vault. Identity consents (if any) remain until you revoke them.',
    });

    return NextResponse.json({ success: true, message: 'Vault credentials deleted' });
  }

  if (action === 'consent' && clientId) {
    await Consent.deleteOne({ sub: session.sub, client_id: clientId });

    // Revoke all live refresh tokens for this subject and client
    await RefreshToken.updateMany(
      { sub: session.sub, client_id: clientId, revoked_at: null },
      { $set: { revoked_at: new Date() } }
    );

    // If no delegated consents remain, purge vault credentials
    const remainingDelegated = await Consent.countDocuments({
      sub: session.sub,
      mode: 'delegated',
    });
    if (remainingDelegated === 0) {
      await Vault.deleteOne({ sub: session.sub });
    }

    const client = await Client.findOne({ client_id: clientId });
    const appName = client?.name || clientId;

    notifySubQuietly({
      sub: session.sub,
      subject: `Access revoked for ${appName}`,
      body: `You revoked access for ${appName} (${clientId}). Refresh tokens for this app are no longer valid.`,
    });

    return NextResponse.json({ success: true, message: 'Consent revoked' });
  }

  if (action === 'account') {
    let confirm = searchParams.get('confirm');
    if (!confirm) {
      try {
        const body = await request.json();
        confirm = body.confirm;
      } catch {
        // ignore
      }
    }

    if (confirm?.trim() !== 'DELETE') {
      return NextResponse.json(
        { error: 'Type DELETE to confirm account deletion' },
        { status: 400 }
      );
    }

    // 1. Tombstone user record (never reuse sub)
    await User.updateOne(
      { sub: session.sub, deleted_at: null },
      { $set: { deleted_at: new Date() } }
    );

    // 2. Revoke all live refresh tokens
    await RefreshToken.updateMany(
      { sub: session.sub, revoked_at: null },
      { $set: { revoked_at: new Date() } }
    );

    // 3. Delete all consents
    await Consent.deleteMany({ sub: session.sub });

    // 4. Delete vault credentials
    await Vault.deleteOne({ sub: session.sub });

    notifySubQuietly({
      sub: session.sub,
      subject: 'Account deleted',
      body: 'Your PESU OAuth2 account was deleted. Consents, refresh tokens, and stored credentials were removed. Your subject id will not be reused.',
    });

    // 5. Clear session cookie
    const config = getConfig();
    const response = NextResponse.json({
      success: true,
      message: 'Account deleted successfully',
    });
    response.cookies.set('pesu_session', '', {
      path: '/',
      maxAge: 0,
      httpOnly: true,
      secure: config.appEnv !== 'local',
      sameSite: 'lax',
    });

    return response;
  }

  return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
}

export async function PATCH(request: NextRequest) {
  const sessionCookie = request.cookies.get('pesu_session')?.value;
  const session = sessionCookie ? await verifySessionToken<{ sub: string }>(sessionCookie) : null;

  if (!session?.sub) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json();
  const { newPassword } = body;

  if (!newPassword) {
    return NextResponse.json({ error: 'New password is required' }, { status: 400 });
  }

  await connectToDatabase();
  const user = await User.findOne({ sub: session.sub, deleted_at: null });
  if (!user) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 });
  }

  const existingVault = await Vault.findOne({ sub: session.sub });
  if (!existingVault) {
    return NextResponse.json({ error: 'No saved credentials to update' }, { status: 400 });
  }

  // Validate credentials against Academy
  const academy = new AcademyClient();
  let authResult;
  try {
    authResult = await academy.login(user.prn || user.srn, newPassword);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Invalid Academy password';
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  const config = getConfig();
  if (!config.vaultMasterKey) {
    return NextResponse.json({ error: 'Vault master key not configured' }, { status: 500 });
  }

  const masterKey = masterKeyFromSecret(config.vaultMasterKey);
  const plaintext: VaultPlaintext = {
    username: user.prn || user.srn,
    password: newPassword,
    session: authResult.session.token
      ? {
          token: authResult.session.token,
          access_token: authResult.session.accessToken || null,
          user_id: authResult.session.userId || null,
        }
      : null,
  };

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
      session_expires_at: authResult.session.expiresAt || null,
      updated_at: new Date(),
    },
    { upsert: false }
  );

  notifySubQuietly({
    sub: session.sub,
    subject: 'Saved credentials updated',
    body: 'Your stored PESU Academy credentials were updated after a successful re-authentication.',
  });

  return NextResponse.json({ success: true, message: 'Vault credentials updated successfully' });
}
