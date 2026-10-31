import { User, Vault } from '@/lib/db/models';
import { getConfig } from '@/lib/config';
import {
  masterKeyFromSecret,
  open,
  seal,
  SealedBlob,
  packVaultPlaintext,
  unpackVaultPlaintext,
  VaultPlaintext,
} from '@/lib/crypto/envelope';
import { AcademyClient, AcademySession, AcademySessionExpiredError } from '@/lib/academy/client';

/**
 * The only place outside consent/settings that opens the credential vault. Callers get a usable
 * PESU Academy mobile session for a subject, never the password.
 */

export type VaultErrorCode =
  | 'misconfigured'
  | 'no_vault'
  | 'vault_unreadable'
  | 'user_missing'
  | 'academy_unavailable';

export class VaultSessionError extends Error {
  constructor(public readonly code: VaultErrorCode, message: string) {
    super(message);
    this.name = 'VaultSessionError';
  }
}

export interface ExchangedSession {
  token: string;
  access_token?: string | null;
  user_id?: string | null;
}

export interface AcademySessionResult {
  session: ExchangedSession;
  /** Login identifier stored with the credentials (SRN/PRN), for calls that need it. */
  username: string;
  refreshed: boolean;
}

// Treat a cached session as stale this long before it expires.
const EXPIRY_SKEW_MS = 60_000;

export async function getAcademySession(
  sub: string,
  { forceRefresh = false }: { forceRefresh?: boolean } = {}
): Promise<AcademySessionResult> {
  const config = getConfig();
  if (!config.vaultMasterKey) {
    throw new VaultSessionError('misconfigured', 'Vault master key unavailable');
  }

  const vaultDoc = await Vault.findOne({ sub });
  if (!vaultDoc) {
    throw new VaultSessionError('no_vault', 'No vault credentials for subject');
  }

  const masterKey = masterKeyFromSecret(config.vaultMasterKey);
  const sealedBlob: SealedBlob = {
    nonce: vaultDoc.nonce,
    ciphertext: vaultDoc.ciphertext,
    wrapNonce: vaultDoc.wrap_nonce,
    wrappedDek: vaultDoc.wrapped_dek,
    keyVersion: vaultDoc.key_version,
  };

  let plaintext: VaultPlaintext;
  try {
    plaintext = unpackVaultPlaintext(open(masterKey, sealedBlob));
  } catch {
    throw new VaultSessionError('vault_unreadable', 'Vault credentials unreadable');
  }

  // Reuse the cached session if it has no expiry (freshly stored) or at least a minute left
  if (
    !forceRefresh &&
    plaintext.session?.token &&
    (!vaultDoc.session_expires_at || vaultDoc.session_expires_at.getTime() > Date.now() + EXPIRY_SKEW_MS)
  ) {
    return { session: plaintext.session, username: plaintext.username, refreshed: false };
  }

  const user = await User.findOne({ sub, deleted_at: null });
  if (!user) {
    throw new VaultSessionError('user_missing', 'User not found or deleted');
  }

  // Refresh Academy session using stored username if available
  const loginIdentifier = plaintext.username || user.prn || user.srn;
  const academy = new AcademyClient();
  let authResult;
  try {
    authResult = await academy.login(loginIdentifier, plaintext.password);
  } catch {
    throw new VaultSessionError('academy_unavailable', 'Could not refresh Academy session');
  }

  const sessionData: ExchangedSession = {
    token: authResult.session.token,
    access_token: authResult.session.accessToken || null,
    user_id: authResult.session.userId || null,
  };

  plaintext.session = sessionData;
  const newSealed = seal(masterKey, packVaultPlaintext(plaintext), 1);

  vaultDoc.nonce = newSealed.nonce;
  vaultDoc.ciphertext = newSealed.ciphertext;
  vaultDoc.wrap_nonce = newSealed.wrapNonce;
  vaultDoc.wrapped_dek = newSealed.wrappedDek;
  vaultDoc.key_version = newSealed.keyVersion;
  vaultDoc.session_expires_at = authResult.session.expiresAt || null;
  vaultDoc.updated_at = new Date();
  await vaultDoc.save();

  return { session: sessionData, username: loginIdentifier, refreshed: true };
}

export function toAcademySession(session: ExchangedSession): AcademySession {
  return {
    token: session.token,
    accessToken: session.access_token ?? null,
    userId: session.user_id ?? null,
    expiresAt: null,
  };
}

/**
 * Runs `fn` with a live Academy session for `sub`. If Academy rejects a cached session
 * (sessions carry no reliable expiry), logs in again once and retries.
 */
export async function withAcademySession<T>(
  sub: string,
  fn: (client: AcademyClient, session: AcademySession, username: string) => Promise<T>
): Promise<T> {
  const client = new AcademyClient();
  const first = await getAcademySession(sub);
  try {
    return await fn(client, toAcademySession(first.session), first.username);
  } catch (err) {
    if (!(err instanceof AcademySessionExpiredError) || first.refreshed) throw err;
  }
  const retry = await getAcademySession(sub, { forceRefresh: true });
  return fn(client, toAcademySession(retry.session), retry.username);
}
