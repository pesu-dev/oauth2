import { describe, it, expect } from 'vitest';
import { proxy } from '@/proxy';
import { NextRequest } from 'next/server';
import { createSessionToken } from '@/lib/session/cookie';

describe('Next.js Proxy', () => {
  it('adds security headers to all responses', async () => {
    const req = new NextRequest('http://localhost:3000/');
    const resp = await proxy(req);

    expect(resp.headers.get('X-Frame-Options')).toBe('DENY');
    expect(resp.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(resp.headers.get('Referrer-Policy')).toBe('strict-origin-when-cross-origin');
  });

  it('redirects unauthenticated users from protected dashboard routes', async () => {
    const req = new NextRequest('http://localhost:3000/portal');
    const resp = await proxy(req);

    expect(resp.status).toBe(307);
    expect(resp.headers.get('location')).toContain('/login?return_to=%2Fportal');
  });

  it('allows authenticated users to access protected routes', async () => {
    const token = await createSessionToken({ sub: 'usr_test' }, 1800);
    const req = new NextRequest('http://localhost:3000/portal', {
      headers: {
        cookie: `pesu_session=${token}`,
      },
    });
    const resp = await proxy(req);

    expect(resp.status).toBe(200);
    expect(resp.headers.get('X-Frame-Options')).toBe('DENY');
  });
});
