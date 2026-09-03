import { existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { computeEvidenceHash } from './hash.js';
import { canReplay, replayDescription } from './replay.js';
import { EvidenceStore } from './store.js';

function tmpDir(): string {
  return join(tmpdir(), `pf-evidence-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
}

describe('EvidenceStore', () => {
  let dir: string;
  let store: EvidenceStore;

  afterEach(() => {
    if (dir && existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  });

  it('creates and retrieves evidence', async () => {
    dir = tmpDir();
    store = new EvidenceStore(dir);
    const ev = await store.create({
      type: 'http',
      tool: 'http',
      target: { url: 'https://example.com/api', host: 'example.com', port: 443, protocol: 'https' },
      request: { method: 'GET', url: 'https://example.com/api' },
      response: { status: 200, body: 'ok' },
    });
    expect(ev.id).toMatch(/^ev_/);
    expect(ev.type).toBe('http');
    expect(ev.hash).toBeTruthy();

    const retrieved = await store.get(ev.id);
    expect(retrieved?.id).toBe(ev.id);
  });

  it('evidence is immutable after creation', async () => {
    dir = tmpDir();
    store = new EvidenceStore(dir);
    const ev = await store.create({
      type: 'command',
      tool: 'shell',
      command: 'echo hello',
      output: 'hello',
      exitCode: 0,
    });
    const hash1 = ev.hash;
    // Loading again should not change anything
    const store2 = new EvidenceStore(dir);
    const ev2 = await store2.get(ev.id);
    expect(ev2?.hash).toBe(hash1);
  });

  it('hash is deterministic', () => {
    const data = { a: 1, b: 'hello', c: [1, 2, 3] };
    const h1 = computeEvidenceHash(data);
    const h2 = computeEvidenceHash(data);
    expect(h1).toBe(h2);
  });

  it('hash changes with different data', () => {
    const h1 = computeEvidenceHash({ a: 1 });
    const h2 = computeEvidenceHash({ a: 2 });
    expect(h1).not.toBe(h2);
  });

  it('redacts secrets before storage', async () => {
    dir = tmpDir();
    store = new EvidenceStore(dir);
    const ev = await store.create({
      type: 'http',
      tool: 'http',
      request: { authorization: 'Bearer sk-test-1234567890abcdef' },
    });
    const retrieved = await store.get(ev.id);
    const req = retrieved?.request as Record<string, unknown>;
    expect(req?.authorization).not.toContain('sk-test-1234567890abcdef');
  });

  it('list with filters', async () => {
    dir = tmpDir();
    store = new EvidenceStore(dir);
    await store.create({ type: 'http', tool: 'http' });
    await store.create({ type: 'command', tool: 'shell' });
    await store.create({ type: 'http', tool: 'web_fetch' });

    const all = await store.list();
    expect(all.length).toBe(3);
    const httpOnly = await store.list({ type: 'http' });
    expect(httpOnly.length).toBe(2);
  });

  it('canReplay and replayDescription', () => {
    const httpEv: Evidence = {
      id: 'ev_test',
      type: 'http',
      createdAt: '',
      tool: 'http',
      target: { url: 'https://example.com' },
      request: { method: 'GET' },
    };
    expect(canReplay(httpEv)).toBe(true);
    expect(replayDescription(httpEv)).toContain('GET https://example.com');

    const cmdEv: Evidence = {
      id: 'ev_test2',
      type: 'command',
      createdAt: '',
      tool: 'shell',
      command: 'echo hi',
    };
    expect(canReplay(cmdEv)).toBe(true);
    expect(replayDescription(cmdEv)).toContain('echo hi');

    const otherEv: Evidence = {
      id: 'ev_test3',
      type: 'other',
      createdAt: '',
      tool: 'unknown',
    };
    expect(canReplay(otherEv)).toBe(false);
  });
});
