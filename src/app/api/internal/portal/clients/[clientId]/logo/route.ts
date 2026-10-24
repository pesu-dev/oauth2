import { NextRequest, NextResponse } from 'next/server';
import { connectToDatabase } from '@/lib/db/connection';
import { withTransaction } from '@/lib/db/transaction';
import { Client, Image } from '@/lib/db/models';
import { verifySessionToken } from '@/lib/session/cookie';
import { findManageableClient } from '@/lib/authz/client-access';
import { imageUrl } from '@/lib/images';
import { insertImage, readImageUpload } from '@/lib/image-store';

type Params = { params: Promise<{ clientId: string }> };

async function sessionSub(request: NextRequest): Promise<string | null> {
  const cookie = request.cookies.get('pesu_session')?.value;
  const session = cookie ? await verifySessionToken<{ sub: string }>(cookie) : null;
  return session?.sub ?? null;
}

/** Uploads or replaces the client logo (multipart field `file`). It needs admin approval before consent shows it. */
export async function POST(request: NextRequest, { params }: Params) {
  const { clientId } = await params;
  const sub = await sessionSub(request);
  if (!sub) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const upload = await readImageUpload(request);
  if (!upload.ok) return NextResponse.json({ error: upload.error }, { status: upload.status });

  await connectToDatabase();
  const client = await findManageableClient(clientId, sub, 'edit');
  if (!client) return NextResponse.json({ error: 'Client not found' }, { status: 404 });

  const previous = client.logo_image_id;
  const imageId = await withTransaction(async (session) => {
    const id = await insertImage(upload, { kind: 'client_logo', ownerRef: clientId, sub }, session);
    await Client.updateOne(
      { client_id: clientId },
      { $set: { logo_image_id: id, logo_status: 'pending', updated_at: new Date() } },
      { session }
    );
    if (previous) await Image.deleteOne({ image_id: previous }, { session });
    return id;
  });

  return NextResponse.json({ logo: { image_id: imageId, url: imageUrl(imageId), status: 'pending' } });
}

/** Removes the client logo. */
export async function DELETE(request: NextRequest, { params }: Params) {
  const { clientId } = await params;
  const sub = await sessionSub(request);
  if (!sub) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  await connectToDatabase();
  const client = await findManageableClient(clientId, sub, 'edit');
  if (!client) return NextResponse.json({ error: 'Client not found' }, { status: 404 });

  if (client.logo_image_id) {
    const imageId = client.logo_image_id;
    await withTransaction(async (session) => {
      await Client.updateOne(
        { client_id: clientId },
        { $set: { logo_image_id: null, logo_status: null, updated_at: new Date() } },
        { session }
      );
      await Image.deleteOne({ image_id: imageId }, { session });
    });
  }
  return NextResponse.json({ success: true });
}
