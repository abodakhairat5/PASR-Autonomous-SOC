// Extended coverage store that adds exploit and vulnerability class tracking
// on top of the existing CoverageStore. Maintains backward compatibility
// while providing richer coverage analysis for adaptive planning.

import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync } from 'node:fs';
import { readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { warn } from '../logger/logger.js';
import type {
  CoverageGap,
  ExploitCoverageEntry,
  ExploitStatus,
  ExtendedCoverageSummary,
  VulnerabilityClassCoverage,
} from './types.js';

const MAX_EXPLOIT_ENTRIES = 2000;

interface PersistShape {
  version: 1;
  exploitEntries: ExploitCoverageEntry[];
}

export class ExtendedCoverageStore {
  private readonly path: string;
  private readonly exploitEntries: Map<string, ExploitCoverageEntry> = new Map();
  private loaded = false;
  private loadPromise: Promise<void> | undefined;
  private dirty = false;
  private saving: Promise<void> | undefined;

  constructor(path: string) {
    this.path = resolve(path);
  }

  async load(): Promise<void> {
    if (this.loaded) return Promise.resolve();
    this.loadPromise ??= this.doLoad();
    return this.loadPromise;
  }

  private async doLoad(): Promise<void> {
    if (existsSync(this.path)) {
      try {
        const raw = await readFile(this.path, 'utf8');
        const parsed = JSON.parse(raw) as PersistShape;
        if (parsed?.version === 1 && Array.isArray(parsed.exploitEntries)) {
          for (const e of parsed.exploitEntries) {
            if (isValidExploitEntry(e)) {
              this.exploitEntries.set(exploitKeyOf(e), e);
            }
          }
        }
      } catch {
        // Best-effort — a corrupted file shouldn't kill the agent.
      }
    }
    this.loaded = true;
  }

  async markExploit(input: {
    exploitId: string;
    target: string;
    vulnClass: string;
    status: ExploitStatus;
    notes?: string;
    evidenceIds?: string[];
  }): Promise<ExploitCoverageEntry> {
    await this.load();
    const exploitId = input.exploitId.trim();
    const target = input.target.trim();
    const vulnClass = input.vulnClass.trim().toLowerCase();
    if (!exploitId || !target || !vulnClass) {
      throw new Error('markExploit: exploitId, target, and vulnClass are all required');
    }
    const key = exploitKeyOf({ exploitId, target, vulnClass });
    const now = Date.now();
    const prev = this.exploitEntries.get(key);
    const merged: ExploitCoverageEntry = {
      exploitId,
      target,
      vulnClass,
      status: input.status,
      count: (prev?.count ?? 0) + 1,
      firstSeen: prev?.firstSeen ?? now,
      lastSeen: now,
      notes: input.notes ?? prev?.notes,
      evidenceIds: input.evidenceIds ?? prev?.evidenceIds,
    };
    this.exploitEntries.set(key, merged);
    this.evictIfNeeded();
    this.queueSave();
    return merged;
  }

  async listExploits(filter?: {
    target?: string;
    vulnClass?: string;
    status?: ExploitStatus;
  }): Promise<ExploitCoverageEntry[]> {
    await this.load();
    const all = [...this.exploitEntries.values()].sort((a, b) => a.lastSeen - b.lastSeen);
    if (!filter) return all;
    return all.filter((e) => {
      if (filter.target && !e.target.includes(filter.target)) return false;
      if (filter.vulnClass && e.vulnClass !== filter.vulnClass.toLowerCase()) return false;
      if (filter.status && e.status !== filter.status) return false;
      return true;
    });
  }

  async getVulnClassCoverage(): Promise<VulnerabilityClassCoverage[]> {
    await this.load();
    const byClass = new Map<string, VulnerabilityClassCoverage>();

    for (const e of this.exploitEntries.values()) {
      let coverage = byClass.get(e.vulnClass);
      if (!coverage) {
        coverage = {
          vulnClass: e.vulnClass,
          totalAttempts: 0,
          confirmed: 0,
          failed: 0,
          notApplicable: 0,
          endpoints: [],
        };
        byClass.set(e.vulnClass, coverage);
      }
      coverage.totalAttempts += e.count;
      if (e.status === 'confirmed') coverage.confirmed += 1;
      if (e.status === 'failed') coverage.failed += 1;
      if (e.status === 'not-applicable') coverage.notApplicable += 1;
      if (!coverage.endpoints.includes(e.target)) {
        coverage.endpoints.push(e.target);
      }
      if (!coverage.lastAttempted || e.lastSeen > coverage.lastAttempted) {
        coverage.lastAttempted = e.lastSeen;
      }
    }

    return [...byClass.values()];
  }

  async findGaps(
    endpoints: string[],
    vulnClasses: string[],
  ): Promise<CoverageGap[]> {
    await this.load();
    const gaps: CoverageGap[] = [];

    for (const endpoint of endpoints) {
      for (const vulnClass of vulnClasses) {
        const key = exploitKeyOf({
          exploitId: '*',
          target: endpoint,
          vulnClass: vulnClass.toLowerCase(),
        });

        // Check if any exploit has been attempted for this endpoint + vulnClass
        const attempted = [...this.exploitEntries.values()].some(
          (e) => e.target === endpoint && e.vulnClass === vulnClass.toLowerCase(),
        );

        if (!attempted) {
          gaps.push({
            endpoint,
            param: '*',
            vulnClass: vulnClass.toLowerCase(),
            priority: 'high',
            reason: `no exploit attempted for ${vulnClass} on ${endpoint}`,
          });
        }
      }
    }

    return gaps;
  }

  async summary(): Promise<ExtendedCoverageSummary> {
    await this.load();
    const byStatus: Record<ExploitStatus, number> = {
      attempted: 0,
      confirmed: 0,
      failed: 0,
      'not-applicable': 0,
    };

    for (const e of this.exploitEntries.values()) {
      byStatus[e.status] = (byStatus[e.status] ?? 0) + 1;
    }

    const byVulnClass: Record<string, VulnerabilityClassCoverage> = {};
    for (const e of this.exploitEntries.values()) {
      if (!byVulnClass[e.vulnClass]) {
        byVulnClass[e.vulnClass] = {
          vulnClass: e.vulnClass,
          totalAttempts: 0,
          confirmed: 0,
          failed: 0,
          notApplicable: 0,
          endpoints: [],
        };
      }
      const coverage = byVulnClass[e.vulnClass]!;
      coverage.totalAttempts += e.count;
      if (e.status === 'confirmed') coverage.confirmed += 1;
      if (e.status === 'failed') coverage.failed += 1;
      if (e.status === 'not-applicable') coverage.notApplicable += 1;
      if (!coverage.endpoints.includes(e.target)) {
        coverage.endpoints.push(e.target);
      }
      if (!coverage.lastAttempted || e.lastSeen > coverage.lastAttempted) {
        coverage.lastAttempted = e.lastSeen;
      }
    }

    return {
      total: this.exploitEntries.size,
      byStatus,
      byVulnClass,
      gaps: [],
      lastUpdated: Date.now(),
    };
  }

  async clear(): Promise<void> {
    await this.load();
    this.exploitEntries.clear();
    this.queueSave();
  }

  async flush(): Promise<void> {
    while (this.saving) await this.saving;
  }

  private evictIfNeeded(): void {
    if (this.exploitEntries.size <= MAX_EXPLOIT_ENTRIES) return;
    const sorted = [...this.exploitEntries.entries()].sort(
      (a, b) => a[1].lastSeen - b[1].lastSeen,
    );
    const drop = this.exploitEntries.size - MAX_EXPLOIT_ENTRIES;
    for (let i = 0; i < drop; i += 1) {
      const k = sorted[i]?.[0];
      if (k !== undefined) this.exploitEntries.delete(k);
    }
  }

  private queueSave(): void {
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
        warn('extended-coverage: failed to persist store', { error: String(err) });
      }
    }
    this.saving = undefined;
  }

  private async persist(): Promise<void> {
    const dir = dirname(this.path);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const payload: PersistShape = {
      version: 1,
      exploitEntries: [...this.exploitEntries.values()],
    };
    const tmp = `${this.path}.tmp.${randomBytes(3).toString('hex')}`;
    try {
      await writeFile(tmp, `${JSON.stringify(payload, null, 2)}\n`, {
        encoding: 'utf8',
        mode: 0o600,
      });
      await rename(tmp, this.path);
    } catch (err) {
      await unlink(tmp).catch(() => undefined);
      throw err;
    }
  }
}

function exploitKeyOf(e: { exploitId: string; target: string; vulnClass: string }): string {
  return `${e.exploitId}\x00${e.target}\x00${e.vulnClass}`;
}

function isValidExploitEntry(e: unknown): e is ExploitCoverageEntry {
  if (!e || typeof e !== 'object') return false;
  const r = e as Record<string, unknown>;
  return (
    typeof r.exploitId === 'string' &&
    typeof r.target === 'string' &&
    typeof r.vulnClass === 'string' &&
    typeof r.status === 'string' &&
    typeof r.count === 'number' &&
    typeof r.firstSeen === 'number' &&
    typeof r.lastSeen === 'number'
  );
}
