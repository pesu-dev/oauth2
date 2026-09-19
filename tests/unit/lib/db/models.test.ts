import { describe, it, expect } from 'vitest';
import mongoose from 'mongoose';
import {
  User,
  Client,
  ClientTester,
  AuthCode,
  Consent,
  Vault,
  RefreshToken,
  ProductionRequest,
  Admin,
} from '@/lib/db/models/index';
import * as ModelsIndex from '@/lib/db/models/index';

describe('Mongoose Models Schema Validation', () => {
  it('exports all model schemas from index', () => {
    expect(ModelsIndex.User).toBeDefined();
    expect(ModelsIndex.Client).toBeDefined();
    expect(ModelsIndex.ClientTester).toBeDefined();
    expect(ModelsIndex.Consent).toBeDefined();
    expect(ModelsIndex.Vault).toBeDefined();
    expect(ModelsIndex.AuthCode).toBeDefined();
    expect(ModelsIndex.RefreshToken).toBeDefined();
    expect(ModelsIndex.ProductionRequest).toBeDefined();
    expect(ModelsIndex.Admin).toBeDefined();
  });

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

  it('supports public clients with null client_secret_hash', async () => {
    const publicClient = new Client({
      client_id: 'cli_public_app',
      name: 'Single Page App',
      owner_sub: 'usr_dev1',
      redirect_uris: ['https://spa.pesu.edu/callback'],
      token_endpoint_auth_method: 'none',
      client_secret_hash: null,
    });
    const err = await publicClient.validate().catch((e: unknown) => e);
    expect(err).toBeUndefined();
  });

  it('validates AuthCode TTL and fields', async () => {
    const code = new AuthCode({
      code_hash: 'code_hash_val',
      client_id: 'cli_123',
      sub: 'usr_123',
      mode: 'identity',
      redirect_uri: 'http://localhost:3000/cb',
      code_challenge: 'chal',
      expires_at: new Date(Date.now() + 600000),
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
      nonce: Buffer.alloc(12),
      ciphertext: Buffer.alloc(32),
      wrap_nonce: Buffer.alloc(12),
      wrapped_dek: Buffer.alloc(48),
      key_version: 1,
    });
    await expect(vault.validate()).resolves.toBeUndefined();

    const rt = new RefreshToken({
      token_hash: 'thash',
      family_id: 'fam_1',
      client_id: 'cli_1',
      sub: 'usr_1',
      expires_at: new Date(Date.now() + 3600000),
    });
    await expect(rt.validate()).resolves.toBeUndefined();

    const pr = new ProductionRequest({
      request_id: 'req_1',
      client_id: 'cli_1',
      requested_by_sub: 'usr_1',
      owner_sub: 'usr_1',
      justification: 'Production access needed',
    });
    await expect(pr.validate()).resolves.toBeUndefined();

    const admin = new Admin({ sub: 'usr_admin' });
    await expect(admin.validate()).resolves.toBeUndefined();
  });

  it('binds to the exact MongoDB collection names matching the Python version', () => {
    expect(User.collection.name).toBe('users');
    expect(Client.collection.name).toBe('clients');
    expect(ClientTester.collection.name).toBe('client_testers');
    expect(Consent.collection.name).toBe('consents');
    expect(Vault.collection.name).toBe('vault');
    expect(AuthCode.collection.name).toBe('authorization_codes');
    expect(RefreshToken.collection.name).toBe('refresh_tokens');
    expect(ProductionRequest.collection.name).toBe('production_requests');
    expect(Admin.collection.name).toBe('admins');
  });
});
