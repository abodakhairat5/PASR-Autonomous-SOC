import { AlertTriangle, RefreshCw } from 'lucide-react'
import { SeverityBadge, ActionBadge, GuardrailBadge, AttackTypeBadge } from './StatusBadge'

export default function IncidentTable({ incidents, loading, onSelect }) {
  if (loading) {
    return (
      <div className="empty-state">
        <RefreshCw size={28} className="spin" />
        <p>Loading incidents...</p>
      </div>
    )
  }

  if (!incidents.length) {
    return (
      <div className="empty-state">
        <AlertTriangle size={28} />
        <p>No incidents found</p>
      </div>
    )
  }

  return (
    <div className="table-wrapper">
      <table>
        <thead>
          <tr>
            <th>Timestamp</th>
            <th>Source IP</th>
            <th>Attack Type</th>
            <th>Severity</th>
            <th>Action</th>
            <th>Guardrail</th>
            <th>Reason</th>
          </tr>
        </thead>
        <tbody>
          {incidents.map((incident, index) => (
            <tr
              key={`${incident.id ?? incident.timestamp}-${index}`}
              className="clickable-row"
              onClick={() => onSelect && onSelect(incident)}
            >
              <td className="timestamp">{incident.timestamp}</td>
              <td className="ip">{incident.source_ip}</td>
              <td>
                <AttackTypeBadge type={incident.attack_type} />
              </td>
              <td>
                <SeverityBadge severity={incident.severity} />
              </td>
              <td>
                <ActionBadge action={incident.action_taken} />
              </td>
              <td>
                <GuardrailBadge approved={incident.guardrail_approved} />
              </td>
              <td className="reason-cell">{incident.reason}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
