import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { setupIntegrationMongo, teardownIntegrationMongo, resetDatabase } from './setup';
import { POST as uploadLogo } from '@/app/api/internal/portal/clients/[clientId]/logo/route';
import { PATCH as reviewClient } from '@/app/api/internal/admin/clients/route';
import { GET as getImage } from '@/app/img/[imageId]/route';
import AuthorizePage from '@/app/oauth2/authorize/page';
import { Admin, Client, Image, User } from '@/lib/db/models';
import { createSessionToken } from '@/lib/session/cookie';
import { png } from '../helpers/images';

const cookieValue = { current: '' };
vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({ get: (name: string) => (name === 'pesu_session' ? { value: cookieValue.current } : undefined) })),
}));
vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
}));

async function consentLogo(): Promise<string | null | undefined> {
  const element = (await AuthorizePage({
    searchParams: Promise.resolve({
      client_id: 'cli_logo',
      redirect_uri: 'https://logo.pesu.dev/cb',
      response_type: 'code',
      scope: 'openid',
      code_challenge: 'E9Melhoa2OwvFrGMTJguCH5ZiXV68OSTXb0Pl5C_D7g',
      code_challenge_method: 'S256',
    }),
  })) as { props: { client: { logoUrl?: string | null } } };
  return element.props.client.logoUrl;
}

describe('Client logos on consent (Integration)', () => {
  beforeAll(async () => {
    await setupIntegrationMongo();
  }, 60000);

  afterAll(async () => {
    await teardownIntegrationMongo();
  });

  beforeEach(async () => {
    await resetDatabase();
  });

  it('shows a logo on consent only after admin approval, and replaces old uploads', async () => {
    await User.create({ sub: 'usr_student', name: 'Student', prn: 'PES1UG20CS500', srn: 'PES1UG20CS500' });
    await Admin.create({ sub: 'usr_admin' });
    await Client.create({
      client_id: 'cli_logo',
      name: 'Logo App',
      owner_sub: 'usr_dev',
      redirect_uris: ['https://logo.pesu.dev/cb'],
      publishing_status: 'production',
      token_endpoint_auth_method: 'none',
    });
    cookieValue.current = await createSessionToken({ sub: 'usr_student', name: 'Student' });

    const send = async (bytes: Buffer) => {
      const form = new FormData();
      form.append('file', new Blob([new Uint8Array(bytes)], { type: 'image/png' }), 'logo.png');
      const res = await uploadLogo(
        new NextRequest('http://localhost:3000/api/internal/portal/clients/cli_logo/logo', {
          method: 'POST',
          headers: { cookie: `pesu_session=${await createSessionToken({ sub: 'usr_dev' })}` },
          body: form,
        }),
        { params: Promise.resolve({ clientId: 'cli_logo' }) }
      );
      return { status: res.status, body: await res.json() };
    };

    const first = await send(png(128, 128));
    expect(first.status).toBe(200);
    expect(await consentLogo()).toBeNull(); // pending: hidden from students

    const approve = await reviewClient(
      new NextRequest('http://localhost:3000/api/internal/admin/clients', {
        method: 'PATCH',
        headers: { cookie: `pesu_session=${await createSessionToken({ sub: 'usr_admin' })}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId: 'cli_logo', action: 'approve_logo' }),
      })
    );
    expect(approve.status).toBe(200);
    expect(await consentLogo()).toBe(first.body.logo.url);

    const served = await getImage(new Request(`http://localhost:3000${first.body.logo.url}`), {
      params: Promise.resolve({ imageId: first.body.logo.image_id }),
    });
    expect(served.headers.get('Content-Type')).toBe('image/png');
    expect(Buffer.from(await served.arrayBuffer()).equals(png(128, 128))).toBe(true);

    // A replacement goes back to review and the old image is deleted
    const second = await send(png(256, 256));
    expect(await consentLogo()).toBeNull();
    expect(await Image.countDocuments()).toBe(1);
    expect(await Image.exists({ image_id: first.body.logo.image_id })).toBeNull();
    expect((await Client.findOne({ client_id: 'cli_logo' }).lean())?.logo_image_id).toBe(second.body.logo.image_id);
  });
});
