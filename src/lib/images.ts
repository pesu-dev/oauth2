/**
 * Upload validation for logos and avatars. Only raster formats are accepted (no SVG: it can
 * carry script), detected from magic bytes rather than the client-supplied content type.
 */

export const MAX_IMAGE_BYTES = 256 * 1024;
export const MIN_IMAGE_DIMENSION = 64;
export const MAX_IMAGE_DIMENSION = 2048;

export type ImageMime = 'image/png' | 'image/jpeg' | 'image/webp';

export interface ImageInfo {
  mime: ImageMime;
  width: number;
  height: number;
}

function pngInfo(buf: Buffer): ImageInfo | null {
  // 8-byte signature, then the IHDR chunk with width/height as big-endian uint32
  if (buf.length < 24 || buf.toString('ascii', 12, 16) !== 'IHDR') return null;
  return { mime: 'image/png', width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

function jpegInfo(buf: Buffer): ImageInfo | null {
  let offset = 2;
  while (offset + 9 < buf.length) {
    if (buf[offset] !== 0xff) return null;
    const marker = buf[offset + 1];
    const length = buf.readUInt16BE(offset + 2);
    // SOF0–SOF15 except DHT (C4), JPG (C8) and DAC (CC) carry the frame size
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      return { mime: 'image/jpeg', height: buf.readUInt16BE(offset + 5), width: buf.readUInt16BE(offset + 7) };
    }
    if (length < 2) return null;
    offset += 2 + length;
  }
  return null;
}

function webpInfo(buf: Buffer): ImageInfo | null {
  if (buf.length < 30) return null;
  const chunk = buf.toString('ascii', 12, 16);
  if (chunk === 'VP8X') {
    return { mime: 'image/webp', width: 1 + buf.readUIntLE(24, 3), height: 1 + buf.readUIntLE(27, 3) };
  }
  if (chunk === 'VP8 ') {
    return { mime: 'image/webp', width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
  }
  if (chunk === 'VP8L') {
    const bits = buf.readUInt32LE(21);
    return { mime: 'image/webp', width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
  }
  return null;
}

/** Identifies PNG, JPEG or WebP from file contents and reads its dimensions. */
export function sniffImage(buf: Buffer): ImageInfo | null {
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return pngInfo(buf);
  }
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return jpegInfo(buf);
  }
  if (buf.length >= 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') {
    return webpInfo(buf);
  }
  return null;
}

export type ValidationResult = { ok: true; info: ImageInfo } | { ok: false; error: string };

export function validateImage(buf: Buffer): ValidationResult {
  if (buf.length === 0) return { ok: false, error: 'The file is empty' };
  if (buf.length > MAX_IMAGE_BYTES) return { ok: false, error: 'Images must be 256 KB or smaller' };
  const info = sniffImage(buf);
  if (!info) return { ok: false, error: 'Upload a PNG, JPEG or WebP image' };
  const { width, height } = info;
  if (width < MIN_IMAGE_DIMENSION || height < MIN_IMAGE_DIMENSION) {
    return { ok: false, error: `Images must be at least ${MIN_IMAGE_DIMENSION}×${MIN_IMAGE_DIMENSION} pixels` };
  }
  if (width > MAX_IMAGE_DIMENSION || height > MAX_IMAGE_DIMENSION) {
    return { ok: false, error: `Images must be at most ${MAX_IMAGE_DIMENSION}×${MAX_IMAGE_DIMENSION} pixels` };
  }
  return { ok: true, info };
}

export function imageUrl(imageId: string): string {
  return `/img/${imageId}`;
}
