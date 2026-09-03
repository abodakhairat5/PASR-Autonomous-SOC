// Next Best Action recommender. Takes the planner's output and
// formats it into actionable recommendations for the agent.
// The agent uses these recommendations to make informed decisions
// about what to do next.

import type { CoverageEntry } from '../coverage/store.js';
import { AdaptiveDecisionPlanner, type PlannedAction, type PlannerContext } from './planner.js';
import type { Experience, ExperienceCategory } from './types.js';

export interface NextActionRecommendation {
  primary: PlannedAction;
  alternatives: PlannedAction[];
  reasoning: string;
  context: {
    coveragePercent: number;
    successRate: number;
    totalActions: number;
    currentPhase: ExperienceCategory;
  };
}

export interface NextActionConfig {
  maxAlternatives: number;
  minConfidence: number;
}

const DEFAULT_CONFIG: NextActionConfig = {
  maxAlternatives: 3,
  minConfidence: 0.3,
};

export class NextBestAction {
  private planner: AdaptiveDecisionPlanner;
  private config: NextActionConfig;

  constructor(config: Partial<NextActionConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.planner = new AdaptiveDecisionPlanner({ maxActions: 10 });
  }

  async recommend(context: PlannerContext): Promise<NextActionRecommendation | null> {
    const actions = await this.planner.plan(context);

    // Filter by minimum confidence
    const viable = actions.filter((a) => a.confidence >= this.config.minConfidence);

    if (viable.length === 0) return null;

    const primary = viable[0] as PlannedAction;
    const alternatives = viable.slice(1, this.config.maxAlternatives + 1);

    const coveragePercent = this.calculateCoverage(context.coverage, context.targets);
    const successRate = this.calculateSuccessRate(context.experiences);
    const reasoning = this.buildReasoning(primary, coveragePercent, successRate, context);

    return {
      primary,
      alternatives,
      reasoning,
      context: {
        coveragePercent,
        successRate,
        totalActions: context.experiences.length,
        currentPhase: context.currentPhase,
      },
    };
  }

  formatRecommendation(rec: NextActionRecommendation): string {
    const lines: string[] = [];

    lines.push('## Next Action Recommendation');
    lines.push('');
    lines.push(`**Action:** ${rec.primary.description}`);
    lines.push(`**Target:** ${rec.primary.target}`);
    lines.push(`**Priority:** ${rec.primary.priority}`);
    lines.push(`**Confidence:** ${(rec.primary.confidence * 100).toFixed(0)}%`);
    lines.push(`**Estimated Duration:** ${(rec.primary.estimatedDuration / 1000).toFixed(0)}s`);
    lines.push('');
    lines.push(`**Rationale:** ${rec.primary.rationale}`);
    lines.push(`**Suggested Approach:** ${rec.primary.suggestedApproach}`);
    lines.push('');

    if (rec.alternatives.length > 0) {
      lines.push('**Alternatives:**');
      for (const alt of rec.alternatives) {
        lines.push(`- ${alt.description} (confidence: ${(alt.confidence * 100).toFixed(0)}%)`);
      }
      lines.push('');
    }

    lines.push('**Context:**');
    lines.push(`- Coverage: ${rec.context.coveragePercent.toFixed(1)}%`);
    lines.push(`- Success Rate: ${(rec.context.successRate * 100).toFixed(1)}%`);
    lines.push(`- Total Actions: ${rec.context.totalActions}`);
    lines.push(`- Current Phase: ${rec.context.currentPhase}`);

    return lines.join('\n');
  }

  private calculateCoverage(coverage: CoverageEntry[], targets: string[]): number {
    if (targets.length === 0) return 0;
    const coveredTargets = new Set(coverage.map((c) => c.endpoint));
    const covered = targets.filter((t) => coveredTargets.has(t)).length;
    return (covered / targets.length) * 100;
  }

  private calculateSuccessRate(experiences: Experience[]): number {
    if (experiences.length === 0) return 0;
    const successes = experiences.filter((e) => e.outcome === 'success').length;
    return successes / experiences.length;
  }

  private buildReasoning(
    primary: PlannedAction,
    coverage: number,
    successRate: number,
    _context: PlannerContext,
  ): string {
    const parts: string[] = [];

    if (coverage < 30) {
      parts.push('Coverage is low; prioritizing new targets');
    } else if (coverage < 70) {
      parts.push('Moderate coverage; balancing new and existing targets');
    } else {
      parts.push('Good coverage; focusing on depth over breadth');
    }

    if (successRate > 0.7) {
      parts.push('High success rate; continuing with proven approaches');
    } else if (successRate > 0.4) {
      parts.push('Moderate success rate; mixing proven and new approaches');
    } else {
      parts.push('Low success rate; trying alternative techniques');
    }

    if (primary.priority === 'critical' || primary.priority === 'high') {
      parts.push('High-priority target identified');
    }

    return `${parts.join('. ')}.`;
  }
}
