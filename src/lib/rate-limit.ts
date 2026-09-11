export class SlidingWindowRateLimiter {
  private limit: number;
  private windowSeconds: number;
  private hits: Map<string, number[]>;

  constructor({ limit, windowSeconds }: { limit: number; windowSeconds: number }) {
    this.limit = limit;
    this.windowSeconds = windowSeconds;
    this.hits = new Map();
  }

  allow(key: string): boolean {
    const now = Date.now() / 1000;
    const cutoff = now - this.windowSeconds;

    let bucket = this.hits.get(key);
    if (!bucket) {
      bucket = [];
      this.hits.set(key, bucket);
    }

    // Drop expired timestamps
    while (bucket.length > 0 && bucket[0] <= cutoff) {
      bucket.shift();
    }

    if (bucket.length >= this.limit) {
      return false;
    }

    bucket.push(now);
    return true;
  }

  reset(): void {
    this.hits.clear();
  }
}

// Default global limiters
export const loginLimiter = new SlidingWindowRateLimiter({ limit: 10, windowSeconds: 60 });
export const tokenLimiter = new SlidingWindowRateLimiter({ limit: 60, windowSeconds: 60 });
export const exchangeLimiter = new SlidingWindowRateLimiter({ limit: 30, windowSeconds: 60 });

export function getClientIp(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) {
    const first = forwarded.split(',')[0].trim();
    if (first) return first;
  }
  return '127.0.0.1';
}
