// Coverage store. Tracks which (endpoint, parameter, vuln_class) tuples
// the agent has attempted during the session, so it can answer "what
// haven't we tested yet?" — the single biggest workflow gap when the
// LLM loops over many endpoints. State persists to disk alongside
// findings so it survives a session restart.
//
// Schema is deliberately small: an entry is *(endpoint, param,
// vulnClass)* keyed; the value carries last status, count, last-ts,
// optional WAF / blocked-by hint, and free-form notes. Re-marking the
// same key updates in place rather than appending — this is a coverage
// matrix, not a log.

import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync } from 'node:fs';
import { chmod, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { warn } from '../logger/logger.js';

// Upper bound on persisted coverage entries so a long session enumerating
// many endpoints can't grow the matrix without limit. Oldest-by-lastSeen
// entries age out first.
const MAX_ENTRIES = 5000;

export type CoverageStatus = 'tried' | 'passed' | 'failed' | 'waf-blocked' | 'skipped';

export interface CoverageEntry {
  endpoint: string; // METHOD path-without-query
  param: string;
  vulnClass: string;
  status: CoverageStatus;
  count: number;
  firstSeen: number;
  lastSeen: number;
  notes?: string;
}

export interface CoverageSummary {
  total: number;
  byStatus: Record<CoverageStatus, number>;
  byVulnClass: Record<string, number>;
}

interface PersistShape {
  version: 1;
  entries: CoverageEntry[];
}

export class CoverageStore {
  private readonly path: string;
  private readonly entries: Map<string, CoverageEntry> = new Map();
  private loaded = false;
  private loadPromise: Promise<void> | undefined;
  // Write coalescing: queueSave() marks the store dirty and starts a single
  // save loop. While a persist() is in flight, further marks just re-set the
  // dirty flag, so a burst of mark() calls collapses to one trailing write
  // (each persist serializes the full current snapshot anyway).
  private dirty = false;
  private saving: Promise<void> | undefined;

  constructor(path: string) {
    this.path = resolve(path);
  }

  /** Load existing state from disk. Idempotent — only reads once. */
  load(): Promise<void> {
    if (this.loaded) return Promise.resolve();
    // Memoize the in-flight read so concurrent mark()/list() callers await the
    // same load instead of racing: previously `loaded` flipped true before the
    // async read resolved, letting a concurrent write persist an empty map over
    // real data.
    this.loadPromise ??= this.doLoad();
    return this.loadPromise;
  }

  private async doLoad(): Promise<void> {
    if (existsSync(this.path)) {
      try {
        const raw = await readFile(this.path, 'utf8');
        const parsed = JSON.parse(raw) as PersistShape;
        if (parsed?.version === 1 && Array.isArray(parsed.entries)) {
          for (const e of parsed.entries) {
            if (isValidEntry(e)) this.entries.set(keyOf(e), e);
          }
        }
      } catch {
        // Best-effort — a corrupted file shouldn't kill the agent.
      }
    }
    // Mark loaded only after the read has fully resolved.
    this.loaded = true;
  }

  /** Record a test attempt. Re-marks update the existing entry in place. */
  async mark(input: {
    endpoint: string;
    param: string;
    vulnClass: string;
    status: CoverageStatus;
    notes?: string;
  }): Promise<CoverageEntry> {
    await this.load();
    const endpoint = normalizeEndpoint(input.endpoint);
    const param = input.param.trim();
    const vulnClass = input.vulnClass.trim().toLowerCase();
    if (!endpoint || !param || !vulnClass) {
      throw new Error('mark: endpoint, param, and vulnClass are all required');
    }
    const key = keyOf({ endpoint, param, vulnClass });
    const now = Date.now();
    const prev = this.entries.get(key);
    const merged: CoverageEntry = {
      endpoint,
      param,
      vulnClass,
      status: input.status,
      count: (prev?.count ?? 0) + 1,
      firstSeen: prev?.firstSeen ?? now,
      lastSeen: now,
      notes: input.notes ?? prev?.notes,
    };
    this.entries.set(key, merged);
    this.evictIfNeeded();
    this.queueSave();
    return merged;
  }

  /** List all entries, newest-last. */
  async list(filter?: {
    endpoint?: string;
    param?: string;
    vulnClass?: string;
    status?: CoverageStatus;
  }): Promise<CoverageEntry[]> {
    await this.load();
    const all = [...this.entries.values()].sort((a, b) => a.lastSeen - b.lastSeen);
    if (!filter) return all;
    return all.filter((e) => {
      if (filter.endpoint && !e.endpoint.includes(filter.endpoint)) return false;
      if (filter.param && e.param !== filter.param) return false;
      if (filter.vulnClass && e.vulnClass !== filter.vulnClass.toLowerCase()) return false;
      if (filter.status && e.status !== filter.status) return false;
      return true;
    });
  }

  /**
   * Given a candidate list of (endpoint, param) pairs and vuln classes to
   * test for each, return the tuples that have NOT yet been marked. This
   * is the "what's next" view that drives the agent past blind repetition.
   */
  async untested(
    candidates: Array<{ endpoint: string; param: string }>,
    vulnClasses: string[],
  ): Promise<Array<{ endpoint: string; param: string; vulnClass: string }>> {
    await this.load();
    const out: Array<{ endpoint: string; param: string; vulnClass: string }> = [];
    for (const c of candidates) {
      const ep = normalizeEndpoint(c.endpoint);
      for (const v of vulnClasses) {
        const k = keyOf({ endpoint: ep, param: c.param, vulnClass: v.toLowerCase() });
        if (!this.entries.has(k)) out.push({ endpoint: ep, param: c.param, vulnClass: v.toLowerCase() });
      }
    }
    return out;
  }

  async summary(): Promise<CoverageSummary> {
    await this.load();
    const byStatus: Record<CoverageStatus, number> = {
      tried: 0,
      passed: 0,
      failed: 0,
      'waf-blocked': 0,
      skipped: 0,
    };
    const byVulnClass: Record<string, number> = {};
    for (const e of this.entries.values()) {
      byStatus[e.status] = (byStatus[e.status] ?? 0) + 1;
      byVulnClass[e.vulnClass] = (byVulnClass[e.vulnClass] ?? 0) + 1;
    }
    return { total: this.entries.size, byStatus, byVulnClass };
  }

  async clear(): Promise<void> {
    await this.load();
    this.entries.clear();
    this.queueSave();
  }

  /** Resolve once all queued writes have flushed. Aids tests and shutdown. */
  async flush(): Promise<void> {
    while (this.saving) await this.saving;
  }

  /** Evict the oldest-by-lastSeen entries once the matrix exceeds the cap. */
  private evictIfNeeded(): void {
    if (this.entries.size <= MAX_ENTRIES) return;
    const sorted = [...this.entries.entries()].sort((a, b) => a[1].lastSeen - b[1].lastSeen);
    const drop = this.entries.size - MAX_ENTRIES;
    for (let i = 0; i < drop; i += 1) {
      const k = sorted[i]?.[0];
      if (k !== undefined) this.entries.delete(k);
    }
  }

  private queueSave(): void {
    // Coalesce writes — a burst of mark() calls shouldn't chain one full
    // rewrite each. Mark dirty; if a save loop is already running it picks the
    // change up, otherwise start one. The loop persists the full snapshot, so a
    // single trailing write captures every pending change.
    this.dirty = true;
    if (this.saving) return;
    this.saving = this.runSaveLoop();
  }

  private async runSaveLoop(): Promise<void> {
    while (this.dirty) {
      this.dirty = false;
      try {
        await this.persist();
      } catch (err) {
        // Don't swallow silently — a failed persist is real data-loss risk.
        warn('coverage: failed to persist store', { error: String(err) });
      }
    }
    this.saving = undefined;
  }

  private async persist(): Promise<void> {
    const dir = dirname(this.path);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const payload: PersistShape = { version: 1, entries: [...this.entries.values()] };
    const tmp = `${this.path}.tmp.${randomBytes(3).toString('hex')}`;
    try {
      await writeFile(tmp, `${JSON.stringify(payload, null, 2)}\n`, {
        encoding: 'utf8',
        mode: 0o600,
      });
      await rename(tmp, this.path);
      await chmod(this.path, 0o600).catch(() => undefined);
    } catch (err) {
      await unlink(tmp).catch(() => undefined);
      throw err;
    }
  }
}

function keyOf(e: { endpoint: string; param: string; vulnClass: string }): string {
  return `${e.endpoint}\x00${e.param}\x00${e.vulnClass}`;
}

function normalizeEndpoint(s: string): string {
  // Strip query for stable keys; leave the method prefix alone so
  // (GET /a, POST /a) are distinct.
  const trimmed = s.trim();
  const q = trimmed.indexOf('?');
  return q >= 0 ? trimmed.slice(0, q) : trimmed;
}

function isValidEntry(e: unknown): e is CoverageEntry {
  if (!e || typeof e !== 'object') return false;
  const r = e as Record<string, unknown>;
  return (
    typeof r.endpoint === 'string' &&
    typeof r.param === 'string' &&
    typeof r.vulnClass === 'string' &&
    typeof r.status === 'string' &&
    typeof r.count === 'number' &&
    typeof r.firstSeen === 'number' &&
    typeof r.lastSeen === 'number'
  );
}
