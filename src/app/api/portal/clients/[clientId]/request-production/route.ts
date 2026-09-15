import { NextRequest, NextResponse } from 'next/server';
import { connectToDatabase } from '@/lib/db/connection';
import { Client, ProductionRequest } from '@/lib/db/models';
import { verifySessionToken } from '@/lib/session/cookie';
import { newRequestId } from '@/lib/id/nanoid';
import { notifySubQuietly } from '@/lib/mailer';

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
  const { justification, delegatedRequested } = body;

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

  if (client.publishing_status !== 'testing') {
    return NextResponse.json(
      { error: 'Only Testing clients can request Production approval.' },
      { status: 400 }
    );
  }

  const existingPending = await ProductionRequest.findOne({
    client_id: clientId,
    status: 'pending',
  });
  if (existingPending) {
    return NextResponse.json(
      { error: 'A Production request is already pending review for this client.' },
      { status: 400 }
    );
  }

  // Create production request
  const prodRequest = await ProductionRequest.create({
    request_id: newRequestId(),
    client_id: clientId,
    requested_by_sub: session.sub,
    owner_sub: session.sub,
    status: 'pending',
    delegated_requested: Boolean(delegatedRequested),
    justification,
    created_at: new Date(),
  });

  client.publishing_status = 'pending_production';
  await client.save();

  notifySubQuietly({
    sub: session.sub,
    subject: `Production review requested for ${client.name}`,
    body: `Your client ${client.name} (${client.client_id}) was submitted for Production review. An admin will approve or reject the request.`,
  });

  return NextResponse.json({ request: prodRequest });
}
