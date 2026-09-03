import { describe, expect, it } from 'vitest';
import { RateLimiter } from './rateLimiter.js';

describe('RateLimiter', () => {
  it('allows when no limits configured', () => {
    const limiter = new RateLimiter({});
    expect(limiter.acquire('origin')).toBe('allow');
  });

  it('allows within RPS limit', () => {
    const limiter = new RateLimiter({ requestsPerSecond: 5 });
    expect(limiter.acquire('a')).toBe('allow');
    expect(limiter.acquire('a')).toBe('allow');
  });

  it('denies when per-minute limit exceeded', () => {
    const limiter = new RateLimiter({ requestsPerMinute: 3 });
    expect(limiter.acquire('a')).toBe('allow');
    expect(limiter.acquire('a')).toBe('allow');
    expect(limiter.acquire('a')).toBe('allow');
    expect(limiter.acquire('a')).toBe('deny');
  });

  it('per-origin isolation', () => {
    const limiter = new RateLimiter({ requestsPerMinute: 2 });
    expect(limiter.acquire('a')).toBe('allow');
    expect(limiter.acquire('a')).toBe('allow');
    expect(limiter.acquire('a')).toBe('deny');
    // Different origin is unaffected
    expect(limiter.acquire('b')).toBe('allow');
  });

  it('burst allows initial burst', () => {
    const limiter = new RateLimiter({ requestsPerSecond: 1, burst: 5 });
    for (let i = 0; i < 5; i++) {
      expect(limiter.acquire('a')).toBe('allow');
    }
  });

  it('reset clears a specific origin', () => {
    const limiter = new RateLimiter({ requestsPerMinute: 1 });
    expect(limiter.acquire('a')).toBe('allow');
    expect(limiter.acquire('a')).toBe('deny');
    limiter.reset('a');
    expect(limiter.acquire('a')).toBe('allow');
  });

  it('reset() clears all origins', () => {
    const limiter = new RateLimiter({ requestsPerMinute: 1 });
    expect(limiter.acquire('a')).toBe('allow');
    expect(limiter.acquire('b')).toBe('allow');
    limiter.reset();
    expect(limiter.acquire('a')).toBe('allow');
    expect(limiter.acquire('b')).toBe('allow');
  });

  it('deterministic behavior', () => {
    const limiter = new RateLimiter({ requestsPerSecond: 2, burst: 2 });
    const results: string[] = [];
    for (let i = 0; i < 5; i++) {
      results.push(limiter.acquire('a'));
    }
    expect(results.filter((r) => r === 'allow').length).toBe(2);
  });
});
