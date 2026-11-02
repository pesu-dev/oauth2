import { NextRequest, NextResponse } from 'next/server';
import { connectToDatabase } from '@/lib/db/connection';
import { Admin, Client, ProductionRequest } from '@/lib/db/models';
import { verifySessionToken } from '@/lib/session/cookie';
import { notifySubQuietly } from '@/lib/mailer';

import { withTransaction } from '@/lib/db/transaction';

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

  const enriched = await ProductionRequest.aggregate([
    { $match: { status: 'pending' } },
    { $sort: { created_at: 1 } },
    {
      $lookup: {
        from: 'clients',
        localField: 'client_id',
        foreignField: 'client_id',
        as: 'client_docs',
      },
    },
    {
      $project: {
        _id: 0,
        request_id: 1,
        client_id: 1,
        status: 1,
        delegated_requested: 1,
        created_at: 1,
        justification: { $ifNull: ['$justification', ''] },
        client_name: {
          $ifNull: [{ $arrayElemAt: ['$client_docs.name', 0] }, '$client_id'],
        },
        owner_sub: {
          $ifNull: [
            '$requested_by_sub',
            {
              $ifNull: [
                '$owner_sub',
                {
                  $ifNull: [{ $arrayElemAt: ['$client_docs.owner_sub', 0] }, 'Unknown'],
                },
              ],
            },
          ],
        },
      },
    },
  ]);

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
  const isApprove = action === 'approve';
  const shouldAllowDelegated = isApprove && Boolean(allowDelegated);

  const txResult = await withTransaction(async (dbSession) => {
    // Atomic CAS resolve
    const prodReq = await ProductionRequest.findOneAndUpdate(
      { request_id: requestId, status: 'pending' },
      {
        $set: {
          status: isApprove ? 'approved' : 'rejected',
          resolved_at: now,
          resolved_by_sub: adminSub,
          reviewed_at: now,
          reviewer_sub: adminSub,
        },
      },
      { returnDocument: 'after', session: dbSession }
    );

    if (!prodReq) {
      return null;
    }

    const client = await Client.findOneAndUpdate(
      { client_id: prodReq.client_id },
      {
        $set: {
          publishing_status: isApprove ? 'production' : 'testing',
          delegated_allowed: shouldAllowDelegated,
          updated_at: now,
        },
      },
      { returnDocument: 'after', session: dbSession }
    );

    return { prodReq, client };
  });

  if (!txResult) {
    return NextResponse.json(
      { error: 'Production request not found or already resolved' },
      { status: 404 }
    );
  }

  const { prodReq, client } = txResult;

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
