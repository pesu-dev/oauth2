import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { verifySessionToken } from '@/lib/session/cookie';
import { pendingCredentialStore } from '@/lib/session/pending-credentials';
import { getConfig } from '@/lib/config';

async function performLogout(request: NextRequest) {
  const config = getConfig();
  const cookieStore = await cookies();
  const pendingCookie = cookieStore.get('pesu_pending')?.value;

  if (pendingCookie) {
    try {
      const decoded = await verifySessionToken<{ cred_id?: string }>(pendingCookie);
      if (decoded?.cred_id) {
        pendingCredentialStore.delete(decoded.cred_id);
      }
    } catch {
      // Ignore token verification errors during logout
    }
  }

  cookieStore.set('pesu_session', '', {
    httpOnly: true,
    secure: config.appEnv !== 'local',
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  });

  cookieStore.set('pesu_pending', '', {
    httpOnly: true,
    secure: config.appEnv !== 'local',
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  });

  const url = new URL(request.url);
  const returnTo = url.searchParams.get('returnTo');
  const safeRedirect = returnTo && returnTo.startsWith('/') && !returnTo.startsWith('//') && !returnTo.includes('://')
    ? returnTo
    : '/';

  return { safeRedirect };
}

export async function POST(request: NextRequest) {
  const { safeRedirect } = await performLogout(request);
  return NextResponse.json({ success: true, redirectTo: safeRedirect });
}
