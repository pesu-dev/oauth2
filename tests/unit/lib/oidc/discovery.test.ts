import { describe, it, expect } from 'vitest';
import { buildOpenIdConfiguration } from '@/lib/oidc/discovery';

describe('OIDC Discovery Configuration Generator', () => {
  it('builds discovery document from issuer URL', () => {
    const config = buildOpenIdConfiguration('https://auth.pesu.dev');
    expect(config.issuer).toBe('https://auth.pesu.dev');
    expect(config.authorization_endpoint).toBe('https://auth.pesu.dev/oauth2/authorize');
    expect(config.token_endpoint).toBe('https://auth.pesu.dev/oauth2/token');
    expect(config.userinfo_endpoint).toBe('https://auth.pesu.dev/api/v1/userinfo');
    expect(config.revocation_endpoint).toBe('https://auth.pesu.dev/oauth2/revoke');
    expect(config.jwks_uri).toBe('https://auth.pesu.dev/jwks.json');
    expect(config.id_token_signing_alg_values_supported).toEqual(['RS256']);
    expect(config.scopes_supported).toContain('openid');
  });

  it('advertises client_secret_basic in token_endpoint_auth_methods_supported', () => {
    const config = buildOpenIdConfiguration('http://localhost:3000');
    expect(config.token_endpoint_auth_methods_supported).toContain('client_secret_basic');
    expect(config.token_endpoint_auth_methods_supported).toContain('client_secret_post');
    expect(config.token_endpoint_auth_methods_supported).toContain('none');
  });
});
