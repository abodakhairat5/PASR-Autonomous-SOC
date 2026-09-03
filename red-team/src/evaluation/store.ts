import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync } from 'node:fs';
import { readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import type { EvaluationSnapshot } from './types.js';

interface EvaluationFile {
  version: 1;
  snapshots: EvaluationSnapshot[];
}

const MAX_SNAPSHOTS = 500;

export class EvaluationStore {
  private readonly path: string;
  private snapshots: EvaluationSnapshot[] = [];
  private loaded = false;

  constructor(path: string) {
    this.path = resolve(path);
  }

  async load(): Promise<void> {
    if (this.loaded) return;
    if (existsSync(this.path)) {
      try {
        const raw = await readFile(this.path, 'utf8');
        const parsed = JSON.parse(raw) as EvaluationFile;
        if (parsed?.version === 1 && Array.isArray(parsed.snapshots)) {
          this.snapshots = parsed.snapshots;
        }
      } catch {
        // Best-effort
      }
    }
    this.loaded = true;
  }

  async append(snapshot: EvaluationSnapshot): Promise<void> {
    await this.load();
    this.snapshots.push(snapshot);
    if (this.snapshots.length > MAX_SNAPSHOTS) {
      this.snapshots = this.snapshots.slice(this.snapshots.length - MAX_SNAPSHOTS);
    }
    await this.persist();
  }

  async list(): Promise<EvaluationSnapshot[]> {
    await this.load();
    return [...this.snapshots];
  }

  async latest(): Promise<EvaluationSnapshot | undefined> {
    await this.load();
    return this.snapshots[this.snapshots.length - 1];
  }

  private async persist(): Promise<void> {
    const dir = dirname(this.path);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
    const payload: EvaluationFile = { version: 1, snapshots: this.snapshots };
    const body = JSON.stringify(payload, null, 2);
    const tmp = `${this.path}.tmp.${randomBytes(3).toString('hex')}`;
    try {
      await writeFile(tmp, body, { encoding: 'utf8', mode: 0o600 });
      await rename(tmp, this.path);
    } catch {
      try {
        const { unlink } = await import('node:fs/promises');
        await unlink(tmp).catch(() => undefined);
      } catch {
        // ignore
      }
    }
  }
}
