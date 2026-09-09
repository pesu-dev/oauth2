import crypto from 'node:crypto';

export function sha256Hex(data: string | Buffer): string {
  return crypto.createHash('sha256').update(data).digest('hex');
}

export function hashToken(token: string): string {
  return sha256Hex(token);
}
