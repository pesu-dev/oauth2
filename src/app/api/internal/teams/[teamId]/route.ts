import { NextRequest, NextResponse } from 'next/server';
import { connectToDatabase } from '@/lib/db/connection';
import { Client, Team, TeamMember, User } from '@/lib/db/models';
import { verifySessionToken } from '@/lib/session/cookie';
import { getTeamRole } from '@/lib/authz/client-access';

type Params = { params: Promise<{ teamId: string }> };

async function sessionSub(request: NextRequest): Promise<string | null> {
  const cookie = request.cookies.get('pesu_session')?.value;
  const session = cookie ? await verifySessionToken<{ sub: string }>(cookie) : null;
  return session?.sub ?? null;
}

/** Team detail for members: members (name + SRN only) and the team's clients. */
export async function GET(request: NextRequest, { params }: Params) {
  const { teamId } = await params;
  const sub = await sessionSub(request);
  if (!sub) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  await connectToDatabase();
  const role = await getTeamRole(teamId, sub);
  const team = role ? await Team.findOne({ team_id: teamId }).lean() : null;
  if (!team) return NextResponse.json({ error: 'Team not found' }, { status: 404 });

  const [members, clients] = await Promise.all([
    TeamMember.find({ team_id: teamId }).sort({ added_at: 1 }).lean(),
    Client.find(
      { owner_type: 'team', owner_team_id: teamId },
      { client_id: 1, name: 1, publishing_status: 1, created_at: 1, _id: 0 }
    )
      .sort({ created_at: -1 })
      .lean(),
  ]);
  const users = await User.find({ sub: { $in: members.map((m) => m.sub) } }, { sub: 1, name: 1, srn: 1, _id: 0 }).lean();
  const bySub = new Map(users.map((u) => [u.sub, u]));

  return NextResponse.json({
    team: { team_id: team.team_id, name: team.name, slug: team.slug, avatar_id: team.avatar_id ?? null, created_at: team.created_at },
    role,
    members: members.map((m) => ({
      sub: m.sub,
      role: m.role,
      name: bySub.get(m.sub)?.name ?? null,
      srn: bySub.get(m.sub)?.srn ?? null,
      added_at: m.added_at,
    })),
    clients,
  });
}

/** Renames a team (owners and admins). */
export async function PATCH(request: NextRequest, { params }: Params) {
  const { teamId } = await params;
  const sub = await sessionSub(request);
  if (!sub) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (name.length < 2 || name.length > 60) {
    return NextResponse.json({ error: 'Team name must be 2–60 characters' }, { status: 400 });
  }

  await connectToDatabase();
  const role = await getTeamRole(teamId, sub);
  if (role !== 'owner' && role !== 'admin') {
    return NextResponse.json({ error: 'Only team owners and admins can rename the team' }, { status: 403 });
  }

  await Team.updateOne({ team_id: teamId }, { $set: { name, updated_at: new Date() } });
  return NextResponse.json({ success: true, name });
}
