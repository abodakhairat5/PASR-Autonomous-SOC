import { useHealth } from '../hooks/useApi';

export function HealthBadge() {
  const { data, isLoading, isError } = useHealth();

  const bg = isError
    ? '#ff4444'
    : isLoading
      ? '#666'
      : data?.status === 'ok'
        ? '#22c55e'
        : '#f59e0b';
  const text = isError ? 'OFFLINE' : isLoading ? '...' : `v${data?.version ?? '?'}`;

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
      <span
        style={{
          width: 8,
          height: 8,
          borderRadius: '50%',
          background: bg,
          display: 'inline-block',
        }}
      />
      <span style={{ color: '#888' }}>{text}</span>
    </div>
  );
}
