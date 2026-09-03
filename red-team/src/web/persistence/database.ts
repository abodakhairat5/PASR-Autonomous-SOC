import { existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import SqliteDatabase from 'better-sqlite3';

export interface Engagement {
  id: string;
  name: string;
  description: string;
  targetUrl: string;
  targetName: string;
  scopeJson: string;
  status: 'idle' | 'running' | 'stopped' | 'error';
  sessionId: string | null;
  backend: string;
  model: string;
  thinkingEnabled: boolean;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  stoppedAt: string | null;
}

export interface Session {
  id: string;
  engagementId: string;
  status: 'running' | 'stopped' | 'error';
  startedAt: string;
  stoppedAt: string | null;
  error: string | null;
}

export interface StoredEvent {
  id: string;
  engagementId: string;
  sessionId: string;
  type: string;
  timestamp: string;
  dataJson: string;
}

export interface StoredFinding {
  id: string;
  engagementId: string;
  sessionId: string;
  findingJson: string;
  severity: string;
  status: string;
  createdAt: string;
}

export interface StoredEvidence {
  id: string;
  engagementId: string;
  sessionId: string;
  type: string;
  tool: string;
  hash: string;
  evidenceJson: string;
  createdAt: string;
}

export interface StoredAuditEntry {
  id: string;
  engagementId: string;
  sessionId: string;
  kind: string;
  detailJson: string;
  timestamp: string;
}

export class ParsDatabase {
  private readonly db: SqliteDatabase.Database;

  constructor(dbPath: string) {
    const dir = dirname(dbPath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
    this.db = new SqliteDatabase(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.migrate();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS engagements (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT DEFAULT '',
        targetUrl TEXT NOT NULL,
        targetName TEXT DEFAULT '',
        scopeJson TEXT DEFAULT '{}',
        status TEXT DEFAULT 'idle',
        sessionId TEXT,
        backend TEXT DEFAULT '',
        model TEXT DEFAULT '',
        thinkingEnabled INTEGER DEFAULT 0,
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL,
        startedAt TEXT,
        stoppedAt TEXT
      );

      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        engagementId TEXT NOT NULL,
        status TEXT DEFAULT 'running',
        startedAt TEXT NOT NULL,
        stoppedAt TEXT,
        error TEXT,
        FOREIGN KEY (engagementId) REFERENCES engagements(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS events (
        id TEXT PRIMARY KEY,
        engagementId TEXT NOT NULL,
        sessionId TEXT NOT NULL,
        type TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        dataJson TEXT DEFAULT '{}',
        FOREIGN KEY (engagementId) REFERENCES engagements(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS findings (
        id TEXT PRIMARY KEY,
        engagementId TEXT NOT NULL,
        sessionId TEXT NOT NULL,
        findingJson TEXT NOT NULL,
        severity TEXT NOT NULL,
        status TEXT NOT NULL,
        createdAt TEXT NOT NULL,
        FOREIGN KEY (engagementId) REFERENCES engagements(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS evidence (
        id TEXT PRIMARY KEY,
        engagementId TEXT NOT NULL,
        sessionId TEXT NOT NULL,
        type TEXT NOT NULL,
        tool TEXT NOT NULL,
        hash TEXT NOT NULL,
        evidenceJson TEXT NOT NULL,
        createdAt TEXT NOT NULL,
        FOREIGN KEY (engagementId) REFERENCES engagements(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS audit_entries (
        id TEXT PRIMARY KEY,
        engagementId TEXT NOT NULL,
        sessionId TEXT NOT NULL,
        kind TEXT NOT NULL,
        detailJson TEXT DEFAULT '{}',
        timestamp TEXT NOT NULL,
        FOREIGN KEY (engagementId) REFERENCES engagements(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_events_engagement ON events(engagementId);
      CREATE INDEX IF NOT EXISTS idx_events_session ON events(sessionId);
      CREATE INDEX IF NOT EXISTS idx_events_type ON events(type);
      CREATE INDEX IF NOT EXISTS idx_events_timestamp ON events(timestamp);
      CREATE INDEX IF NOT EXISTS idx_findings_engagement ON findings(engagementId);
      CREATE INDEX IF NOT EXISTS idx_findings_severity ON findings(severity);
      CREATE INDEX IF NOT EXISTS idx_findings_status ON findings(status);
      CREATE INDEX IF NOT EXISTS idx_evidence_engagement ON evidence(engagementId);
      CREATE INDEX IF NOT EXISTS idx_audit_engagement ON audit_entries(engagementId);
      CREATE INDEX IF NOT EXISTS idx_sessions_engagement ON sessions(engagementId);
    `);
  }

  close(): void {
    this.db.close();
  }

  // --- Engagements ---
  createEngagement(e: Omit<Engagement, 'createdAt' | 'updatedAt'>): Engagement {
    const now = new Date().toISOString();
    const stmt = this.db.prepare(`
      INSERT INTO engagements (id, name, description, targetUrl, targetName, scopeJson, status, sessionId, backend, model, thinkingEnabled, createdAt, updatedAt, startedAt, stoppedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      e.id,
      e.name,
      e.description,
      e.targetUrl,
      e.targetName,
      e.scopeJson,
      e.status,
      e.sessionId,
      e.backend,
      e.model,
      e.thinkingEnabled ? 1 : 0,
      now,
      now,
      e.startedAt,
      e.stoppedAt,
    );
    return this.getEngagement(e.id) as Engagement;
  }

  getEngagement(id: string): Engagement | undefined {
    const row = this.db.prepare('SELECT * FROM engagements WHERE id = ?').get(id) as
      | Engagement
      | undefined;
    return row ? { ...row, thinkingEnabled: !!row.thinkingEnabled } : undefined;
  }

  listEngagements(): Engagement[] {
    const rows = this.db
      .prepare('SELECT * FROM engagements ORDER BY createdAt DESC')
      .all() as Engagement[];
    return rows.map((r) => ({ ...r, thinkingEnabled: !!r.thinkingEnabled }));
  }

  updateEngagement(id: string, patch: Partial<Engagement>): void {
    const fields: string[] = [];
    const values: unknown[] = [];
    for (const [k, v] of Object.entries(patch)) {
      if (k === 'id' || k === 'createdAt') continue;
      fields.push(`${k} = ?`);
      values.push(v);
    }
    fields.push('updatedAt = ?');
    values.push(new Date().toISOString());
    values.push(id);
    this.db.prepare(`UPDATE engagements SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  }

  deleteEngagement(id: string): boolean {
    const result = this.db.prepare('DELETE FROM engagements WHERE id = ?').run(id);
    return result.changes > 0;
  }

  // --- Sessions ---
  createSession(s: Omit<Session, 'startedAt'>): Session {
    const now = new Date().toISOString();
    this.db
      .prepare(`
      INSERT INTO sessions (id, engagementId, status, startedAt, stoppedAt, error)
      VALUES (?, ?, ?, ?, ?, ?)
    `)
      .run(s.id, s.engagementId, s.status, now, s.stoppedAt, s.error);
    return { ...s, startedAt: now };
  }

  getSession(id: string): Session | undefined {
    return this.db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as Session | undefined;
  }

  listSessions(engagementId: string): Session[] {
    return this.db
      .prepare('SELECT * FROM sessions WHERE engagementId = ? ORDER BY startedAt DESC')
      .all(engagementId) as Session[];
  }

  updateSession(id: string, patch: Partial<Session>): void {
    const fields: string[] = [];
    const values: unknown[] = [];
    for (const [k, v] of Object.entries(patch)) {
      if (k === 'id' || k === 'engagementId' || k === 'startedAt') continue;
      fields.push(`${k} = ?`);
      values.push(v);
    }
    values.push(id);
    if (fields.length > 0) {
      this.db.prepare(`UPDATE sessions SET ${fields.join(', ')} WHERE id = ?`).run(...values);
    }
  }

  // --- Events ---
  insertEvent(e: StoredEvent): void {
    this.db
      .prepare(`
      INSERT INTO events (id, engagementId, sessionId, type, timestamp, dataJson)
      VALUES (?, ?, ?, ?, ?, ?)
    `)
      .run(e.id, e.engagementId, e.sessionId, e.type, e.timestamp, e.dataJson);
  }

  listEvents(
    engagementId: string,
    filter?: { types?: string[]; since?: string; limit?: number },
  ): StoredEvent[] {
    let query = 'SELECT * FROM events WHERE engagementId = ?';
    const params: unknown[] = [engagementId];

    if (filter?.types && filter.types.length > 0) {
      query += ` AND type IN (${filter.types.map(() => '?').join(',')})`;
      params.push(...filter.types);
    }
    if (filter?.since) {
      query += ' AND timestamp >= ?';
      params.push(filter.since);
    }
    query += ' ORDER BY timestamp DESC';
    query += ' LIMIT ?';
    params.push(filter?.limit ?? 100);

    return this.db.prepare(query).all(...params) as StoredEvent[];
  }

  // --- Findings ---
  insertFinding(f: StoredFinding): void {
    this.db
      .prepare(`
      INSERT INTO findings (id, engagementId, sessionId, findingJson, severity, status, createdAt)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `)
      .run(f.id, f.engagementId, f.sessionId, f.findingJson, f.severity, f.status, f.createdAt);
  }

  listFindings(
    engagementId: string,
    filter?: { severity?: string; status?: string },
  ): StoredFinding[] {
    let query = 'SELECT * FROM findings WHERE engagementId = ?';
    const params: unknown[] = [engagementId];
    if (filter?.severity) {
      query += ' AND severity = ?';
      params.push(filter.severity);
    }
    if (filter?.status) {
      query += ' AND status = ?';
      params.push(filter.status);
    }
    query += ' ORDER BY createdAt DESC';
    return this.db.prepare(query).all(...params) as StoredFinding[];
  }

  getFinding(id: string): StoredFinding | undefined {
    return this.db.prepare('SELECT * FROM findings WHERE id = ?').get(id) as
      | StoredFinding
      | undefined;
  }

  // --- Evidence ---
  insertEvidence(e: StoredEvidence): void {
    this.db
      .prepare(`
      INSERT INTO evidence (id, engagementId, sessionId, type, tool, hash, evidenceJson, createdAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `)
      .run(e.id, e.engagementId, e.sessionId, e.type, e.tool, e.hash, e.evidenceJson, e.createdAt);
  }

  listEvidence(engagementId: string): StoredEvidence[] {
    return this.db
      .prepare('SELECT * FROM evidence WHERE engagementId = ? ORDER BY createdAt DESC')
      .all(engagementId) as StoredEvidence[];
  }

  getEvidence(id: string): StoredEvidence | undefined {
    return this.db.prepare('SELECT * FROM evidence WHERE id = ?').get(id) as
      | StoredEvidence
      | undefined;
  }

  // --- Audit ---
  insertAuditEntry(e: StoredAuditEntry): void {
    this.db
      .prepare(`
      INSERT INTO audit_entries (id, engagementId, sessionId, kind, detailJson, timestamp)
      VALUES (?, ?, ?, ?, ?, ?)
    `)
      .run(e.id, e.engagementId, e.sessionId, e.kind, e.detailJson, e.timestamp);
  }

  listAuditEntries(engagementId: string, filter?: { kinds?: string[] }): StoredAuditEntry[] {
    let query = 'SELECT * FROM audit_entries WHERE engagementId = ?';
    const params: unknown[] = [engagementId];
    if (filter?.kinds && filter.kinds.length > 0) {
      query += ` AND kind IN (${filter.kinds.map(() => '?').join(',')})`;
      params.push(...filter.kinds);
    }
    query += ' ORDER BY timestamp DESC';
    return this.db.prepare(query).all(...params) as StoredAuditEntry[];
  }

  // --- Stats ---
  getStats() {
    const engagements = (
      this.db.prepare('SELECT COUNT(*) as count FROM engagements').get() as { count: number }
    ).count;
    const running = (
      this.db
        .prepare("SELECT COUNT(*) as count FROM engagements WHERE status = 'running'")
        .get() as { count: number }
    ).count;
    const findings = (
      this.db.prepare('SELECT COUNT(*) as count FROM findings').get() as { count: number }
    ).count;
    const evidence = (
      this.db.prepare('SELECT COUNT(*) as count FROM evidence').get() as { count: number }
    ).count;
    const events = (
      this.db.prepare('SELECT COUNT(*) as count FROM events').get() as { count: number }
    ).count;
    return { engagements, running, findings, evidence, events };
  }
}
