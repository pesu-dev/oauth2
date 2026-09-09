import { NextRequest, NextResponse } from 'next/server';
import { connectToDatabase } from '@/lib/db/connection';
import { Client, ClientTester } from '@/lib/db/models';
import { verifySessionToken } from '@/lib/session/cookie';

export async function GET(
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
  const client = await Client.findOne({ client_id: clientId, owner_sub: session.sub });
  if (!client) {
    return NextResponse.json({ error: 'Client not found' }, { status: 404 });
  }

  const testers = await ClientTester.find({ client_id: clientId });

  return NextResponse.json({ client, testers });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ clientId: string }> }
) {
  const { clientId } = await params;
  const sessionCookie = request.cookies.get('pesu_session')?.value;
  const session = sessionCookie ? await verifySessionToken<{ sub: string }>(sessionCookie) : null;

  if (!session?.sub) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json();
  const { redirectUris } = body;

  if (!redirectUris || !Array.isArray(redirectUris)) {
    return NextResponse.json({ error: 'Invalid redirectUris' }, { status: 400 });
  }

  await connectToDatabase();
  const client = await Client.findOneAndUpdate(
    { client_id: clientId, owner_sub: session.sub },
    { redirect_uris: redirectUris, updated_at: new Date() },
    { new: true }
  );

  if (!client) {
    return NextResponse.json({ error: 'Client not found' }, { status: 404 });
  }

  return NextResponse.json({ client });
}
