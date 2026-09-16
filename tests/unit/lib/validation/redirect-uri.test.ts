import { describe, it, expect } from 'vitest';
import { isValidRedirectUri, parseAndValidateRedirectUris } from '@/lib/validation/redirect-uri';

describe('Redirect URI Validation', () => {
  it('allows valid HTTPS redirect URIs', () => {
    expect(isValidRedirectUri('https://myapp.com/callback')).toBe(true);
    expect(isValidRedirectUri('https://sub.domain.org/auth/oidc')).toBe(true);
  });

  it('allows HTTP only on localhost or 127.0.0.1', () => {
    expect(isValidRedirectUri('http://localhost:3000/callback')).toBe(true);
    expect(isValidRedirectUri('http://127.0.0.1:8080/callback')).toBe(true);
    expect(isValidRedirectUri('http://myapp.com/callback')).toBe(false);
    expect(isValidRedirectUri('http://192.168.1.5/callback')).toBe(false);
  });

  it('rejects invalid schemes and malformed strings', () => {
    expect(isValidRedirectUri('javascript:alert(1)')).toBe(false);
    expect(isValidRedirectUri('data:text/html,evil')).toBe(false);
    expect(isValidRedirectUri('ftp://example.com')).toBe(false);
    expect(isValidRedirectUri('not-a-url')).toBe(false);
    expect(isValidRedirectUri('')).toBe(false);
  });

  it('deduplicates and validates an array of URIs', () => {
    const result = parseAndValidateRedirectUris([
      'https://myapp.com/cb',
      'http://localhost:3000/cb',
      'https://myapp.com/cb',
    ]);
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.uris).toEqual(['https://myapp.com/cb', 'http://localhost:3000/cb']);
    }
  });

  it('rejects array when any URI is invalid', () => {
    const result = parseAndValidateRedirectUris([
      'https://myapp.com/cb',
      'http://evil.com/cb',
    ]);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toContain('Invalid redirect URI');
    }
  });

  it('rejects empty arrays or arrays with only empty strings', () => {
    expect(parseAndValidateRedirectUris([]).valid).toBe(false);
    expect(parseAndValidateRedirectUris(['   ']).valid).toBe(false);
    expect(parseAndValidateRedirectUris([null as never, 123 as never]).valid).toBe(false);
  });
});
