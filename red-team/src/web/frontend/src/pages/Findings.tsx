import { useNavigate } from 'react-router-dom';
import { useEngagements, useFindings } from '../hooks/useApi';

export function FindingsPage() {
  const { data: engagements } = useEngagements();

  return (
    <div>
      <h1 style={{ fontSize: 24, fontWeight: 700, margin: '0 0 24px' }}>Findings</h1>
      <p style={{ color: '#888', fontSize: 14, marginBottom: 24 }}>
        Findings across all engagements.
      </p>
      {engagements?.map((eng) => (
        <EngagementFindings key={eng.id} engagementId={eng.id} engagementName={eng.name} />
      ))}
      {engagements && engagements.length === 0 && (
        <p style={{ color: '#666' }}>No engagements yet.</p>
      )}
    </div>
  );
}

function EngagementFindings({
  engagementId,
  engagementName,
}: { engagementId: string; engagementName: string }) {
  const { data: findings } = useFindings(engagementId);
  const nav = useNavigate();

  if (!findings || findings.length === 0) return null;

  return (
    <div style={{ marginBottom: 24 }}>
      <button
        type="button"
        onClick={() => nav(`/engagements/${engagementId}`)}
        style={{
          background: 'none',
          border: 'none',
          color: '#7c5cff',
          cursor: 'pointer',
          padding: 0,
          fontSize: 16,
          fontWeight: 600,
          marginBottom: 8,
        }}
      >
        {engagementName}
      </button>
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
              gap: 12,
              padding: '8px 12px',
              background: '#111122',
              borderRadius: 6,
              marginBottom: 6,
              alignItems: 'center',
            }}
          >
            <span
              style={{
                fontSize: 11,
                fontWeight: 700,
                padding: '2px 8px',
                borderRadius: 4,
                background:
                  f.severity === 'critical' || f.severity === 'high'
                    ? '#ef4444'
                    : f.severity === 'medium'
                      ? '#f59e0b'
                      : '#3b82f6',
                color: '#fff',
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
