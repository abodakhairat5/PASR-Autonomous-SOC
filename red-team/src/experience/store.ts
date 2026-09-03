// Experience store for persisting structured experiences during an engagement.
// Experiences track what the agent tried, what worked, and what failed,
// enabling adaptive planning and pattern recognition.

import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync } from 'node:fs';
import { readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { warn } from '../logger/logger.js';
import type {
  Experience,
  ExperienceCategory,
  ExperienceOutcome,
  ExperiencePattern,
  ExperienceSummary,
} from './types.js';

const MAX_ENTRIES = 5000;

interface PersistShape {
  version: 1;
  entries: Experience[];
}

export class ExperienceStore {
  private readonly path: string;
  private readonly entries: Experience[] = [];
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
        if (parsed?.version === 1 && Array.isArray(parsed.entries)) {
          for (const e of parsed.entries) {
            if (isValidExperience(e)) this.entries.push(e);
          }
        }
      } catch {
        // Best-effort — a corrupted file shouldn't kill the agent.
      }
    }
    this.loaded = true;
  }

  async record(input: {
    category: ExperienceCategory;
    action: string;
    target: string;
    outcome: ExperienceOutcome;
    duration: number;
    findings?: string[];
    notes?: string;
    tags?: string[];
    evidenceIds?: string[];
    policyDecision?: 'allow' | 'deny' | 'require-approval';
  }): Promise<Experience> {
    await this.load();
    const experience: Experience = {
      experienceId: `exp_${randomBytes(8).toString('hex')}`,
      timestamp: Date.now(),
      category: input.category,
      action: input.action,
      target: input.target,
      outcome: input.outcome,
      duration: input.duration,
      findings: input.findings,
      notes: input.notes,
      tags: input.tags,
      evidenceIds: input.evidenceIds,
      policyDecision: input.policyDecision,
    };
    this.entries.push(experience);
    this.evictIfNeeded();
    this.queueSave();
    return experience;
  }

  async list(filter?: {
    category?: ExperienceCategory;
    outcome?: ExperienceOutcome;
    target?: string;
    since?: number;
  }): Promise<Experience[]> {
    await this.load();
    let result = [...this.entries];
    if (filter) {
      if (filter.category) result = result.filter((e) => e.category === filter.category);
      if (filter.outcome) result = result.filter((e) => e.outcome === filter.outcome);
      if (filter.target) result = result.filter((e) => e.target.includes(filter.target ?? ''));
      if (filter.since) result = result.filter((e) => e.timestamp >= (filter.since ?? 0));
    }
    return result.sort((a, b) => a.timestamp - b.timestamp);
  }

  async getPatterns(): Promise<ExperiencePattern[]> {
    await this.load();
    const patternMap = new Map<string, ExperiencePattern>();

    for (const exp of this.entries) {
      const key = `${exp.category}:${exp.action}`;
      let pattern = patternMap.get(key);
      if (!pattern) {
        pattern = {
          patternId: `pat_${randomBytes(4).toString('hex')}`,
          category: exp.category,
          action: exp.action,
          successRate: 0,
          averageDuration: 0,
          totalAttempts: 0,
          lastSeen: exp.timestamp,
          tags: exp.tags ?? [],
        };
        patternMap.set(key, pattern);
      }
      pattern.totalAttempts += 1;
      if (exp.outcome === 'success') pattern.successRate += 1;
      pattern.averageDuration =
        (pattern.averageDuration * (pattern.totalAttempts - 1) + exp.duration) /
        pattern.totalAttempts;
      if (exp.timestamp > pattern.lastSeen) pattern.lastSeen = exp.timestamp;
    }

    // Calculate success rates
    for (const pattern of patternMap.values()) {
      pattern.successRate =
        pattern.totalAttempts > 0 ? pattern.successRate / pattern.totalAttempts : 0;
    }

    return [...patternMap.values()].sort((a, b) => b.lastSeen - a.lastSeen);
  }

  async summary(): Promise<ExperienceSummary> {
    await this.load();
    const byOutcome: Record<ExperienceOutcome, number> = {
      success: 0,
      failure: 0,
      partial: 0,
      timeout: 0,
      blocked: 0,
    };
    const byCategory: Record<ExperienceCategory, number> = {
      recon: 0,
      scan: 0,
      exploit: 0,
      'post-exploit': 0,
      report: 0,
      'lateral-move': 0,
      'privilege-escalation': 0,
      'data-exfil': 0,
    };

    for (const e of this.entries) {
      byOutcome[e.outcome] = (byOutcome[e.outcome] ?? 0) + 1;
      byCategory[e.category] = (byCategory[e.category] ?? 0) + 1;
    }

    return {
      total: this.entries.length,
      byOutcome,
      byCategory,
      patterns: await this.getPatterns(),
      lastUpdated: Date.now(),
    };
  }

  async clear(): Promise<void> {
    await this.load();
    this.entries.length = 0;
    this.queueSave();
  }

  async flush(): Promise<void> {
    while (this.saving) await this.saving;
  }

  private evictIfNeeded(): void {
    if (this.entries.length <= MAX_ENTRIES) return;
    this.entries.splice(0, this.entries.length - MAX_ENTRIES);
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
        warn('experience: failed to persist store', { error: String(err) });
      }
    }
    this.saving = undefined;
  }

  private async persist(): Promise<void> {
    const dir = dirname(this.path);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const payload: PersistShape = { version: 1, entries: this.entries };
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

function isValidExperience(e: unknown): e is Experience {
  if (!e || typeof e !== 'object') return false;
  const r = e as Record<string, unknown>;
  return (
    typeof r.experienceId === 'string' &&
    typeof r.timestamp === 'number' &&
    typeof r.category === 'string' &&
    typeof r.action === 'string' &&
    typeof r.target === 'string' &&
    typeof r.outcome === 'string' &&
    typeof r.duration === 'number'
  );
}
