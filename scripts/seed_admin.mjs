#!/usr/bin/env node
/**
 * Seed an admin sub into the MongoDB admins collection.
 */
import mongoose from 'mongoose';

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

const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/oauth2';

try {
  await mongoose.connect(mongoUri);
  const AdminSchema = new mongoose.Schema(
    { sub: { type: String, required: true, unique: true } },
    { timestamps: { createdAt: 'created_at', updatedAt: false } }
  );

  const Admin = mongoose.models.Admin || mongoose.model('Admin', AdminSchema, 'admins');
  await Admin.updateOne({ sub }, { $setOnInsert: { sub } }, { upsert: true });
  console.log(`Seeded admin sub=${sub}`);
} catch (err) {
  console.error(`Failed to seed admin: ${err.message}`);
  process.exit(1);
} finally {
  await mongoose.disconnect();
}
