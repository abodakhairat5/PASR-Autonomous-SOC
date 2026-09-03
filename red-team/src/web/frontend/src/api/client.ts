import type {
  AgentEvent,
  ApiResponse,
  AuditEntry,
  CoverageData,
  CreateEngagementInput,
  Engagement,
  EngagementScope,
  EvaluationData,
  Evidence,
  Finding,
  HealthData,
  PendingPermission,
  UpdateScopeInput,
} from './types';

const BASE_URL = '/api';

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const hasBody = options?.body !== undefined;
  const defaultHeaders: Record<string, string> = hasBody
    ? { 'Content-Type': 'application/json' }
    : {};
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: defaultHeaders,
    ...options,
  });
  const body = (await res.json()) as ApiResponse<T>;
  if (!res.ok) {
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return body.data;
}

export const api = {
  health: () => request<HealthData>('/health'),

  // Engagements
  listEngagements: () => request<Engagement[]>('/engagements'),

  getEngagement: (id: string) => request<Engagement>(`/engagements/${id}`),

  createEngagement: (input: CreateEngagementInput) =>
    request<Engagement>('/engagements', {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  deleteEngagement: (id: string) =>
    fetch(`${BASE_URL}/engagements/${id}`, { method: 'DELETE' }).then(() => undefined),

  // Scope
  getScope: (id: string) => request<EngagementScope>(`/engagements/${id}/scope`),

  updateScope: (id: string, input: UpdateScopeInput) =>
    request<EngagementScope>(`/engagements/${id}/scope`, {
      method: 'PUT',
      body: JSON.stringify(input),
    }),

  // Control
  startEngagement: (id: string) =>
    request<{ sessionId: string }>(`/engagements/${id}/start`, { method: 'POST' }),

  stopEngagement: (id: string) =>
    request<{ status: string }>(`/engagements/${id}/stop`, { method: 'POST' }),

  getStatus: (id: string) =>
    request<{
      status: string;
      sessionId: string | null;
      startedAt: string | null;
      stoppedAt: string | null;
    }>(`/engagements/${id}/status`),

  // Events
  getEvents: (id: string, params?: { types?: string[]; since?: string; limit?: number }) => {
    const qs = new URLSearchParams();
    if (params?.types) qs.set('types', params.types.join(','));
    if (params?.since) qs.set('since', params.since);
    if (params?.limit) qs.set('limit', String(params.limit));
    const query = qs.toString();
    return request<AgentEvent[]>(`/engagements/${id}/events${query ? `?${query}` : ''}`);
  },

  // SSE stream — returns an EventSource
  streamEvents: (id: string): EventSource => {
    return new EventSource(`${BASE_URL}/engagements/${id}/events/stream`);
  },

  // Findings
  getFindings: (id: string) => request<Finding[]>(`/engagements/${id}/findings`),

  getFinding: (id: string) => request<Finding>(`/findings/${id}`),

  retestFinding: (id: string) =>
    request<{ status: string; findingId: string }>(`/findings/${id}/retest`, { method: 'POST' }),

  // Evidence
  getEvidence: (id: string) => request<Evidence[]>(`/engagements/${id}/evidence`),

  getEvidenceItem: (id: string) => request<Evidence>(`/evidence/${id}`),

  // Coverage
  getCoverage: (id: string) => request<CoverageData>(`/engagements/${id}/coverage`),

  // Evaluation
  getEvaluation: (id: string) => request<EvaluationData>(`/engagements/${id}/evaluation`),

  // Audit
  getAudit: (id: string, params?: { kind?: string[]; since?: string; limit?: number }) => {
    const qs = new URLSearchParams();
    if (params?.kind) qs.set('kind', params.kind.join(','));
    if (params?.since) qs.set('since', params.since);
    if (params?.limit) qs.set('limit', String(params.limit));
    const query = qs.toString();
    return request<AuditEntry[]>(`/engagements/${id}/audit${query ? `?${query}` : ''}`);
  },

  // Permissions
  getPendingPermissions: (engagementId: string) =>
    request<PendingPermission[]>(`/engagements/${engagementId}/permissions/pending`),

  resolvePermission: (engagementId: string, requestId: string, decision: 'approve' | 'deny') =>
    request<{ requestId: string; decision: string }>(
      `/engagements/${engagementId}/permissions/${requestId}/decision`,
      { method: 'POST', body: JSON.stringify({ decision }) },
    ),
};
