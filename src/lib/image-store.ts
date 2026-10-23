import crypto from 'node:crypto';
import type { ClientSession } from 'mongoose';
import { Image, type ImageKind } from '@/lib/db/models';
import { newImageId } from '@/lib/id/nanoid';
import { MAX_IMAGE_BYTES, validateImage, type ValidationResult } from '@/lib/images';

export type UploadResult = { ok: true; data: Buffer; validated: Extract<ValidationResult, { ok: true }> } | { ok: false; status: number; error: string };

/** Reads and validates a multipart `file` upload. */
export async function readImageUpload(request: Request): Promise<UploadResult> {
  // Cheap guard before buffering the body
  const declared = Number(request.headers.get('content-length') ?? 0);
  if (declared > MAX_IMAGE_BYTES + 16 * 1024) {
    return { ok: false, status: 413, error: 'Images must be 256 KB or smaller' };
  }

  let file: FormDataEntryValue | null;
  try {
    file = (await request.formData()).get('file');
  } catch {
    file = null;
  }
  if (!file || typeof file === 'string') {
    return { ok: false, status: 400, error: 'Send the image as multipart/form-data in a "file" field' };
  }

  const data = Buffer.from(await file.arrayBuffer());
  const validated = validateImage(data);
  if (!validated.ok) return { ok: false, status: 400, error: validated.error };
  return { ok: true, data, validated };
}

/** Inserts a new image document inside the caller's transaction and returns its id. */
export async function insertImage(
  upload: Extract<UploadResult, { ok: true }>,
  { kind, ownerRef, sub }: { kind: ImageKind; ownerRef: string; sub: string },
  session: ClientSession
): Promise<string> {
  const imageId = newImageId();
  await Image.create(
    [
      {
        image_id: imageId,
        kind,
        owner_ref: ownerRef,
        mime: upload.validated.info.mime,
        data: upload.data,
        bytes: upload.data.length,
        width: upload.validated.info.width,
        height: upload.validated.info.height,
        sha256: crypto.createHash('sha256').update(upload.data).digest('hex'),
        created_by_sub: sub,
      },
    ],
    { session }
  );
  return imageId;
}
