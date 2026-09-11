import { NextRequest, NextResponse } from 'next/server';
import { connectToDatabase } from '@/lib/db/connection';
import { Client } from '@/lib/db/models';
import { verifySessionToken } from '@/lib/session/cookie';
import { newClientId, newClientSecret } from '@/lib/id/nanoid';
import { sha256Hex } from '@/lib/crypto/hash';

export async function GET(request: NextRequest) {
  const sessionCookie = request.cookies.get('pesu_session')?.value;
  const session = sessionCookie ? await verifySessionToken<{ sub: string }>(sessionCookie) : null;

  if (!session?.sub) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  await connectToDatabase();
  const clients = await Client.find({ owner_sub: session.sub }).sort({ created_at: -1 });

  return NextResponse.json({ clients });
}

export async function POST(request: NextRequest) {
  const sessionCookie = request.cookies.get('pesu_session')?.value;
  const session = sessionCookie ? await verifySessionToken<{ sub: string }>(sessionCookie) : null;

  if (!session?.sub) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { name, redirectUris } = body;

    if (!name || !redirectUris || !Array.isArray(redirectUris) || redirectUris.length === 0) {
      return NextResponse.json(
        { error: 'Name and at least one redirect URI are required' },
        { status: 400 }
      );
    }

    await connectToDatabase();

    const clientId = newClientId();
    const rawSecret = newClientSecret();
    const secretHash = sha256Hex(rawSecret);

    const client = await Client.create({
      client_id: clientId,
      client_secret_hash: secretHash,
      name,
      owner_sub: session.sub,
      redirect_uris: redirectUris,
      publishing_status: 'testing',
      delegated_allowed: false, // Security: only admins can grant delegated mode upon production review
      token_endpoint_auth_method: 'client_secret_post',
      created_at: new Date(),
      updated_at: new Date(),
    });

    return NextResponse.json({
      client,
      rawSecret, // Show once to user!
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Failed to create client';
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
