// Output-cap tests for the browser_capture_* tools.

import { describe, expect, it } from 'vitest';
import type { CaptureStore } from '../browser/store.js';
import {
  BrowserCaptureBurpTasksTool,
  BrowserCaptureEndpointsTool,
  BrowserCaptureRequestsTool,
} from './browserCapture.js';

const signal = new AbortController().signal;
// The capture tools don't gate, so a bare prompter object is never consulted.
const prompter = {} as never;

describe('BrowserCaptureRequestsTool limit clamp', () => {
  it('clamps an oversized limit to 500 before querying the store', async () => {
    let seenLimit = -1;
    const store = {
      listRequests: (filter?: { limit?: number }) => {
        seenLimit = filter?.limit ?? -1;
        return [];
      },
    } as unknown as CaptureStore;

    await new BrowserCaptureRequestsTool(store).run({ limit: 99999 }, signal, prompter);
    expect(seenLimit).toBe(500);
  });

  it('uses the default 50 when no limit is provided', async () => {
    let seenLimit = -1;
    const store = {
      listRequests: (filter?: { limit?: number }) => {
        seenLimit = filter?.limit ?? -1;
        return [];
      },
    } as unknown as CaptureStore;

    await new BrowserCaptureRequestsTool(store).run({}, signal, prompter);
    expect(seenLimit).toBe(50);
  });

  it('serializes requests compactly (no pretty-print indentation)', async () => {
    const store = {
      listRequests: () => [
        {
          id: 'wr:1',
          method: 'GET',
          url: 'https://x/a',
          status: 200,
          type: 'xhr',
          source: 'webRequest',
          elapsedMs: 5,
          receivedAt: 0,
        },
      ],
    } as unknown as CaptureStore;

    const out = await new BrowserCaptureRequestsTool(store).run({}, signal, prompter);
    // Compact JSON has no newline+indent between fields.
    expect(out).not.toContain('\n  ');
    expect(out).toContain('"id":"wr:1"');
  });
});

describe('BrowserCaptureEndpointsTool listing caps', () => {
  it('limits the number of endpoints listed and notes the omission', async () => {
    const eps = Array.from({ length: 600 }, (_, i) => ({
      method: 'GET',
      url: `https://x/${i}`,
      queryParams: [],
      bodyParams: [],
    }));
    const store = { listEndpoints: () => eps } as unknown as CaptureStore;

    const out = await new BrowserCaptureEndpointsTool(store).run({}, signal, prompter);
    expect(out).toContain('more omitted; showing first 200');
    // No pretty-print indentation.
    expect(out).not.toContain('\n  ');
  });
});

describe('BrowserCaptureBurpTasksTool listing caps', () => {
  it('returns a friendly message when empty', async () => {
    const store = { listBurpTasks: () => [] } as unknown as CaptureStore;
    const out = await new BrowserCaptureBurpTasksTool(store).run({}, signal, prompter);
    expect(out).toBe('No Burp tasks queued.');
  });

  it('caps the number of tasks listed', async () => {
    const tasks = Array.from({ length: 250 }, (_, i) => ({ id: i, createdAt: 0 }));
    const store = { listBurpTasks: () => tasks } as unknown as CaptureStore;
    const out = await new BrowserCaptureBurpTasksTool(store).run({}, signal, prompter);
    expect(out).toContain('more omitted; showing first 200');
  });
});
