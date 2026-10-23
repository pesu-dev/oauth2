import { NextRequest, NextResponse } from 'next/server';
import { connectToDatabase } from '@/lib/db/connection';
import { Client, Team } from '@/lib/db/models';
import { canManageClient, findManageableClient } from '@/lib/authz/client-access';
import { verifySessionToken } from '@/lib/session/cookie';
import { parseAndValidateRedirectUris } from '@/lib/validation/redirect-uri';

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
  const manageable = await findManageableClient(clientId, session.sub, 'view');
  if (!manageable) {
    return NextResponse.json({ error: 'Client not found' }, { status: 404 });
  }

  const results = await Client.aggregate([
    { $match: { client_id: clientId } },
    {
      $lookup: {
        from: 'client_testers',
        localField: 'client_id',
        foreignField: 'client_id',
        as: 'testers',
      },
    },
    // Never send the secret hash to the browser, even to the owner
    { $project: { client_secret_hash: 0 } },
  ]);

  if (!results || results.length === 0) {
    return NextResponse.json({ error: 'Client not found' }, { status: 404 });
  }

  const { testers, ...client } = results[0];
  const [canManageSecrets, canPublish, team] = await Promise.all([
    canManageClient(session.sub, manageable, 'secrets'),
    canManageClient(session.sub, manageable, 'publish'),
    manageable.owner_type === 'team' && manageable.owner_team_id
      ? Team.findOne({ team_id: manageable.owner_team_id }).lean()
      : null,
  ]);
  return NextResponse.json({
    client,
    testers,
    permissions: { secrets: canManageSecrets, publish: canPublish },
    team: team ? { team_id: team.team_id, name: team.name, slug: team.slug } : null,
  });
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
  const { redirectUris, deviceFlowEnabled } = body;

  const update: Record<string, unknown> = { updated_at: new Date() };
  if (redirectUris !== undefined || deviceFlowEnabled === undefined) {
    const validated = parseAndValidateRedirectUris(redirectUris);
    if (!validated.valid) {
      return NextResponse.json({ error: validated.error }, { status: 400 });
    }
    update.redirect_uris = validated.uris;
  }
  if (deviceFlowEnabled !== undefined) {
    if (typeof deviceFlowEnabled !== 'boolean') {
      return NextResponse.json({ error: 'deviceFlowEnabled must be a boolean' }, { status: 400 });
    }
    update.device_flow_enabled = deviceFlowEnabled;
  }

  await connectToDatabase();
  const manageable = await findManageableClient(clientId, session.sub, 'edit');
  const client = manageable
    ? await Client.findOneAndUpdate(
        { client_id: clientId },
        update,
        { returnDocument: 'after', projection: { client_secret_hash: 0 } }
      )
    : null;

  if (!client) {
    return NextResponse.json({ error: 'Client not found' }, { status: 404 });
  }

  return NextResponse.json({ client });
}
