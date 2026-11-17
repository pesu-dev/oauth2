import { USER_CODE_ALPHABET } from '@/lib/id/nanoid';

/** Normalizes user input (case, spaces, dashes) to the 8-character form that gets hashed, or null if invalid. */
export function normalizeUserCode(input: string | null | undefined): string | null {
  const cleaned = (input ?? '').toUpperCase().replace(/[\s-]/g, '');
  if (cleaned.length !== 8) return null;
  for (const ch of cleaned) {
    if (!USER_CODE_ALPHABET.includes(ch)) return null;
  }
  return cleaned;
}

export function formatUserCode(normalized: string): string {
  return `${normalized.slice(0, 4)}-${normalized.slice(4)}`;
}
