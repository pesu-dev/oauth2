import { NextRequest, NextResponse } from 'next/server';
import { connectToDatabase } from '@/lib/db/connection';
import { User } from '@/lib/db/models';
import { verifyAccessToken } from '@/lib/oidc/jwt';
import { profileClaims } from '@/lib/oidc/claims';
import { getConfig } from '@/lib/config';

async function handleUserInfo(request: NextRequest | Request) {
  const authHeader = request.headers.get('authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return NextResponse.json(
      { error: 'invalid_token', error_description: 'Missing or malformed Bearer token' },
      { status: 401, headers: { 'WWW-Authenticate': 'Bearer' } }
    );
  }

  const token = authHeader.slice(7).trim();
  const config = getConfig();

  let payload;
  try {
    payload = await verifyAccessToken(token, config.issuerUrl);
  } catch {
    return NextResponse.json(
      { error: 'invalid_token', error_description: 'Token signature or expiration invalid' },
      { status: 401, headers: { 'WWW-Authenticate': 'Bearer' } }
    );
  }

  await connectToDatabase();
  const user = await User.findOne({ sub: payload.sub, deleted_at: null });
  if (!user) {
    return NextResponse.json(
      { error: 'invalid_token', error_description: 'User not found' },
      { status: 401, headers: { 'WWW-Authenticate': 'Bearer' } }
    );
  }

  const scopes = payload.scope ? payload.scope.split(' ') : [];
  const claims = profileClaims(user, scopes);
  return NextResponse.json(claims);
}

export async function GET(request: NextRequest | Request) {
  return handleUserInfo(request);
}

export async function POST(request: NextRequest | Request) {
  return handleUserInfo(request);
}
