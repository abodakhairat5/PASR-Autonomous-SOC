// Adaptive decision planner that recommends the next best action
// based on coverage gaps, experience patterns, and engagement context.
// The planner is advisory — the agent or operator makes the final decision.

import type { CoverageEntry } from '../coverage/store.js';
import type { Experience, ExperienceCategory } from './types.js';

export type PlannerPriority = 'critical' | 'high' | 'medium' | 'low';

export interface PlannedAction {
  actionId: string;
  category: ExperienceCategory;
  description: string;
  target: string;
  priority: PlannerPriority;
  rationale: string;
  suggestedApproach: string;
  estimatedDuration: number;
  confidence: number;
}

export interface PlannerContext {
  coverage: CoverageEntry[];
  experiences: Experience[];
  findings: Array<{ severity: string; target: string }>;
  currentPhase: ExperienceCategory;
  targets: string[];
}

export interface PlannerConfig {
  maxActions: number;
  prioritizeHighSeverity: boolean;
  balanceCategories: boolean;
}

const DEFAULT_PLANNER_CONFIG: PlannerConfig = {
  maxActions: 5,
  prioritizeHighSeverity: true,
  balanceCategories: true,
};

export class AdaptiveDecisionPlanner {
  private config: PlannerConfig;

  constructor(config: Partial<PlannerConfig> = {}) {
    this.config = { ...DEFAULT_PLANNER_CONFIG, ...config };
  }

  async plan(context: PlannerContext): Promise<PlannedAction[]> {
    const actions: PlannedAction[] = [];

    // 1. Identify coverage gaps
    const gaps = this.findCoverageGaps(context);
    actions.push(...gaps);

    // 2. Suggest follow-ups for successful patterns
    const followUps = this.suggestFollowUps(context);
    actions.push(...followUps);

    // 3. Suggest new approaches for failed patterns
    const alternatives = this.suggestAlternatives(context);
    actions.push(...alternatives);

    // 4. Prioritize based on findings
    const prioritized = this.prioritize(actions, context);

    return prioritized.slice(0, this.config.maxActions);
  }

  private findCoverageGaps(context: PlannerContext): PlannedAction[] {
    const actions: PlannedAction[] = [];
    const coveredEndpoints = new Set(context.coverage.map((c) => `${c.endpoint}:${c.param}`));

    for (const target of context.targets) {
      const vulnClasses = ['sqli', 'xss', 'ssrf', 'idor', 'auth-bypass'];
      for (const vulnClass of vulnClasses) {
        const key = `${target}:${vulnClass}`;
        if (!coveredEndpoints.has(key)) {
          actions.push({
            actionId: `gap_${target}_${vulnClass}`,
            category: 'exploit',
            description: `Test for ${vulnClass} on ${target}`,
            target,
            priority: 'high',
            rationale: `No coverage for ${vulnClass} on ${target}`,
            suggestedApproach: this.getSuggestedApproach(vulnClass),
            estimatedDuration: 30_000,
            confidence: 0.7,
          });
        }
      }
    }

    return actions;
  }

  private suggestFollowUps(context: PlannerContext): PlannedAction[] {
    const actions: PlannedAction[] = [];
    const recentSuccesses = context.experiences.filter((e) => e.outcome === 'success').slice(-5);

    for (const exp of recentSuccesses) {
      if (exp.category === 'recon') {
        actions.push({
          actionId: `followup_scan_${exp.target}`,
          category: 'scan',
          description: `Deep scan on ${exp.target} (recon successful)`,
          target: exp.target,
          priority: 'medium',
          rationale: `Reconnaissance on ${exp.target} succeeded; expand scanning`,
          suggestedApproach: 'Run comprehensive port/service scan',
          estimatedDuration: 60_000,
          confidence: 0.8,
        });
      }
      if (exp.category === 'scan') {
        actions.push({
          actionId: `followup_exploit_${exp.target}`,
          category: 'exploit',
          description: `Attempt exploitation on ${exp.target} (scan completed)`,
          target: exp.target,
          priority: 'medium',
          rationale: `Scan on ${exp.target} completed; try exploitation`,
          suggestedApproach: 'Test discovered services for known vulnerabilities',
          estimatedDuration: 120_000,
          confidence: 0.6,
        });
      }
    }

    return actions;
  }

  private suggestAlternatives(context: PlannerContext): PlannedAction[] {
    const actions: PlannedAction[] = [];
    const recentFailures = context.experiences
      .filter((e) => e.outcome === 'failure' || e.outcome === 'blocked')
      .slice(-3);

    for (const exp of recentFailures) {
      actions.push({
        actionId: `alt_${exp.category}_${exp.target}`,
        category: exp.category,
        description: `Alternative approach for ${exp.category} on ${exp.target}`,
        target: exp.target,
        priority: 'low',
        rationale: `Previous ${exp.category} attempt on ${exp.target} failed; try alternative`,
        suggestedApproach: 'Try different technique or tool',
        estimatedDuration: exp.duration,
        confidence: 0.4,
      });
    }

    return actions;
  }

  private prioritize(actions: PlannedAction[], context: PlannerContext): PlannedAction[] {
    const severityMap = new Map<string, number>();
    for (const finding of context.findings) {
      const severity = this.severityToNumber(finding.severity);
      const current = severityMap.get(finding.target) ?? 0;
      severityMap.set(finding.target, Math.max(current, severity));
    }

    return actions.sort((a, b) => {
      // Higher severity targets get priority
      const aSeverity = severityMap.get(a.target) ?? 0;
      const bSeverity = severityMap.get(b.target) ?? 0;
      if (aSeverity !== bSeverity) return bSeverity - aSeverity;

      // Then by priority level
      const priorityOrder = { critical: 4, high: 3, medium: 2, low: 1 };
      const aPriority = priorityOrder[a.priority];
      const bPriority = priorityOrder[b.priority];
      if (aPriority !== bPriority) return bPriority - aPriority;

      // Then by confidence
      return b.confidence - a.confidence;
    });
  }

  private getSuggestedApproach(vulnClass: string): string {
    const approaches: Record<string, string> = {
      sqli: 'Test input parameters with SQL injection payloads',
      xss: 'Test input reflection and context for XSS',
      ssrf: 'Test URL parameters for server-side request forgery',
      idor: 'Test object references for authorization bypass',
      'auth-bypass': 'Test authentication mechanisms for bypass',
    };
    return approaches[vulnClass] ?? 'Test for general vulnerabilities';
  }

  private severityToNumber(severity: string): number {
    switch (severity.toLowerCase()) {
      case 'critical':
        return 4;
      case 'high':
        return 3;
      case 'medium':
        return 2;
      case 'low':
        return 1;
      default:
        return 0;
    }
  }
}
