import { NextRequest, NextResponse } from 'next/server';
import { connectToDatabase } from '@/lib/db/connection';
import { Team, TeamMember } from '@/lib/db/models';
import { verifySessionToken } from '@/lib/session/cookie';
import { getTeamRole } from '@/lib/authz/client-access';
import { canChangeMember, isTeamRole } from '@/lib/teams';
import { resolveUserSub } from '@/lib/users';
import { notifySubQuietly } from '@/lib/mailer';

type Params = { params: Promise<{ teamId: string }> };

async function sessionSub(request: NextRequest): Promise<string | null> {
  const cookie = request.cookies.get('pesu_session')?.value;
  const session = cookie ? await verifySessionToken<{ sub: string }>(cookie) : null;
  return session?.sub ?? null;
}

async function isLastOwner(teamId: string, sub: string): Promise<boolean> {
  const owners = await TeamMember.find({ team_id: teamId, role: 'owner' }).lean();
  return owners.length === 1 && owners[0].sub === sub;
}

/** Adds a member by PRN, SRN or sub. */
export async function POST(request: NextRequest, { params }: Params) {
  const { teamId } = await params;
  const sub = await sessionSub(request);
  if (!sub) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const role = body.role ?? 'developer';
  if (!isTeamRole(role)) {
    return NextResponse.json({ error: 'role must be owner, admin or developer' }, { status: 400 });
  }

  await connectToDatabase();
  const actorRole = await getTeamRole(teamId, sub);
  if (!canChangeMember(actorRole, null, role)) {
    return NextResponse.json({ error: 'You cannot add members with that role' }, { status: 403 });
  }

  const resolved = await resolveUserSub(body.identifier, 'Team members');
  if (!resolved.ok) return NextResponse.json({ error: resolved.error }, { status: 400 });

  if (await TeamMember.exists({ team_id: teamId, sub: resolved.sub })) {
    return NextResponse.json({ error: 'That person is already on the team' }, { status: 409 });
  }

  const member = await TeamMember.create({ team_id: teamId, sub: resolved.sub, role, added_by_sub: sub, added_at: new Date() });
  const team = await Team.findOne({ team_id: teamId }).lean();
  notifySubQuietly({
    sub: resolved.sub,
    subject: `You were added to ${team?.name ?? 'a team'}`,
    body: `You were added to the team ${team?.name ?? teamId} as ${role} on PESU OAuth2. You can now manage its apps in the developer portal.`,
  });
  return NextResponse.json({ member: { sub: member.sub, role: member.role } });
}

/** Changes a member's role. */
export async function PATCH(request: NextRequest, { params }: Params) {
  const { teamId } = await params;
  const sub = await sessionSub(request);
  if (!sub) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  if (typeof body.sub !== 'string' || !isTeamRole(body.role)) {
    return NextResponse.json({ error: 'sub and a valid role are required' }, { status: 400 });
  }

  await connectToDatabase();
  const [actorRole, targetRole] = await Promise.all([getTeamRole(teamId, sub), getTeamRole(teamId, body.sub)]);
  if (!targetRole) return NextResponse.json({ error: 'Member not found' }, { status: 404 });
  if (!canChangeMember(actorRole, targetRole, body.role)) {
    return NextResponse.json({ error: 'You cannot change that member’s role' }, { status: 403 });
  }
  if (targetRole === 'owner' && body.role !== 'owner' && (await isLastOwner(teamId, body.sub))) {
    return NextResponse.json({ error: 'A team needs at least one owner' }, { status: 400 });
  }

  await TeamMember.updateOne({ team_id: teamId, sub: body.sub }, { $set: { role: body.role } });
  return NextResponse.json({ success: true });
}

/** Removes a member (?sub=), or leaves the team when removing yourself. */
export async function DELETE(request: NextRequest, { params }: Params) {
  const { teamId } = await params;
  const sub = await sessionSub(request);
  if (!sub) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const target = new URL(request.url).searchParams.get('sub');
  if (!target) return NextResponse.json({ error: 'sub parameter required' }, { status: 400 });

  await connectToDatabase();
  const [actorRole, targetRole] = await Promise.all([getTeamRole(teamId, sub), getTeamRole(teamId, target)]);
  if (!targetRole) return NextResponse.json({ error: 'Member not found' }, { status: 404 });
  if (target !== sub && !canChangeMember(actorRole, targetRole)) {
    return NextResponse.json({ error: 'You cannot remove that member' }, { status: 403 });
  }
  if (targetRole === 'owner' && (await isLastOwner(teamId, target))) {
    return NextResponse.json({ error: 'A team needs at least one owner. Add another owner first.' }, { status: 400 });
  }

  await TeamMember.deleteOne({ team_id: teamId, sub: target });
  return NextResponse.json({ success: true });
}
