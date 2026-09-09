import { NextRequest, NextResponse } from 'next/server';
import { connectToDatabase } from '@/lib/db/connection';
import { Client, ProductionRequest } from '@/lib/db/models';
import { verifySessionToken } from '@/lib/session/cookie';
import { newRequestId } from '@/lib/id/nanoid';

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
  const { justification } = body;

  if (!justification || justification.length < 10) {
    return NextResponse.json(
      { error: 'A valid justification (at least 10 characters) is required' },
      { status: 400 }
    );
  }

  await connectToDatabase();
  const client = await Client.findOne({ client_id: clientId, owner_sub: session.sub });
  if (!client) {
    return NextResponse.json({ error: 'Client not found' }, { status: 404 });
  }

  if (client.publishing_status === 'production') {
    return NextResponse.json({ error: 'Client is already in production' }, { status: 400 });
  }

  // Create production request
  const prodRequest = await ProductionRequest.create({
    request_id: newRequestId(),
    client_id: clientId,
    owner_sub: session.sub,
    status: 'pending',
    justification,
    created_at: new Date(),
  });

  client.publishing_status = 'pending_production';
  await client.save();

  return NextResponse.json({ request: prodRequest });
}
