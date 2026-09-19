import crypto from 'node:crypto';

export function verifyPkce(
  codeVerifier: string,
  codeChallenge: string,
  method: string = 'S256'
): boolean {
  if (method !== 'S256') {
    return false;
  }
  const calculatedChallenge = crypto
    .createHash('sha256')
    .update(codeVerifier)
    .digest('base64url');

  if (calculatedChallenge.length !== codeChallenge.length) {
    return false;
  }

  return crypto.timingSafeEqual(
    Buffer.from(calculatedChallenge),
    Buffer.from(codeChallenge)
  );
}
