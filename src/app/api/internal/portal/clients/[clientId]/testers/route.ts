import { NextRequest, NextResponse } from 'next/server';
import { connectToDatabase } from '@/lib/db/connection';
import { Client, ClientTester, User } from '@/lib/db/models';
import { verifySessionToken } from '@/lib/session/cookie';

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

  const body = await request.json();
  const { identifier } = body; // PRN, SRN, or sub

  if (!identifier) {
    return NextResponse.json({ error: 'Identifier is required' }, { status: 400 });
  }

  await connectToDatabase();
  const client = await Client.findOne({ client_id: clientId, owner_sub: session.sub });
  if (!client) {
    return NextResponse.json({ error: 'Client not found' }, { status: 404 });
  }

  // Resolve target sub
  let targetSub = identifier.trim();
  if (!targetSub.startsWith('usr_')) {
    const user = await User.findOne({
      $or: [{ prn: targetSub }, { srn: targetSub }],
    });
    if (!user) {
      return NextResponse.json(
        {
          error: `User with identifier "${targetSub}" has not signed in yet. Testers must be registered users or a valid usr_ subject.`,
        },
        { status: 400 }
      );
    }
    targetSub = user.sub;
  }

  const tester = await ClientTester.findOneAndUpdate(
    { client_id: clientId, sub: targetSub },
    { client_id: clientId, sub: targetSub, added_at: new Date() },
    { upsert: true, returnDocument: 'after' }
  );

  return NextResponse.json({ tester });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ clientId: string }> }
) {
  const { clientId } = await params;
  const sessionCookie = request.cookies.get('pesu_session')?.value;
  const session = sessionCookie ? await verifySessionToken<{ sub: string }>(sessionCookie) : null;

  if (!session?.sub) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const sub = searchParams.get('sub');

  if (!sub) {
    return NextResponse.json({ error: 'Sub parameter required' }, { status: 400 });
  }

  await connectToDatabase();
  const client = await Client.findOne({ client_id: clientId, owner_sub: session.sub });
  if (!client) {
    return NextResponse.json({ error: 'Client not found' }, { status: 404 });
  }

  await ClientTester.deleteOne({ client_id: clientId, sub });
  return NextResponse.json({ success: true });
}
