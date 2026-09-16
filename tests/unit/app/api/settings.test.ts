import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { GET as getSettings, DELETE as deleteSettings, PATCH as patchSettings } from '@/app/api/settings/route';
import { Client, Consent, RefreshToken, User, Vault } from '@/lib/db/models';
import * as cookieHelper from '@/lib/session/cookie';
import { AcademyClient } from '@/lib/academy/client';

vi.mock('@/lib/db/connection', () => ({
  connectToDatabase: vi.fn().mockResolvedValue(null),
}));

vi.mock('@/lib/academy/client');

vi.mock('@/lib/config', () => ({
  getConfig: vi.fn(() => ({
    vaultMasterKey: 'super-secret-vault-master-key-32b',
  })),
}));

describe('Settings API (/api/settings)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('GET /api/settings', () => {
    it('returns 401 when session cookie is missing', async () => {
      const req = new NextRequest('http://localhost:3000/api/settings');
      const res = await getSettings(req);
      expect(res.status).toBe(401);
    });

    it('returns 401 when user not found or deleted', async () => {
      vi.spyOn(cookieHelper, 'verifySessionToken').mockResolvedValueOnce({ sub: 'usr_unknown' });
      vi.spyOn(User, 'findOne').mockResolvedValueOnce(null);

      const req = new NextRequest('http://localhost:3000/api/settings', {
        headers: { cookie: 'pesu_session=valid' },
      });
      const res = await getSettings(req);
      expect(res.status).toBe(401);
    });

    it('returns user details, vault presence, and enriched consents', async () => {
      vi.spyOn(cookieHelper, 'verifySessionToken').mockResolvedValueOnce({ sub: 'usr_test' });
      vi.spyOn(User, 'findOne').mockResolvedValueOnce({
        sub: 'usr_test',
        name: 'Student Name',
      } as never);
      vi.spyOn(Vault, 'findOne').mockResolvedValueOnce({
        sub: 'usr_test',
        updated_at: new Date('2026-01-01'),
      } as never);
      vi.spyOn(Consent, 'find').mockResolvedValueOnce([
        { client_id: 'cli_1', scopes: ['openid'], mode: 'identity', granted_at: new Date() },
      ] as never);
      vi.spyOn(Client, 'find').mockResolvedValueOnce([
        { client_id: 'cli_1', name: 'My App' },
      ] as never);

      const req = new NextRequest('http://localhost:3000/api/settings', {
        headers: { cookie: 'pesu_session=valid' },
      });
      const res = await getSettings(req);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.user.name).toBe('Student Name');
      expect(data.hasVault).toBe(true);
      expect(data.consents[0].client_name).toBe('My App');
    });
  });

  describe('DELETE /api/settings', () => {
    it('returns 401 when unauthenticated', async () => {
      const req = new NextRequest('http://localhost:3000/api/settings?action=vault', {
        method: 'DELETE',
      });
      const res = await deleteSettings(req);
      expect(res.status).toBe(401);
    });

    it('action=vault deletes stored vault credentials', async () => {
      vi.spyOn(cookieHelper, 'verifySessionToken').mockResolvedValueOnce({ sub: 'usr_test' });
      const deleteVaultSpy = vi.spyOn(Vault, 'deleteOne').mockResolvedValueOnce({ acknowledged: true, deletedCount: 1 });

      const req = new NextRequest('http://localhost:3000/api/settings?action=vault', {
        method: 'DELETE',
        headers: { cookie: 'pesu_session=valid' },
      });
      const res = await deleteSettings(req);
      expect(res.status).toBe(200);
      expect(deleteVaultSpy).toHaveBeenCalledWith({ sub: 'usr_test' });
    });

    it('returns 400 when invalid action is provided', async () => {
      vi.spyOn(cookieHelper, 'verifySessionToken').mockResolvedValueOnce({ sub: 'usr_test' });

      const req = new NextRequest('http://localhost:3000/api/settings?action=unknown_action', {
        method: 'DELETE',
        headers: { cookie: 'pesu_session=valid' },
      });
      const res = await deleteSettings(req);
      expect(res.status).toBe(400);
    });

    it('consent revocation revokes refresh tokens and deletes vault when no delegated consents remain', async () => {
      vi.spyOn(cookieHelper, 'verifySessionToken').mockResolvedValueOnce({ sub: 'usr_test_del' });
      const deleteConsentSpy = vi.spyOn(Consent, 'deleteOne').mockResolvedValueOnce({ acknowledged: true, deletedCount: 1 });
      const revokeTokensSpy = vi.spyOn(RefreshToken, 'updateMany').mockResolvedValueOnce({
        acknowledged: true,
        matchedCount: 2,
        modifiedCount: 2,
        upsertedCount: 0,
        upsertedId: null,
      });
      vi.spyOn(Consent, 'countDocuments').mockResolvedValueOnce(0); // 0 delegated consents remain
      const deleteVaultSpy = vi.spyOn(Vault, 'deleteOne').mockResolvedValueOnce({ acknowledged: true, deletedCount: 1 });
      vi.spyOn(Client, 'findOne').mockResolvedValueOnce({ client_id: 'cli_1', name: 'App One' } as unknown as InstanceType<typeof Client>);
      vi.spyOn(User, 'findOne').mockResolvedValueOnce(null);

      const req = new NextRequest('http://localhost:3000/api/settings?action=consent&client_id=cli_1', {
        method: 'DELETE',
        headers: { cookie: 'pesu_session=valid' },
      });

      const res = await deleteSettings(req);
      expect(res.status).toBe(200);
      expect(deleteConsentSpy).toHaveBeenCalledWith({ sub: 'usr_test_del', client_id: 'cli_1' });
      expect(revokeTokensSpy).toHaveBeenCalledWith(
        { sub: 'usr_test_del', client_id: 'cli_1', revoked_at: null },
        expect.any(Object)
      );
      expect(deleteVaultSpy).toHaveBeenCalledWith({ sub: 'usr_test_del' });
    });

    it('account deletion requires DELETE confirmation string', async () => {
      vi.spyOn(cookieHelper, 'verifySessionToken').mockResolvedValueOnce({ sub: 'usr_test_del' });

      const req = new NextRequest('http://localhost:3000/api/settings?action=account', {
        method: 'DELETE',
        headers: {
          cookie: 'pesu_session=valid',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ confirm: 'NO' }),
      });

      const res = await deleteSettings(req);
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toBe('Type DELETE to confirm account deletion');
    });

    it('account deletion tombstones user, revokes all tokens, deletes vault and consents', async () => {
      vi.spyOn(cookieHelper, 'verifySessionToken').mockResolvedValueOnce({ sub: 'usr_test_del' });
      const userUpdateSpy = vi.spyOn(User, 'updateOne').mockResolvedValueOnce({
        acknowledged: true,
        matchedCount: 1,
        modifiedCount: 1,
        upsertedCount: 0,
        upsertedId: null,
      });
      const revokeTokensSpy = vi.spyOn(RefreshToken, 'updateMany').mockResolvedValueOnce({
        acknowledged: true,
        matchedCount: 5,
        modifiedCount: 5,
        upsertedCount: 0,
        upsertedId: null,
      });
      const deleteConsentsSpy = vi.spyOn(Consent, 'deleteMany').mockResolvedValueOnce({ acknowledged: true, deletedCount: 3 });
      const deleteVaultSpy = vi.spyOn(Vault, 'deleteOne').mockResolvedValueOnce({ acknowledged: true, deletedCount: 1 });
      vi.spyOn(User, 'findOne').mockResolvedValueOnce(null);

      const req = new NextRequest('http://localhost:3000/api/settings?action=account', {
        method: 'DELETE',
        headers: {
          cookie: 'pesu_session=valid',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ confirm: 'DELETE' }),
      });

      const res = await deleteSettings(req);
      expect(res.status).toBe(200);
      expect(userUpdateSpy).toHaveBeenCalledWith(
        { sub: 'usr_test_del', deleted_at: null },
        expect.objectContaining({ $set: { deleted_at: expect.any(Date) } })
      );
      expect(revokeTokensSpy).toHaveBeenCalledWith(
        { sub: 'usr_test_del', revoked_at: null },
        expect.any(Object)
      );
      expect(deleteConsentsSpy).toHaveBeenCalledWith({ sub: 'usr_test_del' });
      expect(deleteVaultSpy).toHaveBeenCalledWith({ sub: 'usr_test_del' });

      // Session cookie is cleared
      const setCookie = res.headers.get('set-cookie');
      expect(setCookie).toContain('pesu_session=;');
    });
  });

  describe('PATCH /api/settings', () => {
    it('returns 401 when unauthenticated', async () => {
      const req = new NextRequest('http://localhost:3000/api/settings', {
        method: 'PATCH',
        body: JSON.stringify({ newPassword: 'pass' }),
      });
      const res = await patchSettings(req);
      expect(res.status).toBe(401);
    });

    it('returns 400 when newPassword is empty', async () => {
      vi.spyOn(cookieHelper, 'verifySessionToken').mockResolvedValueOnce({ sub: 'usr_test' });

      const req = new NextRequest('http://localhost:3000/api/settings', {
        method: 'PATCH',
        headers: { cookie: 'pesu_session=valid', 'Content-Type': 'application/json' },
        body: JSON.stringify({ newPassword: '' }),
      });
      const res = await patchSettings(req);
      expect(res.status).toBe(400);
    });

    it('returns 400 when user has no existing vault record to update', async () => {
      vi.spyOn(cookieHelper, 'verifySessionToken').mockResolvedValueOnce({ sub: 'usr_test' });
      vi.spyOn(User, 'findOne').mockResolvedValueOnce({
        sub: 'usr_test',
        prn: 'PES1202000001',
      } as never);
      vi.spyOn(Vault, 'findOne').mockResolvedValueOnce(null);

      const req = new NextRequest('http://localhost:3000/api/settings', {
        method: 'PATCH',
        headers: { cookie: 'pesu_session=valid', 'Content-Type': 'application/json' },
        body: JSON.stringify({ newPassword: 'new_password' }),
      });
      const res = await patchSettings(req);
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toBe('No saved credentials to update');
    });

    it('returns 400 when Academy re-authentication fails', async () => {
      vi.spyOn(cookieHelper, 'verifySessionToken').mockResolvedValueOnce({ sub: 'usr_test' });
      vi.spyOn(User, 'findOne').mockResolvedValueOnce({
        sub: 'usr_test',
        prn: 'PES1202000001',
      } as never);
      vi.spyOn(Vault, 'findOne').mockResolvedValueOnce({ sub: 'usr_test' } as never);

      vi.mocked(AcademyClient).prototype.login = vi.fn().mockRejectedValueOnce(new Error('Invalid credentials'));

      const req = new NextRequest('http://localhost:3000/api/settings', {
        method: 'PATCH',
        headers: { cookie: 'pesu_session=valid', 'Content-Type': 'application/json' },
        body: JSON.stringify({ newPassword: 'wrong_password' }),
      });
      const res = await patchSettings(req);
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toBe('Invalid credentials');
    });

    it('re-encrypts and updates vault on valid password', async () => {
      vi.spyOn(cookieHelper, 'verifySessionToken').mockResolvedValueOnce({ sub: 'usr_test' });
      vi.spyOn(User, 'findOne').mockResolvedValueOnce({
        sub: 'usr_test',
        prn: 'PES1202000001',
      } as never);
      vi.spyOn(Vault, 'findOne').mockResolvedValueOnce({ sub: 'usr_test' } as never);

      vi.mocked(AcademyClient).prototype.login = vi.fn().mockResolvedValueOnce({
        session: { token: 'tok_new', accessToken: 'acc_new', userId: '12345', expiresAt: null },
        profile: { prn: 'PES1202000001', srn: 'PES1202000001', name: 'Student', email: 's@p.edu' },
      } as never);

      const vaultUpsertSpy = vi.spyOn(Vault, 'findOneAndUpdate').mockResolvedValueOnce({} as never);

      const req = new NextRequest('http://localhost:3000/api/settings', {
        method: 'PATCH',
        headers: { cookie: 'pesu_session=valid', 'Content-Type': 'application/json' },
        body: JSON.stringify({ newPassword: 'correct_new_password' }),
      });
      const res = await patchSettings(req);
      expect(res.status).toBe(200);
      expect(vaultUpsertSpy).toHaveBeenCalledWith(
        { sub: 'usr_test' },
        expect.objectContaining({
          sub: 'usr_test',
          username: 'PES1202000001',
        }),
        expect.objectContaining({ upsert: false })
      );
    });
  });
});
