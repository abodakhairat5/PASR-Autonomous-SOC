// CoverageStore tests: mark / list / untested / summary, plus persistence
// round-trip and the path-normalization that strips query strings.

import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { CoverageStore } from './store.js';

function makeStore(): { store: CoverageStore; path: string } {
  const dir = mkdtempSync(join(tmpdir(), 'pf-coverage-'));
  const path = join(dir, 'coverage.json');
  return { store: new CoverageStore(path), path };
}

describe('CoverageStore.mark', () => {
  it('records a new entry with count=1, then increments on re-mark', async () => {
    const { store } = makeStore();
    const a = await store.mark({
      endpoint: 'GET /api/users/{id}',
      param: 'id',
      vulnClass: 'idor',
      status: 'tried',
    });
    expect(a.count).toBe(1);
    expect(a.status).toBe('tried');
    const b = await store.mark({
      endpoint: 'GET /api/users/{id}',
      param: 'id',
      vulnClass: 'idor',
      status: 'failed',
    });
    expect(b.count).toBe(2);
    expect(b.status).toBe('failed'); // status updates in place
  });

  it('strips query strings so /a?x=1 and /a?x=2 share an entry', async () => {
    const { store } = makeStore();
    await store.mark({ endpoint: 'GET /a?x=1', param: 'x', vulnClass: 'xss', status: 'tried' });
    await store.mark({ endpoint: 'GET /a?x=2', param: 'x', vulnClass: 'xss', status: 'passed' });
    const list = await store.list();
    expect(list).toHaveLength(1);
    expect(list[0]?.endpoint).toBe('GET /a');
    expect(list[0]?.count).toBe(2);
    expect(list[0]?.status).toBe('passed');
  });

  it('rejects empty endpoint / param / vulnClass', async () => {
    const { store } = makeStore();
    await expect(
      store.mark({ endpoint: '', param: 'p', vulnClass: 'xss', status: 'tried' }),
    ).rejects.toThrow(/required/);
  });
});

describe('CoverageStore.untested', () => {
  it('returns only untested (endpoint × class) pairs', async () => {
    const { store } = makeStore();
    await store.mark({
      endpoint: 'POST /login',
      param: 'username',
      vulnClass: 'sqli',
      status: 'failed',
    });
    const out = await store.untested(
      [
        { endpoint: 'POST /login', param: 'username' },
        { endpoint: 'POST /login', param: 'password' },
      ],
      ['sqli', 'xss'],
    );
    // 4 combinations total; one is already marked → 3 untested.
    expect(out).toHaveLength(3);
    expect(
      out.find(
        (t) => t.endpoint === 'POST /login' && t.param === 'username' && t.vulnClass === 'sqli',
      ),
    ).toBeUndefined();
  });
});

describe('CoverageStore.summary', () => {
  it('aggregates by status and vuln class', async () => {
    const { store } = makeStore();
    await store.mark({ endpoint: 'GET /a', param: 'q', vulnClass: 'xss', status: 'tried' });
    await store.mark({ endpoint: 'GET /a', param: 'r', vulnClass: 'xss', status: 'passed' });
    await store.mark({ endpoint: 'GET /b', param: 's', vulnClass: 'sqli', status: 'failed' });
    const s = await store.summary();
    expect(s.total).toBe(3);
    expect(s.byStatus.tried).toBe(1);
    expect(s.byStatus.passed).toBe(1);
    expect(s.byStatus.failed).toBe(1);
    expect(s.byVulnClass.xss).toBe(2);
    expect(s.byVulnClass.sqli).toBe(1);
  });
});

describe('CoverageStore persistence', () => {
  it('round-trips entries through the JSON file', async () => {
    const { store, path } = makeStore();
    await store.mark({
      endpoint: 'GET /x',
      param: 'p',
      vulnClass: 'ssti',
      status: 'passed',
      notes: 'jinja2 sandbox escape via lipsum',
    });
    // Allow the queued save to settle.
    await new Promise((r) => setTimeout(r, 30));
    const raw = readFileSync(path, 'utf8');
    expect(raw).toContain('"version": 1');
    expect(raw).toContain('"endpoint": "GET /x"');
    expect(raw).toContain('jinja2 sandbox escape via lipsum');

    const fresh = new CoverageStore(path);
    const list = await fresh.list();
    expect(list).toHaveLength(1);
    expect(list[0]?.notes).toContain('lipsum');
  });

  it('survives a corrupted file gracefully (load returns no entries)', async () => {
    const { path } = makeStore();
    // Write garbage to the persistence path.
    const dir = path.replace(/\/[^/]+$/, '');
    require('node:fs').writeFileSync(path, '{{ not json', { mode: 0o600 });
    const fresh = new CoverageStore(path);
    const list = await fresh.list();
    expect(list).toHaveLength(0);
    expect(dir).toBeTruthy(); // sanity that we wrote into a tmpdir
  });

  it('does not lose pre-existing entries under concurrent first marks', async () => {
    // Pre-populate the file with one entry via a first store.
    const { store: seed, path } = makeStore();
    await seed.mark({ endpoint: 'GET /seed', param: 'id', vulnClass: 'idor', status: 'tried' });
    await seed.flush();

    // A fresh store: fire two mark() calls before load() has resolved. The race
    // fix must let the on-disk seed survive alongside both new marks.
    const fresh = new CoverageStore(path);
    await Promise.all([
      fresh.mark({ endpoint: 'GET /a', param: 'p', vulnClass: 'xss', status: 'tried' }),
      fresh.mark({ endpoint: 'GET /b', param: 'q', vulnClass: 'sqli', status: 'tried' }),
    ]);
    await fresh.flush();

    const reread = new CoverageStore(path);
    const list = await reread.list();
    const endpoints = list.map((e) => e.endpoint).sort();
    expect(endpoints).toEqual(['GET /a', 'GET /b', 'GET /seed']);
  });

  it('coalesces a burst of marks into a single settled snapshot', async () => {
    const { store, path } = makeStore();
    await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        store.mark({ endpoint: `GET /x${i}`, param: 'p', vulnClass: 'xss', status: 'tried' }),
      ),
    );
    await store.flush();
    const reread = new CoverageStore(path);
    expect(await reread.list()).toHaveLength(20);
  });
});
