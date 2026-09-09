import { NextResponse } from 'next/server';
import { getPublicJwks } from '@/lib/oidc/jwt';

export async function GET() {
  const jwks = await getPublicJwks();
  return NextResponse.json(jwks);
}
