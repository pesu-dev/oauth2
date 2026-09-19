import fs from 'node:fs';
import path from 'node:path';
import mongoose from 'mongoose';
import { getConfig } from '@/lib/config';

interface MongooseCache {
  conn: typeof mongoose | null;
  promise: Promise<typeof mongoose> | null;
}

declare global {
  var mongooseCache: MongooseCache | undefined;
}

const cached: MongooseCache = global.mongooseCache || { conn: null, promise: null };

if (!global.mongooseCache) {
  global.mongooseCache = cached;
}

export async function connectToDatabase(): Promise<typeof mongoose> {
  if (cached.conn) {
    return cached.conn;
  }

  if (!cached.promise) {
    const config = getConfig();
    const hasCert = config.mongoX509CertPath && fs.existsSync(config.mongoX509CertPath);
    const opts: mongoose.ConnectOptions = {
      dbName: config.dbName,
      bufferCommands: false,
      ...(hasCert
        ? {
            tls: true,
            tlsCertificateKeyFile: path.resolve(config.mongoX509CertPath!),
            authMechanism: 'MONGODB-X509',
            authSource: '$external',
          }
        : {}),
    };

    cached.promise = mongoose.connect(config.mongoUri, opts).then((m) => {
      return m;
    });
  }

  try {
    cached.conn = await cached.promise;
  } catch (e) {
    cached.promise = null;
    throw e;
  }

  return cached.conn;
}
