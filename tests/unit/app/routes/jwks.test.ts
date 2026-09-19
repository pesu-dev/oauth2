import { describe, it, expect } from 'vitest';
import { GET as getJwks } from '@/app/jwks.json/route';

describe('JWKS Endpoint (/jwks.json)', () => {
  it('returns 200 with RSA public keys', async () => {
    const resp = await getJwks();
    expect(resp.status).toBe(200);
    const data = await resp.json();
    expect(data.keys).toBeDefined();
    expect(data.keys.length).toBeGreaterThan(0);
    expect(data.keys[0].kty).toBe('RSA');
  });
});
