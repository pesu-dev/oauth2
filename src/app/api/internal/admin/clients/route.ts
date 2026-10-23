import { NextRequest, NextResponse } from 'next/server';
import { connectToDatabase } from '@/lib/db/connection';
import { Admin, Client } from '@/lib/db/models';
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

  const { searchParams } = new URL(request.url);
  const query = searchParams.get('q')?.trim();

  let filter: Record<string, unknown> = {};
  if (searchParams.get('logos') === 'pending') {
    filter = { logo_status: 'pending' };
  } else if (query) {
    const escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(escapedQuery, 'i');
    filter = {
      $or: [{ client_id: regex }, { name: regex }, { owner_sub: regex }],
    };
  }

  const clients = await Client.find(filter).sort({ created_at: -1 }).limit(20).lean();

  return NextResponse.json({
    clients: clients.map((c) => ({
      client_id: c.client_id,
      name: c.name,
      owner_sub: c.owner_sub,
      publishing_status: c.publishing_status,
      delegated_allowed: c.delegated_allowed,
      redirect_uris: c.redirect_uris,
      logo_image_id: c.logo_image_id || null,
      logo_status: c.logo_status || null,
      suspension_reason: c.suspension_reason || null,
      suspended_at: c.suspended_at || null,
      suspended_by_sub: c.suspended_by_sub || null,
      created_at: c.created_at,
      updated_at: c.updated_at,
    })),
  });
}

export async function PATCH(request: NextRequest) {
  const adminSub = await checkAdmin(request);
  if (!adminSub) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = await request.json();
  const { clientId, action, reason, targetStatus } = body;

  if (!clientId || !['suspend', 'unsuspend', 'approve_logo', 'reject_logo'].includes(action)) {
    return NextResponse.json({ error: 'Invalid parameters' }, { status: 400 });
  }

  const client = await Client.findOne({ client_id: clientId });
  if (!client) {
    return NextResponse.json({ error: 'Client not found' }, { status: 404 });
  }

  const now = new Date();

  if (action === 'approve_logo' || action === 'reject_logo') {
    if (!client.logo_image_id) {
      return NextResponse.json({ error: 'This client has no logo to review' }, { status: 400 });
    }
    const approved = action === 'approve_logo';
    client.logo_status = approved ? 'approved' : 'rejected';
    client.updated_at = now;
    await client.save();

    notifySubQuietly({
      sub: client.owner_sub,
      subject: approved ? `Logo approved for ${client.name}` : `Logo not approved for ${client.name}`,
      body: approved
        ? `The logo for ${client.name} (${client.client_id}) was approved and now appears on the consent screen.`
        : `The logo for ${client.name} (${client.client_id}) was not approved${typeof reason === 'string' && reason.trim() ? `:\n${reason.trim()}` : '.'} Upload a different image to request another review.`,
    });

    return NextResponse.json({ success: true, logo_status: client.logo_status });
  }

  if (action === 'suspend') {
    if (!reason || typeof reason !== 'string' || !reason.trim()) {
      return NextResponse.json({ error: 'Suspension reason is required' }, { status: 400 });
    }

    const trimmedReason = reason.trim();
    client.publishing_status = 'suspended';
    client.suspension_reason = trimmedReason;
    client.suspended_at = now;
    client.suspended_by_sub = adminSub;
    client.updated_at = now;
    await client.save();

    notifySubQuietly({
      sub: client.owner_sub,
      subject: `${client.name} has been suspended`,
      body: `Your client application ${client.name} (${client.client_id}) has been suspended by an administrator.\n\nReason:\n${trimmedReason}`,
    });

    return NextResponse.json({ success: true, client });
  }

  // action === 'unsuspend'
  const validStatus = ['testing', 'production'].includes(targetStatus) ? targetStatus : 'testing';
  client.publishing_status = validStatus;
  client.suspension_reason = null;
  client.suspended_at = null;
  client.suspended_by_sub = null;
  client.updated_at = now;
  await client.save();

  notifySubQuietly({
    sub: client.owner_sub,
    subject: `${client.name} has been reinstated`,
    body: `Your client application ${client.name} (${client.client_id}) has been reinstated to ${validStatus} status.`,
  });

  return NextResponse.json({ success: true, client });
}
