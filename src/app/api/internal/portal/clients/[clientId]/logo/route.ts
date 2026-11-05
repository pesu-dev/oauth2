import crypto from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { connectToDatabase } from '@/lib/db/connection';
import { withTransaction } from '@/lib/db/transaction';
import { Client, Image } from '@/lib/db/models';
import { verifySessionToken } from '@/lib/session/cookie';
import { findManageableClient } from '@/lib/authz/client-access';
import { newImageId } from '@/lib/id/nanoid';
import { MAX_IMAGE_BYTES, imageUrl, validateImage } from '@/lib/images';

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

  // Cheap guard before buffering the body
  const declared = Number(request.headers.get('content-length') ?? 0);
  if (declared > MAX_IMAGE_BYTES + 16 * 1024) {
    return NextResponse.json({ error: 'Images must be 256 KB or smaller' }, { status: 413 });
  }

  let file: FormDataEntryValue | null;
  try {
    file = (await request.formData()).get('file');
  } catch {
    return NextResponse.json({ error: 'Send the image as multipart/form-data in a "file" field' }, { status: 400 });
  }
  if (!file || typeof file === 'string') {
    return NextResponse.json({ error: 'Send the image as multipart/form-data in a "file" field' }, { status: 400 });
  }

  const data = Buffer.from(await file.arrayBuffer());
  const validated = validateImage(data);
  if (!validated.ok) return NextResponse.json({ error: validated.error }, { status: 400 });

  await connectToDatabase();
  const client = await findManageableClient(clientId, sub, 'edit');
  if (!client) return NextResponse.json({ error: 'Client not found' }, { status: 404 });

  const imageId = newImageId();
  const previous = client.logo_image_id;
  await withTransaction(async (session) => {
    await Image.create(
      [
        {
          image_id: imageId,
          kind: 'client_logo',
          owner_ref: clientId,
          mime: validated.info.mime,
          data,
          bytes: data.length,
          width: validated.info.width,
          height: validated.info.height,
          sha256: crypto.createHash('sha256').update(data).digest('hex'),
          created_by_sub: sub,
        },
      ],
      { session }
    );
    await Client.updateOne(
      { client_id: clientId },
      { $set: { logo_image_id: imageId, logo_status: 'pending', updated_at: new Date() } },
      { session }
    );
    if (previous) await Image.deleteOne({ image_id: previous }, { session });
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
