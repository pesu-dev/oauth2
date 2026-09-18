import { NextRequest, NextResponse } from 'next/server';
import { connectToDatabase } from '@/lib/db/connection';
import { Client, User } from '@/lib/db/models';
import { AcademyClient } from '@/lib/academy/client';
import { createSessionToken } from '@/lib/session/cookie';
import { pendingCredentialStore } from '@/lib/session/pending-credentials';
import { newSub } from '@/lib/id/nanoid';
import { cookies } from 'next/headers';
import { getConfig } from '@/lib/config';

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
    const orConditions: Array<{ prn?: string; srn?: string }> = [];
    if (result.profile.prn) orConditions.push({ prn: result.profile.prn });
    if (result.profile.srn) orConditions.push({ srn: result.profile.srn });

    let user = orConditions.length > 0
      ? await User.findOne({ $or: orConditions, deleted_at: null })
      : null;

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
      if (result.profile.prn) user.prn = result.profile.prn;
      if (result.profile.srn) user.srn = result.profile.srn;
      if (result.profile.program) user.program = result.profile.program;
      if (result.profile.branch) user.branch = result.profile.branch;
      if (result.profile.semester) user.semester = result.profile.semester;
      if (result.profile.section) user.section = result.profile.section;
      if (result.profile.campus) user.campus = result.profile.campus;
      if (result.profile.email) user.email = result.profile.email;
      if (result.profile.phone) user.phone = result.profile.phone;
      user.last_login_at = new Date();
      await user.save();
    }

    const config = getConfig();

    // Set signed session token cookie
    const sessionToken = await createSessionToken({
      sub: user.sub,
      name: user.name,
      prn: user.prn,
    }, 1800);

    const cookieStore = await cookies();
    cookieStore.set('pesu_session', sessionToken, {
      httpOnly: true,
      secure: config.appEnv !== 'local',
      sameSite: 'lax',
      path: '/',
      maxAge: 1800,
    });

    // Store in-memory ephemeral pending credential ONLY for delegated authorization flows
    let isDelegatedFlow = false;
    try {
      const url = new URL(safeRedirect, 'http://localhost');
      if (url.pathname === '/authorize') {
        const modeParam = url.searchParams.get('mode');
        const clientIdParam = url.searchParams.get('client_id');
        if (modeParam === 'delegated') {
          isDelegatedFlow = true;
        } else if (modeParam !== 'identity' && clientIdParam) {
          const client = await Client.findOne({ client_id: clientIdParam });
          if (client?.delegated_allowed) {
            isDelegatedFlow = true;
          }
        }
      }
    } catch {
      // ignore
    }

    if (isDelegatedFlow) {
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
        secure: config.appEnv !== 'local',
        sameSite: 'lax',
        path: '/',
        maxAge: 600,
      });
    }

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
