import { NextRequest, NextResponse } from 'next/server';
import { connectToDatabase } from '@/lib/db/connection';
import { User } from '@/lib/db/models';
import { AcademyClient } from '@/lib/academy/client';
import { createSessionToken } from '@/lib/session/cookie';
import { newSub } from '@/lib/id/nanoid';
import { cookies } from 'next/headers';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { username, password, returnTo } = body;

    if (!username || !password) {
      return NextResponse.json(
        { error: 'Username and password are required' },
        { status: 400 }
      );
    }

    const academy = new AcademyClient();
    const result = await academy.login(username, password);

    await connectToDatabase();

    // Check existing user by PRN or SRN (ignoring tombstoned accounts)
    let user = await User.findOne({
      $or: [
        { prn: result.profile.prn },
        { srn: result.profile.srn },
      ],
      deleted_at: null,
    });

    if (!user) {
      user = await User.create({
        sub: newSub(),
        name: result.profile.name,
        prn: result.profile.prn || username,
        srn: result.profile.srn || username,
        program: result.profile.program || '',
        branch: result.profile.branch || '',
        semester: result.profile.semester || '',
        section: result.profile.section || '',
        campus: result.profile.campus || '',
        email: result.profile.email || undefined,
        phone: result.profile.phone || undefined,
        created_at: new Date(),
        last_login_at: new Date(),
      });
    } else {
      user.name = result.profile.name || user.name;
      user.last_login_at = new Date();
      if (result.profile.email) user.email = result.profile.email;
      if (result.profile.phone) user.phone = result.profile.phone;
      await user.save();
    }

    // Set signed session token cookie
    const sessionToken = await createSessionToken({
      sub: user.sub,
      name: user.name,
      prn: user.prn,
    }, 1800);

    const cookieStore = await cookies();
    cookieStore.set('pesu_session', sessionToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 1800,
    });

    // Also store temporary encrypted pending credential for delegated vault if flow requires it
    const pendingCredToken = await createSessionToken({
      sub: user.sub,
      password,
      session_token: result.session.token,
      user_id: result.session.userId,
    }, 600);

    cookieStore.set('pesu_pending', pendingCredToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 600,
    });

    return NextResponse.json({
      success: true,
      sub: user.sub,
      redirectTo: returnTo || '/portal',
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Authentication failed';
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
