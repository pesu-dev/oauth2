import { describe, it, expect, vi } from 'vitest';
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

  it('drops expired timestamps when window expires', () => {
    vi.useFakeTimers();
    try {
      const limiter = new SlidingWindowRateLimiter({ limit: 2, windowSeconds: 60 });
      expect(limiter.allow('ip-1')).toBe(true);
      expect(limiter.allow('ip-1')).toBe(true);
      expect(limiter.allow('ip-1')).toBe(false);

      vi.advanceTimersByTime(61000);

      expect(limiter.allow('ip-1')).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('extracts client IP from x-forwarded-for or falls back to 127.0.0.1', async () => {
    const { getClientIp } = await import('@/lib/rate-limit');
    const req1 = new Request('http://localhost', {
      headers: { 'x-forwarded-for': '203.0.113.195, 70.41.3.18' },
    });
    expect(getClientIp(req1)).toBe('203.0.113.195');

    const req2 = new Request('http://localhost', {
      headers: { 'x-forwarded-for': '' },
    });
    expect(getClientIp(req2)).toBe('127.0.0.1');

    const req3 = new Request('http://localhost');
    expect(getClientIp(req3)).toBe('127.0.0.1');
  });
});
