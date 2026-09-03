import { existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { CoverageStore } from '../coverage/store.js';
import { EvidenceStore } from '../evidence/store.js';
import type { Finding } from '../findings/store.js';
import { EvaluationMetricsCollector, compareSnapshots } from './metrics.js';
import { EvaluationStore } from './store.js';

function tmpDir(): string {
  return join(tmpdir(), `pf-eval-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
}

describe('EvaluationMetricsCollector', () => {
  let dir: string;

  afterEach(() => {
    if (dir && existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  });

  it('collects metrics with no data', async () => {
    dir = tmpDir();
    const coverage = new CoverageStore(join(dir, 'coverage.json'));
    const evidence = new EvidenceStore(join(dir, 'evidence'));
    const collector = new EvaluationMetricsCollector(coverage, evidence);

    const snapshot = await collector.collect([]);
    expect(snapshot.metrics.length).toBe(12);
    expect(snapshot.metrics.find((m) => m.name === 'agentIterations')?.value).toBe(0);
    expect(snapshot.metrics.find((m) => m.name === 'scopeCompliance')?.value).toBe(1);
  });

  it('collects metrics with findings', async () => {
    dir = tmpDir();
    const coverage = new CoverageStore(join(dir, 'coverage.json'));
    const evidence = new EvidenceStore(join(dir, 'evidence'));
    const collector = new EvaluationMetricsCollector(coverage, evidence);

    collector.recordIteration();
    collector.recordIteration();

    const findings: Finding[] = [
      {
        title: 'XSS',
        severity: 'high',
        url: 'https://target/api',
        impact: 'RCE',
        createdAt: '',
        slug: 'xss',
        status: 'confirmed',
        evidenceIds: ['ev_1'],
      },
      {
        title: 'Info Leak',
        severity: 'low',
        url: 'https://target/api',
        impact: 'info',
        createdAt: '',
        slug: 'info-leak',
        status: 'suspected',
      },
    ];

    const snapshot = await collector.collect(findings, 'session-1');
    expect(snapshot.sessionId).toBe('session-1');
    const confirmed = snapshot.metrics.find((m) => m.name === 'confirmedFindingRate');
    expect(confirmed?.value).toBe(0.5);
  });

  it('compareSnapshots returns deltas', () => {
    const baseline = {
      timestamp: '',
      metrics: [
        { name: 'a', value: 1, timestamp: '' },
        { name: 'b', value: 2, timestamp: '' },
      ],
    };
    const enhanced = {
      timestamp: '',
      metrics: [
        { name: 'a', value: 3, timestamp: '' },
        { name: 'b', value: 2, timestamp: '' },
        { name: 'c', value: 5, timestamp: '' },
      ],
    };
    const diffs = compareSnapshots(baseline, enhanced);
    expect(diffs.find((d) => d.metric === 'a')?.delta).toBe(2);
    expect(diffs.find((d) => d.metric === 'b')?.delta).toBe(0);
    expect(diffs.find((d) => d.metric === 'c')?.delta).toBe(5);
  });
});

describe('EvaluationStore', () => {
  let dir: string;

  afterEach(() => {
    if (dir && existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  });

  it('persists and loads snapshots', async () => {
    dir = tmpDir();
    const store = new EvaluationStore(join(dir, 'eval.json'));
    await store.append({
      timestamp: '2026-01-01T00:00:00Z',
      metrics: [{ name: 'test', value: 1, timestamp: '' }],
    });
    const loaded = new EvaluationStore(join(dir, 'eval.json'));
    const snapshots = await loaded.list();
    expect(snapshots.length).toBe(1);
    expect(snapshots[0]?.metrics[0]?.name).toBe('test');
  });

  it('latest returns most recent', async () => {
    dir = tmpDir();
    const store = new EvaluationStore(join(dir, 'eval.json'));
    await store.append({ timestamp: 't1', metrics: [] });
    await store.append({ timestamp: 't2', metrics: [] });
    const latest = await store.latest();
    expect(latest?.timestamp).toBe('t2');
  });
});
