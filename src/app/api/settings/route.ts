import { NextRequest, NextResponse } from 'next/server';
import { connectToDatabase } from '@/lib/db/connection';
import { Client, Consent, User, Vault } from '@/lib/db/models';
import { verifySessionToken } from '@/lib/session/cookie';
import { AcademyClient } from '@/lib/academy/client';
import { getConfig } from '@/lib/config';
import { masterKeyFromSecret, seal } from '@/lib/crypto/envelope';

export async function GET(request: NextRequest) {
  const sessionCookie = request.cookies.get('pesu_session')?.value;
  const session = sessionCookie ? await verifySessionToken<{ sub: string }>(sessionCookie) : null;

  if (!session?.sub) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  await connectToDatabase();
  const user = await User.findOne({ sub: session.sub });
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
  const action = searchParams.get('action'); // 'vault' | 'consent'
  const clientId = searchParams.get('client_id');

  await connectToDatabase();

  if (action === 'vault') {
    await Vault.deleteOne({ sub: session.sub });
    return NextResponse.json({ success: true, message: 'Vault credentials deleted' });
  }

  if (action === 'consent' && clientId) {
    await Consent.deleteOne({ sub: session.sub, client_id: clientId });
    return NextResponse.json({ success: true, message: 'Consent revoked' });
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
  const user = await User.findOne({ sub: session.sub });
  if (!user) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 });
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
  const passBlob = seal(masterKey, Buffer.from(newPassword, 'utf-8'), 1);

  let sessionBlob;
  if (authResult.session.token) {
    sessionBlob = seal(masterKey, Buffer.from(authResult.session.token, 'utf-8'), 1);
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

  return NextResponse.json({ success: true, message: 'Vault credentials updated successfully' });
}
