import { NextRequest, NextResponse } from 'next/server';
import { connectToDatabase } from '@/lib/db/connection';
import { withTransaction } from '@/lib/db/transaction';
import { ProductionRequest } from '@/lib/db/models';
import { verifySessionToken } from '@/lib/session/cookie';
import { newRequestId } from '@/lib/id/nanoid';
import { notifySubQuietly } from '@/lib/mailer';
import { findManageableClient } from '@/lib/authz/client-access';
import { isResourceScope } from '@/lib/oidc/scopes';

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
  // Scope-only requests (productionRequested: false) ask for API access without leaving Testing.
  const productionRequested = body.productionRequested !== false;
  const rawScopes: unknown = body.requestedScopes ?? [];

  if (!Array.isArray(rawScopes) || rawScopes.some((s) => typeof s !== 'string' || !isResourceScope(s))) {
    return NextResponse.json(
      { error: 'requestedScopes must be a list of resource scopes (e.g. attendance:read)' },
      { status: 400 }
    );
  }
  const requestedScopes = [...new Set(rawScopes as string[])];

  if (!productionRequested && requestedScopes.length === 0) {
    return NextResponse.json(
      { error: 'Request Production or at least one API scope' },
      { status: 400 }
    );
  }

  if (!justification || justification.length < 10) {
    return NextResponse.json(
      { error: 'A valid justification (at least 10 characters) is required' },
      { status: 400 }
    );
  }

  await connectToDatabase();
  const client = await findManageableClient(clientId, session.sub, 'publish');
  if (!client) {
    return NextResponse.json({ error: 'Client not found' }, { status: 404 });
  }

  if (productionRequested && client.publishing_status !== 'testing') {
    return NextResponse.json(
      { error: 'Only Testing clients can request Production approval.' },
      { status: 400 }
    );
  }

  if (client.publishing_status === 'suspended') {
    return NextResponse.json({ error: 'Suspended clients cannot request access.' }, { status: 400 });
  }

  const newScopes = requestedScopes.filter((s) => !(client.allowed_scopes ?? []).includes(s));
  if (!productionRequested && newScopes.length === 0) {
    return NextResponse.json({ error: 'All requested scopes are already approved.' }, { status: 400 });
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

  const userSub = session.sub;

  // Create production request and update client publishing status in a transaction
  const prodRequest = await withTransaction(async (dbSession) => {
    const [doc] = await ProductionRequest.create(
      [
        {
          request_id: newRequestId(),
          client_id: clientId,
          requested_by_sub: userSub,
          owner_sub: client.owner_sub,
          status: 'pending',
          delegated_requested: Boolean(delegatedRequested) || newScopes.length > 0,
          production_requested: productionRequested,
          requested_scopes: newScopes,
          approved_scopes: [],
          justification,
          created_at: new Date(),
        },
      ],
      { session: dbSession }
    );

    if (productionRequested) {
      client.publishing_status = 'pending_production';
      await client.save({ session: dbSession });
    }

    return doc;
  });

  notifySubQuietly({
    sub: session.sub,
    subject: `${productionRequested ? 'Production review' : 'API access review'} requested for ${client.name}`,
    body: `Your client ${client.name} (${client.client_id}) was submitted for ${productionRequested ? 'Production' : 'API access'} review${newScopes.length ? ` (scopes: ${newScopes.join(', ')})` : ''}. An admin will approve or reject the request.`,
  });

  return NextResponse.json({ request: prodRequest });
}
