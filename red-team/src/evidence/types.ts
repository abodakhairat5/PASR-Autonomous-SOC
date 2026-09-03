export type EvidenceType = 'http' | 'command' | 'browser' | 'mcp' | 'other';

export interface EvidenceTarget {
  url?: string;
  host?: string;
  port?: number;
  protocol?: string;
}

export interface EvidenceProvenance {
  sessionId?: string;
  turnId?: string;
  toolCallId?: string;
}

export interface Evidence {
  id: string;
  type: EvidenceType;
  createdAt: string;
  target?: EvidenceTarget;
  tool: string;
  request?: unknown;
  response?: unknown;
  command?: string;
  output?: string;
  exitCode?: number;
  hash?: string;
  provenance?: EvidenceProvenance;
}
