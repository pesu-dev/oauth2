import {
  generateKeyPair,
  exportJWK,
  SignJWT,
  jwtVerify,
  importPKCS8,
  JWK,
} from 'jose';
import crypto from 'node:crypto';
import { nanoid } from 'nanoid';
import { IUser } from '@/lib/db/models';
import { profileClaims } from './claims';

interface KeyPairHolder {
  privateKey: CryptoKey | Uint8Array;
  publicKey: CryptoKey | Uint8Array;
  kid: string;
}

let keyHolderPromise: Promise<KeyPairHolder> | null = null;

export async function getKeyPair(): Promise<KeyPairHolder> {
  if (!keyHolderPromise) {
    keyHolderPromise = (async () => {
      const pem = process.env.TOKEN_SIGNING_KEY_PEM;
      if (pem) {
        const privateKey = await importPKCS8(pem, 'RS256');
        const kid = process.env.TOKEN_SIGNING_KEY_ID || 'pesu-key-1';
        return {
          privateKey,
          publicKey: privateKey,
          kid,
        };
      }

      const { privateKey, publicKey } = await generateKeyPair('RS256', {
        extractable: true,
      });
      const kid = 'pesu-key-default';
      return { privateKey, publicKey, kid };
    })();
  }
  return keyHolderPromise;
}

export async function getPublicJwks(): Promise<{ keys: JWK[] }> {
  const { publicKey, kid } = await getKeyPair();
  const jwk = await exportJWK(publicKey);
  return {
    keys: [
      {
        ...jwk,
        kid,
        alg: 'RS256',
        use: 'sig',
      },
    ],
  };
}

export function calculateAtHash(accessToken: string): string {
  const hash = crypto.createHash('sha256').update(accessToken, 'ascii').digest();
  return hash.subarray(0, 16).toString('base64url');
}

export interface MintAccessTokenParams {
  issuer: string;
  sub: string;
  clientId: string;
  scopes: string[];
  ttlSeconds?: number;
}

export async function mintAccessToken({
  issuer,
  sub,
  clientId,
  scopes,
  ttlSeconds = 3600,
}: MintAccessTokenParams): Promise<string> {
  const { privateKey, kid } = await getKeyPair();
  const now = Math.floor(Date.now() / 1000);

  return new SignJWT({
    client_id: clientId,
    scope: scopes.join(' '),
  })
    .setProtectedHeader({ alg: 'RS256', kid })
    .setIssuer(issuer)
    .setSubject(sub)
    .setAudience(clientId)
    .setJti(nanoid())
    .setIssuedAt(now)
    .setExpirationTime(now + ttlSeconds)
    .sign(privateKey);
}

export interface MintIdTokenParams {
  issuer: string;
  sub: string;
  clientId: string;
  user: IUser;
  scopes: string[];
  accessToken?: string;
  ttlSeconds?: number;
}

export async function mintIdToken({
  issuer,
  sub,
  clientId,
  user,
  scopes,
  accessToken,
  ttlSeconds = 3600,
}: MintIdTokenParams): Promise<string> {
  const { privateKey, kid } = await getKeyPair();
  const now = Math.floor(Date.now() / 1000);

  const claims = profileClaims(user, scopes);
  if (accessToken) {
    claims.at_hash = calculateAtHash(accessToken);
  }

  return new SignJWT(claims)
    .setProtectedHeader({ alg: 'RS256', kid })
    .setIssuer(issuer)
    .setSubject(sub)
    .setAudience(clientId)
    .setIssuedAt(now)
    .setExpirationTime(now + ttlSeconds)
    .sign(privateKey);
}

export async function verifyAccessToken(
  token: string,
  issuer: string
): Promise<{ sub: string; client_id: string; scope: string }> {
  const { publicKey } = await getKeyPair();
  const { payload } = await jwtVerify(token, publicKey, {
    issuer,
  });

  return {
    sub: payload.sub as string,
    client_id: payload.client_id as string,
    scope: (payload.scope as string) || '',
  };
}
