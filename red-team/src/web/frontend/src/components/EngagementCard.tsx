import type { Engagement } from '../api/types';

const statusColors: Record<string, string> = {
  idle: '#666',
  running: '#22c55e',
  stopped: '#f59e0b',
  completed: '#3b82f6',
  error: '#ef4444',
};

export function StatusBadge({ status }: { status: string }) {
  const color = statusColors[status] ?? '#666';
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        fontSize: 12,
        color,
        fontWeight: 600,
        textTransform: 'uppercase',
      }}
    >
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: color }} />
      {status}
    </span>
  );
}

function formatDate(iso: string | null): string {
  if (!iso) return '-';
  return new Date(iso).toLocaleString();
}

export function EngagementCard({ engagement }: { engagement: Engagement }) {
  return (
    <div
      style={{
        border: '1px solid #1a1a2e',
        borderRadius: 8,
        padding: 16,
        background: '#111122',
        transition: 'border-color 0.15s',
        cursor: 'pointer',
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLElement).style.borderColor = '#7c5cff';
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLElement).style.borderColor = '#1a1a2e';
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          marginBottom: 8,
        }}
      >
        <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600, color: '#e0e0e0' }}>
          {engagement.name}
        </h3>
        <StatusBadge status={engagement.status} />
      </div>
      {engagement.description && (
        <p style={{ margin: '0 0 8px', fontSize: 13, color: '#888' }}>{engagement.description}</p>
      )}
      <div style={{ fontSize: 12, color: '#666', display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        <span>Target: {engagement.targetUrl || '-'}</span>
        <span>Model: {engagement.model || engagement.backend || '-'}</span>
        <span>Created: {formatDate(engagement.createdAt)}</span>
      </div>
    </div>
  );
}
