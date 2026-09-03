// Backend error classification. The UI cares about three categories:
// "no model loaded" (lmstudio's typical first-launch state), "model not
// found" (ollama pull missing), and "backend unreachable" (daemon down).
// Anything else is just a generic BackendError so the raw upstream message
// still reaches the log file.
//
// The classifier pattern set is the source of truth for these categories;
// keep it in sync with the backend error shapes.

export type ErrorCategory = 'model-not-loaded' | 'model-not-found' | 'backend-down' | 'unknown';

export class BackendError extends Error {
  readonly backend: string;
  readonly category: ErrorCategory;
  readonly statusCode: number;
  readonly detail: string;
  /** Server-advised wait before retrying (from a Retry-After header), in ms. */
  retryAfterMs?: number;

  constructor(backend: string, category: ErrorCategory, statusCode: number, detail: string) {
    const msg =
      statusCode !== 0 ? `${backend} error ${statusCode}: ${detail}` : `${backend}: ${detail}`;
    super(msg);
    this.name = 'BackendError';
    this.backend = backend;
    this.category = category;
    this.statusCode = statusCode;
    this.detail = detail;
  }
}

/**
 * True for errors worth retrying with backoff: rate limits (429), request
 * timeouts (408), and transient upstream failures (502/503/504), plus a
 * `backend-down` transport error (the daemon may be mid-restart). A plain 500
 * is treated as deterministic and NOT retried, since it usually reflects a bad
 * request rather than a blip.
 */
export function isTransient(err: unknown): boolean {
  if (!(err instanceof BackendError)) return false;
  if (err.category === 'backend-down') return true;
  return err.statusCode === 429 || [408, 502, 503, 504].includes(err.statusCode);
}

/**
 * Parse a Retry-After header (delta-seconds or an HTTP-date) into ms relative to
 * `now`. Returns undefined when absent/unparseable so the caller falls back to
 * its own backoff schedule. `now` is injectable for deterministic tests.
 */
export function parseRetryAfter(
  header: string | null | undefined,
  now = Date.now(),
): number | undefined {
  if (!header) return undefined;
  const trimmed = header.trim();
  if (/^\d+$/.test(trimmed)) return Number(trimmed) * 1000;
  const when = Date.parse(trimmed);
  if (Number.isNaN(when)) return undefined;
  return Math.max(0, when - now);
}

/**
 * Classify a transport or non-2xx response into a BackendError. Pass
 * `transportErr` (from fetch/undici) OR `statusCode` + `body` (from a
 * non-2xx response), not both — pass undefined for the unused half.
 */
export function classifyBackend(
  backend: string,
  transportErr: unknown,
  statusCode: number,
  body: string | undefined,
): BackendError {
  if (transportErr !== undefined && transportErr !== null) {
    const msg = transportErr instanceof Error ? transportErr.message : String(transportErr);
    const lower = msg.toLowerCase();
    if (
      lower.includes('econnrefused') ||
      lower.includes('connection refused') ||
      lower.includes('enotfound') ||
      lower.includes('no such host') ||
      lower.includes('etimedout') ||
      lower.includes('i/o timeout') ||
      lower.includes('network is unreachable') ||
      lower.includes('socket hang up') ||
      lower.includes('fetch failed')
    ) {
      return new BackendError(backend, 'backend-down', 0, msg);
    }
    return new BackendError(backend, 'unknown', 0, msg);
  }

  // Extract a human message from whichever error envelope the backend used.
  let msg = (body ?? '').trim();
  if (body) {
    try {
      const parsed = JSON.parse(body) as {
        error?: string | { message?: string };
      };
      if (typeof parsed.error === 'string' && parsed.error) {
        msg = parsed.error;
      } else if (parsed.error && typeof parsed.error === 'object' && parsed.error.message) {
        msg = parsed.error.message;
      }
    } catch {
      // Not JSON — keep raw body as msg.
    }
  }

  const lower = msg.toLowerCase();
  // Rate-limit phrasing in the body. Some proxies (OpenRouter, ...) surface a
  // transient rate limit inside an HTTP 200, where `statusCode` doesn't signal
  // it. Map it to 429 so isTransient treats it as retryable; real error
  // statuses keep their own code (already transient when they should be).
  if (
    lower.includes('rate limit') ||
    lower.includes('rate_limit') ||
    lower.includes('too many requests') ||
    lower.includes('quota exceeded')
  ) {
    return new BackendError(backend, 'unknown', statusCode < 400 ? 429 : statusCode, msg);
  }
  if (
    lower.includes('no models loaded') ||
    lower.includes('no model loaded') ||
    lower.includes('model not loaded') ||
    lower.includes('please load a model')
  ) {
    return new BackendError(backend, 'model-not-loaded', statusCode, msg);
  }
  if (
    lower.includes('try pulling it first') ||
    lower.includes('model not found') ||
    lower.includes('does not exist') ||
    (lower.includes('model') && lower.includes('not found'))
  ) {
    return new BackendError(backend, 'model-not-found', statusCode, msg);
  }
  return new BackendError(backend, 'unknown', statusCode, msg);
}
