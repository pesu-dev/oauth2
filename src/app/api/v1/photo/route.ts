import { NextResponse } from 'next/server';
import { requireScope } from '@/lib/api/guard';
import { withAcademySession, VaultSessionError } from '@/lib/academy/session';
import { AcademyRequestError, AcademySessionExpiredError } from '@/lib/academy/client';
import { sniffImage } from '@/lib/images';

export const dynamic = 'force-dynamic';

function error(status: number, code: string, description: string) {
  return NextResponse.json({ error: code, error_description: description }, { status, headers: { 'Cache-Control': 'no-store' } });
}

/** The student's PESU Academy profile photo (scope photo:read), fetched live and never stored. */
export async function GET(request: Request) {
  const guard = await requireScope(request, 'photo:read');
  if (!guard.ok) return guard.response;

  let bytes: Buffer | null;
  try {
    bytes = await withAcademySession(guard.sub, (client, session) => client.fetchStudentPhoto(session));
  } catch (err) {
    if (err instanceof VaultSessionError) {
      if (err.code === 'misconfigured') return error(503, 'temporarily_unavailable', err.message);
      if (err.code === 'academy_unavailable') return error(502, 'academy_unavailable', err.message);
      return error(403, 'consent_required', 'Stored PESU Academy credentials are missing; ask the student to sign in again');
    }
    if (err instanceof AcademySessionExpiredError || err instanceof AcademyRequestError) {
      return error(502, 'academy_unavailable', 'PESU Academy did not return the photo');
    }
    throw err;
  }

  const info = bytes ? sniffImage(bytes) : null;
  if (!bytes || !info) {
    return error(404, 'not_found', 'No profile photo is available for this student');
  }

  return new Response(new Uint8Array(bytes), {
    status: 200,
    headers: {
      'Content-Type': info.mime,
      'Content-Length': String(bytes.length),
      // Personal data: never cache in shared caches or on disk
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; sandbox",
    },
  });
}
