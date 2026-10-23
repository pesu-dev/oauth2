/**
 * Scope registry: the single source of truth for every scope the authorization server
 * understands, the consent copy shown for it, and whether it needs delegated (vault) mode.
 */

export type ScopeKind = 'identity' | 'resource';

export interface ScopeDefinition {
  name: string;
  kind: ScopeKind;
  /** Short plain-language line shown on the consent screen. */
  consentLabel: string;
  /** One-sentence explanation for consent, docs and the portal. */
  description: string;
  /** Sensitive scopes are highlighted on consent and need a justification in access requests. */
  sensitive: boolean;
  /** Resource scopes call PESU Academy on the student's behalf, so they require a vault. */
  requiresDelegated: boolean;
  /** Claims or data this scope releases (for docs). */
  claims: string[];
}

export const IDENTITY_SCOPES = ['openid', 'profile', 'email', 'phone', 'offline_access'] as const;

export const SCOPES: readonly ScopeDefinition[] = [
  {
    name: 'openid',
    kind: 'identity',
    consentLabel: 'Know who you are',
    description: 'Required for OpenID Connect. Issues an ID token with your stable, opaque user id.',
    sensitive: false,
    requiresDelegated: false,
    claims: ['sub'],
  },
  {
    name: 'profile',
    kind: 'identity',
    consentLabel: 'Access your Student Profile',
    description: 'Name, PRN, SRN, program, branch, semester, section, and campus.',
    sensitive: false,
    requiresDelegated: false,
    claims: ['name', 'prn', 'srn', 'program', 'branch', 'semester', 'section', 'campus'],
  },
  {
    name: 'email',
    kind: 'identity',
    consentLabel: 'View your Email Address',
    description: 'Your email registered on PESU Academy.',
    sensitive: false,
    requiresDelegated: false,
    claims: ['email'],
  },
  {
    name: 'phone',
    kind: 'identity',
    consentLabel: 'View your Phone Number',
    description: 'Your contact phone number registered on PESU Academy.',
    sensitive: true,
    requiresDelegated: false,
    claims: ['phone_number'],
  },
  {
    name: 'offline_access',
    kind: 'identity',
    consentLabel: 'Maintain Offline Access',
    description: 'Remain signed into this application without re-authenticating every hour.',
    sensitive: false,
    requiresDelegated: false,
    claims: ['refresh_token'],
  },
  {
    name: 'courses:read',
    kind: 'resource',
    consentLabel: 'Read your courses',
    description: 'Your semesters and the courses you are enrolled in.',
    sensitive: false,
    requiresDelegated: true,
    claims: ['/api/v1/semesters', '/api/v1/courses'],
  },
  {
    name: 'attendance:read',
    kind: 'resource',
    consentLabel: 'Read your attendance',
    description: 'Classes held and attended for each of your courses.',
    sensitive: false,
    requiresDelegated: true,
    claims: ['/api/v1/attendance'],
  },
  {
    name: 'results:read',
    kind: 'resource',
    consentLabel: 'Read your results',
    description: 'ISA marks, ESA grades, SGPA, CGPA and credits.',
    sensitive: true,
    requiresDelegated: true,
    claims: ['/api/v1/results/isa', '/api/v1/results/esa'],
  },
  {
    name: 'timetable:read',
    kind: 'resource',
    consentLabel: 'Read your timetable',
    description: 'Your weekly class timetable.',
    sensitive: false,
    requiresDelegated: true,
    claims: ['/api/v1/timetable'],
  },
  {
    name: 'announcements:read',
    kind: 'resource',
    consentLabel: 'Read your announcements',
    description: 'Announcements posted to you on PESU Academy.',
    sensitive: false,
    requiresDelegated: true,
    claims: ['/api/v1/announcements'],
  },
  {
    name: 'assignments:read',
    kind: 'resource',
    consentLabel: 'Read your assignments',
    description: 'Assignments and their due dates.',
    sensitive: false,
    requiresDelegated: true,
    claims: ['/api/v1/assignments'],
  },
  {
    name: 'photo:read',
    kind: 'resource',
    consentLabel: 'See your student photo',
    description: 'Your PESU Academy profile photo, fetched live and never stored by this service.',
    sensitive: true,
    requiresDelegated: true,
    claims: ['picture', '/api/v1/photo'],
  },
  {
    name: 'seating:read',
    kind: 'resource',
    consentLabel: 'Read your exam seating',
    description: 'Exam hall and seat allocations.',
    sensitive: false,
    requiresDelegated: true,
    claims: ['/api/v1/seating'],
  },
];

const BY_NAME = new Map(SCOPES.map((s) => [s.name, s]));

export function getScope(name: string): ScopeDefinition | undefined {
  return BY_NAME.get(name);
}

export function isKnownScope(name: string): boolean {
  return BY_NAME.has(name);
}

export function isResourceScope(name: string): boolean {
  return BY_NAME.get(name)?.kind === 'resource';
}

export function allScopeNames(): string[] {
  return SCOPES.map((s) => s.name);
}

export function resourceScopeNames(): string[] {
  return SCOPES.filter((s) => s.kind === 'resource').map((s) => s.name);
}

/**
 * Splits a space-delimited scope string, drops unknown scopes, and de-duplicates
 * while preserving request order.
 */
export function parseScopes(raw: string | undefined | null): string[] {
  const seen = new Set<string>();
  for (const token of (raw ?? '').split(/\s+/)) {
    if (token && BY_NAME.has(token)) seen.add(token);
  }
  return [...seen];
}

/** True when any requested scope needs the delegated credential vault. */
export function requiresDelegated(scopes: string[]): boolean {
  return scopes.some((s) => BY_NAME.get(s)?.requiresDelegated);
}

/** Scopes that are not covered by what an admin has approved for the client. */
export function unapprovedScopes(requested: string[], allowed: readonly string[] | undefined): string[] {
  const approved = new Set<string>([...IDENTITY_SCOPES, ...(allowed ?? [])]);
  return requested.filter((s) => !approved.has(s));
}
