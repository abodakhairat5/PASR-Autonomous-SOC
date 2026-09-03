import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { api } from '../api/client';
import type { UpdateScopeInput } from '../api/types';

// Engagements
export const useEngagements = () =>
  useQuery({ queryKey: ['engagements'], queryFn: api.listEngagements });

export const useEngagement = (id: string) =>
  useQuery({ queryKey: ['engagements', id], queryFn: () => api.getEngagement(id), enabled: !!id });

export const useCreateEngagement = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: api.createEngagement,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['engagements'] }),
  });
};

export const useDeleteEngagement = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: api.deleteEngagement,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['engagements'] }),
  });
};

// Scope
export const useScope = (id: string) =>
  useQuery({
    queryKey: ['engagements', id, 'scope'],
    queryFn: () => api.getScope(id),
    enabled: !!id,
  });

export const useUpdateScope = (id: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateScopeInput) => api.updateScope(id, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['engagements', id, 'scope'] }),
  });
};

// Control
export const useStartEngagement = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: api.startEngagement,
    onSuccess: (_data, id) => qc.invalidateQueries({ queryKey: ['engagements', id] }),
  });
};

export const useStopEngagement = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: api.stopEngagement,
    onSuccess: (_data, id) => qc.invalidateQueries({ queryKey: ['engagements', id] }),
  });
};

// Events
export const useEvents = (
  id: string,
  params?: { types?: string[]; since?: string; limit?: number },
) =>
  useQuery({
    queryKey: ['engagements', id, 'events', params],
    queryFn: () => api.getEvents(id, params),
    enabled: !!id,
  });

// SSE Hook
export function useEventStream(engagementId: string | null) {
  const [events, setEvents] = useState<Array<{ type: string; data: unknown }>>([]);
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    if (!engagementId) return;
    const es = api.streamEvents(engagementId);
    esRef.current = es;

    es.onmessage = (msg) => {
      try {
        const data = JSON.parse(msg.data);
        setEvents((prev) => [...prev.slice(-500), data]);
      } catch {
        // keep-alive
      }
    };

    return () => {
      es.close();
      esRef.current = null;
    };
  }, [engagementId]);

  return events;
}

// Findings
export const useFindings = (id: string) =>
  useQuery({
    queryKey: ['engagements', id, 'findings'],
    queryFn: () => api.getFindings(id),
    enabled: !!id,
  });

export const useRetestFinding = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: api.retestFinding,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['findings'] }),
  });
};

// Evidence
export const useEvidence = (id: string) =>
  useQuery({
    queryKey: ['engagements', id, 'evidence'],
    queryFn: () => api.getEvidence(id),
    enabled: !!id,
  });

// Coverage
export const useCoverage = (id: string) =>
  useQuery({
    queryKey: ['engagements', id, 'coverage'],
    queryFn: () => api.getCoverage(id),
    enabled: !!id,
  });

// Evaluation
export const useEvaluation = (id: string) =>
  useQuery({
    queryKey: ['engagements', id, 'evaluation'],
    queryFn: () => api.getEvaluation(id),
    enabled: !!id,
  });

// Audit
export const useAudit = (
  id: string,
  params?: { kind?: string[]; since?: string; limit?: number },
) =>
  useQuery({
    queryKey: ['engagements', id, 'audit', params],
    queryFn: () => api.getAudit(id, params),
    enabled: !!id,
  });

// Permissions
export const usePendingPermissions = (id: string) =>
  useQuery({
    queryKey: ['engagements', id, 'permissions'],
    queryFn: () => api.getPendingPermissions(id),
    enabled: !!id,
    refetchInterval: 2000,
  });

export const useResolvePermission = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      engagementId,
      requestId,
      decision,
    }: {
      engagementId: string;
      requestId: string;
      decision: 'approve' | 'deny';
    }) => api.resolvePermission(engagementId, requestId, decision),
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({
        queryKey: ['engagements', variables.engagementId, 'permissions'],
      });
    },
  });
};

// Health
export const useHealth = () =>
  useQuery({ queryKey: ['health'], queryFn: api.health, refetchInterval: 5000 });
