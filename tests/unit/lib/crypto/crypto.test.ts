import { describe, it, expect } from 'vitest';
import { sha256Hex, hashToken } from '@/lib/crypto/hash';
import { verifyPkce } from '@/lib/crypto/pkce';
import {
  seal,
  open,
  masterKeyFromSecret,
  VaultCryptoError,
} from '@/lib/crypto/envelope';
import crypto from 'node:crypto';

describe('Crypto utilities', () => {
  describe('Hashing', () => {
    it('computes expected sha256 hash', () => {
      const hash = sha256Hex('hello');
      expect(hash).toBe('2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824');
    });

    it('hashToken aliases sha256Hex', () => {
      expect(hashToken('token123')).toBe(sha256Hex('token123'));
    });
  });

  describe('PKCE verification', () => {
    it('verifies valid S256 code verifier and challenge', () => {
      const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
      // S256 challenge = base64url(sha256(verifier))
      const challenge = crypto
        .createHash('sha256')
        .update(verifier)
        .digest('base64url');

      expect(verifyPkce(verifier, challenge, 'S256')).toBe(true);
    });

    it('rejects invalid verifier', () => {
      const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
      const challenge = crypto
        .createHash('sha256')
        .update(verifier)
        .digest('base64url');

      expect(verifyPkce('wrong_verifier_string_here_1234567890', challenge, 'S256')).toBe(false);
    });

    it('rejects unsupported challenge methods', () => {
      expect(verifyPkce('foo', 'bar', 'plain')).toBe(false);
    });

    it('rejects challenge when length does not match calculated challenge', () => {
      expect(verifyPkce('verifier', 'short')).toBe(false);
    });
  });

  describe('Envelope Encryption (Vault)', () => {
    const secret = 'super-secret-vault-master-key-32b';
    const masterKey = masterKeyFromSecret(secret);

    it('derives a 32-byte master key from secret', () => {
      expect(masterKey.length).toBe(32);
    });

    it('throws error when masterKey is not 32 bytes', () => {
      const shortKey = Buffer.from('too-short');
      const plaintext = Buffer.from('hello');
      expect(() => seal(shortKey, plaintext)).toThrow('masterKey must be 32 bytes');

      const sealed = seal(masterKey, plaintext);
      expect(() => open(shortKey, sealed)).toThrow('masterKey must be 32 bytes');
    });

    it('encrypts and decrypts round-trip correctly', () => {
      const plaintext = Buffer.from('my-pesu-password-1234', 'utf-8');
      const sealed = seal(masterKey, plaintext, 1);

      expect(sealed.keyVersion).toBe(1);
      expect(sealed.ciphertext).not.toEqual(plaintext);

      const decrypted = open(masterKey, sealed);
      expect(decrypted.toString('utf-8')).toBe('my-pesu-password-1234');
    });

    it('throws VaultCryptoError on invalid master key or auth tag failure', () => {
      const plaintext = Buffer.from('test-secret', 'utf-8');
      const sealed = seal(masterKey, plaintext, 1);
      const wrongKey = masterKeyFromSecret('wrong-secret-key');

      expect(() => open(wrongKey, sealed)).toThrow(VaultCryptoError);
    });

    it('throws VaultCryptoError when ciphertext is tampered', () => {
      const plaintext = Buffer.from('tamper-test', 'utf-8');
      const sealed = seal(masterKey, plaintext, 1);

      // Tamper ciphertext
      sealed.ciphertext[0] ^= 0xff;

      expect(() => open(masterKey, sealed)).toThrow(VaultCryptoError);
    });

    it('packs and unpacks VaultPlaintext correctly', async () => {
      const { packVaultPlaintext, unpackVaultPlaintext } = await import('@/lib/crypto/envelope');
      const payload = {
        username: 'student1',
        password: 'secretpassword',
        session: { token: 'tok123' },
      };
      const packed = packVaultPlaintext(payload);
      const unpacked = unpackVaultPlaintext(packed);
      expect(unpacked).toEqual(payload);
    });

    it('throws VaultCryptoError when unpacking invalid VaultPlaintext', async () => {
      const { unpackVaultPlaintext } = await import('@/lib/crypto/envelope');
      expect(() => unpackVaultPlaintext(Buffer.from(JSON.stringify({ only: 'something' })))).toThrow(
        VaultCryptoError
      );
      expect(() => unpackVaultPlaintext(Buffer.from(JSON.stringify(null)))).toThrow(
        VaultCryptoError
      );
    });
  });

  describe('Argon2id Client Secret Hashing', () => {
    it('hashes and verifies client secret successfully', async () => {
      const { hashClientSecret, verifyClientSecret } = await import('@/lib/crypto/hash');
      const secret = 'my_super_secret_client_key_123';
      const hashed = await hashClientSecret(secret);

      expect(hashed).toMatch(/^\$argon2id\$/);
      expect(await verifyClientSecret(secret, hashed)).toBe(true);
      expect(await verifyClientSecret('wrong_secret', hashed)).toBe(false);
    });

    it('returns false on empty inputs or malformed hash string', async () => {
      const { verifyClientSecret } = await import('@/lib/crypto/hash');
      expect(await verifyClientSecret('', 'hash')).toBe(false);
      expect(await verifyClientSecret('secret', '')).toBe(false);
      expect(await verifyClientSecret('secret', 'invalid-argon2-malformed-hash')).toBe(false);
    });
  });
});
