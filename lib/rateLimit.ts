type Bucket = {
  count: number;
  startedAt: number;
};

export class InMemoryRateLimiter {
  private readonly store = new Map<string, Bucket>();

  constructor(
    private readonly maxRequests: number,
    private readonly windowMs: number,
  ) {}

  consume(key: string): { allowed: boolean; remaining: number; resetAt: number } {
    const now = Date.now();
    const current = this.store.get(key);

    if (!current || now - current.startedAt >= this.windowMs) {
      const resetAt = now + this.windowMs;
      this.store.set(key, { count: 1, startedAt: now });
      return { allowed: true, remaining: this.maxRequests - 1, resetAt };
    }

    current.count += 1;
    const allowed = current.count <= this.maxRequests;
    const remaining = Math.max(0, this.maxRequests - current.count);
    const resetAt = current.startedAt + this.windowMs;

    this.prune(now);
    return { allowed, remaining, resetAt };
  }

  private prune(now: number): void {
    for (const [key, bucket] of this.store.entries()) {
      if (now - bucket.startedAt >= this.windowMs) {
        this.store.delete(key);
      }
    }
  }
}

export const extractRateLimiter = new InMemoryRateLimiter(10, 60_000);
export const batchExtractRateLimiter = new InMemoryRateLimiter(12_000, 60 * 60_000);
