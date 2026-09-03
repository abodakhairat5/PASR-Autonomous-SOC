import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type { EngagementScope } from '../api/types';
import { StatusBadge } from '../components/EngagementCard';
import { EventStream } from '../components/EventStream';
import { PermissionApprovalModal } from '../components/PermissionApprovalModal';
import {
  useAudit,
  useDeleteEngagement,
  useEngagement,
  useEvaluation,
  useEvents,
  useEvidence,
  useFindings,
  usePendingPermissions,
  useScope,
  useStartEngagement,
  useStopEngagement,
  useUpdateScope,
} from '../hooks/useApi';

export function EngagementDetailPage() {
  const { id } = useParams<{ id: string }>();
  const nav = useNavigate();
  const { data: eng, isLoading } = useEngagement(id ?? '');
  const start = useStartEngagement();
  const stop = useStopEngagement();
  const del = useDeleteEngagement();
  const { data: events } = useEvents(id ?? '', { limit: 100 });
  const { data: findings } = useFindings(id ?? '');
  const { data: evidence } = useEvidence(id ?? '');
  const { data: pendingPermissions } = usePendingPermissions(id ?? '');

  if (!id) return <p style={{ color: '#ef4444' }}>Invalid engagement ID</p>;
  if (isLoading) return <p style={{ color: '#888' }}>Loading...</p>;
  if (!eng) return <p style={{ color: '#ef4444' }}>Engagement not found</p>;

  const isRunning = eng.status === 'running';

  return (
    <div>
      <PermissionApprovalModal permissions={pendingPermissions ?? []} engagementId={id} />
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          marginBottom: 24,
        }}
      >
        <div>
          <button
            type="button"
            onClick={() => nav('/')}
            style={{
              background: 'none',
              border: 'none',
              color: '#7c5cff',
              cursor: 'pointer',
              padding: 0,
              marginBottom: 8,
              fontSize: 13,
            }}
          >
            ← Back to engagements
          </button>
          <h1 style={{ margin: 0, fontSize: 24, fontWeight: 700 }}>{eng.name}</h1>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 4 }}>
            <StatusBadge status={eng.status} />
            <span style={{ fontSize: 12, color: '#666' }}>ID: {eng.id}</span>
          </div>
          {eng.description && <p style={{ color: '#888', marginTop: 8 }}>{eng.description}</p>}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {!isRunning ? (
            <button
              type="button"
              onClick={() => start.mutate(id)}
              disabled={start.isPending}
              style={{
                background: '#22c55e',
                color: '#fff',
                border: 'none',
                borderRadius: 6,
                padding: '8px 16px',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              ▶ Start
            </button>
          ) : (
            <button
              type="button"
              onClick={() => stop.mutate(id)}
              disabled={stop.isPending}
              style={{
                background: '#f59e0b',
                color: '#000',
                border: 'none',
                borderRadius: 6,
                padding: '8px 16px',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              ■ Stop
            </button>
          )}
          <button
            type="button"
            onClick={async () => {
              if (confirm('Delete this engagement?')) {
                await del.mutateAsync(id);
                nav('/');
              }
            }}
            style={{
              background: '#ef4444',
              color: '#fff',
              border: 'none',
              borderRadius: 6,
              padding: '8px 16px',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Delete
          </button>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 24 }}>
        <InfoCard label="Target" value={eng.targetUrl || '-'} />
        <InfoCard label="Model" value={eng.model || eng.backend || '-'} />
        <InfoCard
          label="Started"
          value={eng.startedAt ? new Date(eng.startedAt).toLocaleString() : '-'}
        />
        <InfoCard label="Findings" value={String(findings?.length ?? 0)} />
      </div>

      <Tabs
        tabs={['Scope', 'Events', 'Findings', 'Evidence', 'Evaluation', 'Audit']}
        defaultTab="Events"
      >
        {(tab) => {
          if (tab === 'Scope') return <ScopePanel engagementId={id} />;
          if (tab === 'Events')
            return isRunning ? (
              <EventStream engagementId={id} />
            ) : (
              <EventList events={events ?? []} />
            );
          if (tab === 'Findings') return <FindingsList findings={findings ?? []} />;
          if (tab === 'Evidence') return <EvidenceList evidence={evidence ?? []} />;
          if (tab === 'Evaluation') return <EvaluationPanel engagementId={id} />;
          return <AuditPanel engagementId={id} />;
        }}
      </Tabs>
    </div>
  );
}

function InfoCard({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{ background: '#111122', border: '1px solid #1a1a2e', borderRadius: 8, padding: 14 }}
    >
      <div
        style={{
          fontSize: 11,
          color: '#666',
          textTransform: 'uppercase',
          letterSpacing: 1,
          marginBottom: 4,
        }}
      >
        {label}
      </div>
      <div style={{ fontSize: 14, color: '#e0e0e0', wordBreak: 'break-all' }}>{value}</div>
    </div>
  );
}

function Tabs({
  tabs,
  defaultTab,
  children,
}: { tabs: string[]; defaultTab: string; children: (tab: string) => React.ReactNode }) {
  const [active, setActive] = useState(defaultTab);
  return (
    <div>
      <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid #1a1a2e', marginBottom: 16 }}>
        {tabs.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setActive(t)}
            style={{
              background: 'none',
              border: 'none',
              borderBottom: active === t ? '2px solid #7c5cff' : '2px solid transparent',
              color: active === t ? '#7c5cff' : '#888',
              padding: '8px 16px',
              cursor: 'pointer',
              fontSize: 14,
              fontWeight: 500,
            }}
          >
            {t}
          </button>
        ))}
      </div>
      {children(active)}
    </div>
  );
}

function ScopePanel({ engagementId }: { engagementId: string }) {
  const { data: scope } = useScope(engagementId);
  const updateScope = useUpdateScope(engagementId);
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(JSON.stringify(scope ?? {}, null, 2));

  const handleSave = async () => {
    try {
      const parsed = JSON.parse(text) as EngagementScope;
      await updateScope.mutateAsync({ scope: parsed });
      setEditing(false);
    } catch {
      alert('Invalid JSON');
    }
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
        <span style={{ fontSize: 13, color: '#888' }}>Scope configuration (JSON)</span>
        <div style={{ display: 'flex', gap: 8 }}>
          {editing ? (
            <>
              <button type="button" onClick={handleSave} style={btnGreen}>
                Save
              </button>
              <button type="button" onClick={() => setEditing(false)} style={btnGray}>
                Cancel
              </button>
            </>
          ) : (
            <button type="button" onClick={() => setEditing(true)} style={btnGray}>
              Edit
            </button>
          )}
        </div>
      </div>
      <pre
        style={{
          background: '#0a0a0f',
          border: '1px solid #1a1a2e',
          borderRadius: 8,
          padding: 16,
          fontSize: 13,
          overflow: 'auto',
          maxHeight: 400,
          margin: 0,
        }}
      >
        {editing ? (
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            style={{
              width: '100%',
              minHeight: 300,
              background: 'transparent',
              border: 'none',
              color: '#e0e0e0',
              fontFamily: 'monospace',
              fontSize: 13,
              resize: 'vertical',
              outline: 'none',
            }}
          />
        ) : (
          JSON.stringify(scope ?? {}, null, 2)
        )}
      </pre>
      {updateScope.isError && (
        <p style={{ color: '#ef4444', fontSize: 13, marginTop: 4 }}>{updateScope.error.message}</p>
      )}
    </div>
  );
}

function EventList({
  events,
}: { events: Array<{ id: string; type: string; timestamp: string; dataJson: string }> }) {
  return (
    <div style={{ maxHeight: 500, overflow: 'auto' }}>
      {events.length === 0 && <p style={{ color: '#666' }}>No events yet.</p>}
      {events.map((evt) => {
        let detail = '';
        try {
          const d = JSON.parse(evt.dataJson);
          detail = d.name ?? d.type ?? '';
        } catch {
          /* */
        }
        return (
          <div
            key={evt.id}
            style={{
              display: 'flex',
              gap: 12,
              padding: '6px 0',
              borderBottom: '1px solid #111',
              fontSize: 13,
            }}
          >
            <span style={{ color: '#7c5cff', minWidth: 120, fontFamily: 'monospace' }}>
              {evt.type}
            </span>
            <span style={{ color: '#888', flex: 1 }}>{detail}</span>
            <span style={{ color: '#555', fontSize: 11 }}>
              {new Date(evt.timestamp).toLocaleTimeString()}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function FindingsList({
  findings,
}: { findings: Array<{ id: string; severity: string; status: string; findingJson: string }> }) {
  const severityColor: Record<string, string> = {
    critical: '#ef4444',
    high: '#f59e0b',
    medium: '#3b82f6',
    low: '#666',
    info: '#555',
  };
  return (
    <div>
      {findings.length === 0 && <p style={{ color: '#666' }}>No findings yet.</p>}
      {findings.map((f) => {
        let title = f.id;
        try {
          const d = JSON.parse(f.findingJson);
          title = d.title ?? d.name ?? f.id;
        } catch {
          /* */
        }
        return (
          <div
            key={f.id}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              padding: '10px 0',
              borderBottom: '1px solid #111',
            }}
          >
            <span
              style={{
                background: severityColor[f.severity] ?? '#666',
                color: '#fff',
                fontSize: 11,
                fontWeight: 700,
                padding: '2px 8px',
                borderRadius: 4,
                textTransform: 'uppercase',
              }}
            >
              {f.severity}
            </span>
            <span style={{ flex: 1, fontSize: 14 }}>{title}</span>
            <span style={{ color: '#888', fontSize: 12 }}>{f.status}</span>
          </div>
        );
      })}
    </div>
  );
}

function EvidenceList({
  evidence,
}: {
  evidence: Array<{ id: string; type: string; tool: string; hash: string; createdAt: string }>;
}) {
  return (
    <div>
      {evidence.length === 0 && <p style={{ color: '#666' }}>No evidence captured yet.</p>}
      {evidence.map((ev) => (
        <div
          key={ev.id}
          style={{
            display: 'flex',
            gap: 12,
            padding: '8px 0',
            borderBottom: '1px solid #111',
            fontSize: 13,
          }}
        >
          <span style={{ color: '#7c5cff', fontFamily: 'monospace', minWidth: 100 }}>
            {ev.tool}
          </span>
          <span
            style={{
              color: '#888',
              fontFamily: 'monospace',
              flex: 1,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {ev.hash}
          </span>
          <span style={{ color: '#555' }}>{new Date(ev.createdAt).toLocaleTimeString()}</span>
        </div>
      ))}
    </div>
  );
}

function EvaluationPanel({ engagementId }: { engagementId: string }) {
  const { data: evaluation, isLoading } = useEvaluation(engagementId);

  if (isLoading) return <p style={{ color: '#888' }}>Loading evaluation...</p>;

  const latest = evaluation?.latest;
  const snapshots = evaluation?.snapshots ?? [];

  if (!latest && snapshots.length === 0) {
    return (
      <div>
        <p style={{ color: '#666', marginBottom: 16 }}>No evaluation data available yet.</p>
        <p style={{ color: '#555', fontSize: 13 }}>
          Evaluation metrics are generated when the agent completes an engagement session.
        </p>
      </div>
    );
  }

  return (
    <div>
      {latest && (
        <div style={{ marginBottom: 24 }}>
          <h3 style={{ fontSize: 14, fontWeight: 600, color: '#e0e0e0', marginBottom: 12 }}>
            Latest Evaluation
          </h3>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
              gap: 12,
            }}
          >
            {(latest.metrics ?? []).map((m) => (
              <div
                key={m.name}
                style={{
                  background: '#111122',
                  border: '1px solid #1a1a2e',
                  borderRadius: 8,
                  padding: 12,
                }}
              >
                <div
                  style={{
                    fontSize: 11,
                    color: '#666',
                    textTransform: 'uppercase',
                    letterSpacing: 0.5,
                    marginBottom: 4,
                  }}
                >
                  {m.name}
                </div>
                <div style={{ fontSize: 18, fontWeight: 700, color: '#e0e0e0' }}>
                  {m.unit === 'ratio'
                    ? `${(m.value * 100).toFixed(1)}%`
                    : m.unit === 'ms'
                      ? `${(m.value / 1000).toFixed(1)}s`
                      : m.value.toFixed(2)}
                </div>
                {m.unit && (
                  <div style={{ fontSize: 11, color: '#555', marginTop: 2 }}>{m.unit}</div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {snapshots.length > 1 && (
        <div>
          <h3 style={{ fontSize: 14, fontWeight: 600, color: '#e0e0e0', marginBottom: 8 }}>
            Snapshot History ({snapshots.length})
          </h3>
          <div style={{ fontSize: 13, color: '#666' }}>
            {snapshots
              .slice(-5)
              .reverse()
              .map((s) => (
                <div key={s.timestamp} style={{ padding: '4px 0', borderBottom: '1px solid #111' }}>
                  {new Date(s.timestamp).toLocaleString()} — {s.metrics?.length ?? 0} metrics
                </div>
              ))}
          </div>
        </div>
      )}
    </div>
  );
}

function AuditPanel({ engagementId }: { engagementId: string }) {
  const [filterKind, setFilterKind] = useState<string[]>([]);
  const { data: entries, isLoading } = useAudit(engagementId, {
    kind: filterKind.length > 0 ? filterKind : undefined,
    limit: 100,
  });

  const kindColors: Record<string, string> = {
    'policy-decision': '#3b82f6',
    'evidence-captured': '#22c55e',
    'experience-recorded': '#a855f7',
    'session-start': '#f59e0b',
    'session-end': '#ef4444',
    'permission-required': '#f59e0b',
    'permission-approved': '#22c55e',
    'permission-denied': '#ef4444',
  };

  const allKinds = [
    'policy-decision',
    'evidence-captured',
    'experience-recorded',
    'session-start',
    'session-end',
  ];

  const toggleKind = (kind: string) => {
    setFilterKind((prev) =>
      prev.includes(kind) ? prev.filter((k) => k !== kind) : [...prev, kind],
    );
  };

  return (
    <div>
      <div style={{ display: 'flex', gap: 6, marginBottom: 16, flexWrap: 'wrap' }}>
        {allKinds.map((kind) => (
          <button
            key={kind}
            type="button"
            onClick={() => toggleKind(kind)}
            style={{
              background: filterKind.includes(kind) ? '#7c5cff' : '#1a1a2e',
              color: filterKind.includes(kind) ? '#fff' : '#888',
              border: '1px solid #2a2a3e',
              borderRadius: 4,
              padding: '4px 10px',
              fontSize: 12,
              cursor: 'pointer',
            }}
          >
            {kind}
          </button>
        ))}
        {filterKind.length > 0 && (
          <button
            type="button"
            onClick={() => setFilterKind([])}
            style={{
              background: 'none',
              border: 'none',
              color: '#7c5cff',
              cursor: 'pointer',
              fontSize: 12,
            }}
          >
            Clear
          </button>
        )}
      </div>

      {isLoading && <p style={{ color: '#888' }}>Loading audit trail...</p>}

      {!isLoading && (!entries || entries.length === 0) && (
        <p style={{ color: '#666' }}>No audit entries found.</p>
      )}

      {entries?.map((entry) => (
        <div
          key={entry.id}
          style={{
            display: 'flex',
            gap: 12,
            padding: '8px 0',
            borderBottom: '1px solid #111',
            fontSize: 13,
          }}
        >
          <span style={{ color: '#555', minWidth: 80, fontSize: 11 }}>
            {new Date(entry.timestamp).toLocaleTimeString()}
          </span>
          <span
            style={{
              background: kindColors[entry.kind] ?? '#666',
              color: '#fff',
              fontSize: 10,
              fontWeight: 700,
              padding: '2px 6px',
              borderRadius: 3,
              textTransform: 'uppercase',
              minWidth: 100,
              textAlign: 'center',
            }}
          >
            {entry.kind}
          </span>
          <span style={{ color: '#888', flex: 1, fontFamily: 'monospace', fontSize: 12 }}>
            {entry.id}
          </span>
        </div>
      ))}
    </div>
  );
}

const btnGreen = {
  background: '#22c55e',
  color: '#fff',
  border: 'none',
  borderRadius: 6,
  padding: '6px 14px',
  fontSize: 13,
  fontWeight: 600 as const,
  cursor: 'pointer' as const,
};
const btnGray = {
  background: '#1a1a2e',
  color: '#aaa',
  border: '1px solid #2a2a3e',
  borderRadius: 6,
  padding: '6px 14px',
  fontSize: 13,
  cursor: 'pointer' as const,
};
