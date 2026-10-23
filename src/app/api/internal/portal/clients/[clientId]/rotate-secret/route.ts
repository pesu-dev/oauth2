import { NextRequest, NextResponse } from 'next/server';
import { connectToDatabase } from '@/lib/db/connection';
import { Client } from '@/lib/db/models';
import { verifySessionToken } from '@/lib/session/cookie';
import { findManageableClient } from '@/lib/authz/client-access';
import { newClientSecret } from '@/lib/id/nanoid';
import { hashClientSecret } from '@/lib/crypto/hash';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ clientId: string }> }
) {
  const { clientId } = await params;
  const sessionCookie = request.cookies.get('pesu_session')?.value;
  const session = sessionCookie ? await verifySessionToken<{ sub: string }>(sessionCookie) : null;

  if (!session?.sub) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const rawSecret = newClientSecret();
  const [, secretHash] = await Promise.all([
    connectToDatabase(),
    hashClientSecret(rawSecret),
  ]);

  const manageable = await findManageableClient(clientId, session.sub, 'secrets');
  const client = manageable
    ? await Client.findOneAndUpdate(
        { client_id: clientId },
        { client_secret_hash: secretHash, updated_at: new Date() },
        { returnDocument: 'after' }
      )
    : null;

  if (!client) {
    return NextResponse.json({ error: 'Client not found' }, { status: 404 });
  }

  return NextResponse.json({
    clientId: client.client_id,
    clientSecret: rawSecret,
  });
}
