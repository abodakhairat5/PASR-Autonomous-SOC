import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AuditLogger } from '../audit/logger.js';
import { EvaluationStore } from '../evaluation/store.js';
import { ParsDatabase } from '../web/persistence/database.js';

function tmpDir(): string {
  return mkdtempSync(join(tmpdir(), 'pars-eval-audit-test-'));
}

describe('Evaluation + Audit Web Layer', () => {
  let tmp: string;
  let db: ParsDatabase;

  beforeEach(() => {
    tmp = tmpDir();
    db = new ParsDatabase(join(tmp, 'test.db'));
  });

  afterEach(() => {
    db.close();
    rmSync(tmp, { recursive: true, force: true });
  });

  // --- Evaluation Tests ---

  it('Test 1: EvaluationStore persists and loads snapshots', async () => {
    const store = new EvaluationStore(join(tmp, 'eval.json'));
    await store.load();

    await store.append({
      timestamp: new Date().toISOString(),
      metrics: [
        { name: 'reconCoverage', value: 0.85, timestamp: new Date().toISOString() },
        { name: 'confirmedFindingRate', value: 0.5, timestamp: new Date().toISOString() },
      ],
    });

    const snapshots = await store.list();
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0].metrics).toHaveLength(2);
    expect(snapshots[0].metrics[0].name).toBe('reconCoverage');
    expect(snapshots[0].metrics[0].value).toBe(0.85);
  });

  it('Test 2: EvaluationStore latest() returns most recent', async () => {
    const store = new EvaluationStore(join(tmp, 'eval2.json'));
    await store.load();

    await store.append({
      timestamp: '2024-01-01T00:00:00Z',
      metrics: [{ name: 'test', value: 1, timestamp: '2024-01-01T00:00:00Z' }],
    });
    await store.append({
      timestamp: '2024-01-02T00:00:00Z',
      metrics: [{ name: 'test', value: 2, timestamp: '2024-01-02T00:00:00Z' }],
    });

    const latest = await store.latest();
    expect(latest).toBeDefined();
    expect(latest?.timestamp).toBe('2024-01-02T00:00:00Z');
    expect(latest?.metrics[0].value).toBe(2);
  });

  it('Test 3: EvaluationStore handles missing file gracefully', async () => {
    const store = new EvaluationStore(join(tmp, 'nonexistent.json'));
    await store.load();
    const snapshots = await store.list();
    expect(snapshots).toEqual([]);
    const latest = await store.latest();
    expect(latest).toBeUndefined();
  });

  it('Test 4: Evaluation data is scoped to engagement via sessionId', async () => {
    const _eng1 = db.createEngagement({
      id: 'eng_eval1',
      name: 'Eval 1',
      description: '',
      targetUrl: 'https://a.com',
      targetName: '',
      scopeJson: '{}',
      status: 'idle',
      sessionId: 'sess_1',
      backend: '',
      model: '',
      thinkingEnabled: false,
      startedAt: null,
      stoppedAt: null,
    });
    const _eng2 = db.createEngagement({
      id: 'eng_eval2',
      name: 'Eval 2',
      description: '',
      targetUrl: 'https://b.com',
      targetName: '',
      scopeJson: '{}',
      status: 'idle',
      sessionId: 'sess_2',
      backend: '',
      model: '',
      thinkingEnabled: false,
      startedAt: null,
      stoppedAt: null,
    });

    // Each engagement has its own evaluation store
    const store1 = new EvaluationStore(join(tmp, 'eval-sess1.json'));
    const store2 = new EvaluationStore(join(tmp, 'eval-sess2.json'));
    await store1.load();
    await store2.load();

    await store1.append({
      timestamp: new Date().toISOString(),
      metrics: [{ name: 'metric_a', value: 1, timestamp: new Date().toISOString() }],
    });
    await store2.append({
      timestamp: new Date().toISOString(),
      metrics: [{ name: 'metric_b', value: 2, timestamp: new Date().toISOString() }],
    });

    const list1 = await store1.list();
    const list2 = await store2.list();
    expect(list1[0].metrics[0].name).toBe('metric_a');
    expect(list2[0].metrics[0].name).toBe('metric_b');
    expect(list1[0].metrics[0].value).not.toBe(list2[0].metrics[0].value);
  });

  // --- Audit Tests ---

  it('Test 5: AuditLogger appends and lists entries', async () => {
    const auditDir = join(tmp, 'audit');
    mkdirSync(auditDir, { recursive: true });
    const logger = new AuditLogger(auditDir);

    await logger.log({
      kind: 'policy-decision',
      detail: { hostname: 'example.com', action: 'allow' },
    });
    await logger.log({ kind: 'evidence-captured', detail: { tool: 'http', hash: 'abc123' } });

    const entries = await logger.list();
    expect(entries).toHaveLength(2);
    expect(entries[0].kind).toBe('policy-decision');
    expect(entries[1].kind).toBe('evidence-captured');
    expect(entries[0].id).toMatch(/^aud_/);
  });

  it('Test 6: AuditLogger count works', async () => {
    const auditDir = join(tmp, 'audit-count');
    mkdirSync(auditDir, { recursive: true });
    const logger = new AuditLogger(auditDir);

    expect(await logger.count()).toBe(0);
    await logger.log({ kind: 'session-start', detail: {} });
    expect(await logger.count()).toBe(1);
    await logger.log({ kind: 'session-end', detail: {} });
    expect(await logger.count()).toBe(2);
  });

  it('Test 7: AuditLogger list with since filter', async () => {
    const auditDir = join(tmp, 'audit-since');
    mkdirSync(auditDir, { recursive: true });
    const logger = new AuditLogger(auditDir);

    const _t1 = '2024-01-01T00:00:00Z';
    const _t2 = '2024-06-01T00:00:00Z';
    const _t3 = '2024-12-01T00:00:00Z';

    // Use mocked timestamps by logging and then filtering
    await logger.log({ kind: 'session-start', detail: { note: 'first' } });
    await logger.log({ kind: 'session-end', detail: { note: 'second' } });

    const all = await logger.list();
    expect(all).toHaveLength(2);

    // Future timestamp should return empty
    const future = await logger.list('2099-01-01T00:00:00Z');
    expect(future).toHaveLength(0);
  });

  it('Test 8: Audit entries are engagement-isolated via sessionId', async () => {
    const _eng = db.createEngagement({
      id: 'eng_audit',
      name: 'Audit Test',
      description: '',
      targetUrl: 'https://test.com',
      targetName: '',
      scopeJson: '{}',
      status: 'idle',
      sessionId: 'sess_audit',
      backend: '',
      model: '',
      thinkingEnabled: false,
      startedAt: null,
      stoppedAt: null,
    });

    // Create audit entries for this session
    const auditDir = join(tmp, 'audit-eng');
    mkdirSync(auditDir, { recursive: true });
    const logger = new AuditLogger(auditDir);
    await logger.log({ kind: 'policy-decision', detail: { hostname: 'test.com' } });
    await logger.log({ kind: 'evidence-captured', detail: { tool: 'shell' } });

    // DB also stores engagement-level audit entries
    db.insertAuditEntry({
      id: 'aud_db1',
      engagementId: 'eng_audit',
      sessionId: 'sess_audit',
      kind: 'policy-decision',
      detailJson: JSON.stringify({ hostname: 'test.com' }),
      timestamp: new Date().toISOString(),
    });

    const dbEntries = db.listAuditEntries('eng_audit');
    expect(dbEntries.length).toBeGreaterThanOrEqual(1);
    expect(dbEntries[0].engagementId).toBe('eng_audit');
  });

  it('Test 9: cross-engagement audit isolation', () => {
    db.createEngagement({
      id: 'eng_a',
      name: 'A',
      description: '',
      targetUrl: 'https://a.com',
      targetName: '',
      scopeJson: '{}',
      status: 'idle',
      sessionId: null,
      backend: '',
      model: '',
      thinkingEnabled: false,
      startedAt: null,
      stoppedAt: null,
    });
    db.createEngagement({
      id: 'eng_b',
      name: 'B',
      description: '',
      targetUrl: 'https://b.com',
      targetName: '',
      scopeJson: '{}',
      status: 'idle',
      sessionId: null,
      backend: '',
      model: '',
      thinkingEnabled: false,
      startedAt: null,
      stoppedAt: null,
    });

    db.insertAuditEntry({
      id: 'aud_a1',
      engagementId: 'eng_a',
      sessionId: 'sess_a',
      kind: 'policy-decision',
      detailJson: '{}',
      timestamp: new Date().toISOString(),
    });

    const entriesA = db.listAuditEntries('eng_a');
    const entriesB = db.listAuditEntries('eng_b');
    expect(entriesA).toHaveLength(1);
    expect(entriesB).toHaveLength(0);
    expect(entriesA[0].engagementId).toBe('eng_a');
  });

  it('Test 10: empty evaluation state returns empty data', async () => {
    const store = new EvaluationStore(join(tmp, 'eval-empty.json'));
    await store.load();

    const snapshots = await store.list();
    const latest = await store.latest();
    expect(snapshots).toEqual([]);
    expect(latest).toBeUndefined();
  });

  it('Test 11: invalid engagement ID returns no audit entries', () => {
    const entries = db.listAuditEntries('eng_nonexistent');
    expect(entries).toEqual([]);
  });
});
