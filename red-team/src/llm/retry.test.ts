import { describe, expect, it, vi } from 'vitest';
import { BackendError, isTransient, parseRetryAfter } from './errors.js';
import { withRetry } from './retry.js';

const transient = (status: number) => new BackendError('test', 'unknown', status, 'rate limited');
const down = () => new BackendError('test', 'backend-down', 0, 'socket hang up');

describe('isTransient', () => {
  it('flags 429 and 502/503/504 and backend-down', () => {
    expect(isTransient(transient(429))).toBe(true);
    expect(isTransient(transient(503))).toBe(true);
    expect(isTransient(down())).toBe(true);
  });
  it('does not flag 4xx (except 429), 500, or plain errors', () => {
    expect(isTransient(transient(400))).toBe(false);
    expect(isTransient(transient(401))).toBe(false);
    expect(isTransient(transient(500))).toBe(false);
    expect(isTransient(new Error('boom'))).toBe(false);
  });
});

describe('parseRetryAfter', () => {
  it('parses delta-seconds', () => {
    expect(parseRetryAfter('2')).toBe(2000);
  });
  it('parses an HTTP-date relative to now', () => {
    const now = Date.parse('2026-01-01T00:00:00Z');
    expect(parseRetryAfter('Thu, 01 Jan 2026 00:00:05 GMT', now)).toBe(5000);
  });
  it('returns undefined for missing/garbage', () => {
    expect(parseRetryAfter(null)).toBeUndefined();
    expect(parseRetryAfter('soon')).toBeUndefined();
  });
});

describe('withRetry', () => {
  const noSleep = vi.fn(async () => {});

  it('returns immediately on success without retrying', async () => {
    const fn = vi.fn(async () => 'ok');
    expect(await withRetry(fn, { sleep: noSleep })).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries transient failures up to the limit then succeeds', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(transient(429))
      .mockRejectedValueOnce(transient(503))
      .mockResolvedValueOnce('done');
    const onRetry = vi.fn();
    expect(await withRetry(fn, { sleep: noSleep, onRetry })).toBe('done');
    expect(fn).toHaveBeenCalledTimes(3);
    expect(onRetry).toHaveBeenCalledTimes(2);
  });

  it('gives up after exhausting retries and rethrows the last error', async () => {
    const fn = vi.fn().mockRejectedValue(transient(429));
    await expect(withRetry(fn, { retries: 2, sleep: noSleep })).rejects.toThrow(/429/);
    expect(fn).toHaveBeenCalledTimes(3); // 1 + 2 retries
  });

  it('does not retry a non-transient error', async () => {
    const fn = vi.fn().mockRejectedValue(transient(400));
    await expect(withRetry(fn, { sleep: noSleep })).rejects.toThrow(/400/);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('uses exponential backoff and honors a larger Retry-After', async () => {
    const delays: number[] = [];
    const sleep = vi.fn(async (ms: number) => {
      delays.push(ms);
    });
    const withRA = transient(429);
    withRA.retryAfterMs = 9000; // larger than the computed 500ms first step
    const fn = vi
      .fn()
      .mockRejectedValueOnce(transient(429)) // backoff 500 (+ jitter)
      .mockRejectedValueOnce(withRA) // Retry-After 9000 wins
      .mockResolvedValueOnce('ok');
    await withRetry(fn, { sleep, baseDelayMs: 500, maxDelayMs: 8000 });
    // First wait is the 500ms step plus a sub-step jitter; the second is the
    // server-advised 9000ms (well under the 30s ceiling, so it passes through).
    expect(delays[0]).toBeGreaterThanOrEqual(500);
    expect(delays[0]).toBeLessThan(1000);
    expect(delays[1]).toBe(9000);
  });

  it('clamps an absurd Retry-After to the 30s ceiling', async () => {
    const delays: number[] = [];
    const sleep = vi.fn(async (ms: number) => {
      delays.push(ms);
    });
    const withRA = transient(429);
    withRA.retryAfterMs = 3_600_000; // a bad proxy asking for an hour
    const fn = vi.fn().mockRejectedValueOnce(withRA).mockResolvedValueOnce('ok');
    await withRetry(fn, { sleep, baseDelayMs: 500, maxDelayMs: 8000 });
    expect(delays).toHaveLength(1);
    expect(delays[0]).toBe(30_000);
  });

  it('stops when the signal is already aborted', async () => {
    const fn = vi.fn().mockRejectedValue(transient(429));
    const ctrl = new AbortController();
    ctrl.abort();
    await expect(withRetry(fn, { sleep: noSleep, signal: ctrl.signal })).rejects.toThrow();
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
