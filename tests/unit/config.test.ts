import { describe, it, expect, beforeEach } from 'vitest';
import { getConfig } from '@/lib/config';

describe('Config', () => {
  const origEnv = process.env;

  beforeEach(() => {
    process.env = { ...origEnv };
  });

  it('provides default config for local environment', () => {
    delete process.env.APP_ENV;
    delete process.env.ISSUER_URL;
    delete process.env.MONGODB_URI;

    const config = getConfig();
    expect(config.appEnv).toBe('local');
    expect(config.issuerUrl).toBe('http://localhost:3000');
    expect(config.dbName).toBe('oauth2');
    expect(config.accessTokenTtlSeconds).toBe(3600);
    expect(config.authorizationCodeTtlSeconds).toBe(600);
  });

  it('respects explicit ISSUER_URL and APP_ENV', () => {
    process.env.APP_ENV = 'staging';
    process.env.ISSUER_URL = 'https://custom-staging.auth.dev';

    const config = getConfig();
    expect(config.appEnv).toBe('staging');
    expect(config.issuerUrl).toBe('https://custom-staging.auth.dev');
  });
});
