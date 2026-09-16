import { describe, it, expect, vi, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import fs from 'node:fs';
import { connectToDatabase } from '@/lib/db/connection';
import * as configHelper from '@/lib/config';

describe('Database Connection Singleton', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    if (global.mongooseCache) {
      global.mongooseCache.conn = null;
      global.mongooseCache.promise = null;
    }
  });

  it('returns cached connection when already connected', async () => {
    const fakeConn = {} as typeof mongoose;
    global.mongooseCache!.conn = fakeConn;

    const connectSpy = vi.spyOn(mongoose, 'connect');
    const result = await connectToDatabase();

    expect(result).toBe(fakeConn);
    expect(connectSpy).not.toHaveBeenCalled();
  });

  it('connects with X.509 TLS options when cert exists', async () => {
    vi.spyOn(configHelper, 'getConfig').mockReturnValue({
      mongoUri: 'mongodb+srv://cluster.example.com',
      dbName: 'oauth2_test',
      mongoX509CertPath: '/certs/mongo.pem',
    } as ReturnType<typeof configHelper.getConfig>);

    vi.spyOn(fs, 'existsSync').mockReturnValue(true);
    const mockMongoose = {} as typeof mongoose;
    const connectSpy = vi.spyOn(mongoose, 'connect').mockResolvedValue(mockMongoose);

    const result = await connectToDatabase();
    expect(result).toBe(mockMongoose);
    expect(connectSpy).toHaveBeenCalledWith(
      'mongodb+srv://cluster.example.com',
      expect.objectContaining({
        tls: true,
        authMechanism: 'MONGODB-X509',
        authSource: '$external',
      })
    );
  });

  it('resets cached promise on connection error and re-throws', async () => {
    vi.spyOn(mongoose, 'connect').mockRejectedValueOnce(new Error('Connection failed'));

    await expect(connectToDatabase()).rejects.toThrow('Connection failed');
    expect(global.mongooseCache!.promise).toBeNull();
  });

  it('connects without TLS X.509 options when cert is absent', async () => {
    vi.spyOn(configHelper, 'getConfig').mockReturnValue({
      mongoUri: 'mongodb+srv://cluster.example.com',
      dbName: 'oauth2_test',
      mongoX509CertPath: undefined,
    } as ReturnType<typeof configHelper.getConfig>);

    const mockMongoose = {} as typeof mongoose;
    const connectSpy = vi.spyOn(mongoose, 'connect').mockResolvedValue(mockMongoose);

    const result = await connectToDatabase();
    expect(result).toBe(mockMongoose);
    expect(connectSpy).toHaveBeenCalledWith(
      'mongodb+srv://cluster.example.com',
      {
        dbName: 'oauth2_test',
        bufferCommands: false,
      }
    );
  });

  it('reuses existing in-flight promise when called concurrently', async () => {
    const mockMongoose = {} as typeof mongoose;
    vi.spyOn(mongoose, 'connect').mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve(mockMongoose), 10))
    );

    const p1 = connectToDatabase();
    const p2 = connectToDatabase();
    const [res1, res2] = await Promise.all([p1, p2]);
    expect(res1).toBe(mockMongoose);
    expect(res2).toBe(mockMongoose);
  });

  it('preserves existing global.mongooseCache when module initializes', async () => {
    const existingCache = { conn: null, promise: null };
    global.mongooseCache = existingCache;
    vi.resetModules();
    const { connectToDatabase: freshConnect } = await import('@/lib/db/connection');
    expect(freshConnect).toBeDefined();
    expect(global.mongooseCache).toBe(existingCache);
  });
});
