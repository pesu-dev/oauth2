import { describe, it, expect } from 'vitest';
import { GET as getDiscovery } from '@/app/.well-known/openid-configuration/route';

describe('Discovery Endpoint (/.well-known/openid-configuration)', () => {
  it('returns 200 with OIDC configuration', async () => {
    const resp = await getDiscovery();
    expect(resp.status).toBe(200);
    const data = await resp.json();
    expect(data.issuer).toBeDefined();
    expect(data.authorization_endpoint).toBeDefined();
    expect(data.token_endpoint).toBeDefined();
  });
});
