import { describe, it, expect } from 'vitest';
import { profileClaims } from '@/lib/oidc/claims';
import { IUser } from '@/lib/db/models';

describe('OIDC Claims Mapping', () => {
  const mockUser = {
    sub: 'usr_123',
    name: 'Student Name',
    prn: 'PES1UG20CS001',
    srn: 'PES1202000001',
    program: 'Bachelor of Technology',
    branch: 'Computer Science and Engineering',
    semester: 'Sem-6',
    section: 'A',
    campus: 'RR',
    email: 'student@pes.edu',
    phone: '9876543210',
  } as unknown as IUser;

  it('filters claims based on granted scopes', () => {
    // Identity only (no profile/email/phone)
    const baseClaims = profileClaims(mockUser, ['openid']);
    expect(baseClaims).toEqual({ sub: 'usr_123' });

    // With profile scope
    const profile = profileClaims(mockUser, ['openid', 'profile']);
    expect(profile.name).toBe('Student Name');
    expect(profile.prn).toBe('PES1UG20CS001');
    expect(profile.email).toBeUndefined();

    // With email and phone
    const all = profileClaims(mockUser, ['openid', 'profile', 'email', 'phone']);
    expect(all.email).toBe('student@pes.edu');
    expect(all.phone_number).toBe('9876543210');
  });
});
