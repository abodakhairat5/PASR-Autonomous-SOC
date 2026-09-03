import { useState } from 'react';
import type { PendingPermission } from '../api/types';
import { useResolvePermission } from '../hooks/useApi';

interface Props {
  permissions: PendingPermission[];
  engagementId: string;
}

const riskColors: Record<string, string> = {
  high: '#ef4444',
  medium: '#f59e0b',
  low: '#22c55e',
};

export function PermissionApprovalModal({ permissions, engagementId }: Props) {
  if (permissions.length === 0) return null;

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: 'rgba(0,0,0,0.7)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
        padding: 20,
      }}
    >
      <div
        style={{ display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 500, width: '100%' }}
      >
        {permissions.map((perm) => (
          <PermissionCard key={perm.id} permission={perm} engagementId={engagementId} />
        ))}
      </div>
    </div>
  );
}

function PermissionCard({
  permission,
  engagementId,
}: {
  permission: PendingPermission;
  engagementId: string;
}) {
  const resolve = useResolvePermission();
  const [decided, setDecided] = useState<'approve' | 'deny' | null>(null);

  const handleDecision = async (decision: 'approve' | 'deny') => {
    setDecided(decision);
    await resolve.mutateAsync({
      engagementId,
      requestId: permission.id,
      decision,
    });
  };

  if (decided) {
    return (
      <div
        style={{
          background: '#111122',
          border: `1px solid ${decided === 'approve' ? '#22c55e' : '#ef4444'}`,
          borderRadius: 8,
          padding: 20,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <span
            style={{
              width: 10,
              height: 10,
              borderRadius: '50%',
              background: decided === 'approve' ? '#22c55e' : '#ef4444',
            }}
          />
          <span style={{ fontWeight: 600, color: decided === 'approve' ? '#22c55e' : '#ef4444' }}>
            {decided === 'approve' ? 'APPROVED' : 'DENIED'}
          </span>
        </div>
        <div style={{ fontSize: 13, color: '#888' }}>{permission.summary}</div>
      </div>
    );
  }

  // Parse detail for structured fields
  let detailText = permission.detail;
  let riskLevel = '';
  try {
    const parsed = JSON.parse(permission.detail) as Record<string, unknown>;
    if (typeof parsed.risk === 'string') riskLevel = parsed.risk;
    if (typeof parsed.detail === 'string') detailText = parsed.detail;
  } catch {
    // use detailText as-is
  }

  return (
    <div
      style={{
        background: '#111122',
        border: '1px solid #f59e0b',
        borderRadius: 8,
        padding: 20,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <span style={{ fontSize: 16 }}>⚠</span>
        <span style={{ fontWeight: 700, fontSize: 14, color: '#f59e0b' }}>PERMISSION REQUIRED</span>
      </div>

      <div style={{ display: 'grid', gap: 8, marginBottom: 16 }}>
        <DetailRow label="Action" value={permission.tool} />
        <DetailRow label="Summary" value={permission.summary} />
        <DetailRow label="Detail" value={detailText} />
        {riskLevel && (
          <DetailRow
            label="Risk"
            value={riskLevel.toUpperCase()}
            valueColor={riskColors[riskLevel.toLowerCase()] ?? '#888'}
          />
        )}
        <DetailRow label="Requested" value={new Date(permission.timestamp).toLocaleTimeString()} />
      </div>

      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button
          type="button"
          onClick={() => handleDecision('deny')}
          disabled={resolve.isPending}
          style={{
            background: '#ef4444',
            color: '#fff',
            border: 'none',
            borderRadius: 6,
            padding: '8px 20px',
            fontWeight: 600,
            cursor: 'pointer',
            fontSize: 13,
          }}
        >
          DENY
        </button>
        <button
          type="button"
          onClick={() => handleDecision('approve')}
          disabled={resolve.isPending}
          style={{
            background: '#22c55e',
            color: '#fff',
            border: 'none',
            borderRadius: 6,
            padding: '8px 20px',
            fontWeight: 600,
            cursor: 'pointer',
            fontSize: 13,
          }}
        >
          APPROVE
        </button>
      </div>
      {resolve.isError && (
        <p style={{ color: '#ef4444', fontSize: 12, marginTop: 8 }}>{resolve.error.message}</p>
      )}
    </div>
  );
}

function DetailRow({
  label,
  value,
  valueColor,
}: {
  label: string;
  value: string;
  valueColor?: string;
}) {
  return (
    <div style={{ display: 'flex', gap: 12, fontSize: 13 }}>
      <span style={{ color: '#666', minWidth: 90, textTransform: 'uppercase', letterSpacing: 0.5 }}>
        {label}
      </span>
      <span style={{ color: valueColor ?? '#e0e0e0', flex: 1, wordBreak: 'break-word' }}>
        {value}
      </span>
    </div>
  );
}
