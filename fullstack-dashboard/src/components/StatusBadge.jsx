import { CheckCircle2, XCircle, ShieldAlert } from 'lucide-react'

const SEVERITY_CLASS = {
  CRITICAL: 'severity critical',
  HIGH: 'severity high',
  MEDIUM: 'severity medium',
  LOW: 'severity low',
  INFO: 'severity info',
}

const ACTION_CLASS = {
  BLOCK: 'action block',
  BLOCK_IP: 'action block',
  ALERT: 'action alert',
  ALERT_HUMAN_ANALYST: 'action analyst',
  THROTTLE: 'action throttle',
  INVESTIGATE: 'action investigate',
  IGNORE: 'action ignore',
  PENDING_HUMAN_APPROVAL: 'action pending',
}

export function SeverityBadge({ severity }) {
  const key = String(severity || 'INFO').toUpperCase()
  return (
    <span className={SEVERITY_CLASS[key] || 'severity info'}>
      {severity || 'INFO'}
    </span>
  )
}

export function ActionBadge({ action }) {
  const key = String(action || 'N/A').toUpperCase()
  return (
    <span className={ACTION_CLASS[key] || 'action neutral'}>
      {action || 'N/A'}
    </span>
  )
}

export function GuardrailBadge({ approved }) {
  const ok = Boolean(approved)
  return (
    <span className={`guardrail ${ok ? 'approved' : 'rejected'}`}>
      {ok ? <CheckCircle2 size={14} /> : <XCircle size={14} />}
      {ok ? 'Approved' : 'Blocked'}
    </span>
  )
}

export function AttackTypeBadge({ type }) {
  return <span className="attack-badge">{type || 'UNKNOWN'}</span>
}

export function ApprovedTag({ approved }) {
  return approved ? (
    <span className="pill green">
      <CheckCircle2 size={13} /> Guardrail Approved
    </span>
  ) : (
    <span className="pill red">
      <ShieldAlert size={13} /> Guardrail Rejected
    </span>
  )
}
