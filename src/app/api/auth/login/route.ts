import { NextRequest, NextResponse } from 'next/server';
import { connectToDatabase } from '@/lib/db/connection';
import { User } from '@/lib/db/models';
import { AcademyClient } from '@/lib/academy/client';
import { createSessionToken } from '@/lib/session/cookie';
import { pendingCredentialStore } from '@/lib/session/pending-credentials';
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

    // Sanitize returnTo against open redirects
    let safeRedirect = '/portal';
    if (
      returnTo &&
      typeof returnTo === 'string' &&
      returnTo.startsWith('/') &&
      !returnTo.startsWith('//') &&
      !returnTo.includes('://') &&
      !returnTo.includes('\\')
    ) {
      safeRedirect = returnTo;
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

    // Store in-memory ephemeral pending credential (never put raw password in the cookie)
    const credId = pendingCredentialStore.put({
      username: username.trim(),
      password,
      sessionToken: result.session.token,
      accessToken: result.session.accessToken,
      userId: result.session.userId,
      expiresAt: result.session.expiresAt,
    });

    const pendingCredToken = await createSessionToken({
      sub: user.sub,
      cred_id: credId,
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
      redirectTo: safeRedirect,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Authentication failed';
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
