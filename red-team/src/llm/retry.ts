// Exponential-backoff retry for transient LLM-backend failures (rate limits,
// 5xx blips, daemon mid-restart). Only errors classified as transient by
// errors.isTransient are retried; everything else (auth failures, bad requests,
// aborts) propagates immediately. A server-advised Retry-After always wins over
// the computed backoff when it asks us to wait longer.

import { BackendError, isTransient } from './errors.js';

export interface RetryOptions {
  /** Max additional attempts after the first try (default 2 → up to 3 calls). */
  retries?: number;
  /** First backoff step in ms; doubles each attempt (default 500). */
  baseDelayMs?: number;
  /** Upper bound on a single backoff wait (default 8000). */
  maxDelayMs?: number;
  /** Injectable sleep so tests don't wait real time. */
  sleep?: (ms: number) => Promise<void>;
  /** Cancels pending waits and stops further attempts. */
  signal?: AbortSignal;
  /** Observability hook fired before each retry wait. */
  onRetry?: (info: { attempt: number; delayMs: number; err: unknown }) => void;
}

/** Ceiling for server-advised Retry-After waits. A misbehaving proxy can echo
 *  an absurd Retry-After (minutes/hours); clamp it so one bad response can't
 *  stall the agent for far longer than our own backoff ever would. */
const MAX_RETRY_AFTER_MS = 30_000;

const defaultSleep = (ms: number, signal?: AbortSignal): Promise<void> =>
  new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new Error('aborted'));
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(t);
        reject(new Error('aborted'));
      },
      { once: true },
    );
  });

/**
 * Run `fn`, retrying on transient backend errors with exponential backoff.
 * Returns `fn`'s result, or rethrows the last error once attempts are exhausted
 * or the error is non-transient.
 */
export async function withRetry<T>(fn: () => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const retries = opts.retries ?? 2;
  const baseDelayMs = opts.baseDelayMs ?? 500;
  const maxDelayMs = opts.maxDelayMs ?? 8000;
  const sleep = opts.sleep ?? ((ms: number) => defaultSleep(ms, opts.signal));

  let attempt = 0;
  while (true) {
    try {
      return await fn();
    } catch (err) {
      if (opts.signal?.aborted) throw err;
      if (attempt >= retries || !isTransient(err)) throw err;
      // Exponential backoff plus a little jitter so concurrent callers hitting
      // the same rate limit don't all wake and re-fire in lockstep.
      const backoff = Math.min(maxDelayMs, baseDelayMs * 2 ** attempt);
      const jittered = backoff + Math.random() * baseDelayMs;
      const advised = err instanceof BackendError ? (err.retryAfterMs ?? 0) : 0;
      const delayMs = Math.max(jittered, Math.min(advised, MAX_RETRY_AFTER_MS));
      opts.onRetry?.({ attempt: attempt + 1, delayMs, err });
      await sleep(delayMs);
      attempt += 1;
    }
  }
}
