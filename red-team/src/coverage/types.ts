// Extended coverage types for exploit and vulnerability class tracking.
// Builds on the existing CoverageEntry to add exploit-specific metadata
// for tracking which exploits have been attempted and their outcomes.

export type ExploitStatus = 'attempted' | 'confirmed' | 'failed' | 'not-applicable';

export interface ExploitCoverageEntry {
  exploitId: string;
  target: string; // endpoint or host
  vulnClass: string;
  status: ExploitStatus;
  count: number;
  firstSeen: number;
  lastSeen: number;
  notes?: string;
  evidenceIds?: string[];
}

export interface VulnerabilityClassCoverage {
  vulnClass: string;
  totalAttempts: number;
  confirmed: number;
  failed: number;
  notApplicable: number;
  lastAttempted?: number;
  endpoints: string[];
}

export interface CoverageGap {
  endpoint: string;
  param: string;
  vulnClass: string;
  priority: 'high' | 'medium' | 'low';
  reason: string;
}

export interface ExtendedCoverageSummary {
  total: number;
  byStatus: Record<ExploitStatus, number>;
  byVulnClass: Record<string, VulnerabilityClassCoverage>;
  gaps: CoverageGap[];
  lastUpdated: number;
}
