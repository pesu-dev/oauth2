import { NextRequest, NextResponse } from 'next/server';
import { connectToDatabase } from '@/lib/db/connection';
import { Admin, Client, ProductionRequest } from '@/lib/db/models';
import { verifySessionToken } from '@/lib/session/cookie';

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

  const requests = await ProductionRequest.find({ status: 'pending' }).sort({ created_at: -1 });

  // Enrich with client names
  const clientIds = requests.map((r) => r.client_id);
  const clients = await Client.find({ client_id: { $in: clientIds } });
  const clientMap = new Map(clients.map((c) => [c.client_id, c.name]));

  const enriched = requests.map((r) => ({
    ...r.toObject(),
    client_name: clientMap.get(r.client_id) || 'Unknown App',
  }));

  return NextResponse.json({ requests: enriched });
}

export async function POST(request: NextRequest) {
  const adminSub = await checkAdmin(request);
  if (!adminSub) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = await request.json();
  const { requestId, action } = body; // 'approve' | 'reject'

  if (!requestId || !['approve', 'reject'].includes(action)) {
    return NextResponse.json({ error: 'Invalid request parameters' }, { status: 400 });
  }

  const prodReq = await ProductionRequest.findOne({ request_id: requestId });
  if (!prodReq) {
    return NextResponse.json({ error: 'Production request not found' }, { status: 404 });
  }

  prodReq.status = action === 'approve' ? 'approved' : 'rejected';
  prodReq.reviewed_at = new Date();
  prodReq.reviewer_sub = adminSub;
  await prodReq.save();

  if (action === 'approve') {
    await Client.updateOne(
      { client_id: prodReq.client_id },
      { publishing_status: 'production', updated_at: new Date() }
    );
  } else {
    await Client.updateOne(
      { client_id: prodReq.client_id },
      { publishing_status: 'testing', updated_at: new Date() }
    );
  }

  return NextResponse.json({ success: true, status: prodReq.status });
}
