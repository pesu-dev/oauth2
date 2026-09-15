import { describe, it, expect } from 'vitest';
import {
  newSub,
  newClientId,
  newClientSecret,
  newAuthCode,
  newRefreshToken,
  newFamilyId,
  newRequestId,
} from '@/lib/id/nanoid';

describe('Nanoid ID generator', () => {
  it('generates usr_ prefixed subject IDs', () => {
    const sub = newSub();
    expect(sub).toMatch(/^usr_[A-Za-z0-9_-]+$/);
    expect(newSub()).not.toBe(sub);
  });

  it('generates cli_ prefixed client IDs', () => {
    const clientId = newClientId();
    expect(clientId).toMatch(/^cli_[A-Za-z0-9_-]+$/);
  });

  it('generates sec_ prefixed client secrets', () => {
    const secret = newClientSecret();
    expect(secret).toMatch(/^sec_[A-Za-z0-9_-]{32}$/);
  });

  it('generates code_ prefixed authorization codes', () => {
    const code = newAuthCode();
    expect(code).toMatch(/^code_[A-Za-z0-9_-]{32}$/);
  });

  it('generates rt_ prefixed refresh tokens', () => {
    const rt = newRefreshToken();
    expect(rt).toMatch(/^rt_[A-Za-z0-9_-]{32}$/);
  });

  it('generates fam_ prefixed token family IDs', () => {
    const fam = newFamilyId();
    expect(fam).toMatch(/^fam_[A-Za-z0-9_-]+$/);
  });

  it('generates req_ prefixed production request IDs', () => {
    const req = newRequestId();
    expect(req).toMatch(/^req_[A-Za-z0-9_-]+$/);
  });
});
