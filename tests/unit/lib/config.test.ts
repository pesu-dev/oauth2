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

  it('respects explicit ISSUER_URL and APP_ENV when secrets are provided', () => {
    process.env.APP_ENV = 'staging';
    process.env.ISSUER_URL = 'https://custom-staging.auth.dev';
    process.env.VAULT_MASTER_KEY = 'test-vault-key-32-chars-long-here!';
    process.env.TOKEN_EXCHANGE_SECRET = 'test-token-exchange-secret';
    process.env.SESSION_SECRET = 'test-session-secret-at-least-32-chars!';
    process.env.TOKEN_SIGNING_KEY_PEM = 'fake-pem-key';

    const config = getConfig();
    expect(config.appEnv).toBe('staging');
    expect(config.issuerUrl).toBe('https://custom-staging.auth.dev');
  });

  it('throws fail-fast error when secrets are missing in non-local environment', () => {
    process.env.APP_ENV = 'prod';
    delete process.env.VAULT_MASTER_KEY;
    delete process.env.TOKEN_EXCHANGE_SECRET;
    delete process.env.SESSION_SECRET;
    delete process.env.TOKEN_SIGNING_KEY_PEM;

    expect(() => getConfig()).toThrow(/Missing required secrets for prod/);
  });

  it('falls back to local for invalid APP_ENV', () => {
    process.env.APP_ENV = 'invalid_environment' as never;
    const config = getConfig();
    expect(config.appEnv).toBe('local');
  });

  it('includes tokenSigningKeyPem in missing secrets list when only it is missing in prod', () => {
    process.env.APP_ENV = 'prod';
    process.env.VAULT_MASTER_KEY = 'vkey-32-chars-long-test-key-here!';
    process.env.TOKEN_EXCHANGE_SECRET = 'exchange-secret';
    process.env.SESSION_SECRET = 'session-secret-at-least-32-chars!';
    delete process.env.TOKEN_SIGNING_KEY_PEM;
    process.env.TOKEN_SIGNING_KEY_PATH = '/path/does/not/exist.pem';

    expect(() => getConfig()).toThrow(/TOKEN_SIGNING_KEY_PEM \/ TOKEN_SIGNING_KEY_PATH/);
  });

  it('reads key from TOKEN_SIGNING_KEY_PATH when present', async () => {
    const path = await import('node:path');
    delete process.env.TOKEN_SIGNING_KEY_PEM;
    process.env.TOKEN_SIGNING_KEY_PATH = path.resolve(process.cwd(), 'package.json');

    const config = getConfig();
    expect(config.tokenSigningKeyPem).toContain('pesu-oauth2');
  });

  it('handles read error from TOKEN_SIGNING_KEY_PATH gracefully', async () => {
    const path = await import('node:path');
    delete process.env.TOKEN_SIGNING_KEY_PEM;
    // Reading a directory with readFileSync throws EISDIR
    process.env.TOKEN_SIGNING_KEY_PATH = path.resolve(process.cwd(), 'src');

    const config = getConfig();
    expect(config.tokenSigningKeyPem).toBeUndefined();
  });
});

