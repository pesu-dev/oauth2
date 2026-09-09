import fs from 'node:fs';
import { describe, it, expect } from 'vitest';
import { connectToDatabase } from '@/lib/db/connection';
import { User } from '@/lib/db/models';
import { getConfig } from '@/lib/config';

describe('smoke test', () => {
  it('verifies test environment works', () => {
    expect(1 + 1).toBe(2);
  });

  it('connects to Mongo Atlas with X.509 and queries users collection', async () => {
    const config = getConfig();
    if (!config.mongoX509CertPath || !fs.existsSync(config.mongoX509CertPath)) {
      return;
    }
    const conn = await connectToDatabase();
    expect(conn).toBeDefined();
    const count = await User.countDocuments();
    expect(typeof count).toBe('number');
  });
});
