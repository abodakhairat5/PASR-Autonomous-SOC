import { useEventStream } from '../hooks/useApi';

const eventTypeColors: Record<string, string> = {
  'permission-required': '#f59e0b',
  'permission-approved': '#22c55e',
  'permission-denied': '#ef4444',
  'policy-decision': '#3b82f6',
  'tool-call': '#a855f7',
  'tool-result': '#888',
  'agent-started': '#22c55e',
  'agent-completed': '#22c55e',
  'agent-error': '#ef4444',
  'evidence-captured': '#22c55e',
  'experience-recorded': '#a855f7',
};

function formatEventTime(evt: { data: unknown }): string {
  const d = evt.data as Record<string, unknown>;
  if (typeof d?.timestamp === 'string') {
    return new Date(d.timestamp).toLocaleTimeString();
  }
  return '';
}

export function EventStream({ engagementId }: { engagementId: string }) {
  const events = useEventStream(engagementId);

  return (
    <div style={{ maxHeight: 500, overflow: 'auto' }}>
      <div
        style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, fontSize: 13 }}
      >
        <span
          style={{
            width: 8,
            height: 8,
            borderRadius: '50%',
            background: '#22c55e',
            animation: 'pulse 2s infinite',
          }}
        />
        <span style={{ color: '#888' }}>Live stream — {events.length} events</span>
      </div>
      {events.length === 0 && <p style={{ color: '#555', fontSize: 13 }}>Waiting for events...</p>}
      {events.map((evt, i) => {
        const d = evt.data as Record<string, unknown>;
        const type = typeof d?.type === 'string' ? d.type : evt.type;
        const name = typeof d?.name === 'string' ? d.name : '';
        const summary = typeof d?.summary === 'string' ? d.summary : '';
        const tool = typeof d?.tool === 'string' ? d.tool : '';
        const key = `${String(type)}-${i}`;
        const color = eventTypeColors[String(type)] ?? '#7c5cff';
        const time = formatEventTime(evt);

        // Permission events get special rendering
        if (type === 'permission-required') {
          return (
            <div
              key={key}
              style={{
                background: '#1a1a0a',
                border: '1px solid #f59e0b',
                borderRadius: 6,
                padding: '8px 12px',
                marginBottom: 6,
                fontSize: 13,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                <span style={{ color: '#f59e0b', fontWeight: 700 }}>APPROVAL REQUIRED</span>
                {time && <span style={{ color: '#555', fontSize: 11 }}>{time}</span>}
              </div>
              <div style={{ color: '#aaa' }}>
                {tool && <span style={{ fontFamily: 'monospace' }}>{tool}</span>}
                {summary && <span style={{ marginLeft: 8 }}>{summary}</span>}
              </div>
            </div>
          );
        }

        if (type === 'permission-approved') {
          return (
            <div
              key={key}
              style={{
                display: 'flex',
                gap: 12,
                padding: '5px 0',
                borderBottom: '1px solid #111',
                fontSize: 13,
              }}
            >
              <span style={{ color: '#22c55e', fontWeight: 700, minWidth: 120 }}>APPROVED</span>
              <span style={{ color: '#888', flex: 1 }}>{tool || summary || name}</span>
              {time && <span style={{ color: '#555', fontSize: 11 }}>{time}</span>}
            </div>
          );
        }

        if (type === 'permission-denied') {
          return (
            <div
              key={key}
              style={{
                display: 'flex',
                gap: 12,
                padding: '5px 0',
                borderBottom: '1px solid #111',
                fontSize: 13,
              }}
            >
              <span style={{ color: '#ef4444', fontWeight: 700, minWidth: 120 }}>DENIED</span>
              <span style={{ color: '#888', flex: 1 }}>{tool || summary || name}</span>
              {time && <span style={{ color: '#555', fontSize: 11 }}>{time}</span>}
            </div>
          );
        }

        if (type === 'policy-decision') {
          const action = typeof d?.action === 'string' ? d.action : '';
          const reason = typeof d?.reason === 'string' ? d.reason : '';
          const actionColor =
            action === 'allow' ? '#22c55e' : action === 'deny' ? '#ef4444' : '#f59e0b';
          return (
            <div
              key={key}
              style={{
                display: 'flex',
                gap: 12,
                padding: '5px 0',
                borderBottom: '1px solid #111',
                fontSize: 13,
              }}
            >
              <span style={{ color: actionColor, fontWeight: 700, minWidth: 120 }}>
                POLICY {action.toUpperCase()}
              </span>
              <span style={{ color: '#888', flex: 1 }}>{reason || String(d?.hostname ?? '')}</span>
              {time && <span style={{ color: '#555', fontSize: 11 }}>{time}</span>}
            </div>
          );
        }

        return (
          <div
            key={key}
            style={{
              display: 'flex',
              gap: 12,
              padding: '5px 0',
              borderBottom: '1px solid #111',
              fontSize: 13,
            }}
          >
            <span style={{ color, fontFamily: 'monospace', minWidth: 120 }}>{String(type)}</span>
            <span style={{ color: '#888', flex: 1 }}>{name || summary || tool}</span>
            {time && <span style={{ color: '#555', fontSize: 11 }}>{time}</span>}
          </div>
        );
      })}
    </div>
  );
}
