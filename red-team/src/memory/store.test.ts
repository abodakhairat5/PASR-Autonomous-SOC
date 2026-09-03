import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MemoryStore, formatMemoryRecall } from './store.js';

let cwd: string;
let home: string;

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), 'pf-mem-cwd-'));
  home = mkdtempSync(join(tmpdir(), 'pf-mem-home-'));
});
afterEach(() => {
  rmSync(cwd, { recursive: true, force: true });
  rmSync(home, { recursive: true, force: true });
});

const store = () => new MemoryStore({ cwd, home });

describe('MemoryStore', () => {
  it('adds a fact and lists it', () => {
    const s = store();
    const fact = s.add({
      text: 'orders API has IDOR via sequential id',
      createdAt: '2026-06-10T00:00:00Z',
    });
    expect(fact).not.toBeNull();
    const list = s.list();
    expect(list).toHaveLength(1);
    expect(list[0]?.description).toContain('orders API has IDOR');
  });

  it('pins a catalog index with name + description', () => {
    const s = store();
    s.add({
      text: 'prefer curl over scanners',
      type: 'preference',
      createdAt: '2026-06-10T00:00:00Z',
    });
    const idx = s.index();
    expect(idx).toContain('[preference]');
    expect(idx).toContain('prefer curl over scanners');
  });

  it('recalls facts by relevance to a query', () => {
    const s = store();
    s.add({
      text: 'orders API IDOR via sequential id on /api/orders/{id}',
      createdAt: '2026-06-10T00:00:01Z',
    });
    s.add({
      text: 'login uses OAuth with a vulnerable redirect_uri',
      createdAt: '2026-06-10T00:00:02Z',
    });
    const hits = s.search('test the orders endpoint for idor', 5);
    expect(hits[0]?.text).toContain('orders API IDOR');
  });

  it('ranks a fresher fact above a slightly higher-overlap stale one', () => {
    const s = store();
    // Stale fact has an extra matching token ("boost") → higher raw overlap.
    s.add({
      text: 'idor orders boost stale',
      description: 'idor orders',
      createdAt: '2025-01-01T00:00:00.000Z',
    });
    // Fresh fact has lower raw overlap but is far more recent.
    s.add({
      text: 'idor orders fresh',
      description: 'idor orders',
      createdAt: '2026-06-10T00:00:00.000Z',
    });
    const hits = s.search('idor orders boost', 5);
    // Recency boost lifts the fresher lesson to the top despite less overlap.
    expect(hits[0]?.text).toContain('fresh');
    expect(hits[0]?.text).not.toContain('boost');
  });

  it('redacts secrets before persisting', () => {
    const s = store();
    const fact = s.add({
      text: 'admin token Bearer abcdef0123456789abcdef0123456789',
      createdAt: '2026-06-10T00:00:00Z',
    });
    expect(fact?.text).not.toContain('abcdef0123456789abcdef0123456789');
    // And it's not on disk either.
    const reread = store().list();
    expect(reread[0]?.text).not.toContain('abcdef0123456789abcdef0123456789');
  });

  it('separates project and personal scopes', () => {
    const s = store();
    s.add({
      text: 'project-only host scope note',
      scope: 'project',
      createdAt: '2026-06-10T00:00:00Z',
    });
    s.add({
      text: 'personal habit always test two accounts',
      scope: 'personal',
      createdAt: '2026-06-10T00:00:01Z',
    });
    const scopes = s
      .list()
      .map((f) => f.scope)
      .sort();
    expect(scopes).toEqual(['personal', 'project']);
  });

  it('forgets facts matching a query', () => {
    const s = store();
    s.add({ text: 'orders API IDOR', createdAt: '2026-06-10T00:00:00Z' });
    s.add({ text: 'login OAuth redirect bug', createdAt: '2026-06-10T00:00:01Z' });
    const removed = s.forget('orders');
    expect(removed).toHaveLength(1);
    expect(s.list()).toHaveLength(1);
    expect(s.list()[0]?.text).toContain('login OAuth');
  });

  it('returns null on empty text', () => {
    expect(store().add({ text: '   ' })).toBeNull();
  });

  it('formatMemoryRecall renders nothing for an empty set', () => {
    expect(formatMemoryRecall([])).toBe('');
  });
});
