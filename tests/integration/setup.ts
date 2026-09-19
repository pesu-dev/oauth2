import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { MongoDBContainer, StartedMongoDBContainer } from '@testcontainers/mongodb';
import mongoose from 'mongoose';

// Configure Colima socket override on macOS if present
const colimaSock = path.join(os.homedir(), '.colima', 'default', 'docker.sock');
if (fs.existsSync(colimaSock)) {
  if (!process.env.DOCKER_HOST) {
    process.env.DOCKER_HOST = `unix://${colimaSock}`;
  }
  if (!process.env.TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE) {
    process.env.TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE = '/var/run/docker.sock';
  }
}

let container: StartedMongoDBContainer | null = null;

export async function setupIntegrationMongo(): Promise<string> {
  if (container) {
    return container.getConnectionString();
  }

  container = await new MongoDBContainer('mongo:7').start();
  const uri = container.getConnectionString();
  process.env.MONGODB_URI = `${uri}/oauth2?directConnection=true`;

  // Provide default test secrets if not set
  process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'integration-test-session-secret-key-at-least-32b';
  process.env.VAULT_MASTER_KEY = process.env.VAULT_MASTER_KEY || 'super-secret-vault-master-key-32b';
  process.env.TOKEN_EXCHANGE_SECRET = process.env.TOKEN_EXCHANGE_SECRET || 'exchange-secret-super-safe-12345';
  process.env.APP_ENV = 'local';

  await mongoose.connect(process.env.MONGODB_URI);

  // Synchronize indexes so compound unique and TTL indexes are physically created on Mongo
  await mongoose.connection.syncIndexes();

  return uri;
}

export async function teardownIntegrationMongo(): Promise<void> {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
  if (container) {
    await container.stop();
    container = null;
  }
}

export async function resetDatabase(): Promise<void> {
  if (mongoose.connection.readyState !== 1) {
    return;
  }
  const collections = mongoose.connection.collections;
  for (const key of Object.keys(collections)) {
    await collections[key].deleteMany({});
  }
}
