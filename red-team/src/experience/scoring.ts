// Experience scoring for comparing and ranking experiences.
// Provides quantitative metrics for adaptive decision making.

import type {
  Experience,
  ExperienceCategory,
  ExperienceOutcome,
  ExperiencePattern,
} from './types.js';

export interface ScoredExperience {
  experience: Experience;
  score: number;
  factors: ScoreFactors;
}

export interface ScoreFactors {
  recency: number;
  success: number;
  efficiency: number;
  relevance: number;
}

export interface ScoringConfig {
  recencyWeight: number;
  successWeight: number;
  efficiencyWeight: number;
  relevanceWeight: number;
  maxAgeMs: number;
}

const DEFAULT_CONFIG: ScoringConfig = {
  recencyWeight: 0.2,
  successWeight: 0.4,
  efficiencyWeight: 0.2,
  relevanceWeight: 0.2,
  maxAgeMs: 24 * 60 * 60 * 1000, // 24 hours
};

export function scoreExperience(
  experience: Experience,
  targetCategory?: ExperienceCategory,
  config: ScoringConfig = DEFAULT_CONFIG,
): ScoredExperience {
  const now = Date.now();
  const factors: ScoreFactors = {
    recency: calculateRecency(experience.timestamp, now, config.maxAgeMs),
    success: calculateSuccessScore(experience.outcome),
    efficiency: calculateEfficiency(experience.duration),
    relevance: calculateRelevance(experience.category, targetCategory),
  };

  const score =
    factors.recency * config.recencyWeight +
    factors.success * config.successWeight +
    factors.efficiency * config.efficiencyWeight +
    factors.relevance * config.relevanceWeight;

  return { experience, score, factors };
}

export function rankExperiences(
  experiences: Experience[],
  targetCategory?: ExperienceCategory,
  config?: ScoringConfig,
): ScoredExperience[] {
  return experiences
    .map((e) => scoreExperience(e, targetCategory, config))
    .sort((a, b) => b.score - a.score);
}

export function scorePattern(
  pattern: ExperiencePattern,
  targetCategory?: ExperienceCategory,
): number {
  const recencyFactor = Math.min(1, (Date.now() - pattern.lastSeen) / (7 * 24 * 60 * 60 * 1000));
  const successFactor = pattern.successRate;
  const volumeFactor = Math.min(1, pattern.totalAttempts / 10);
  const relevanceFactor = targetCategory && pattern.category === targetCategory ? 1 : 0.5;

  return (
    (1 - recencyFactor) * 0.2 + successFactor * 0.4 + volumeFactor * 0.2 + relevanceFactor * 0.2
  );
}

function calculateRecency(timestamp: number, now: number, maxAgeMs: number): number {
  const age = now - timestamp;
  if (age >= maxAgeMs) return 0;
  return 1 - age / maxAgeMs;
}

function calculateSuccessScore(outcome: ExperienceOutcome): number {
  switch (outcome) {
    case 'success':
      return 1;
    case 'partial':
      return 0.5;
    case 'failure':
      return 0.1;
    case 'timeout':
      return 0.2;
    case 'blocked':
      return 0;
    default:
      return 0;
  }
}

function calculateEfficiency(durationMs: number): number {
  // Optimal duration is around 10 seconds; very short or very long are less efficient
  if (durationMs <= 0) return 0;
  const optimalMs = 10_000;
  const ratio = durationMs / optimalMs;
  if (ratio <= 1) return 1;
  // Decay for longer durations
  return Math.max(0, 1 - (ratio - 1) * 0.1);
}

function calculateRelevance(
  category: ExperienceCategory,
  targetCategory?: ExperienceCategory,
): number {
  if (!targetCategory) return 0.5;
  return category === targetCategory ? 1 : 0.3;
}
