/**
 * Validation for OAuth redirect URIs.
 * Only HTTPS is permitted, with HTTP allowed strictly on localhost/127.0.0.1 for development.
 */
export function isValidRedirectUri(uri: string): boolean {
  try {
    const parsed = new URL(uri.trim());
    if (parsed.protocol === 'https:' && parsed.hostname) {
      return true;
    }
    if (
      parsed.protocol === 'http:' &&
      (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1')
    ) {
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

export function parseAndValidateRedirectUris(
  uris?: string[] | null
): { valid: true; uris: string[] } | { valid: false; error: string } {
  if (uris === undefined || uris === null) {
    return { valid: true, uris: [] };
  }

  if (!Array.isArray(uris)) {
    return { valid: false, error: 'Redirect URIs must be an array' };
  }

  const cleanedUris: string[] = [];
  const seen = new Set<string>();

  for (const raw of uris) {
    if (typeof raw !== 'string') {
      return {
        valid: false,
        error: 'Each redirect URI must be a valid string',
      };
    }

    const trimmed = raw.trim();
    if (!trimmed) continue;

    if (!isValidRedirectUri(trimmed)) {
      return {
        valid: false,
        error: `Invalid redirect URI: "${trimmed}". Must use HTTPS, or HTTP strictly on localhost/127.0.0.1.`,
      };
    }

    if (!seen.has(trimmed)) {
      seen.add(trimmed);
      cleanedUris.push(trimmed);
    }
  }

  return { valid: true, uris: cleanedUris };
}
