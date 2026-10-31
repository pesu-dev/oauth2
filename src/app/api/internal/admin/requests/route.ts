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
        production_requested: { $ifNull: ['$production_requested', true] },
        requested_scopes: { $ifNull: ['$requested_scopes', []] },
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
  const { requestId, action, allowDelegated = false, approvedScopes } = body; // 'approve' | 'reject'

  if (!requestId || !['approve', 'reject'].includes(action)) {
    return NextResponse.json({ error: 'Invalid request parameters' }, { status: 400 });
  }

  if (approvedScopes !== undefined && (!Array.isArray(approvedScopes) || approvedScopes.some((s: unknown) => typeof s !== 'string'))) {
    return NextResponse.json({ error: 'approvedScopes must be a list of scope names' }, { status: 400 });
  }

  const now = new Date();
  const isApprove = action === 'approve';

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

    // Admins approve scopes individually; anything not explicitly approved is dropped.
    // Omitting approvedScopes approves everything that was requested.
    const requested = prodReq.requested_scopes ?? [];
    const granted = isApprove
      ? requested.filter((s) => (approvedScopes === undefined ? true : approvedScopes.includes(s)))
      : [];
    if (granted.length > 0) {
      await ProductionRequest.updateOne(
        { request_id: prodReq.request_id },
        { $set: { approved_scopes: granted } },
        { session: dbSession }
      );
    }

    const productionRequested = prodReq.production_requested !== false;
    const existing = await Client.findOne({ client_id: prodReq.client_id }, null, { session: dbSession });
    const allowedScopes = [...new Set([...(existing?.allowed_scopes ?? []), ...granted])];
    // Resource scopes need the vault, so any approved scope keeps delegated mode on.
    const delegatedAllowed = productionRequested
      ? (isApprove && Boolean(allowDelegated)) || allowedScopes.length > 0
      : Boolean(existing?.delegated_allowed) || granted.length > 0;

    const update: Record<string, unknown> = {
      delegated_allowed: delegatedAllowed,
      allowed_scopes: allowedScopes,
      updated_at: now,
    };
    if (productionRequested) {
      update.publishing_status = isApprove ? 'production' : 'testing';
    }

    const client = await Client.findOneAndUpdate(
      { client_id: prodReq.client_id },
      { $set: update },
      { returnDocument: 'after', session: dbSession }
    );

    return { prodReq, client, granted };
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
    const productionRequested = prodReq.production_requested !== false;
    const scopesLine = txResult.granted.length ? ` Approved API scopes: ${txResult.granted.join(', ')}.` : '';
    if (isApprove) {
      notifySubQuietly({
        sub: ownerSub,
        subject: productionRequested ? `${client.name} approved for Production` : `API access approved for ${client.name}`,
        body: `Your client ${client.name} (${client.client_id}) was approved${productionRequested ? ' for Production' : ''}.${client.delegated_allowed ? ' Delegated mode is allowed.' : ''}${scopesLine}`,
      });
    } else {
      notifySubQuietly({
        sub: ownerSub,
        subject: productionRequested ? `${client.name} returned to Testing` : `API access request for ${client.name} rejected`,
        body: productionRequested
          ? `Your Production request for ${client.name} (${client.client_id}) was rejected. The client remains in Testing.`
          : `Your API access request for ${client.name} (${client.client_id}) was rejected. Its current scopes are unchanged.`,
      });
    }
  }

  return NextResponse.json({ success: true, status: prodReq.status });
}
