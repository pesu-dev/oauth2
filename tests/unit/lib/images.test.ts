import { describe, it, expect } from 'vitest';
import { MAX_IMAGE_BYTES, imageUrl, sniffImage, validateImage } from '@/lib/images';
import { png } from '../../helpers/images';

function jpeg(width: number, height: number): Buffer {
  const app0 = Buffer.from([0xff, 0xe0, 0x00, 0x04, 0x00, 0x00]);
  const dht = Buffer.from([0xff, 0xc4, 0x00, 0x04, 0x00, 0x00]);
  const sof = Buffer.alloc(11);
  sof.writeUInt16BE(0xffc0, 0);
  sof.writeUInt16BE(8, 2);
  sof[4] = 8;
  sof.writeUInt16BE(height, 5);
  sof.writeUInt16BE(width, 7);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), app0, dht, sof, Buffer.alloc(8)]);
}

function webp(kind: 'VP8X' | 'VP8 ' | 'VP8L', width: number, height: number): Buffer {
  const buf = Buffer.alloc(40);
  buf.write('RIFF', 0, 'ascii');
  buf.write('WEBP', 8, 'ascii');
  buf.write(kind, 12, 'ascii');
  if (kind === 'VP8X') {
    buf.writeUIntLE(width - 1, 24, 3);
    buf.writeUIntLE(height - 1, 27, 3);
  } else if (kind === 'VP8 ') {
    buf.writeUInt16LE(width, 26);
    buf.writeUInt16LE(height, 28);
  } else {
    buf.writeUInt32LE(((height - 1) << 14) | (width - 1), 21);
  }
  return buf;
}

describe('image sniffing', () => {
  it('reads PNG, JPEG and WebP dimensions from magic bytes', () => {
    expect(sniffImage(png(128, 96))).toEqual({ mime: 'image/png', width: 128, height: 96 });
    expect(sniffImage(jpeg(300, 200))).toEqual({ mime: 'image/jpeg', width: 300, height: 200 });
    expect(sniffImage(webp('VP8X', 512, 256))).toEqual({ mime: 'image/webp', width: 512, height: 256 });
    expect(sniffImage(webp('VP8 ', 100, 80))).toEqual({ mime: 'image/webp', width: 100, height: 80 });
    expect(sniffImage(webp('VP8L', 70, 65))).toEqual({ mime: 'image/webp', width: 70, height: 65 });
  });

  it('rejects SVG, other formats and truncated headers', () => {
    expect(sniffImage(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>'))).toBeNull();
    expect(sniffImage(Buffer.from('GIF89a......'))).toBeNull();
    expect(sniffImage(png(64, 64).subarray(0, 20))).toBeNull();
    const badIhdr = png(64, 64);
    badIhdr.write('XXXX', 12, 'ascii');
    expect(sniffImage(badIhdr)).toBeNull();
    expect(sniffImage(Buffer.from([0xff, 0xd8, 0xff, 0x00, 0, 0, 0, 0, 0, 0, 0, 0]))).toBeNull(); // not a marker
    expect(sniffImage(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 1, 0, 0, 0, 0, 0, 0]))).toBeNull(); // bad length
    expect(sniffImage(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 4]))).toBeNull(); // no SOF
    const shortWebp = webp('VP8X', 64, 64).subarray(0, 20);
    expect(sniffImage(shortWebp)).toBeNull();
    const unknownWebp = webp('VP8X', 64, 64);
    unknownWebp.write('ALPH', 12, 'ascii');
    expect(sniffImage(unknownWebp)).toBeNull();
  });
});

describe('image validation', () => {
  it('accepts reasonable logos', () => {
    expect(validateImage(png(256, 256))).toMatchObject({ ok: true, info: { mime: 'image/png' } });
  });

  it.each([
    [Buffer.alloc(0), 'empty'],
    [Buffer.concat([png(256, 256), Buffer.alloc(MAX_IMAGE_BYTES)]), '256 KB'],
    [Buffer.from('not an image at all'), 'PNG, JPEG or WebP'],
    [png(32, 300), 'at least 64'],
    [png(4000, 300), 'at most 2048'],
  ])('rejects %#: %s', (buf, message) => {
    const result = validateImage(buf as Buffer);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain(message);
  });

  it('builds image urls', () => {
    expect(imageUrl('img_abc')).toBe('/img/img_abc');
  });
});
