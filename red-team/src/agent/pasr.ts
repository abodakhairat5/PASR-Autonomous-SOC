// PASR integration layer: wires Policy Engine, Evidence Store, Experience Store,
// Extended Coverage, and Adaptive Planner into the agent loop.
//
// This is advisory — every PASR subsystem is optional. When present, the
// integration records experiences after tool calls, injects coverage/pattern
// context into the system prompt, and exposes a next-best-action planner.

import type { AuditLogger } from '../audit/logger.js';
import type { ExtendedCoverageStore } from '../coverage/extended.js';
import type { CoverageEntry } from '../coverage/store.js';
import type { EvidenceStore } from '../evidence/store.js';
import type { ExperienceStore } from '../experience/store.js';
import type { ExperienceCategory, ExperienceOutcome } from '../experience/types.js';
import { AdaptiveDecisionPlanner } from '../experience/planner.js';
import type { PlannedAction } from '../experience/planner.js';
import type { PolicyEngine } from '../policy/policy.js';
import type { AgentEvent } from './events.js';

export type PASREventSink = (e: AgentEvent) => void;

export interface PASROptions {
  policyEngine?: PolicyEngine;
  evidenceStore?: EvidenceStore;
  experienceStore?: ExperienceStore;
  extendedCoverage?: ExtendedCoverageStore;
  auditLogger?: AuditLogger;
}

export interface ExperienceRecordInput {
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
}

export class PASRIntegration {
  readonly policyEngine: PolicyEngine | undefined;
  readonly evidenceStore: EvidenceStore | undefined;
  readonly experienceStore: ExperienceStore | undefined;
  readonly extendedCoverage: ExtendedCoverageStore | undefined;
  readonly auditLogger: AuditLogger | undefined;
  private readonly planner: AdaptiveDecisionPlanner;
  private eventSink: PASREventSink | null = null;

  constructor(opts: PASROptions = {}) {
    this.policyEngine = opts.policyEngine;
    this.evidenceStore = opts.evidenceStore;
    this.experienceStore = opts.experienceStore;
    this.extendedCoverage = opts.extendedCoverage;
    this.auditLogger = opts.auditLogger;
    this.planner = new AdaptiveDecisionPlanner();

    // Wire event forwarding from subsystems. Callbacks are no-ops until
    // setEventSink() is called (typically once at the start of each run).
    this.policyEngine?.setCallbacks({
      onDecision: (ev) => this.eventSink?.(ev),
    });
    this.evidenceStore?.setCallbacks({
      onCaptured: (ev) => this.eventSink?.(ev),
    });
  }

  /** Set the event sink for forwarding PASR events to the UI.
   *  Called once per run() invocation with the agent's EventSink. */
  setEventSink(sink: PASREventSink): void {
    this.eventSink = sink;
  }

  /** True when at least one subsystem is configured. */
  get active(): boolean {
    return !!(
      this.policyEngine ||
      this.evidenceStore ||
      this.experienceStore ||
      this.extendedCoverage
    );
  }

  /** Record an experience after a tool call. Fire-and-forget — never throws. */
  async recordExperience(input: ExperienceRecordInput): Promise<void> {
    if (!this.experienceStore) return;
    try {
      const exp = await this.experienceStore.record(input);
      if (this.auditLogger) {
        void this.auditLogger.log({
          kind: 'experience-recorded',
          detail: {
            experienceId: exp.experienceId,
            category: input.category,
            action: input.action,
            outcome: input.outcome,
            target: input.target,
          },
        });
      }
    } catch {
      // Best-effort — a failed record never blocks the agent.
    }
  }

  /** Build the PASR context block to inject into the system prompt.
   *  Includes coverage stats, success patterns, and adaptive planner
   *  recommendations — the complete feedback loop from execution to planning. */
  async buildPromptContext(): Promise<string> {
    const sections: string[] = [];

    const coverageCtx = await this.coverageContext();
    if (coverageCtx) sections.push(coverageCtx);

    const patternsCtx = await this.patternsContext();
    if (patternsCtx) sections.push(patternsCtx);

    const plannerCtx = await this.plannerContext();
    if (plannerCtx) sections.push(plannerCtx);

    return sections.join('\n\n');
  }

  /** Get next-best-action recommendations from the adaptive planner. */
  async getNextActions(context: {
    coverage: CoverageEntry[];
    findings: Array<{ severity: string; target: string }>;
    currentPhase: ExperienceCategory;
    targets: string[];
  }): Promise<PlannedAction[]> {
    if (!this.experienceStore) return [];
    try {
      const experiences = await this.experienceStore.list();
      return await this.planner.plan({
        coverage: context.coverage,
        experiences,
        findings: context.findings,
        currentPhase: context.currentPhase,
        targets: context.targets,
      });
    } catch {
      return [];
    }
  }

  private async coverageContext(): Promise<string> {
    if (!this.extendedCoverage) return '';
    try {
      const summary = await this.extendedCoverage.summary();
      const exploitCount = summary.total;
      const confirmed = summary.byStatus.confirmed ?? 0;
      const failed = summary.byStatus.failed ?? 0;
      const notApplicable = summary.byStatus['not-applicable'] ?? 0;

      const lines: string[] = [
        '## Exploit Coverage (PASR)',
        `Total exploit attempts: ${exploitCount}`,
        `Confirmed: ${confirmed} | Failed: ${failed} | Not applicable: ${notApplicable}`,
      ];

      const byVulnClass = Object.values(summary.byVulnClass);
      if (byVulnClass.length > 0) {
        lines.push('');
        for (const vc of byVulnClass) {
          lines.push(
            `- ${vc.vulnClass}: ${vc.totalAttempts} attempts (${vc.confirmed} confirmed) across ${vc.endpoints.length} endpoint(s)`,
          );
        }
      }

      lines.push('');
      lines.push(
        'Use this to avoid repeating confirmed/failed exploit attempts unless explicitly asked.',
      );
      return lines.join('\n');
    } catch {
      return '';
    }
  }

  private async patternsContext(): Promise<string> {
    if (!this.experienceStore) return '';
    try {
      const patterns = await this.experienceStore.getPatterns();
      const highSuccess = patterns.filter((p) => p.successRate >= 0.7 && p.totalAttempts >= 2);
      if (highSuccess.length === 0) return '';

      const lines: string[] = [
        '## Successful Patterns (PASR)',
        'These approaches have a high success rate based on past experiences:',
      ];
      for (const p of highSuccess.slice(0, 5)) {
        const rate = Math.round(p.successRate * 100);
        lines.push(`- ${p.category}/${p.action}: ${rate}% success over ${p.totalAttempts} attempts`);
      }
      return lines.join('\n');
    } catch {
      return '';
    }
  }

  private async plannerContext(): Promise<string> {
    if (!this.experienceStore) return '';
    try {
      const experiences = await this.experienceStore.list();
      if (experiences.length === 0) return '';

      const targets = [...new Set(experiences.map((e) => e.target).filter(Boolean))];
      const lastExp = experiences[experiences.length - 1];
      const currentPhase = lastExp?.category ?? 'recon';

      const actions = await this.planner.plan({
        coverage: [],
        experiences,
        findings: [],
        currentPhase,
        targets,
      });

      if (actions.length === 0) return '';

      const lines: string[] = [
        '## Adaptive Planner Recommendations (PARS)',
        'Based on execution history and outcomes:',
      ];
      for (const a of actions.slice(0, 3)) {
        const confidence = Math.round(a.confidence * 100);
        lines.push(
          `- [${a.priority}] ${a.description} (target: ${a.target}, confidence: ${confidence}%)`,
        );
        if (a.suggestedApproach) {
          lines.push(`  approach: ${a.suggestedApproach}`);
        }
      }
      lines.push('');
      lines.push(
        'Use these recommendations to prioritize next actions. Do not repeat confirmed/failed attempts.',
      );
      return lines.join('\n');
    } catch {
      return '';
    }
  }
}
