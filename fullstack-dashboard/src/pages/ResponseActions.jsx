import { useEffect, useMemo, useRef, useState } from 'react'
import { RefreshCw, Ban, BellRing, UserCheck, Inbox, Play, CheckCircle2 } from 'lucide-react'
import { api } from '../services/api'
import {
  AttackTypeBadge,
  ActionBadge,
  GuardrailBadge,
} from '../components/StatusBadge'

const GROUP_META = {
  BLOCK: { label: 'Block Actions', icon: Ban, tone: 'red', desc: 'Source IPs automatically blocked' },
  ALERT: { label: 'Alert Actions', icon: BellRing, tone: 'yellow', desc: 'Security alerts generated' },
  ALERT_HUMAN_ANALYST: { label: 'Human Analyst Alerts', icon: UserCheck, tone: 'blue', desc: 'Escalated for human review' },
}

function SimLog({ log, loading, onRefresh }) {
  return (
    <section className="action-group">
      <div className="action-group-header tone-blue">
        <div className="group-icon">
          <CheckCircle2 size={22} />
        </div>
        <div className="group-text">
          <div className="group-title-row">
            <h3>Safe Simulation Log</h3>
            <span className="action neutral">{log.length}</span>
          </div>
          <p>Recorded simulated executions — no real-world network changes are ever made</p>
        </div>
      </div>

      {!log.length ? (
        <div className="empty-state compact">
          <Inbox size={24} />
          <p>No simulated actions recorded yet. Use “Simulate Execute” on a response row above.</p>
        </div>
      ) : (
        <div className="table-wrapper">
          <table>
            <thead>
              <tr>
                <th>Recorded At</th>
                <th>Source IP</th>
                <th>Attack Type</th>
                <th>Action</th>
                <th>Outcome</th>
              </tr>
            </thead>
            <tbody>
              {log.map((item) => (
                <tr key={item.id}>
                  <td className="timestamp">{item.recorded_at}</td>
                  <td className="ip">{item.source_ip || '—'}</td>
                  <td><AttackTypeBadge type={item.attack_type} /></td>
                  <td><ActionBadge action={item.action} /></td>
                  <td>
                    <span className="pill green">
                      <CheckCircle2 size={13} /> {item.outcome}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="analyzer-actions">
        <button className="refresh-btn" onClick={onRefresh} disabled={loading}>
          <RefreshCw size={17} className={loading ? 'spin' : ''} />
          Refresh Log
        </button>
      </div>
    </section>
  )
}

export default function ResponseActions() {
  const [actions, setActions] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [simLog, setSimLog] = useState([])
  const [simLoading, setSimLoading] = useState(true)
  const [simError, setSimError] = useState('')
  const [executingId, setExecutingId] = useState(null)

  const actionsInFlight = useRef(false)
  const simInFlight = useRef(false)

  const load = async () => {
    if (actionsInFlight.current) return
    actionsInFlight.current = true
    setLoading(true)
    setError('')
    try {
      const data = await api.getResponseActions()
      setActions(data.actions || [])
    } catch (err) {
      setError(err.message || 'Unable to load response actions.')
      setActions([])
    } finally {
      setLoading(false)
      actionsInFlight.current = false
    }
  }

  const loadSimLog = async () => {
    if (simInFlight.current) return
    simInFlight.current = true
    setSimError('')
    try {
      const data = await api.getSimulatedActions()
      setSimLog(data.actions || [])
    } catch (err) {
      setSimError(err.message || 'Unable to load the simulation log.')
      setSimLog([])
    } finally {
      setSimLoading(false)
      simInFlight.current = false
    }
  }

  useEffect(() => {
    // Async fetch on mount is intentional.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load()
    loadSimLog()

    const id = setInterval(() => {
      // Keep response actions current after new analyses.
      load()
      loadSimLog()
    }, 8000)

    return () => clearInterval(id)
  }, [])

  const executedIds = useMemo(() => new Set(simLog.map((item) => item.incident_id)), [simLog])

  const groups = useMemo(() => {
    const order = ['BLOCK', 'ALERT', 'ALERT_HUMAN_ANALYST']
    const byAction = {}
    actions.forEach((a) => {
      const key = a.final_action
      if (!byAction[key]) byAction[key] = []
      byAction[key].push(a)
    })
    const named = order
      .filter((key) => byAction[key] && byAction[key].length)
      .map((key) => ({ key, items: byAction[key] }))
    // Include any other real action types that exist in the database.
    Object.keys(byAction)
      .filter((key) => !order.includes(key) && byAction[key]?.length)
      .forEach((key) => named.push({ key, items: byAction[key] }))
    return named
  }, [actions])

  const handleSimulate = async (incidentId, finalAction) => {
    if (executingId != null) return
    setExecutingId(incidentId)
    setSimError('')
    try {
      await api.simulateAction(incidentId, finalAction)
      await loadSimLog()
    } catch (err) {
      setSimError(err.message || 'Simulated action failed to record.')
    } finally {
      setExecutingId(null)
    }
  }

  if (error) {
    return (
      <div className="page-state">
        <div className="error-box">{error}</div>
        <button className="refresh-btn" onClick={load}>
          <RefreshCw size={17} /> Retry
        </button>
      </div>
    )
  }

  if (loading && !actions.length) {
    return (
      <div className="page-state">
        <div className="empty-state">
          <RefreshCw size={28} className="spin" />
          <p>Loading response actions...</p>
        </div>
      </div>
    )
  }

  if (!groups.length) {
    return (
      <div className="page-state">
        <div className="empty-state">
          <Inbox size={28} />
          <p>No response actions recorded yet.</p>
        </div>
        <button className="refresh-btn" onClick={load}>
          <RefreshCw size={17} /> Refresh
        </button>
      </div>
    )
  }

  return (
    <div className="response-actions">
      {simError && <div className="error-box">{simError}</div>}

      {groups.map(({ key, items }) => {
        const meta = GROUP_META[key] || {
          label: key,
          icon: Ban,
          tone: 'blue',
          desc: 'Response actions',
        }
        const Icon = meta.icon
        return (
          <section key={key} className="action-group">
            <div className={`action-group-header tone-${meta.tone}`}>
              <div className="group-icon">
                <Icon size={22} />
              </div>
              <div className="group-text">
                <div className="group-title-row">
                  <h3>{meta.label}</h3>
                  <span className={`action ${String(key).toLowerCase()}`}>{items.length}</span>
                </div>
                <p>{meta.desc} — {items.length} triggered</p>
              </div>
            </div>

            <div className="table-wrapper">
              <table>
                <thead>
                  <tr>
                    <th>Timestamp</th>
                    <th>Source / Target IP</th>
                    <th>Attack Type</th>
                    <th>Recommended</th>
                    <th>Final Action</th>
                    <th>Priority</th>
                    <th>Guardrail</th>
                    <th>Reason</th>
                    <th>Simulate</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((action, index) => {
                    const executed = action.id != null && executedIds.has(action.id)
                    return (
                      <tr key={`${action.id ?? action.timestamp}-${index}`}>
                        <td className="timestamp">{action.timestamp}</td>
                        <td className="ip">{action.source_ip || action.target_ip}</td>
                        <td><AttackTypeBadge type={action.attack_type} /></td>
                        <td>
                          {action.recommended_action ? (
                            <ActionBadge action={action.recommended_action} />
                          ) : (
                            <span className="muted">—</span>
                          )}
                        </td>
                        <td><ActionBadge action={action.final_action} /></td>
                        <td>{action.priority || <span className="muted">—</span>}</td>
                        <td><GuardrailBadge approved={action.guardrail_approved} /></td>
                        <td className="reason-cell">{action.reason}</td>
                        <td>
                          {executed ? (
                            <span className="pill green">
                              <CheckCircle2 size={13} /> Executed
                            </span>
                          ) : (
                            <button
                              className="refresh-btn simulate-btn"
                              onClick={() => handleSimulate(action.id, action.final_action)}
                              disabled={executingId != null}
                              title="Safely simulate this action (logs only, no real network change)"
                            >
                              <Play size={13} />
                              {executingId === action.id ? 'Recording...' : 'Simulate Execute'}
                            </button>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </section>
        )
      })}

      <SimLog log={simLog} loading={simLoading} onRefresh={loadSimLog} />
    </div>
  )
}