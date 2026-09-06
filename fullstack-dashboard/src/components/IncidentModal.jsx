import { useEffect } from 'react'
import {
  X,
  MapPin,
  Tags,
  Activity,
  Ban,
  ShieldAlert,
  Clock,
  FileText,
  ScanSearch,
  GitMerge,
  Gauge,
  Bot,
  FileCode2,
  MessageSquareText,
  BookOpenCheck,
  Target,
  CheckCircle2,
} from 'lucide-react'
import {
  SeverityBadge,
  ActionBadge,
  AttackTypeBadge,
  ApprovedTag,
} from './StatusBadge'

function Row({ icon, label, value }) {
  return (
    <div className="modal-row">
      <div className="modal-row-label">
        {icon}
        <span>{label}</span>
      </div>
      <div className="modal-row-value">{value || '—'}</div>
    </div>
  )
}

function Section({ icon, title, children }) {
  return (
    <div className="modal-section">
      <div className="modal-section-title">
        {icon}
        <h4>{title}</h4>
      </div>
      <div className="modal-rows">{children}</div>
    </div>
  )
}

function ListValue({ items, empty }) {
  const list = Array.isArray(items) && items.length ? items : null
  if (!list) return <span className="muted">{empty || '—'}</span>
  return (
    <div className="value-list">
      {list.map((item, index) => (
        <span className="value-tag" key={index}>
          {item}
        </span>
      ))}
    </div>
  )
}

function has(o) {
  return o != null
}

function GuardrailTag({ approved, text }) {
  const yes = approved === true || approved === 'true' || approved === 'APPROVED'
  return (
    <span className={`modal-guardrail ${yes ? 'yes' : 'no'}`}>
      {yes ? <CheckCircle2 size={13} /> : <Ban size={13} />}
      {text || (yes ? 'Approved' : 'Not Approved')}
    </span>
  )
}

export default function IncidentModal({ incident, onClose }) {
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  if (!incident) return null

  const d = incident.details
  const attack = d?.attack
  const correlation = d?.correlation
  const risk = d?.risk
  const decision = d?.decision
  const rule = d?.rule
  const explanation = d?.explanation
  const knowledge = d?.knowledge
  const guardrail = d?.guardrail
  const rich = Boolean(
    d &&
      (attack || correlation || risk || decision || rule || explanation || knowledge || guardrail)
  )

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-wide" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <h3>Incident Detail</h3>
            <p className="modal-subtitle">
              <AttackTypeBadge type={incident.attack_type} />
            </p>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <X size={20} />
          </button>
        </div>

        <div className="modal-approval">
          <ApprovedTag approved={incident.guardrail_approved} />
        </div>

        <div className="modal-body">
          <div className="modal-rows">
            <Row
              icon={<MapPin size={16} />}
              label="Source IP"
              value={<span className="ip">{incident.source_ip}</span>}
            />
            <Row
              icon={<Tags size={16} />}
              label="Attack Type"
              value={
                has(attack?.technique_id) ? (
                  <span>
                    <AttackTypeBadge type={incident.attack_type} />{' '}
                    <span className="technique-tag">MITRE {attack.technique_id}</span>
                  </span>
                ) : (
                  <AttackTypeBadge type={incident.attack_type} />
                )
              }
            />
            <Row
              icon={<Activity size={16} />}
              label="Severity"
              value={<SeverityBadge severity={incident.severity} />}
            />
            <Row
              icon={<Ban size={16} />}
              label="Action Taken"
              value={<ActionBadge action={incident.action_taken} />}
            />
            <Row
              icon={<ShieldAlert size={16} />}
              label="Guardrail Status"
              value={<ApprovedTag approved={incident.guardrail_approved} />}
            />
            <Row
              icon={<Clock size={16} />}
              label="Timestamp"
              value={incident.timestamp}
            />
            <Row
              icon={<FileText size={16} />}
              label="Reason"
              value={incident.reason}
            />
            {has(decision?.priority) && (
              <Row
                icon={<Target size={16} />}
                label="Priority"
                value={decision.priority}
              />
            )}
            {has(decision?.recommended_action) && (
              <Row
                icon={<Bot size={16} />}
                label="Recommended Action"
                value={<ActionBadge action={decision.recommended_action} />}
              />
            )}
          </div>

          {rich && (
            <div className="modal-sections">
              {has(attack) && (
                <Section icon={<ScanSearch size={16} />} title="Attack Analysis">
                  {has(attack.confidence) && (
                    <Row
                      icon={<Activity size={16} />}
                      label="Confidence"
                      value={`${Math.round(Number(attack.confidence) * 100)}%`}
                    />
                  )}
                  {has(attack.summary) && (
                    <Row icon={<MessageSquareText size={16} />} label="Summary" value={attack.summary} />
                  )}
                  {has(attack.indicators) && (
                    <Row icon={<FileText size={16} />} label="Indicators" value={<ListValue items={attack.indicators} />} />
                  )}
                </Section>
              )}

              {has(correlation) && (
                <Section icon={<GitMerge size={16} />} title="Threat Correlation">
                  <Row icon={<Activity size={16} />} label="Correlation Status" value={correlation.correlation_status} />
                  {has(correlation.related_event_count) && (
                    <Row icon={<Activity size={16} />} label="Related Events" value={correlation.related_event_count} />
                  )}
                  {has(correlation.pattern) && (
                    <Row icon={<MessageSquareText size={16} />} label="Pattern" value={correlation.pattern} />
                  )}
                  {has(correlation.related_ips) && (
                    <Row icon={<MapPin size={16} />} label="Related IPs" value={<ListValue items={correlation.related_ips} />} />
                  )}
                </Section>
              )}

              {has(risk) && (
                <Section icon={<Gauge size={16} />} title="Risk Assessment">
                  <Row icon={<Activity size={16} />} label="Risk Score" value={has(risk.risk_score) ? `${risk.risk_score}/100` : '—'} />
                  <Row icon={<Activity size={16} />} label="Impact" value={risk.impact} />
                  {has(risk.factors) && (
                    <Row icon={<FileText size={16} />} label="Risk Factors" value={<ListValue items={risk.factors} />} />
                  )}
                  {has(risk.summary) && (
                    <Row icon={<MessageSquareText size={16} />} label="Summary" value={risk.summary} />
                  )}
                </Section>
              )}

              {has(decision) && (
                <Section icon={<Bot size={16} />} title="Decision">
                  {has(decision.decision_confidence) && (
                    <Row
                      icon={<Activity size={16} />}
                      label="Confidence"
                      value={`${Math.round(Number(decision.decision_confidence) * 100)}%`}
                    />
                  )}
                  {has(decision.target) && (
                    <Row icon={<MapPin size={16} />} label="Target" value={<span className="ip">{decision.target}</span>} />
                  )}
                  {has(decision.reasoning) && (
                    <Row icon={<MessageSquareText size={16} />} label="Reasoning" value={decision.reasoning} />
                  )}
                </Section>
              )}

              {has(rule) && (
                <Section icon={<FileCode2 size={16} />} title="Generated Rule">
                  {has(rule.rule_type) && <Row icon={<FileCode2 size={16} />} label="Rule Type" value={rule.rule_type} />}
                  {has(rule.direction) && <Row icon={<Activity size={16} />} label="Direction" value={rule.direction} />}
                  {has(rule.rule_description) && (
                    <Row icon={<MessageSquareText size={16} />} label="Description" value={rule.rule_description} />
                  )}
                  {has(rule.requires_approval) && (
                    <Row icon={<ShieldAlert size={16} />} label="Requires Approval" value={String(rule.requires_approval)} />
                  )}
                </Section>
              )}

              {has(explanation) && (
                <Section icon={<MessageSquareText size={16} />} title="Explanation">
                  {has(explanation.explanation) && (
                    <Row icon={<MessageSquareText size={16} />} label="Explanation" value={explanation.explanation} />
                  )}
                  {has(explanation.decision_summary) && (
                    <Row icon={<FileText size={16} />} label="Decision Summary" value={explanation.decision_summary} />
                  )}
                  {has(explanation.analyst_recommendation) && (
                    <Row icon={<ShieldAlert size={16} />} label="Analyst Recommendation" value={explanation.analyst_recommendation} />
                  )}
                  {has(explanation.key_evidence) && (
                    <Row icon={<FileText size={16} />} label="Key Evidence" value={<ListValue items={explanation.key_evidence} />} />
                  )}
                </Section>
              )}

              {has(knowledge) && (
                <Section icon={<BookOpenCheck size={16} />} title="Knowledge Store">
                  {has(knowledge.validation_status) && (
                    <Row icon={<ShieldAlert size={16} />} label="Validation" value={knowledge.validation_status} />
                  )}
                  {has(knowledge.lesson) && (
                    <Row icon={<FileText size={16} />} label="Lesson Learned" value={knowledge.lesson} />
                  )}
                  {has(knowledge.reusable_pattern) && (
                    <Row icon={<GitMerge size={16} />} label="Reusable Pattern" value={knowledge.reusable_pattern} />
                  )}
                </Section>
              )}

              {has(guardrail) && (
                <Section icon={<ShieldAlert size={16} />} title="Guardrail Review">
                  <Row
                    icon={<ShieldAlert size={16} />}
                    label="Approved"
                    value={
                      <GuardrailTag approved={guardrail.approved} text={guardrail.approval_message} />
                    }
                  />
                  {has(guardrail.override_action) && (
                    <Row icon={<Ban size={16} />} label="Final Action" value={<ActionBadge action={guardrail.override_action} />} />
                  )}
                </Section>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}