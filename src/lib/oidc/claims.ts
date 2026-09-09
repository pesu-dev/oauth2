import { IUser } from '@/lib/db/models';

export function profileClaims(
  user: IUser,
  scopes: string[] | Set<string>
): Record<string, unknown> {
  const scopeSet = new Set(scopes);
  const claims: Record<string, unknown> = {
    sub: user.sub,
  };

  if (scopeSet.has('profile')) {
    Object.assign(claims, {
      name: user.name,
      prn: user.prn,
      srn: user.srn,
      program: user.program,
      branch: user.branch,
      semester: user.semester,
      section: user.section,
      campus: user.campus,
    });
  }

  if (scopeSet.has('email') && user.email) {
    claims.email = user.email;
  }

  if (scopeSet.has('phone') && user.phone) {
    claims.phone_number = user.phone;
  }

  return claims;
}
