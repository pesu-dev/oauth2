import { connectToDatabase } from '@/lib/db/connection';
import { Image } from '@/lib/db/models';

/**
 * Serves uploaded logos and avatars. Ids are random and a new upload always gets a new id, so
 * responses are immutable. The sandbox CSP and nosniff stop the bytes being treated as anything
 * but an image even if a crafted file slipped past validation.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ imageId: string }> }) {
  const { imageId } = await params;
  if (!/^img_[\w-]{24}$/.test(imageId)) {
    return new Response('Not found', { status: 404 });
  }

  await connectToDatabase();
  const image = await Image.findOne({ image_id: imageId }, { data: 1, mime: 1, sha256: 1 }).lean();
  if (!image) {
    return new Response('Not found', { status: 404 });
  }

  const body = Buffer.isBuffer(image.data) ? image.data : Buffer.from((image.data as { buffer: ArrayBuffer }).buffer);
  return new Response(new Uint8Array(body), {
    status: 200,
    headers: {
      'Content-Type': image.mime,
      'Content-Length': String(body.length),
      'Cache-Control': 'public, max-age=31536000, immutable',
      ETag: `"${image.sha256}"`,
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; sandbox",
      'Content-Disposition': 'inline',
      'Cross-Origin-Resource-Policy': 'same-site',
    },
  });
}
