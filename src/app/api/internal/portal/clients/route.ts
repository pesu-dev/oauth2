import { NextRequest, NextResponse } from 'next/server';
import { connectToDatabase } from '@/lib/db/connection';
import { Client } from '@/lib/db/models';
import { verifySessionToken } from '@/lib/session/cookie';
import { newClientId, newClientSecret } from '@/lib/id/nanoid';
import { hashClientSecret } from '@/lib/crypto/hash';
import { parseAndValidateRedirectUris } from '@/lib/validation/redirect-uri';
import { getTeamRole, teamIdsFor } from '@/lib/authz/client-access';

export async function GET(request: NextRequest) {
  const sessionCookie = request.cookies.get('pesu_session')?.value;
  const session = sessionCookie ? await verifySessionToken<{ sub: string }>(sessionCookie) : null;

  if (!session?.sub) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  await connectToDatabase();
  const teamIds = await teamIdsFor(session.sub);
  const clients = await Client.find(
    {
      $or: [
        { owner_sub: session.sub, owner_type: { $ne: 'team' } },
        ...(teamIds.length ? [{ owner_type: 'team' as const, owner_team_id: { $in: teamIds } }] : []),
      ],
    },
    { client_secret_hash: 0 }
  )
    .sort({ created_at: -1 })
    .lean();

  return NextResponse.json({ clients });
}

export async function POST(request: NextRequest) {
  const sessionCookie = request.cookies.get('pesu_session')?.value;
  const session = sessionCookie ? await verifySessionToken<{ sub: string }>(sessionCookie) : null;

  if (!session?.sub) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { name, redirectUris, teamId } = body;

    if (!name || !name.trim()) {
      return NextResponse.json(
        { error: 'Client application name is required' },
        { status: 400 }
      );
    }

    const validated = parseAndValidateRedirectUris(redirectUris);
    if (!validated.valid) {
      return NextResponse.json({ error: validated.error }, { status: 400 });
    }

    // Creating a team-owned client requires owner or admin rights on that team
    if (teamId !== undefined && teamId !== null && teamId !== '') {
      await connectToDatabase();
      const role = typeof teamId === 'string' ? await getTeamRole(teamId, session.sub) : null;
      if (role !== 'owner' && role !== 'admin') {
        return NextResponse.json({ error: 'You must be an owner or admin of that team' }, { status: 403 });
      }
    }
    const ownedByTeam = typeof teamId === 'string' && teamId !== '';

    const clientId = newClientId();
    const rawSecret = newClientSecret();
    const [, secretHash] = await Promise.all([
      connectToDatabase(),
      hashClientSecret(rawSecret),
    ]);

    const client = await Client.create({
      client_id: clientId,
      client_secret_hash: secretHash,
      name: name.trim(),
      owner_sub: session.sub,
      owner_type: ownedByTeam ? 'team' : 'user',
      owner_team_id: ownedByTeam ? teamId : null,
      redirect_uris: validated.uris,
      publishing_status: 'testing',
      delegated_allowed: false, // Security: only admins can grant delegated mode upon production review
      token_endpoint_auth_method: 'client_secret_post',
      created_at: new Date(),
      updated_at: new Date(),
    });

    const plain = typeof client.toObject === 'function' ? client.toObject() : client;
    const { client_secret_hash: _hash, ...safeClient } = plain;
    void _hash;
    return NextResponse.json({
      client: safeClient,
      rawSecret, // Show once to user!
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Failed to create client';
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
