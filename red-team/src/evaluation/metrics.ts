import type { CoverageStatus, CoverageStore } from '../coverage/store.js';
import type { EvidenceStore } from '../evidence/store.js';
import type { Finding } from '../findings/store.js';
import type { EvaluationSnapshot, MetricEntry } from './types.js';

export class EvaluationMetricsCollector {
  private readonly coverageStore: CoverageStore;
  private readonly evidenceStore: EvidenceStore;
  private startTime = Date.now();
  private iterations = 0;
  private scopeViolations = 0;
  private totalRequests = 0;

  constructor(coverageStore: CoverageStore, evidenceStore: EvidenceStore) {
    this.coverageStore = coverageStore;
    this.evidenceStore = evidenceStore;
  }

  recordIteration(): void {
    this.iterations += 1;
  }

  recordScopeViolation(): void {
    this.scopeViolations += 1;
  }

  recordRequest(): void {
    this.totalRequests += 1;
  }

  async collect(findings: Finding[], sessionId?: string): Promise<EvaluationSnapshot> {
    const coverageSummary = await this.coverageStore.summary();
    const evidenceCount = await this.evidenceStore.count();

    const confirmedFindings = findings.filter(
      (f) => f.status === 'confirmed' || f.status === 'retested',
    );
    const suspectedFindings = findings.filter((f) => f.status === 'suspected' || !f.status);

    const retestedFindings = findings.filter((f) => f.retest?.attempts && f.retest.attempts > 0);
    const retestConfirmed = retestedFindings.filter((f) => f.retest?.lastResult === 'confirmed');

    const metrics: MetricEntry[] = [
      {
        name: 'reconCoverage',
        value: computeReconCoverage(coverageSummary.byStatus),
        unit: 'ratio',
        timestamp: new Date().toISOString(),
      },
      {
        name: 'endpointDiscoveryRate',
        value: coverageSummary.total,
        unit: 'count',
        timestamp: new Date().toISOString(),
      },
      {
        name: 'vulnerabilityDetectionRate',
        value: findings.length,
        unit: 'count',
        timestamp: new Date().toISOString(),
      },
      {
        name: 'confirmedFindingRate',
        value: findings.length > 0 ? confirmedFindings.length / findings.length : 0,
        unit: 'ratio',
        timestamp: new Date().toISOString(),
      },
      {
        name: 'falsePositiveRate',
        value: findings.length > 0 ? suspectedFindings.length / findings.length : 0,
        unit: 'ratio',
        timestamp: new Date().toISOString(),
      },
      {
        name: 'evidenceQuality',
        value: evidenceCount > 0 ? Math.min(1, evidenceCount / Math.max(1, findings.length)) : 0,
        unit: 'ratio',
        timestamp: new Date().toISOString(),
      },
      {
        name: 'retestSuccessRate',
        value: retestedFindings.length > 0 ? retestConfirmed.length / retestedFindings.length : 0,
        unit: 'ratio',
        timestamp: new Date().toISOString(),
      },
      {
        name: 'timeToFinding',
        value: (Date.now() - this.startTime) / Math.max(1, findings.length),
        unit: 'ms',
        timestamp: new Date().toISOString(),
      },
      {
        name: 'toolEfficiency',
        value: this.iterations > 0 ? findings.length / this.iterations : 0,
        unit: 'findings/iteration',
        timestamp: new Date().toISOString(),
      },
      {
        name: 'agentIterations',
        value: this.iterations,
        unit: 'count',
        timestamp: new Date().toISOString(),
      },
      {
        name: 'scopeCompliance',
        value:
          this.totalRequests > 0
            ? (this.totalRequests - this.scopeViolations) / this.totalRequests
            : 1,
        unit: 'ratio',
        timestamp: new Date().toISOString(),
      },
      {
        name: 'learningEffectiveness',
        value: computeLearningEffectiveness(coverageSummary.byStatus),
        unit: 'ratio',
        timestamp: new Date().toISOString(),
      },
    ];

    return {
      timestamp: new Date().toISOString(),
      sessionId,
      metrics,
    };
  }
}

function computeReconCoverage(byStatus: Record<CoverageStatus, number>): number {
  const total = Object.values(byStatus).reduce((a, b) => a + b, 0);
  if (total === 0) return 0;
  const tested = byStatus.passed + byStatus.failed + byStatus.tried;
  return tested / total;
}

function computeLearningEffectiveness(byStatus: Record<CoverageStatus, number>): number {
  const total = Object.values(byStatus).reduce((a, b) => a + b, 0);
  if (total === 0) return 0;
  // Learning effectiveness = ratio of definitive results (passed + failed) to total
  const definitive = byStatus.passed + byStatus.failed;
  return definitive / total;
}

export function compareSnapshots(
  baseline: EvaluationSnapshot,
  enhanced: EvaluationSnapshot,
): Array<{ metric: string; baseline: number; enhanced: number; delta: number }> {
  const baseMap = new Map(baseline.metrics.map((m) => [m.name, m.value]));
  const enhancedMap = new Map(enhanced.metrics.map((m) => [m.name, m.value]));

  const allMetrics = new Set([...baseMap.keys(), ...enhancedMap.keys()]);
  const result: Array<{ metric: string; baseline: number; enhanced: number; delta: number }> = [];

  for (const name of allMetrics) {
    const b = baseMap.get(name) ?? 0;
    const e = enhancedMap.get(name) ?? 0;
    result.push({ metric: name, baseline: b, enhanced: e, delta: e - b });
  }

  return result;
}
