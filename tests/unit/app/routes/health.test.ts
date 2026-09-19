import { describe, it, expect } from 'vitest';
import { GET as getHealth } from '@/app/health/route';

describe('Health Check Endpoint (/health)', () => {
  it('returns HTTP 200 and status ok', async () => {
    const res = await getHealth();
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toEqual({ status: 'ok' });
  });
});
