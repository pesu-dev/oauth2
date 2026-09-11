import { describe, it, expect, beforeEach } from 'vitest';
import { proxy } from '@/proxy';
import { NextRequest } from 'next/server';
import { createSessionToken } from '@/lib/session/cookie';
import { loginLimiter, tokenLimiter, exchangeLimiter } from '@/lib/rate-limit';

describe('Next.js Proxy', () => {
  beforeEach(() => {
    loginLimiter.reset();
    tokenLimiter.reset();
    exchangeLimiter.reset();
  });

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

  it('rejects unauthenticated requests to protected API routes with 401', async () => {
    const req = new NextRequest('http://localhost:3000/api/portal/clients');
    const resp = await proxy(req);

    expect(resp.status).toBe(401);
    const data = await resp.json();
    expect(data.error).toBe('Unauthorized');
  });

  it('allows authenticated users to access protected routes and forwards identity', async () => {
    const token = await createSessionToken({ sub: 'usr_test', name: 'Test User' }, 1800);
    const req = new NextRequest('http://localhost:3000/portal', {
      headers: {
        cookie: `pesu_session=${token}`,
      },
    });
    const resp = await proxy(req);

    expect(resp.status).toBe(200);
    expect(resp.headers.get('X-Frame-Options')).toBe('DENY');
  });

  describe('Rate Limiting', () => {
    it('enforces rate limit on POST /api/auth/login and returns 429', async () => {
      // Limit is 10
      for (let i = 0; i < 10; i++) {
        const req = new NextRequest('http://localhost:3000/api/auth/login', {
          method: 'POST',
          headers: { 'x-forwarded-for': '192.168.1.50' },
        });
        const res = await proxy(req);
        expect(res.status).toBe(200); // forwarded to route handler
      }

      // 11th request blocked by proxy
      const req = new NextRequest('http://localhost:3000/api/auth/login', {
        method: 'POST',
        headers: { 'x-forwarded-for': '192.168.1.50' },
      });
      const res = await proxy(req);
      expect(res.status).toBe(429);
      expect(res.headers.get('Retry-After')).toBe('60');
      const data = await res.json();
      expect(data.error).toContain('Too many login attempts');
    });

    it('enforces rate limit on POST /token and returns RFC 429', async () => {
      // Simulate exhausting tokenLimiter limit (60)
      for (let i = 0; i < 60; i++) {
        tokenLimiter.allow('token:192.168.1.60');
      }

      const req = new NextRequest('http://localhost:3000/token', {
        method: 'POST',
        headers: { 'x-forwarded-for': '192.168.1.60' },
      });
      const res = await proxy(req);
      expect(res.status).toBe(429);
      const data = await res.json();
      expect(data.error).toBe('temporarily_unavailable');
    });

    it('enforces rate limit on POST /oauth/token-exchange and returns RFC 429', async () => {
      // Simulate exhausting exchangeLimiter limit (30)
      for (let i = 0; i < 30; i++) {
        exchangeLimiter.allow('exchange:192.168.1.70');
      }

      const req = new NextRequest('http://localhost:3000/oauth/token-exchange', {
        method: 'POST',
        headers: { 'x-forwarded-for': '192.168.1.70' },
      });
      const res = await proxy(req);
      expect(res.status).toBe(429);
      const data = await res.json();
      expect(data.error).toBe('temporarily_unavailable');
    });
  });

  describe('OIDC CORS & Preflight', () => {
    it('handles OPTIONS preflight on OIDC endpoints with 204 and CORS headers', async () => {
      const endpoints = [
        'http://localhost:3000/.well-known/openid-configuration',
        'http://localhost:3000/jwks.json',
        'http://localhost:3000/token',
        'http://localhost:3000/userinfo',
        'http://localhost:3000/revoke',
      ];

      for (const url of endpoints) {
        const req = new NextRequest(url, { method: 'OPTIONS' });
        const res = await proxy(req);
        expect(res.status).toBe(204);
        expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
        expect(res.headers.get('Access-Control-Allow-Methods')).toContain('POST');
        expect(res.headers.get('Access-Control-Allow-Headers')).toContain('Authorization');
      }
    });

    it('attaches Access-Control-Allow-Origin to OIDC GET responses', async () => {
      const req = new NextRequest('http://localhost:3000/jwks.json');
      const res = await proxy(req);
      expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
    });
  });
});
