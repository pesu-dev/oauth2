import { masterKeyFromSecret, packVaultPlaintext, seal, type VaultPlaintext } from '@/lib/crypto/envelope';
import type { PendingCredentials } from '@/lib/session/pending-credentials';

/**
 * Builds the vault document fields for credentials captured at login, sealed with a fresh DEK.
 * The caller upserts it inside the same transaction as the consent it belongs to.
 */
export function sealPendingCredentials(
  sub: string,
  pending: PendingCredentials,
  vaultMasterKey: string
): Record<string, unknown> {
  const plaintext: VaultPlaintext = {
    username: pending.username || sub,
    password: pending.password,
    session: pending.sessionToken
      ? {
          token: pending.sessionToken,
          access_token: pending.accessToken || null,
          user_id: pending.userId || null,
        }
      : null,
  };
  const sealed = seal(masterKeyFromSecret(vaultMasterKey), packVaultPlaintext(plaintext), 1);
  return {
    sub,
    nonce: sealed.nonce,
    ciphertext: sealed.ciphertext,
    wrap_nonce: sealed.wrapNonce,
    wrapped_dek: sealed.wrappedDek,
    key_version: sealed.keyVersion,
    session_expires_at: pending.expiresAt ? new Date(pending.expiresAt) : undefined,
    updated_at: new Date(),
  };
}
