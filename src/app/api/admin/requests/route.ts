import { NextRequest, NextResponse } from 'next/server';
import { connectToDatabase } from '@/lib/db/connection';
import { Admin, Client, ProductionRequest } from '@/lib/db/models';
import { verifySessionToken } from '@/lib/session/cookie';
import { notifySubQuietly } from '@/lib/mailer';

async function checkAdmin(request: NextRequest): Promise<string | null> {
  const sessionCookie = request.cookies.get('pesu_session')?.value;
  const session = sessionCookie ? await verifySessionToken<{ sub: string }>(sessionCookie) : null;
  if (!session?.sub) return null;

  await connectToDatabase();
  const admin = await Admin.findOne({ sub: session.sub });
  return admin ? session.sub : null;
}

export async function GET(request: NextRequest) {
  const adminSub = await checkAdmin(request);
  if (!adminSub) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const requests = await ProductionRequest.find({ status: 'pending' }).sort({ created_at: 1 });

  // Enrich with client details
  const clientIds = requests.map((r) => r.client_id);
  const clients = await Client.find({ client_id: { $in: clientIds } });
  const clientMap = new Map(clients.map((c) => [c.client_id, c]));

  const enriched = requests.map((r) => {
    const client = clientMap.get(r.client_id);
    return {
      request_id: r.request_id,
      client_id: r.client_id,
      client_name: client?.name || r.client_id,
      owner_sub: r.requested_by_sub || r.owner_sub || client?.owner_sub || 'Unknown',
      status: r.status,
      delegated_requested: r.delegated_requested,
      justification: r.justification || '',
      created_at: r.created_at,
    };
  });

  return NextResponse.json({ requests: enriched });
}

export async function POST(request: NextRequest) {
  const adminSub = await checkAdmin(request);
  if (!adminSub) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = await request.json();
  const { requestId, action, allowDelegated = false } = body; // 'approve' | 'reject'

  if (!requestId || !['approve', 'reject'].includes(action)) {
    return NextResponse.json({ error: 'Invalid request parameters' }, { status: 400 });
  }

  const now = new Date();

  // Atomic CAS resolve
  const prodReq = await ProductionRequest.findOneAndUpdate(
    { request_id: requestId, status: 'pending' },
    {
      $set: {
        status: action === 'approve' ? 'approved' : 'rejected',
        resolved_at: now,
        resolved_by_sub: adminSub,
        reviewed_at: now,
        reviewer_sub: adminSub,
      },
    },
    { returnDocument: 'after' }
  );

  if (!prodReq) {
    return NextResponse.json(
      { error: 'Production request not found or already resolved' },
      { status: 404 }
    );
  }

  const isApprove = action === 'approve';
  const shouldAllowDelegated = isApprove && Boolean(allowDelegated);

  let client;
  try {
    client = await Client.findOneAndUpdate(
      { client_id: prodReq.client_id },
      {
        $set: {
          publishing_status: isApprove ? 'production' : 'testing',
          delegated_allowed: shouldAllowDelegated,
          updated_at: now,
        },
      },
      { returnDocument: 'after' }
    );
  } catch (err) {
    await ProductionRequest.updateOne(
      { request_id: requestId },
      {
        $set: {
          status: 'pending',
          resolved_at: null,
          resolved_by_sub: null,
          reviewed_at: null,
          reviewer_sub: null,
        },
      }
    );
    throw err;
  }

  if (client) {
    const ownerSub = client.owner_sub || prodReq.requested_by_sub;
    if (isApprove) {
      notifySubQuietly({
        sub: ownerSub,
        subject: `${client.name} approved for Production`,
        body: `Your client ${client.name} (${client.client_id}) was approved for Production.${shouldAllowDelegated ? ' Delegated mode is allowed.' : ''}`,
      });
    } else {
      notifySubQuietly({
        sub: ownerSub,
        subject: `${client.name} returned to Testing`,
        body: `Your Production request for ${client.name} (${client.client_id}) was rejected. The client remains in Testing.`,
      });
    }
  }

  return NextResponse.json({ success: true, status: prodReq.status });
}
