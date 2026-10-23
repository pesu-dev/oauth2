import { describe, it, expect } from 'vitest';
import {
  SCOPES,
  IDENTITY_SCOPES,
  allScopeNames,
  getScope,
  isKnownScope,
  isResourceScope,
  parseScopes,
  requiresDelegated,
  resourceScopeNames,
  unapprovedScopes,
} from '@/lib/oidc/scopes';

describe('scope registry', () => {
  it('defines unique scopes with identity scopes first', () => {
    const names = allScopeNames();
    expect(new Set(names).size).toBe(names.length);
    expect(names.slice(0, IDENTITY_SCOPES.length)).toEqual([...IDENTITY_SCOPES]);
  });

  it('marks every resource scope as resource:read and delegated', () => {
    const resource = resourceScopeNames();
    expect(resource).toEqual([
      'courses:read',
      'attendance:read',
      'results:read',
      'timetable:read',
      'announcements:read',
      'assignments:read',
      'photo:read',
      'seating:read',
    ]);
    for (const name of resource) {
      expect(name).toMatch(/^[a-z]+:read$/);
      expect(getScope(name)?.requiresDelegated).toBe(true);
    }
    for (const def of SCOPES.filter((s) => s.kind === 'identity')) {
      expect(def.requiresDelegated).toBe(false);
    }
  });

  it('looks scopes up by name', () => {
    expect(getScope('profile')?.consentLabel).toBe('Access your Student Profile');
    expect(getScope('nope')).toBeUndefined();
    expect(isKnownScope('openid')).toBe(true);
    expect(isKnownScope('admin')).toBe(false);
    expect(isResourceScope('attendance:read')).toBe(true);
    expect(isResourceScope('email')).toBe(false);
    expect(isResourceScope('unknown')).toBe(false);
  });

  it('parses scope strings, dropping unknown and duplicate scopes in order', () => {
    expect(parseScopes('openid  profile admin profile attendance:read')).toEqual([
      'openid',
      'profile',
      'attendance:read',
    ]);
    expect(parseScopes('')).toEqual([]);
    expect(parseScopes(undefined)).toEqual([]);
    expect(parseScopes(null)).toEqual([]);
  });

  it('detects when delegated mode is required', () => {
    expect(requiresDelegated(['openid', 'profile'])).toBe(false);
    expect(requiresDelegated(['openid', 'results:read'])).toBe(true);
    expect(requiresDelegated(['ghost'])).toBe(false);
  });

  it('reports resource scopes a client has not been approved for', () => {
    expect(unapprovedScopes(['openid', 'email', 'attendance:read'], undefined)).toEqual(['attendance:read']);
    expect(unapprovedScopes(['openid', 'attendance:read'], ['attendance:read'])).toEqual([]);
    expect(unapprovedScopes(['openid', 'results:read', 'seating:read'], ['seating:read'])).toEqual(['results:read']);
  });
});
