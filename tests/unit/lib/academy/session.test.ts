import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { User, Vault } from '@/lib/db/models';
import { masterKeyFromSecret, packVaultPlaintext, seal, open, unpackVaultPlaintext } from '@/lib/crypto/envelope';
import { getAcademySession, withAcademySession, toAcademySession, VaultSessionError } from '@/lib/academy/session';
import { AcademySessionExpiredError } from '@/lib/academy/client';

const mockLogin = vi.fn();
const mockRefresh = vi.fn();
vi.mock('@/lib/academy/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/academy/client')>();
  return {
    ...actual,
    AcademyClient: class {
      login = (...args: unknown[]) => mockLogin(...args);
      refresh = (...args: unknown[]) => mockRefresh(...args);
    },
  };
});

const SECRET = 'unit-test-vault-master-key';

function vaultDoc(session: { token: string; refresh_token?: string } | null, sessionExpiresAt?: Date | null) {
  const sealed = seal(
    masterKeyFromSecret(SECRET),
    packVaultPlaintext({ username: 'PES1UG20CS001', password: 'pw', session }),
    1
  );
  return {
    nonce: sealed.nonce,
    ciphertext: sealed.ciphertext,
    wrap_nonce: sealed.wrapNonce,
    wrapped_dek: sealed.wrappedDek,
    key_version: sealed.keyVersion,
    session_expires_at: sessionExpiresAt,
    save: vi.fn().mockResolvedValue(undefined),
  };
}

function reopen(doc: ReturnType<typeof vaultDoc>) {
  return unpackVaultPlaintext(
    open(masterKeyFromSecret(SECRET), {
      nonce: doc.nonce,
      ciphertext: doc.ciphertext,
      wrapNonce: doc.wrap_nonce,
      wrappedDek: doc.wrapped_dek,
      keyVersion: doc.key_version,
    })
  );
}

describe('Academy session service', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockLogin.mockReset();
    mockRefresh.mockReset();
    process.env.VAULT_MASTER_KEY = SECRET;
    vi.spyOn(User, 'findOne').mockResolvedValue({ sub: 'usr_1', prn: 'PES1201800001', srn: 'PES1UG20CS001' } as never);
  });

  afterEach(() => {
    delete process.env.VAULT_MASTER_KEY;
  });

  it('reuses a cached session without logging in', async () => {
    vi.spyOn(Vault, 'findOne').mockResolvedValue(vaultDoc({ token: 'cached' }, null) as never);
    const result = await getAcademySession('usr_1');
    expect(result).toEqual({ session: { token: 'cached' }, username: 'PES1UG20CS001', refreshed: false, via: 'cache' });
    expect(mockLogin).not.toHaveBeenCalled();
  });

  it('logs in again and reseals when forced, without ever returning the password', async () => {
    const doc = vaultDoc({ token: 'cached' }, null);
    vi.spyOn(Vault, 'findOne').mockResolvedValue(doc as never);
    const expiresAt = new Date(Date.now() + 30 * 60_000);
    mockLogin.mockResolvedValue({ session: { token: 'fresh', accessToken: 'a', userId: 'u', expiresAt, refreshToken: 'r' } });

    const result = await getAcademySession('usr_1', { forceLogin: true });
    expect(mockLogin).toHaveBeenCalledWith('PES1UG20CS001', 'pw');
    expect(mockRefresh).not.toHaveBeenCalled();
    expect(result).toMatchObject({ refreshed: true, via: 'login' });
    expect(result.session).toEqual({ token: 'fresh', access_token: 'a', user_id: 'u', refresh_token: 'r' });
    expect(doc.session_expires_at).toBe(expiresAt);
    expect(JSON.stringify(result)).not.toContain('"pw"');
    expect(doc.save).toHaveBeenCalled();
    expect(reopen(doc).session?.token).toBe('fresh');
  });

  it('logs in again when a session without a refresh token is about to expire', async () => {
    vi.spyOn(Vault, 'findOne').mockResolvedValue(vaultDoc({ token: 'old' }, new Date(Date.now() + 1000)) as never);
    mockLogin.mockResolvedValue({ session: { token: 'new', accessToken: null, userId: null, expiresAt: null } });
    const result = await getAcademySession('usr_1');
    expect(result.session).toEqual({ token: 'new', access_token: null, user_id: null, refresh_token: null });
    expect(mockRefresh).not.toHaveBeenCalled();
  });

  it('renews an expiring session with the refresh token instead of the password', async () => {
    const doc = vaultDoc({ token: 'old', refresh_token: 'r1' }, new Date(Date.now() - 1000));
    vi.spyOn(Vault, 'findOne').mockResolvedValue(doc as never);
    const expiresAt = new Date(Date.now() + 30 * 60_000);
    mockRefresh.mockResolvedValue({ token: 'old', accessToken: 'a2', userId: null, expiresAt, refreshToken: 'r1' });

    const result = await getAcademySession('usr_1');
    expect(mockRefresh).toHaveBeenCalledWith(expect.objectContaining({ token: 'old', refreshToken: 'r1' }));
    expect(mockLogin).not.toHaveBeenCalled();
    expect(result).toMatchObject({ refreshed: true, via: 'refresh', session: { access_token: 'a2', refresh_token: 'r1' } });
    expect(reopen(doc).session?.access_token).toBe('a2');
    expect(reopen(doc).password).toBe('pw');
    expect(doc.session_expires_at).toBe(expiresAt);
  });

  it('falls back to the password when the refresh token is rejected', async () => {
    vi.spyOn(Vault, 'findOne').mockResolvedValue(vaultDoc({ token: 'old', refresh_token: 'expired' }, new Date(0)) as never);
    mockRefresh.mockRejectedValue(new AcademySessionExpiredError('Refresh rejected: HTTP 401'));
    mockLogin.mockResolvedValue({ session: { token: 'new', accessToken: 'a', userId: null, expiresAt: null, refreshToken: 'r2' } });
    const result = await getAcademySession('usr_1');
    expect(mockLogin).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ via: 'login', session: { token: 'new', refresh_token: 'r2' } });
  });

  it.each([
    ['misconfigured', () => delete process.env.VAULT_MASTER_KEY, null],
    ['no_vault', () => {}, null],
    ['vault_unreadable', () => {}, { ...vaultDoc(null), ciphertext: Buffer.from('tampered-ciphertext-bytes') }],
  ])('throws %s', async (code, setup, doc) => {
    setup();
    vi.spyOn(Vault, 'findOne').mockResolvedValue(doc as never);
    await expect(getAcademySession('usr_1')).rejects.toMatchObject({ code });
  });

  it('throws user_missing and academy_unavailable during refresh', async () => {
    vi.spyOn(Vault, 'findOne').mockResolvedValue(vaultDoc(null) as never);
    vi.spyOn(User, 'findOne').mockResolvedValueOnce(null);
    await expect(getAcademySession('usr_1')).rejects.toMatchObject({ code: 'user_missing' });

    mockLogin.mockRejectedValueOnce(new Error('bad password'));
    const err = await getAcademySession('usr_1').catch((e) => e);
    expect(err).toBeInstanceOf(VaultSessionError);
    expect(err.code).toBe('academy_unavailable');
  });

  it('converts exchanged sessions to client sessions', () => {
    expect(toAcademySession({ token: 't' })).toEqual({ token: 't', accessToken: null, userId: null, expiresAt: null, refreshToken: null });
    expect(toAcademySession({ token: 't', access_token: 'a', user_id: 'u', refresh_token: 'r' })).toEqual({
      token: 't',
      accessToken: 'a',
      userId: 'u',
      expiresAt: null,
      refreshToken: 'r',
    });
  });

  describe('withAcademySession', () => {
    it('runs the callback with the cached session', async () => {
      vi.spyOn(Vault, 'findOne').mockResolvedValue(vaultDoc({ token: 'cached' }, null) as never);
      const fn = vi.fn().mockResolvedValue('rows');
      await expect(withAcademySession('usr_1', fn)).resolves.toBe('rows');
      expect(fn).toHaveBeenCalledTimes(1);
      expect(fn.mock.calls[0][1].token).toBe('cached');
      expect(fn.mock.calls[0][2]).toBe('PES1UG20CS001');
    });

    it('logs in again once when Academy rejects the cached session', async () => {
      vi.spyOn(Vault, 'findOne').mockImplementation(() => Promise.resolve(vaultDoc({ token: 'stale' }, null)) as never);
      mockLogin.mockResolvedValue({ session: { token: 'fresh', accessToken: null, userId: null, expiresAt: null } });
      const fn = vi
        .fn()
        .mockRejectedValueOnce(new AcademySessionExpiredError())
        .mockResolvedValueOnce('ok');

      await expect(withAcademySession('usr_1', fn)).resolves.toBe('ok');
      expect(fn).toHaveBeenCalledTimes(2);
      expect(fn.mock.calls[1][1].token).toBe('fresh');
    });

    it('logs in with the password when a just-refreshed session is rejected', async () => {
      vi.spyOn(Vault, 'findOne').mockImplementation(() => Promise.resolve(vaultDoc({ token: 'old', refresh_token: 'r' }, new Date(0))) as never);
      mockRefresh.mockResolvedValue({ token: 'old', accessToken: 'refreshed', userId: null, expiresAt: null, refreshToken: 'r' });
      mockLogin.mockResolvedValue({ session: { token: 'fresh', accessToken: 'logged-in', userId: null, expiresAt: null } });
      const fn = vi.fn().mockRejectedValueOnce(new AcademySessionExpiredError()).mockResolvedValueOnce('ok');

      await expect(withAcademySession('usr_1', fn)).resolves.toBe('ok');
      expect(mockRefresh).toHaveBeenCalledTimes(1);
      expect(mockLogin).toHaveBeenCalledTimes(1);
      expect(fn.mock.calls[1][1].accessToken).toBe('logged-in');
    });

    it('does not retry other errors or a session that was just logged in', async () => {
      vi.spyOn(Vault, 'findOne').mockImplementation(() => Promise.resolve(vaultDoc({ token: 'x' }, null)) as never);
      await expect(withAcademySession('usr_1', vi.fn().mockRejectedValue(new Error('boom')))).rejects.toThrow('boom');

      vi.spyOn(Vault, 'findOne').mockImplementation(() => Promise.resolve(vaultDoc(null)) as never);
      mockLogin.mockResolvedValue({ session: { token: 'fresh', accessToken: null, userId: null, expiresAt: null } });
      const fn = vi.fn().mockRejectedValue(new AcademySessionExpiredError());
      await expect(withAcademySession('usr_1', fn)).rejects.toBeInstanceOf(AcademySessionExpiredError);
      expect(fn).toHaveBeenCalledTimes(1);
    });
  });
});
