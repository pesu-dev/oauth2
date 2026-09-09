import { NextRequest, NextResponse } from 'next/server';
import { connectToDatabase } from '@/lib/db/connection';
import { Admin } from '@/lib/db/models';
import { verifySessionToken } from '@/lib/session/cookie';

export async function GET(request: NextRequest) {
  const sessionCookie = request.cookies.get('pesu_session')?.value;
  if (!sessionCookie) {
    return NextResponse.json({ authenticated: false, isAdmin: false });
  }

  const session = await verifySessionToken<{ sub: string }>(sessionCookie);
  if (!session?.sub) {
    return NextResponse.json({ authenticated: false, isAdmin: false });
  }

  try {
    await connectToDatabase();
    const admin = await Admin.findOne({ sub: session.sub });
    return NextResponse.json({
      authenticated: true,
      sub: session.sub,
      isAdmin: Boolean(admin),
    });
  } catch {
    return NextResponse.json({ authenticated: true, sub: session.sub, isAdmin: false });
  }
}
