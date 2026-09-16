import crypto from 'node:crypto';
import { hash, verify } from '@node-rs/argon2';

export function sha256Hex(data: string | Buffer): string {
  return crypto.createHash('sha256').update(data).digest('hex');
}

export function hashToken(token: string): string {
  return sha256Hex(token);
}

// OWASP interactive Argon2id baseline: time_cost=2, memory_cost=19456 (19 MiB), parallelism=1
const ARGON2_CONFIG = {
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
};

export async function hashClientSecret(secret: string): Promise<string> {
  return hash(secret, ARGON2_CONFIG);
}

export async function verifyClientSecret(secret: string, storedHash: string): Promise<boolean> {
  if (!secret || !storedHash) return false;

  try {
    return await verify(storedHash, secret);
  } catch {
    return false;
  }
}
