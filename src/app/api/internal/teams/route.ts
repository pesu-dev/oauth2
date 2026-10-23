import { NextRequest, NextResponse } from 'next/server';
import { connectToDatabase } from '@/lib/db/connection';
import { withTransaction } from '@/lib/db/transaction';
import { Client, Team, TeamMember } from '@/lib/db/models';
import { verifySessionToken } from '@/lib/session/cookie';
import { newTeamId } from '@/lib/id/nanoid';
import { slugify } from '@/lib/teams';

async function sessionSub(request: NextRequest): Promise<string | null> {
  const cookie = request.cookies.get('pesu_session')?.value;
  const session = cookie ? await verifySessionToken<{ sub: string }>(cookie) : null;
  return session?.sub ?? null;
}

/** Teams the signed-in user belongs to, with their role and counts. */
export async function GET(request: NextRequest) {
  const sub = await sessionSub(request);
  if (!sub) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  await connectToDatabase();
  const memberships = await TeamMember.find({ sub }).lean();
  const teamIds = memberships.map((m) => m.team_id);
  if (teamIds.length === 0) return NextResponse.json({ teams: [] });

  const [teams, memberCounts, clientCounts] = await Promise.all([
    Team.find({ team_id: { $in: teamIds } }).sort({ created_at: -1 }).lean(),
    TeamMember.aggregate([{ $match: { team_id: { $in: teamIds } } }, { $group: { _id: '$team_id', n: { $sum: 1 } } }]),
    Client.aggregate([
      { $match: { owner_type: 'team', owner_team_id: { $in: teamIds } } },
      { $group: { _id: '$owner_team_id', n: { $sum: 1 } } },
    ]),
  ]);
  const roleOf = new Map(memberships.map((m) => [m.team_id, m.role]));
  const members = new Map(memberCounts.map((r: { _id: string; n: number }) => [r._id, r.n]));
  const clients = new Map(clientCounts.map((r: { _id: string; n: number }) => [r._id, r.n]));

  return NextResponse.json({
    teams: teams.map((t) => ({
      team_id: t.team_id,
      name: t.name,
      slug: t.slug,
      avatar_id: t.avatar_id ?? null,
      role: roleOf.get(t.team_id),
      member_count: members.get(t.team_id) ?? 0,
      client_count: clients.get(t.team_id) ?? 0,
      created_at: t.created_at,
    })),
  });
}

/** Creates a team; the creator becomes its first owner. */
export async function POST(request: NextRequest) {
  const sub = await sessionSub(request);
  if (!sub) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (name.length < 2 || name.length > 60) {
    return NextResponse.json({ error: 'Team name must be 2–60 characters' }, { status: 400 });
  }

  await connectToDatabase();
  const base = slugify(name);
  let slug = base;
  for (let i = 2; await Team.exists({ slug }); i++) {
    slug = `${base}-${i}`;
  }

  const teamId = newTeamId();
  const now = new Date();
  await withTransaction(async (session) => {
    await Team.create([{ team_id: teamId, name, slug, created_by_sub: sub, created_at: now, updated_at: now }], { session });
    await TeamMember.create([{ team_id: teamId, sub, role: 'owner', added_by_sub: sub, added_at: now }], { session });
  });

  return NextResponse.json({ team: { team_id: teamId, name, slug, role: 'owner' } });
}
