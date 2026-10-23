import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AxiosInstance } from 'axios';
import { NextRequest } from 'next/server';
import { Image, Team, TeamMember } from '@/lib/db/models';
import * as cookieHelper from '@/lib/session/cookie';
import { AcademyClient, AcademyRequestError } from '@/lib/academy/client';
import { VaultSessionError } from '@/lib/academy/session';
import { profileClaims } from '@/lib/oidc/claims';
import { POST as uploadAvatar, DELETE as deleteAvatar } from '@/app/api/internal/teams/[teamId]/avatar/route';
import { GET as getPhoto } from '@/app/api/v1/photo/route';
import { png } from '../../../helpers/images';

vi.mock('@/lib/db/connection', () => ({ connectToDatabase: vi.fn().mockResolvedValue(null) }));
vi.mock('@/lib/db/transaction', () => ({
  withTransaction: vi.fn(async (fn: (session: unknown) => Promise<unknown>) => fn({ id: 'tx' })),
}));

const mockGuard = vi.fn();
vi.mock('@/lib/api/guard', () => ({ requireScope: (...args: unknown[]) => mockGuard(...args) }));
const mockWithSession = vi.fn();
vi.mock('@/lib/academy/session', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/academy/session')>();
  return { ...actual, withAcademySession: (...args: unknown[]) => mockWithSession(...args) };
});

const lean = <T,>(value: T) => ({ lean: () => Promise.resolve(value) }) as never;
const SESSION = { token: 't', accessToken: 'a', userId: 'u', expiresAt: null };

describe('student photo', () => {
  beforeEach(() => {
    mockGuard.mockReset().mockResolvedValue({ ok: true, sub: 'usr_1', clientId: 'cli_1', scopes: ['photo:read'] });
    mockWithSession.mockReset();
  });

  it('adds a picture claim only with photo:read and an issuer', () => {
    const user = { sub: 'usr_1' } as never;
    expect(profileClaims(user, ['openid', 'photo:read'], 'https://auth.pesu.dev/')).toMatchObject({
      picture: 'https://auth.pesu.dev/api/v1/photo',
    });
    expect(profileClaims(user, ['openid', 'photo:read'])).not.toHaveProperty('picture');
    expect(profileClaims(user, ['openid'], 'https://auth.pesu.dev')).not.toHaveProperty('picture');
  });

  it('extracts the photo from the profile dispatcher call, including data URLs', async () => {
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
    const cases: [unknown, Buffer | null][] = [
      [{ STUDENT_PHOTO: { profilePicture: jpeg.toString('base64') } }, jpeg],
      [{ STUDENT_PHOTO: { profilePicture: `data:image/jpeg;base64,${jpeg.toString('base64')}` } }, jpeg],
      [{ STUDENT_PHOTO: { profilePicture: '   ' } }, null],
      [{ STUDENT_PHOTO: {} }, null],
      [{ STUDENT_PHOTO: { profilePicture: '====' } }, null],
      [null, null],
    ];
    for (const [payload, expected] of cases) {
      const post = vi.fn().mockResolvedValue({ status: 200, data: payload });
      const client = new AcademyClient({ post } as unknown as AxiosInstance);
      const result = await client.fetchStudentPhoto(SESSION);
      expect(result ? result.equals(expected!) : result).toBe(expected ? true : null);
      const form = post.mock.calls[0][1] as FormData;
      expect(form.get('menuId')).toBe('11172');
    }
  });

  it('returns the image privately and never cached', async () => {
    const bytes = png(64, 64);
    mockWithSession.mockImplementation(async (_sub: string, fn: (c: unknown, s: unknown) => unknown) =>
      fn({ fetchStudentPhoto: async () => bytes }, SESSION)
    );
    const res = await getPhoto(new Request('http://localhost:3000/api/v1/photo'));
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('image/png');
    expect(res.headers.get('Cache-Control')).toBe('private, no-store');
    expect(Buffer.from(await res.arrayBuffer()).equals(bytes)).toBe(true);
  });

  it('passes guard failures through and reports missing photos', async () => {
    mockGuard.mockResolvedValueOnce({ ok: false, response: new Response(null, { status: 403 }) });
    expect((await getPhoto(new Request('http://x/api/v1/photo'))).status).toBe(403);

    mockWithSession.mockResolvedValueOnce(null);
    expect((await getPhoto(new Request('http://x/api/v1/photo'))).status).toBe(404);
    mockWithSession.mockResolvedValueOnce(Buffer.from('not an image'));
    expect((await getPhoto(new Request('http://x/api/v1/photo'))).status).toBe(404);
  });

  it.each([
    [new VaultSessionError('misconfigured', 'x'), 503],
    [new VaultSessionError('academy_unavailable', 'x'), 502],
    [new VaultSessionError('no_vault', 'x'), 403],
    [new AcademyRequestError('nope'), 502],
  ])('maps %s to %i', async (err, status) => {
    mockWithSession.mockRejectedValueOnce(err);
    expect((await getPhoto(new Request('http://x/api/v1/photo'))).status).toBe(status);
  });

  it('rethrows unexpected errors', async () => {
    mockWithSession.mockRejectedValueOnce(new TypeError('bug'));
    await expect(getPhoto(new Request('http://x/api/v1/photo'))).rejects.toThrow('bug');
  });
});

describe('team avatar API', () => {
  const TEAM = { params: Promise.resolve({ teamId: 'team_1' }) };
  const send = (body?: BodyInit, method = 'POST') => {
    const req = new NextRequest('http://localhost:3000/api/internal/teams/team_1/avatar', {
      method,
      headers: { cookie: 'pesu_session=s' },
      body,
    });
    return method === 'POST' ? uploadAvatar(req, TEAM) : deleteAvatar(req, TEAM);
  };
  const file = () => {
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(png(96, 96))], { type: 'image/png' }));
    return form;
  };

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(cookieHelper, 'verifySessionToken').mockResolvedValue({ sub: 'usr_lead' });
    vi.spyOn(TeamMember, 'findOne').mockReturnValue(lean({ role: 'owner' }));
  });

  it('requires a session and owner/admin rights', async () => {
    vi.spyOn(cookieHelper, 'verifySessionToken').mockResolvedValueOnce(null);
    expect((await send(file())).status).toBe(401);
    vi.spyOn(TeamMember, 'findOne').mockReturnValueOnce(lean({ role: 'developer' }));
    expect((await send(file())).status).toBe(403);
  });

  it('validates the upload and the team', async () => {
    expect((await send('x')).status).toBe(400);
    vi.spyOn(Team, 'findOne').mockReturnValueOnce(lean(null));
    expect((await send(file())).status).toBe(404);
  });

  it('replaces the avatar and removes the old image', async () => {
    vi.spyOn(Team, 'findOne').mockReturnValue(lean({ team_id: 'team_1', avatar_id: 'img_old' }));
    const create = vi.spyOn(Image, 'create').mockResolvedValue([] as never);
    const update = vi.spyOn(Team, 'updateOne').mockResolvedValue({} as never);
    const remove = vi.spyOn(Image, 'deleteOne').mockResolvedValue({} as never);
    const res = await send(file());
    expect((await res.json()).avatar.url).toMatch(/^\/img\/img_/);
    expect(create.mock.calls[0][0]).toEqual([expect.objectContaining({ kind: 'team_avatar', owner_ref: 'team_1' })]);
    expect(update.mock.calls[0][1]).toMatchObject({ $set: { avatar_id: expect.stringMatching(/^img_/) } });
    expect(remove).toHaveBeenCalledWith({ image_id: 'img_old' }, expect.any(Object));

    vi.spyOn(Team, 'findOne').mockReturnValue(lean({ team_id: 'team_1', avatar_id: null }));
    remove.mockClear();
    await send(file());
    expect(remove).not.toHaveBeenCalled();
  });

  it('removes an avatar if present', async () => {
    const update = vi.spyOn(Team, 'updateOne').mockResolvedValue({} as never);
    const remove = vi.spyOn(Image, 'deleteOne').mockResolvedValue({} as never);
    vi.spyOn(Team, 'findOne').mockReturnValueOnce(lean({ avatar_id: 'img_1' }));
    expect((await send(undefined, 'DELETE')).status).toBe(200);
    expect(update.mock.calls[0][1]).toMatchObject({ $set: { avatar_id: null } });
    expect(remove).toHaveBeenCalledWith({ image_id: 'img_1' }, expect.any(Object));

    vi.spyOn(Team, 'findOne').mockReturnValueOnce(lean(null));
    expect((await send(undefined, 'DELETE')).status).toBe(200);
    vi.spyOn(TeamMember, 'findOne').mockReturnValueOnce(lean(null));
    expect((await send(undefined, 'DELETE')).status).toBe(403);
  });
});
