import { describe, it, expect } from 'vitest';
import { createSessionToken, verifySessionToken } from '@/lib/session/cookie';

describe('Session Cookie Helpers', () => {
  it('creates and verifies session tokens', async () => {
    const data = { sub: 'usr_test123', name: 'Test Student' };
    const token = await createSessionToken(data, 1800);

    expect(typeof token).toBe('string');

    const verified = await verifySessionToken<typeof data>(token);
    expect(verified).not.toBeNull();
    expect(verified?.sub).toBe('usr_test123');
    expect(verified?.name).toBe('Test Student');
  });

  it('rejects tampered tokens', async () => {
    const token = await createSessionToken({ sub: 'usr_1' }, 1800);
    const tampered = token + 'xyz';

    const verified = await verifySessionToken(tampered);
    expect(verified).toBeNull();
  });
});
