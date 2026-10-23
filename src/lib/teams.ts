import type { TeamRole } from '@/lib/db/models';

export const TEAM_ROLES: readonly TeamRole[] = ['owner', 'admin', 'developer'];

export function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '') // drop accents left as combining marks
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'team'
  );
}

export function isTeamRole(value: unknown): value is TeamRole {
  return typeof value === 'string' && (TEAM_ROLES as readonly string[]).includes(value);
}

/**
 * Membership rules: owners manage everyone; admins manage non-owners and cannot create owners;
 * developers can only leave. The caller separately prevents removing or demoting the last owner.
 */
export function canChangeMember(actor: TeamRole | null, target: TeamRole | null, newRole?: TeamRole): boolean {
  if (actor === 'owner') return true;
  if (actor === 'admin') return target !== 'owner' && newRole !== 'owner';
  return false;
}
