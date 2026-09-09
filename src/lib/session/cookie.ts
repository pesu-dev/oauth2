import { SignJWT, jwtVerify } from 'jose';
import { getConfig } from '@/lib/config';

function getSessionSecretKey(): Uint8Array {
  const config = getConfig();
  return new TextEncoder().encode(config.sessionSecret);
}

export async function createSessionToken(
  payload: Record<string, unknown>,
  maxAgeSeconds: number = 1800
): Promise<string> {
  const secretKey = getSessionSecretKey();
  const now = Math.floor(Date.now() / 1000);

  return new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt(now)
    .setExpirationTime(now + maxAgeSeconds)
    .sign(secretKey);
}

export async function verifySessionToken<T = Record<string, unknown>>(
  token: string
): Promise<T | null> {
  try {
    const secretKey = getSessionSecretKey();
    const { payload } = await jwtVerify(token, secretKey);
    return payload as unknown as T;
  } catch {
    return null;
  }
}
