import { NextRequest, NextResponse } from 'next/server';
import { connectToDatabase } from '@/lib/db/connection';
import { RefreshToken } from '@/lib/db/models';
import { sha256Hex } from '@/lib/crypto/hash';

export async function POST(request: NextRequest | Request) {
  let token = '';

  const contentType = request.headers.get('content-type') || '';
  if (contentType.includes('application/x-www-form-urlencoded') || contentType.includes('multipart/form-data')) {
    const formData = await request.formData();
    token = String(formData.get('token') || '');
  } else if (contentType.includes('application/json')) {
    const json = await request.json();
    token = String(json.token || '');
  } else {
    try {
      const text = await request.text();
      const params = new URLSearchParams(text);
      token = params.get('token') || '';
    } catch {
      // ignore
    }
  }

  if (!token) {
    return NextResponse.json(
      { error: 'invalid_request', error_description: 'Missing token parameter' },
      { status: 400 }
    );
  }

  await connectToDatabase();
  const tokenHash = sha256Hex(token);
  await RefreshToken.updateOne({ token_hash: tokenHash }, { revoked_at: new Date() });

  // RFC 7009: Successful response is 200 OK regardless of whether token was active
  return NextResponse.json({ revoked: true });
}
