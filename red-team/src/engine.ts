// PARS Pentest Engine — Public API
//
// This is the reusable engine boundary. Import from here to embed PARS
// in a CLI, API server, or web frontend without pulling in Ink/React/CLI deps.
//
// Usage:
//   import { Agent, PolicyEngine, EvidenceStore, ... } from '@pentesterflow/agent/engine';

// --- Core Agent ---
export { Agent } from './agent/agent.js';
export type { AgentOptions, AgentRunOptions, EventSink } from './agent/agent.js';
export { PASRIntegration } from './agent/pasr.js';
export type { PASROptions, ExperienceRecordInput, PASREventSink } from './agent/pasr.js';
export type { AgentEvent } from './agent/events.js';

// --- Policy & Scope ---
export { PolicyEngine } from './policy/policy.js';
export type { PolicyEngineCallbacks } from './policy/policy.js';
export { RateLimiter } from './policy/rateLimiter.js';
export type { RateLimitConfig, RateLimitResult } from './policy/rateLimiter.js';
export { isInScope, matchesDomain, matchesIP, matchesCIDR } from './policy/scope.js';
export type { PolicyRequest, PolicyDecision, PolicyAction } from './policy/types.js';

// --- Evidence ---
export { EvidenceStore } from './evidence/store.js';
export type { EvidenceStoreCallbacks } from './evidence/store.js';
export { computeEvidenceHash } from './evidence/hash.js';
export { canReplay, replayDescription } from './evidence/replay.js';
export type {
  Evidence,
  EvidenceType,
  EvidenceTarget,
  EvidenceProvenance,
} from './evidence/types.js';

// --- Findings ---
export { Store as FindingsStore, slugify } from './findings/store.js';
export type { Finding, Severity, FindingStatus, RetestInfo } from './findings/store.js';

// --- Coverage ---
export { CoverageStore } from './coverage/store.js';
export type { CoverageEntry, CoverageStatus } from './coverage/store.js';
export { ExtendedCoverageStore } from './coverage/extended.js';
export type {
  ExploitCoverageEntry,
  ExploitStatus,
  VulnerabilityClassCoverage,
  CoverageGap,
  ExtendedCoverageSummary,
} from './coverage/types.js';

// --- Experience ---
export { ExperienceStore } from './experience/store.js';
export { AdaptiveDecisionPlanner } from './experience/planner.js';
export type { PlannedAction, PlannerContext, PlannerConfig } from './experience/planner.js';
export { scoreExperience, rankExperiences, scorePattern } from './experience/scoring.js';
export type { ScoredExperience, ScoreFactors, ScoringConfig } from './experience/scoring.js';
export type {
  Experience,
  ExperiencePattern,
  ExperienceSummary,
  ExperienceOutcome,
  ExperienceCategory,
} from './experience/types.js';

// --- Retest ---
export { RetestEngine } from './retest/engine.js';
export type { RetestResult, RetestState, RetestAttempt } from './retest/types.js';

// --- Evaluation ---
export { EvaluationMetricsCollector } from './evaluation/metrics.js';
export { EvaluationStore } from './evaluation/store.js';
export { compareSnapshots } from './evaluation/metrics.js';
export type { EvaluationMetrics, EvaluationSnapshot, MetricEntry } from './evaluation/types.js';

// --- Audit ---
export { AuditLogger } from './audit/logger.js';
export type { AuditEntry } from './audit/logger.js';

// --- Target ---
export { Target } from './target/target.js';
export type {
  TargetSnapshot,
  TargetSnapshotV2,
  EngagementScope,
  EngagementMode,
  Authorization,
  RateLimitConfig as TargetRateLimitConfig,
} from './target/target.js';

// --- Tools ---
export { Registry as ToolRegistry } from './tools/registry.js';
export type { Tool } from './tools/types.js';
export { HTTPTool } from './tools/http.js';
export { ShellTool, BashTool, rewritePortableCommand } from './tools/shell.js';
export { FileReadTool, FileWriteTool, FileEditTool } from './tools/file.js';
export { GlobTool } from './tools/search.js';
export { GrepTool } from './tools/search.js';
export { ConfirmFindingTool } from './tools/finding.js';
export type { FindingNotifier } from './tools/finding.js';

// --- Memory ---
export { MemoryStore, formatMemoryRecall } from './memory/store.js';
export type { MemoryFact, AddMemoryInput } from './memory/store.js';

// --- Redaction ---
export { redact } from './redact/index.js';
