import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';
import mongoose from 'mongoose';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { setupIntegrationMongo, teardownIntegrationMongo } from './setup';
import { Client } from '@/lib/db/models';

const run = promisify(execFile);

describe('scripts/seed_client.mjs (Integration)', () => {
  beforeAll(async () => {
    await setupIntegrationMongo();
  }, 60000);

  afterAll(async () => {
    await teardownIntegrationMongo();
  });

  // The script is plain .mjs and inserts raw documents, so this guards it against drifting from the model.
  it('inserts a document the Client model accepts', async () => {
    const { stdout } = await run(process.execPath, [path.resolve('scripts/seed_client.mjs'), '--status', 'testing'], {
      env: { ...process.env, MONGODB_URI: process.env.MONGODB_URI, DB_NAME: 'oauth2' },
    });
    const clientId = stdout.match(/client_id:\s+(\S+)/)?.[1];
    expect(clientId).toMatch(/^cli_/);

    const raw = await mongoose.connection.useDb('oauth2').collection('clients').findOne({ client_id: clientId });
    expect(raw).not.toBeNull();
    expect(new Client(raw).validateSync()).toBeUndefined();

    const unknownFields = Object.keys(raw!).filter((field) => !Client.schema.path(field));
    expect(unknownFields).toEqual([]);
  });
});
