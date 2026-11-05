import { customAlphabet, nanoid } from 'nanoid';

// RFC 8628 §6.1: consonants only, no ambiguous characters, easy to type on a phone
export const USER_CODE_ALPHABET = 'BCDFGHJKLMNPQRSTVWXZ';
const userCodeChars = customAlphabet(USER_CODE_ALPHABET, 8);

export function newSub(): string {
  return `usr_${nanoid()}`;
}

export function newClientId(): string {
  return `cli_${nanoid()}`;
}

export function newClientSecret(): string {
  return `sec_${nanoid(32)}`;
}

export function newAuthCode(): string {
  return `code_${nanoid(32)}`;
}

export function newRefreshToken(): string {
  return `rt_${nanoid(32)}`;
}

export function newFamilyId(): string {
  return `fam_${nanoid()}`;
}

export function newRequestId(): string {
  return `req_${nanoid()}`;
}

export function newDeviceCode(): string {
  return `dev_${nanoid(40)}`;
}

/** Returns an 8-character user code formatted for display as XXXX-XXXX. */
export function newUserCode(): string {
  const raw = userCodeChars();
  return `${raw.slice(0, 4)}-${raw.slice(4)}`;
}
