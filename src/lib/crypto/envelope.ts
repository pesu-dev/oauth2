import crypto from 'node:crypto';

const DEK_LEN = 32;
const NONCE_LEN = 12;
const TAG_LEN = 16;

export class VaultCryptoError extends Error {
  constructor(message: string = 'failed to open sealed blob') {
    super(message);
    this.name = 'VaultCryptoError';
  }
}

export interface SealedBlob {
  nonce: Buffer;
  ciphertext: Buffer;
  wrapNonce: Buffer;
  wrappedDek: Buffer;
  keyVersion: number;
}

export function masterKeyFromSecret(secret: string): Buffer {
  return crypto.createHash('sha256').update(secret, 'utf-8').digest();
}

export function seal(
  masterKey: Buffer,
  plaintext: Buffer,
  keyVersion: number = 1
): SealedBlob {
  if (masterKey.length !== DEK_LEN) {
    throw new Error('masterKey must be 32 bytes');
  }

  const dek = crypto.randomBytes(DEK_LEN);
  const nonce = crypto.randomBytes(NONCE_LEN);

  const cipher = crypto.createCipheriv('aes-256-gcm', dek, nonce);
  const encryptedPayload = Buffer.concat([
    cipher.update(plaintext),
    cipher.final(),
    cipher.getAuthTag(),
  ]);

  const wrapNonce = crypto.randomBytes(NONCE_LEN);
  const wrapCipher = crypto.createCipheriv('aes-256-gcm', masterKey, wrapNonce);
  const wrappedDek = Buffer.concat([
    wrapCipher.update(dek),
    wrapCipher.final(),
    wrapCipher.getAuthTag(),
  ]);

  return {
    nonce,
    ciphertext: encryptedPayload,
    wrapNonce,
    wrappedDek,
    keyVersion,
  };
}

export function open(masterKey: Buffer, blob: SealedBlob): Buffer {
  if (masterKey.length !== DEK_LEN) {
    throw new Error('masterKey must be 32 bytes');
  }

  let dek: Buffer;
  try {
    const wrapCiphertext = blob.wrappedDek.subarray(0, blob.wrappedDek.length - TAG_LEN);
    const wrapTag = blob.wrappedDek.subarray(blob.wrappedDek.length - TAG_LEN);

    const wrapDecipher = crypto.createDecipheriv('aes-256-gcm', masterKey, blob.wrapNonce);
    wrapDecipher.setAuthTag(wrapTag);
    dek = Buffer.concat([wrapDecipher.update(wrapCiphertext), wrapDecipher.final()]);
  } catch {
    throw new VaultCryptoError('failed to unwrap DEK');
  }

  try {
    const ciphertext = blob.ciphertext.subarray(0, blob.ciphertext.length - TAG_LEN);
    const tag = blob.ciphertext.subarray(blob.ciphertext.length - TAG_LEN);

    const decipher = crypto.createDecipheriv('aes-256-gcm', dek, blob.nonce);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } catch {
    throw new VaultCryptoError('failed to decrypt payload');
  }
}
