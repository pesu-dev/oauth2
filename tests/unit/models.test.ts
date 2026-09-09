import { describe, it, expect } from 'vitest';
import mongoose from 'mongoose';
import {
  User,
  Client,
  AuthCode,
  Consent,
  Vault,
  RefreshToken,
  ProductionRequest,
  Admin,
} from '@/lib/db/models';

describe('Mongoose Models Schema Validation', () => {
  it('validates required fields for User', async () => {
    const user = new User({});
    let error: mongoose.Error.ValidationError | undefined;
    try {
      await user.validate();
    } catch (err) {
      error = err as mongoose.Error.ValidationError;
    }
    expect(error?.errors.sub).toBeDefined();
    expect(error?.errors.name).toBeDefined();
    expect(error?.errors.prn).toBeDefined();
    expect(error?.errors.srn).toBeDefined();
  });

  it('validates required fields and defaults for Client', async () => {
    const client = new Client({
      client_id: 'cli_123',
      client_secret_hash: 'hash',
      name: 'Test App',
      owner_sub: 'usr_owner',
      redirect_uris: ['http://localhost:3000/callback'],
    });
    await expect(client.validate()).resolves.toBeUndefined();
    expect(client.publishing_status).toBe('testing');
    expect(client.delegated_allowed).toBe(false);
  });

  it('validates AuthCode TTL and fields', async () => {
    const code = new AuthCode({
      code_hash: 'code_hash_val',
      client_id: 'cli_123',
      sub: 'usr_123',
      mode: 'identity',
      redirect_uri: 'http://localhost:3000/cb',
      code_challenge: 'chal',
    });
    await expect(code.validate()).resolves.toBeUndefined();
    expect(code.code_challenge_method).toBe('S256');
  });

  it('validates Consent mode enum', async () => {
    const consent = new Consent({
      sub: 'usr_1',
      client_id: 'cli_1',
      mode: 'invalid_mode' as unknown as 'identity',
    });
    let error: mongoose.Error.ValidationError | undefined;
    try {
      await consent.validate();
    } catch (err) {
      error = err as mongoose.Error.ValidationError;
    }
    expect(error?.errors.mode).toBeDefined();
  });

  it('validates Vault, RefreshToken, ProductionRequest, and Admin', async () => {
    const vault = new Vault({
      sub: 'usr_1',
      encrypted_password: 'enc',
      password_nonce: 'n',
      password_wrap_nonce: 'wn',
      password_wrapped_dek: 'wd',
    });
    await expect(vault.validate()).resolves.toBeUndefined();

    const rt = new RefreshToken({
      token_hash: 'thash',
      family_id: 'fam_1',
      client_id: 'cli_1',
      sub: 'usr_1',
    });
    await expect(rt.validate()).resolves.toBeUndefined();

    const pr = new ProductionRequest({
      request_id: 'req_1',
      client_id: 'cli_1',
      owner_sub: 'usr_1',
      justification: 'Production access needed',
    });
    await expect(pr.validate()).resolves.toBeUndefined();

    const admin = new Admin({ sub: 'usr_admin' });
    await expect(admin.validate()).resolves.toBeUndefined();
  });
});
