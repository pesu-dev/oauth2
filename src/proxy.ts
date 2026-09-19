import { NextRequest, NextResponse } from 'next/server';
import { verifySessionToken } from '@/lib/session/cookie';
import {
  loginLimiter,
  tokenLimiter,
  exchangeLimiter,
  getClientIp,
} from '@/lib/rate-limit';

const PROTECTED_PAGE_PREFIXES = ['/portal', '/admin', '/settings'];
const PROTECTED_API_PREFIXES = [
  '/api/internal/portal',
  '/api/internal/settings',
  '/api/internal/admin',
];

export const CURRENT_API_VERSION = 'v1';
export const RESOURCE_ENDPOINTS = ['userinfo'];

const RESOURCE_ROUTES = RESOURCE_ENDPOINTS.flatMap((ep) => [
  `/api/${ep}`,
  `/api/${CURRENT_API_VERSION}/${ep}`,
]);

const OIDC_ROUTES = [
  '/.well-known/openid-configuration',
  '/jwks.json',
  '/oauth2/token',
  '/oauth2/revoke',
  '/oauth2/token-exchange',
  ...RESOURCE_ROUTES,
];

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-Requested-With, x-token-exchange-secret',
  'Access-Control-Max-Age': '86400',
};

export async function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname.replace(/\/+$/, '') || '/';
  const ip = getClientIp(request);

  // 1. OIDC CORS preflight (OPTIONS)
  const isOidc = OIDC_ROUTES.some((route) => pathname === route || pathname.startsWith(route + '/'));
  if (isOidc && request.method === 'OPTIONS') {
    return new NextResponse(null, {
      status: 204,
      headers: CORS_HEADERS,
    });
  }

  // 2. Sliding-Window Rate Limiting
  if (request.method === 'POST') {
    if (pathname === '/api/internal/auth/login' && !loginLimiter.allow(ip)) {
      return NextResponse.json(
        { error: 'Too many login attempts. Please wait a minute and try again.' },
        { status: 429, headers: { 'Retry-After': '60' } }
      );
    }

    if (pathname === '/oauth2/token' && !tokenLimiter.allow(`token:${ip}`)) {
      return NextResponse.json(
        { error: 'temporarily_unavailable', error_description: 'Too many requests' },
        { status: 429, headers: { 'Retry-After': '60' } }
      );
    }

    if (pathname === '/oauth2/token-exchange' && !exchangeLimiter.allow(`exchange:${ip}`)) {
      return NextResponse.json(
        { error: 'temporarily_unavailable', error_description: 'Too many requests' },
        { status: 429, headers: { 'Retry-After': '60' } }
      );
    }
  }

  // 3. CSRF & Cross-Origin Defense for internal mutating API endpoints
  const MUTATING_METHODS = ['POST', 'PUT', 'PATCH', 'DELETE'];
  if (MUTATING_METHODS.includes(request.method) && pathname.startsWith('/api/internal/')) {
    const origin = request.headers.get('origin');
    const host = request.headers.get('x-forwarded-host') || request.headers.get('host');
    const secFetchSite = request.headers.get('sec-fetch-site');

    if (secFetchSite === 'cross-site') {
      return NextResponse.json(
        { error: 'Forbidden: cross-origin requests are not allowed' },
        { status: 403 }
      );
    }

    if (origin) {
      try {
        const originUrl = new URL(origin);
        if (host && originUrl.host !== host) {
          return NextResponse.json(
            { error: 'Forbidden: cross-origin requests are not allowed' },
            { status: 403 }
          );
        }
      } catch {
        return NextResponse.json(
          { error: 'Forbidden: invalid origin header' },
          { status: 403 }
        );
      }
    }

    const isInternalBrowserApi = PROTECTED_API_PREFIXES.some((prefix) =>
      pathname.startsWith(prefix)
    );
    if (isInternalBrowserApi && !origin && !secFetchSite) {
      return NextResponse.json(
        { error: 'Forbidden: missing origin proof' },
        { status: 403 }
      );
    }
  }

  // 4. Centralized Protected Routes Authentication
  const isProtectedPage = PROTECTED_PAGE_PREFIXES.some((prefix) => pathname.startsWith(prefix));
  const isProtectedApi = PROTECTED_API_PREFIXES.some((prefix) => pathname.startsWith(prefix));

  let session: { sub: string; name?: string } | null = null;
  if (isProtectedPage || isProtectedApi) {
    const sessionCookie = request.cookies.get('pesu_session')?.value;
    session = sessionCookie ? await verifySessionToken<{ sub: string; name?: string }>(sessionCookie) : null;

    if (!session?.sub) {
      if (isProtectedApi) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }

      const loginUrl = new URL('/login', request.url);
      loginUrl.searchParams.set('return_to', pathname);
      return NextResponse.redirect(loginUrl);
    }
  }

  // 5. Header propagation (injected verified user ID and normalized client IP)
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-client-ip', ip);
  if (session?.sub) {
    requestHeaders.set('x-user-sub', session.sub);
    if (session.name) {
      requestHeaders.set('x-user-name', session.name);
    }
  }

  // 6. Scalable resource endpoint alias rewrite: /api/:resource rewrites internally to /api/:version/:resource
  const matchedResource = RESOURCE_ENDPOINTS.find((ep) => pathname === `/api/${ep}`);
  let response: NextResponse;
  if (matchedResource) {
    const rewriteUrl = request.nextUrl.clone();
    rewriteUrl.pathname = `/api/${CURRENT_API_VERSION}/${matchedResource}`;
    response = NextResponse.rewrite(rewriteUrl, {
      request: {
        headers: requestHeaders,
      },
    });
  } else {
    response = NextResponse.next({
      request: {
        headers: requestHeaders,
      },
    });
  }

  // 7. OIDC CORS response headers
  if (isOidc) {
    Object.entries(CORS_HEADERS).forEach(([key, value]) => {
      response.headers.set(key, value);
    });
  }

  // 8. Security Headers on all responses
  response.headers.set('X-Frame-Options', 'DENY');
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  response.headers.set(
    'Permissions-Policy',
    'camera=(), microphone=(), geolocation=()'
  );

  return response;
}

export const middleware = proxy;

export const config = {
  matcher: [
    /*
     * Match all request paths except for:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public asset extensions (.svg, .png, etc.)
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
