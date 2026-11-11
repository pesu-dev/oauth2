import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { Admin, Client, Image } from '@/lib/db/models';
import * as cookieHelper from '@/lib/session/cookie';
import { POST as uploadLogo, DELETE as deleteLogo } from '@/app/api/internal/portal/clients/[clientId]/logo/route';
import { GET as getImage } from '@/app/img/[imageId]/route';
import { GET as listAdminClients, PATCH as patchAdminClient } from '@/app/api/internal/admin/clients/route';
import { png } from '../../../helpers/images';

vi.mock('@/lib/db/connection', () => ({ connectToDatabase: vi.fn().mockResolvedValue(null) }));
vi.mock('@/lib/db/transaction', () => ({
  withTransaction: vi.fn(async (fn: (session: unknown) => Promise<unknown>) => fn({ id: 'tx' })),
}));
vi.mock('@/lib/mailer', () => ({ notifySubQuietly: vi.fn() }));

const PARAMS = { params: Promise.resolve({ clientId: 'cli_1' }) };

function upload(body: BodyInit | null, headers: Record<string, string> = {}) {
  return uploadLogo(
    new NextRequest('http://localhost:3000/api/internal/portal/clients/cli_1/logo', {
      method: 'POST',
      headers: { cookie: 'pesu_session=s', ...headers },
      body,
    }),
    PARAMS
  );
}

function formWith(file: Blob | string) {
  const form = new FormData();
  form.append('file', file);
  return form;
}

describe('logo upload API', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(cookieHelper, 'verifySessionToken').mockResolvedValue({ sub: 'usr_dev' });
  });

  it('requires a session and a multipart file field', async () => {
    vi.spyOn(cookieHelper, 'verifySessionToken').mockResolvedValueOnce(null);
    expect((await upload(formWith(new Blob([new Uint8Array(png(64, 64))])))).status).toBe(401);
    expect((await upload('plain', { 'Content-Type': 'text/plain' })).status).toBe(400);
    expect((await upload(formWith('not a file'))).status).toBe(400);
  });

  it('rejects oversize declarations, invalid images and unmanageable clients', async () => {
    expect((await upload(formWith(new Blob([new Uint8Array(png(64, 64))])), { 'content-length': String(1024 * 1024) })).status).toBe(413);
    const svg = await upload(formWith(new Blob(['<svg/>'], { type: 'image/svg+xml' })));
    expect((await svg.json()).error).toContain('PNG, JPEG or WebP');

    vi.spyOn(Client, 'findOne').mockResolvedValueOnce(null);
    expect((await upload(formWith(new Blob([new Uint8Array(png(128, 128))])))).status).toBe(404);
  });

  it('stores the image, marks the logo pending and deletes the previous one', async () => {
    vi.spyOn(Client, 'findOne').mockResolvedValueOnce({
      client_id: 'cli_1',
      owner_sub: 'usr_dev',
      owner_type: 'user',
      logo_image_id: 'img_old',
    } as never);
    const create = vi.spyOn(Image, 'create').mockResolvedValue([] as never);
    const update = vi.spyOn(Client, 'updateOne').mockResolvedValue({} as never);
    const remove = vi.spyOn(Image, 'deleteOne').mockResolvedValue({} as never);

    const res = await upload(formWith(new Blob([new Uint8Array(png(128, 128))], { type: 'image/png' })));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.logo).toMatchObject({ status: 'pending', url: expect.stringMatching(/^\/img\/img_/) });
    expect(create.mock.calls[0][0]).toEqual([
      expect.objectContaining({ kind: 'client_logo', owner_ref: 'cli_1', mime: 'image/png', width: 128, height: 128, created_by_sub: 'usr_dev' }),
    ]);
    expect(update.mock.calls[0][1]).toMatchObject({ $set: { logo_status: 'pending' } });
    expect(remove).toHaveBeenCalledWith({ image_id: 'img_old' }, expect.any(Object));
  });

  it('removes a logo, and tolerates clients without one', async () => {
    vi.spyOn(Client, 'findOne').mockResolvedValueOnce({ client_id: 'cli_1', owner_sub: 'usr_dev', logo_image_id: 'img_1' } as never);
    const update = vi.spyOn(Client, 'updateOne').mockResolvedValue({} as never);
    const remove = vi.spyOn(Image, 'deleteOne').mockResolvedValue({} as never);
    const del = () =>
      deleteLogo(new NextRequest('http://localhost:3000/x', { method: 'DELETE', headers: { cookie: 'pesu_session=s' } }), PARAMS);
    expect((await del()).status).toBe(200);
    expect(update.mock.calls[0][1]).toMatchObject({ $set: { logo_image_id: null, logo_status: null } });
    expect(remove).toHaveBeenCalledWith({ image_id: 'img_1' }, expect.any(Object));

    vi.spyOn(Client, 'findOne').mockResolvedValueOnce({ client_id: 'cli_1', owner_sub: 'usr_dev' } as never);
    expect((await del()).status).toBe(200);
    vi.spyOn(Client, 'findOne').mockResolvedValueOnce(null);
    expect((await del()).status).toBe(404);
    vi.spyOn(cookieHelper, 'verifySessionToken').mockResolvedValueOnce(null);
    expect((await del()).status).toBe(401);
  });
});

describe('image serving', () => {
  beforeEach(() => vi.restoreAllMocks());
  const get = (id: string) => getImage(new Request(`http://localhost:3000/img/${id}`), { params: Promise.resolve({ imageId: id }) });

  it('rejects malformed and unknown ids', async () => {
    expect((await get('../etc/passwd')).status).toBe(404);
    vi.spyOn(Image, 'findOne').mockReturnValueOnce({ lean: () => Promise.resolve(null) } as never);
    expect((await get('img_aaaaaaaaaaaaaaaaaaaaaaaa')).status).toBe(404);
  });

  it('serves bytes with immutable caching and a sandbox CSP', async () => {
    const data = png(64, 64);
    for (const stored of [data, { buffer: data.buffer.slice(data.byteOffset, data.byteOffset + data.length) }]) {
      vi.spyOn(Image, 'findOne').mockReturnValueOnce({
        lean: () => Promise.resolve({ data: stored, mime: 'image/png', sha256: 'abc' }),
      } as never);
      const res = await get('img_aaaaaaaaaaaaaaaaaaaaaaaa');
      expect(res.status).toBe(200);
      expect(res.headers.get('Content-Type')).toBe('image/png');
      expect(res.headers.get('Cache-Control')).toContain('immutable');
      expect(res.headers.get('Content-Security-Policy')).toContain('sandbox');
      expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
      expect(res.headers.get('ETag')).toBe('"abc"');
      expect(Buffer.from(await res.arrayBuffer()).equals(data)).toBe(true);
    }
  });
});

describe('admin logo review', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(cookieHelper, 'verifySessionToken').mockResolvedValue({ sub: 'usr_admin' });
    vi.spyOn(Admin, 'findOne').mockResolvedValue({ sub: 'usr_admin' } as never);
  });

  const patch = (body: Record<string, unknown>) =>
    patchAdminClient(
      new NextRequest('http://localhost:3000/api/internal/admin/clients', {
        method: 'PATCH',
        headers: { cookie: 'pesu_session=s', 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
    );

  it('lists pending logos', async () => {
    const find = vi.spyOn(Client, 'find').mockReturnValue({
      sort: () => ({ limit: () => ({ lean: () => Promise.resolve([{ client_id: 'cli_1', name: 'A', logo_image_id: 'img_1', logo_status: 'pending' }]) }) }),
    } as never);
    const res = await listAdminClients(new NextRequest('http://localhost:3000/api/internal/admin/clients?logos=pending', { headers: { cookie: 'pesu_session=s' } }));
    expect(find).toHaveBeenCalledWith({ logo_status: 'pending' });
    expect((await res.json()).clients[0]).toMatchObject({ logo_image_id: 'img_1', logo_status: 'pending' });
  });

  it('approves and rejects logos, notifying the owner', async () => {
    const { notifySubQuietly } = await import('@/lib/mailer');
    const client = { client_id: 'cli_1', name: 'A', owner_sub: 'usr_dev', logo_image_id: 'img_1', save: vi.fn() };
    vi.spyOn(Client, 'findOne').mockResolvedValue(client as never);

    expect(await (await patch({ clientId: 'cli_1', action: 'approve_logo' })).json()).toMatchObject({ logo_status: 'approved' });
    expect(vi.mocked(notifySubQuietly).mock.calls.at(-1)?.[0].subject).toBe('Logo approved for A');

    await patch({ clientId: 'cli_1', action: 'reject_logo', reason: 'Looks like the PESU crest' });
    expect(client).toMatchObject({ logo_status: 'rejected' });
    expect(vi.mocked(notifySubQuietly).mock.calls.at(-1)?.[0].body).toContain('PESU crest');

    await patch({ clientId: 'cli_1', action: 'reject_logo' });
    expect(vi.mocked(notifySubQuietly).mock.calls.at(-1)?.[0].body).toContain('was not approved.');
  });

  it('refuses to review a client without a logo', async () => {
    vi.spyOn(Client, 'findOne').mockResolvedValue({ client_id: 'cli_1', save: vi.fn() } as never);
    expect((await patch({ clientId: 'cli_1', action: 'approve_logo' })).status).toBe(400);
  });
});

