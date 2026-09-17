#!/usr/bin/env node
/**
 * Seed an admin sub into the MongoDB admins collection.
 *
 * Usage:
 *   node scripts/seed_admin.mjs --sub usr_...
 *
 * Environment:
 *   APP_ENV   - 'local' (default) | 'staging' | 'prod'
 *               Selects the Atlas cluster URI (mirrors src/lib/config.ts).
 *   MONGODB_URI - Override the derived cluster URI if set.
 *
 * For non-local environments the Atlas cluster requires X.509 auth;
 * set MONGO_X509_CERT_PATH to the path of your client PEM file.
 */
import fs from 'node:fs';
import mongoose from 'mongoose';

// ── Mirrors ENVIRONMENT_DEFAULTS in src/lib/config.ts ──────────────────────
const ENVIRONMENT_DEFAULTS = {
  prod: 'mongodb+srv://pesudev.nkzgere.mongodb.net/',
  staging: 'mongodb+srv://pesudev.andmjbp.mongodb.net/',
  local: 'mongodb+srv://pesudev.andmjbp.mongodb.net/',
};

const rawEnv = process.env.APP_ENV || 'local';
const appEnv = ['local', 'staging', 'prod'].includes(rawEnv) ? rawEnv : 'local';
const defaultMongoUri = ENVIRONMENT_DEFAULTS[appEnv];
const mongoUri = process.env.MONGODB_URI || defaultMongoUri;

// ── CLI args ────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
let sub = null;

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--sub') {
    sub = args[++i];
  }
}

if (!sub || !sub.startsWith('usr_')) {
  console.error('Usage: node scripts/seed_admin.mjs --sub usr_...');
  process.exit(1);
}

// ── X.509 client auth (required for Atlas clusters) ─────────────────────────
const certPath = process.env.MONGO_X509_CERT_PATH;
const connectOptions = {};
if (certPath) {
  if (!fs.existsSync(certPath)) {
    console.error(`MONGO_X509_CERT_PATH set but file not found: ${certPath}`);
    process.exit(1);
  }
  const pem = fs.readFileSync(certPath, 'utf-8');
  connectOptions.tlsCertificateKeyFile = certPath;
  connectOptions.authMechanism = 'MONGODB-X509';
  connectOptions.authSource = '$external';
  void pem; // referenced via tlsCertificateKeyFile
}

// ── Connect and seed ────────────────────────────────────────────────────────
console.log(`Connecting to MongoDB (APP_ENV=${appEnv})…`);

try {
  await mongoose.connect(mongoUri, connectOptions);

  const AdminSchema = new mongoose.Schema(
    { sub: { type: String, required: true, unique: true } },
    { timestamps: { createdAt: 'created_at', updatedAt: false } }
  );

  const Admin = mongoose.models.Admin || mongoose.model('Admin', AdminSchema, 'admins');
  const result = await Admin.updateOne({ sub }, { $setOnInsert: { sub } }, { upsert: true });

  if (result.upsertedCount > 0) {
    console.log(`✓ Seeded new admin: sub=${sub}`);
  } else {
    console.log(`✓ Admin already exists (no change): sub=${sub}`);
  }
} catch (err) {
  console.error(`Failed to seed admin: ${err.message}`);
  process.exit(1);
} finally {
  await mongoose.disconnect();
}
