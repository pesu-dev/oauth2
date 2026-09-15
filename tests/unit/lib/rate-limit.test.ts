import { describe, it, expect } from 'vitest';
import { SlidingWindowRateLimiter } from '@/lib/rate-limit';

describe('SlidingWindowRateLimiter', () => {
  it('allows requests within limit and rejects when exceeded', () => {
    const limiter = new SlidingWindowRateLimiter({ limit: 3, windowSeconds: 60 });
    expect(limiter.allow('ip-1')).toBe(true);
    expect(limiter.allow('ip-1')).toBe(true);
    expect(limiter.allow('ip-1')).toBe(true);
    expect(limiter.allow('ip-1')).toBe(false);

    // Key isolation
    expect(limiter.allow('ip-2')).toBe(true);
  });

  it('resets hits correctly', () => {
    const limiter = new SlidingWindowRateLimiter({ limit: 1, windowSeconds: 60 });
    expect(limiter.allow('ip-1')).toBe(true);
    expect(limiter.allow('ip-1')).toBe(false);

    limiter.reset();
    expect(limiter.allow('ip-1')).toBe(true);
  });
});
