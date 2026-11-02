#!/usr/bin/env node
/**
 * Seed a confidential OIDC client into a LOCAL MongoDB (see docker-compose.yml).
 *
 * Usage:
 *   node scripts/seed_client.mjs [--name "Local Test App"] \
 *     [--redirect-uri http://localhost:9000/callback] \
 *     [--status production|testing] [--owner usr_...] [--delegated]
 *
 * Environment:
 *   MONGODB_URI - defaults to mongodb://127.0.0.1:27017/?directConnection=true
 *   DB_NAME     - defaults to oauth2
 *
 * Prints the client_id and the raw client_secret once. Refuses non-local URIs.
 */
import { hash } from '@node-rs/argon2';
import mongoose from 'mongoose';
import { nanoid } from 'nanoid';

const mongoUri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/?directConnection=true';
const dbName = process.env.DB_NAME || 'oauth2';

// ── Mirrors ARGON2_CONFIG in src/lib/crypto/hash.ts ────────────────────────
const ARGON2_CONFIG = { memoryCost: 19456, timeCost: 2, parallelism: 1 };

// ── CLI args ────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const opts = {
  name: 'Local Test App',
  redirectUri: 'http://localhost:9000/callback',
  status: 'production',
  owner: 'usr_local_seed',
  delegated: false,
};

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--name') opts.name = args[++i];
  else if (args[i] === '--redirect-uri') opts.redirectUri = args[++i];
  else if (args[i] === '--status') opts.status = args[++i];
  else if (args[i] === '--owner') opts.owner = args[++i];
  else if (args[i] === '--delegated') opts.delegated = true;
}

if (!['production', 'testing'].includes(opts.status)) {
  console.error('--status must be production or testing');
  process.exit(1);
}

const host = new URL(mongoUri.replace(/^mongodb(\+srv)?:/, 'http:')).hostname;
if (!['localhost', '127.0.0.1'].includes(host)) {
  console.error(`Refusing to seed a non-local MongoDB (${host}). This script is for local development only.`);
  process.exit(1);
}

// ── Connect and seed ────────────────────────────────────────────────────────
console.log(`Connecting to MongoDB (${host}, db=${dbName})…`);

try {
  await mongoose.connect(mongoUri, { dbName });

  const clientId = `cli_${nanoid()}`;
  const clientSecret = `sec_${nanoid(32)}`;
  const now = new Date();

  await mongoose.connection.collection('clients').insertOne({
    client_id: clientId,
    client_secret_hash: await hash(clientSecret, ARGON2_CONFIG),
    name: opts.name,
    owner_sub: opts.owner,
    redirect_uris: [opts.redirectUri],
    publishing_status: opts.status,
    delegated_allowed: opts.delegated,
    token_endpoint_auth_method: 'client_secret_post',
    created_at: now,
    updated_at: now,
  });

  console.log('✓ Seeded client');
  console.log(`  client_id:     ${clientId}`);
  console.log(`  client_secret: ${clientSecret}`);
  console.log(`  redirect_uri:  ${opts.redirectUri}`);
  console.log(`  status:        ${opts.status}${opts.delegated ? ' (delegated allowed)' : ''}`);
} catch (err) {
  console.error(`Failed to seed client: ${err.message}`);
  process.exit(1);
} finally {
  await mongoose.disconnect();
}
