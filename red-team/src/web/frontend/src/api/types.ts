export interface Engagement {
  id: string;
  name: string;
  description: string;
  targetUrl: string;
  targetName: string;
  scopeJson: string;
  status: 'idle' | 'running' | 'stopped' | 'completed' | 'error';
  sessionId: string | null;
  backend: string;
  model: string;
  thinkingEnabled: boolean;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  stoppedAt: string | null;
}

export interface EngagementScope {
  allowedHosts?: string[];
  allowedPorts?: string[];
  disallowedPaths?: string[];
  rules?: string[];
  [key: string]: unknown;
}

export interface Session {
  id: string;
  engagementId: string;
  status: string;
  stoppedAt: string | null;
  error: string | null;
}

export interface AgentEvent {
  id: string;
  engagementId: string;
  sessionId: string;
  type: string;
  timestamp: string;
  dataJson: string;
}

export interface Finding {
  id: string;
  engagementId: string;
  sessionId: string;
  findingJson: string;
  severity: string;
  status: string;
  createdAt: string;
}

export interface Evidence {
  id: string;
  engagementId: string;
  sessionId: string;
  type: string;
  tool: string;
  hash: string;
  evidenceJson: string;
  createdAt: string;
}

export interface AuditEntry {
  id: string;
  engagementId: string;
  sessionId: string;
  kind: string;
  detailJson: string;
  timestamp: string;
}

export interface CoverageData {
  entries: Array<{
    area: string;
    status: string;
    vulnClass?: string;
    [key: string]: unknown;
  }>;
  summary: {
    total: number;
    byStatus: Record<string, number>;
    byVulnClass: Record<string, number>;
  };
}

export interface EvaluationData {
  snapshots: Array<{
    id: string;
    timestamp: string;
    metrics: Array<{ name: string; value: number; unit?: string; timestamp: string }>;
    [key: string]: unknown;
  }>;
  latest: {
    id: string;
    timestamp: string;
    metrics: Array<{ name: string; value: number; unit?: string; timestamp: string }>;
    [key: string]: unknown;
  } | null;
}

export interface HealthData {
  status: string;
  version: string;
  uptime: number;
  stats: Record<string, number>;
  sseClients: number;
}

export interface CreateEngagementInput {
  name: string;
  description?: string;
  targetUrl: string;
  targetName?: string;
  scope?: EngagementScope;
  backend?: string;
  model?: string;
  thinkingEnabled?: boolean;
}

export interface UpdateScopeInput {
  scope: EngagementScope;
}

export interface ApiResponse<T> {
  data: T;
  total?: number;
  error?: string;
}

export interface PendingPermission {
  id: string;
  tool: string;
  summary: string;
  detail: string;
  timestamp: string;
}

export interface PermissionRequiredEvent {
  type: 'permission-required';
  sessionId: string;
  requestId: string;
  tool: string;
  summary: string;
  detail: string;
}

export interface PermissionDecisionEvent {
  type: 'permission-approved' | 'permission-denied';
  sessionId: string;
  requestId: string;
  decision: string;
  tool: string;
  summary: string;
  reason?: string;
}
