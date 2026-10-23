import { User } from '@/lib/db/models';

export type ResolveResult = { ok: true; sub: string } | { ok: false; error: string };

/**
 * Resolves a PRN, SRN or `usr_` subject typed into the portal to a user who has signed in at
 * least once. People who have never signed in cannot be added as testers or team members.
 */
export async function resolveUserSub(identifier: unknown, what: string = 'Users'): Promise<ResolveResult> {
  if (typeof identifier !== 'string' || !identifier.trim()) {
    return { ok: false, error: 'Identifier is required' };
  }
  const target = identifier.trim();
  if (target.startsWith('usr_')) return { ok: true, sub: target };

  const user = await User.findOne({ $or: [{ prn: target }, { srn: target }] });
  if (!user) {
    return {
      ok: false,
      error: `User with identifier "${target}" has not signed in yet. ${what} must be registered users or a valid usr_ subject.`,
    };
  }
  return { ok: true, sub: user.sub };
}
