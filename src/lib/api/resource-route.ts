import { NextResponse } from 'next/server';
import { requireScope } from '@/lib/api/guard';
import { withAcademySession, VaultSessionError } from '@/lib/academy/session';
import { AcademyRequestError, AcademySessionExpiredError } from '@/lib/academy/client';
import {
  RESOURCES,
  ResourceUnavailableError,
  fetchResource,
  type ResourceId,
} from '@/lib/academy/resources';

const NO_STORE = { 'Cache-Control': 'no-store', Pragma: 'no-cache' };

const QUERY_RULES: Record<string, RegExp> = {
  semester: /^\d{1,12}$/,
  page: /^[1-9]\d{0,3}$/,
  day: /^(mon|tue|wed|thu|fri|sat|sun)[a-z]*$|^[1-7]$/i,
};

function errorResponse(status: number, error: string, description: string) {
  return NextResponse.json({ error, error_description: description }, { status, headers: NO_STORE });
}

/** Builds the GET handler for one read-only PESU Academy resource. */
export function createResourceHandler(resourceId: ResourceId, allowedQuery: string[] = []) {
  const def = RESOURCES[resourceId];

  return async function GET(request: Request) {
    const guard = await requireScope(request, def.scope);
    if (!guard.ok) return guard.response;

    const url = new URL(request.url);
    const query = new URLSearchParams();
    for (const [key, value] of url.searchParams) {
      if (!allowedQuery.includes(key)) {
        return errorResponse(400, 'invalid_request', `Unknown query parameter: ${key}`);
      }
      if (!QUERY_RULES[key].test(value)) {
        return errorResponse(400, 'invalid_request', `Invalid value for ${key}`);
      }
      query.set(key, value);
    }

    try {
      const data = await withAcademySession(guard.sub, (client, session, username) =>
        fetchResource(client, session, def, { query, username })
      );
      return NextResponse.json(
        { resource: def.id, data, fetched_at: new Date().toISOString() },
        { headers: NO_STORE }
      );
    } catch (err) {
      if (err instanceof ResourceUnavailableError) {
        return errorResponse(501, 'resource_unavailable', err.message);
      }
      if (err instanceof VaultSessionError) {
        if (err.code === 'misconfigured') return errorResponse(503, 'temporarily_unavailable', err.message);
        if (err.code === 'academy_unavailable') return errorResponse(502, 'academy_unavailable', err.message);
        // No usable stored credentials: the student must authorize again with delegated consent.
        return errorResponse(403, 'consent_required', 'Stored PESU Academy credentials are missing; ask the student to sign in again');
      }
      if (err instanceof AcademySessionExpiredError || err instanceof AcademyRequestError) {
        return errorResponse(502, 'academy_unavailable', 'PESU Academy did not return this resource');
      }
      throw err;
    }
  };
}
