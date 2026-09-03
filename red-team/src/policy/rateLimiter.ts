export interface RateLimitConfig {
  requestsPerSecond?: number;
  requestsPerMinute?: number;
  burst?: number;
}

export type RateLimitResult = 'allow' | 'wait' | 'deny';

interface Bucket {
  tokens: number;
  lastRefill: number;
  requestTimes: number[];
}

export class RateLimiter {
  private readonly buckets = new Map<string, Bucket>();
  private readonly config: RateLimitConfig;

  constructor(config: RateLimitConfig = {}) {
    this.config = config;
  }

  acquire(origin: string): RateLimitResult {
    if (!this.config.requestsPerSecond && !this.config.requestsPerMinute) {
      return 'allow';
    }

    const now = Date.now();
    let bucket = this.buckets.get(origin);
    if (!bucket) {
      bucket = { tokens: this.getBurst(), lastRefill: now, requestTimes: [] };
      this.buckets.set(origin, bucket);
    }

    this.refill(bucket, now);
    this.pruneOldRequests(bucket, now);

    if (
      this.config.requestsPerMinute &&
      bucket.requestTimes.length >= this.config.requestsPerMinute
    ) {
      return 'deny';
    }

    if (this.config.requestsPerSecond && bucket.tokens <= 0) {
      return 'wait';
    }

    bucket.tokens -= 1;
    bucket.requestTimes.push(now);
    return 'allow';
  }

  async waitAndAcquire(origin: string, signal?: AbortSignal): Promise<RateLimitResult> {
    const maxWaitMs = 30_000;
    const start = Date.now();

    while (Date.now() - start < maxWaitMs) {
      if (signal?.aborted) return 'deny';
      const result = this.acquire(origin);
      if (result === 'allow') return 'allow';
      if (result === 'deny') return 'deny';
      await sleep(50);
    }
    return 'deny';
  }

  reset(origin?: string): void {
    if (origin) {
      this.buckets.delete(origin);
    } else {
      this.buckets.clear();
    }
  }

  private getBurst(): number {
    return this.config.burst ?? this.config.requestsPerSecond ?? 10;
  }

  private refill(bucket: Bucket, now: number): void {
    if (!this.config.requestsPerSecond) return;
    const elapsed = now - bucket.lastRefill;
    const refillAmount = (elapsed / 1000) * this.config.requestsPerSecond;
    bucket.tokens = Math.min(this.getBurst(), bucket.tokens + refillAmount);
    bucket.lastRefill = now;
  }

  private pruneOldRequests(bucket: Bucket, now: number): void {
    const windowMs = 60_000;
    bucket.requestTimes = bucket.requestTimes.filter((t) => now - t < windowMs);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
