import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync } from 'node:fs';
import { readFile, rename, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { apply as redact } from '../redact/index.js';
import { computeEvidenceHash } from './hash.js';
import type { Evidence, EvidenceProvenance, EvidenceTarget, EvidenceType } from './types.js';

const MAX_EVIDENCE_ENTRIES = 2000;

interface EvidenceFile {
  version: 1;
  entries: Evidence[];
}

export interface EvidenceStoreCallbacks {
  onCaptured?: (event: {
    type: 'evidence-captured';
    evidenceId: string;
    tool: string;
    hash: string;
  }) => void;
}

export class EvidenceStore {
  private readonly dir: string;
  private entries: Evidence[] = [];
  private loaded = false;
  private callbacks?: EvidenceStoreCallbacks;

  constructor(dir = 'findings/evidence', callbacks?: EvidenceStoreCallbacks) {
    this.dir = resolve(dir);
    this.callbacks = callbacks;
  }

  setCallbacks(cb: EvidenceStoreCallbacks): void {
    this.callbacks = cb;
  }

  async load(): Promise<void> {
    if (this.loaded) return;
    const filePath = this.filePath();
    if (existsSync(filePath)) {
      try {
        const raw = await readFile(filePath, 'utf8');
        const parsed = JSON.parse(raw) as EvidenceFile;
        if (parsed?.version === 1 && Array.isArray(parsed.entries)) {
          this.entries = parsed.entries;
        }
      } catch {
        // Best-effort
      }
    }
    this.loaded = true;
  }

  async create(input: {
    type: EvidenceType;
    tool: string;
    target?: EvidenceTarget;
    request?: unknown;
    response?: unknown;
    command?: string;
    output?: string;
    exitCode?: number;
    provenance?: EvidenceProvenance;
  }): Promise<Evidence> {
    await this.load();

    const id = `ev_${randomBytes(8).toString('hex')}`;
    const createdAt = new Date().toISOString();

    // Redact before hashing and storage
    const redactedRequest = input.request ? redactObj(input.request) : undefined;
    const redactedResponse = input.response ? redactObj(input.response) : undefined;
    const redactedOutput = input.output ? redact(input.output) : undefined;
    const redactedCommand = input.command ? redact(input.command) : undefined;

    const hash = computeEvidenceHash({
      type: input.type,
      tool: input.tool,
      target: input.target,
      request: redactedRequest,
      response: redactedResponse,
      command: redactedCommand,
      output: redactedOutput,
      exitCode: input.exitCode,
    });

    const evidence: Evidence = {
      id,
      type: input.type,
      createdAt,
      target: input.target,
      tool: input.tool,
      request: redactedRequest,
      response: redactedResponse,
      command: redactedCommand,
      output: redactedOutput,
      exitCode: input.exitCode,
      hash,
      provenance: input.provenance,
    };

    this.entries.push(evidence);
    this.evictIfNeeded();
    await this.persist();
    if (evidence.hash) {
      this.callbacks?.onCaptured?.({
        type: 'evidence-captured',
        evidenceId: evidence.id,
        tool: evidence.tool,
        hash: evidence.hash,
      });
    }
    return evidence;
  }

  async get(id: string): Promise<Evidence | undefined> {
    await this.load();
    return this.entries.find((e) => e.id === id);
  }

  async list(filter?: { type?: EvidenceType; tool?: string }): Promise<Evidence[]> {
    await this.load();
    if (!filter) return [...this.entries];
    return this.entries.filter((e) => {
      if (filter.type && e.type !== filter.type) return false;
      if (filter.tool && e.tool !== filter.tool) return false;
      return true;
    });
  }

  async count(): Promise<number> {
    await this.load();
    return this.entries.length;
  }

  private filePath(): string {
    return resolve(this.dir, 'evidence.json');
  }

  private evictIfNeeded(): void {
    if (this.entries.length <= MAX_EVIDENCE_ENTRIES) return;
    this.entries = this.entries.slice(this.entries.length - MAX_EVIDENCE_ENTRIES);
  }

  private async persist(): Promise<void> {
    if (!existsSync(this.dir)) mkdirSync(this.dir, { recursive: true, mode: 0o700 });
    const payload: EvidenceFile = { version: 1, entries: this.entries };
    const body = JSON.stringify(payload, null, 2);
    const tmp = `${this.filePath()}.tmp.${randomBytes(3).toString('hex')}`;
    try {
      await writeFile(tmp, body, { encoding: 'utf8', mode: 0o600 });
      await rename(tmp, this.filePath());
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

function redactObj(obj: unknown): unknown {
  if (typeof obj === 'string') return redact(obj);
  if (Array.isArray(obj)) return obj.map(redactObj);
  if (obj && typeof obj === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      out[k] = redactObj(v);
    }
    return out;
  }
  return obj;
}
