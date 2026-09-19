import { nanoid } from 'nanoid';

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
