// Audit logger for recording all PASR decisions with timestamps.
// Provides an append-only log of policy decisions, evidence captures,
// and experience records for forensic review.

import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync } from 'node:fs';
import { appendFile, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

export interface AuditEntry {
  id: string;
  timestamp: string;
  kind: 'policy-decision' | 'evidence-captured' | 'experience-recorded' | 'session-start' | 'session-end';
  detail: Record<string, unknown>;
}

export class AuditLogger {
  private readonly filePath: string;
  private flushed = false;

  constructor(dir = 'findings/audit') {
    this.filePath = resolve(dir, 'audit.jsonl');
  }

  async log(entry: Omit<AuditEntry, 'id' | 'timestamp'>): Promise<AuditEntry> {
    const full: AuditEntry = {
      id: `aud_${randomBytes(8).toString('hex')}`,
      timestamp: new Date().toISOString(),
      ...entry,
    };
    const line = `${JSON.stringify(full)}\n`;
    const dir = dirname(this.filePath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
    await appendFile(this.filePath, line, { encoding: 'utf8', mode: 0o600 });
    return full;
  }

  async list(since?: string): Promise<AuditEntry[]> {
    if (!existsSync(this.filePath)) return [];
    try {
      const raw = await readFile(this.filePath, 'utf8');
      const entries: AuditEntry[] = [];
      for (const line of raw.split('\n')) {
        if (!line.trim()) continue;
        try {
          const e = JSON.parse(line) as AuditEntry;
          if (since && e.timestamp < since) continue;
          entries.push(e);
        } catch {
          // Skip malformed lines
        }
      }
      return entries;
    } catch {
      return [];
    }
  }

  async count(): Promise<number> {
    if (!existsSync(this.filePath)) return 0;
    try {
      const raw = await readFile(this.filePath, 'utf8');
      return raw.split('\n').filter((l) => l.trim()).length;
    } catch {
      return 0;
    }
  }
}
