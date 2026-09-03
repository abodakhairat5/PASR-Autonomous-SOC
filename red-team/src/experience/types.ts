// Structured experience types for tracking what worked, what didn't,
// and what the agent learned during the engagement. Experiences are
// the building blocks for adaptive planning and replay.

export type ExperienceOutcome = 'success' | 'failure' | 'partial' | 'timeout' | 'blocked';

export type ExperienceCategory =
  | 'recon'
  | 'scan'
  | 'exploit'
  | 'post-exploit'
  | 'report'
  | 'lateral-move'
  | 'privilege-escalation'
  | 'data-exfil';

export interface Experience {
  experienceId: string;
  timestamp: number;
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

export interface ExperiencePattern {
  patternId: string;
  category: ExperienceCategory;
  action: string;
  successRate: number;
  averageDuration: number;
  totalAttempts: number;
  lastSeen: number;
  tags: string[];
}

export interface ExperienceSummary {
  total: number;
  byOutcome: Record<ExperienceOutcome, number>;
  byCategory: Record<ExperienceCategory, number>;
  patterns: ExperiencePattern[];
  lastUpdated: number;
}
