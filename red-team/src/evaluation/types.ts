export interface EvaluationMetrics {
  reconCoverage: number;
  endpointDiscoveryRate: number;
  vulnerabilityDetectionRate: number;
  confirmedFindingRate: number;
  falsePositiveRate: number;
  evidenceQuality: number;
  retestSuccessRate: number;
  timeToFinding: number;
  toolEfficiency: number;
  agentIterations: number;
  scopeCompliance: number;
  learningEffectiveness: number;
}

export interface MetricEntry {
  name: string;
  value: number;
  unit?: string;
  timestamp: string;
}

export interface EvaluationSnapshot {
  timestamp: string;
  sessionId?: string;
  metrics: MetricEntry[];
}
