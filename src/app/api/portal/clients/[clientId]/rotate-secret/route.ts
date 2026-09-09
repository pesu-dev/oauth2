import { NextRequest, NextResponse } from 'next/server';
import { connectToDatabase } from '@/lib/db/connection';
import { Client } from '@/lib/db/models';
import { verifySessionToken } from '@/lib/session/cookie';
import { newClientSecret } from '@/lib/id/nanoid';
import { sha256Hex } from '@/lib/crypto/hash';

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

  await connectToDatabase();
  const rawSecret = newClientSecret();
  const secretHash = sha256Hex(rawSecret);

  const client = await Client.findOneAndUpdate(
    { client_id: clientId, owner_sub: session.sub },
    { client_secret_hash: secretHash, updated_at: new Date() },
    { returnDocument: 'after' }
  );

  if (!client) {
    return NextResponse.json({ error: 'Client not found' }, { status: 404 });
  }

  return NextResponse.json({
    clientId: client.client_id,
    clientSecret: rawSecret,
  });
}
