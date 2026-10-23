import { NextRequest, NextResponse } from 'next/server';
import { connectToDatabase } from '@/lib/db/connection';
import { withTransaction } from '@/lib/db/transaction';
import { Image, Team } from '@/lib/db/models';
import { verifySessionToken } from '@/lib/session/cookie';
import { getTeamRole } from '@/lib/authz/client-access';
import { imageUrl } from '@/lib/images';
import { insertImage, readImageUpload } from '@/lib/image-store';

type Params = { params: Promise<{ teamId: string }> };

async function authorize(request: NextRequest, teamId: string): Promise<{ sub: string } | NextResponse> {
  const cookie = request.cookies.get('pesu_session')?.value;
  const session = cookie ? await verifySessionToken<{ sub: string }>(cookie) : null;
  if (!session?.sub) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  await connectToDatabase();
  const role = await getTeamRole(teamId, session.sub);
  if (role !== 'owner' && role !== 'admin') {
    return NextResponse.json({ error: 'Only team owners and admins can change the avatar' }, { status: 403 });
  }
  return { sub: session.sub };
}

/** Uploads or replaces the team avatar. Avatars appear in the portal only, never on consent. */
export async function POST(request: NextRequest, { params }: Params) {
  const { teamId } = await params;
  const auth = await authorize(request, teamId);
  if (auth instanceof NextResponse) return auth;

  const upload = await readImageUpload(request);
  if (!upload.ok) return NextResponse.json({ error: upload.error }, { status: upload.status });

  const team = await Team.findOne({ team_id: teamId }).lean();
  if (!team) return NextResponse.json({ error: 'Team not found' }, { status: 404 });

  const imageId = await withTransaction(async (session) => {
    const id = await insertImage(upload, { kind: 'team_avatar', ownerRef: teamId, sub: auth.sub }, session);
    await Team.updateOne({ team_id: teamId }, { $set: { avatar_id: id, updated_at: new Date() } }, { session });
    if (team.avatar_id) await Image.deleteOne({ image_id: team.avatar_id }, { session });
    return id;
  });

  return NextResponse.json({ avatar: { image_id: imageId, url: imageUrl(imageId) } });
}

/** Removes the team avatar. */
export async function DELETE(request: NextRequest, { params }: Params) {
  const { teamId } = await params;
  const auth = await authorize(request, teamId);
  if (auth instanceof NextResponse) return auth;

  const team = await Team.findOne({ team_id: teamId }).lean();
  if (team?.avatar_id) {
    const avatarId = team.avatar_id;
    await withTransaction(async (session) => {
      await Team.updateOne({ team_id: teamId }, { $set: { avatar_id: null, updated_at: new Date() } }, { session });
      await Image.deleteOne({ image_id: avatarId }, { session });
    });
  }
  return NextResponse.json({ success: true });
}
