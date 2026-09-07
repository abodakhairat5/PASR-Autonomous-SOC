import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Send,
  RefreshCw,
  AlertTriangle,
  ShieldAlert,
  Activity,
  Ban,
  Gauge,
  Crosshair,
  ShieldCheck,
  HelpCircle,
  UserCheck,
  ThumbsUp,
  Server,
  Database,
  Cpu,
  Bot,
  BellRing,
  Clock,
  X,
} from 'lucide-react'
import StatCard from '../components/StatCard'
import Pipeline from '../components/Pipeline'
import IncidentTable from '../components/IncidentTable'
import IncidentModal from '../components/IncidentModal'
import {
  AttackTypeBadge,
  ActionBadge,
  ApprovedTag,
  SeverityBadge,
  GuardrailBadge,
} from '../components/StatusBadge'
import { api } from '../services/api'

function InfoRow({ label, value }) {
  return (
    <div className="info-row">
      <span>{label}</span>
      <strong>{value ?? '—'}</strong>
    </div>
  )
}

function SectionCard({ title, icon, children }) {
  return (
    <div className="result-card">
      <div className="result-card-title">
        {icon}
        <h3>{title}</h3>
      </div>
      <div className="result-card-body">{children}</div>
    </div>
  )
}

const SEVERITY_COLORS = {
  CRITICAL: 'var(--red)',
  HIGH: '#ff8577',
  MEDIUM: 'var(--yellow)',
  LOW: 'var(--green)',
  INFO: 'var(--blue)',
}

const ATTACK_COLORS = ['#3b9dff', '#5fb2ff', '#123a63', '#2e8b57', '#9b59b6', '#e67e22', '#16a085', '#7d8ba0']

const ACTION_COLORS = {
  BLOCK: 'var(--red)',
  ALERT: 'var(--yellow)',
  ALERT_HUMAN_ANALYST: 'var(--blue)',
  THROTTLE: '#9b59b6',
  INVESTIGATE: '#3b9dff',
  IGNORE: '#7d8ba0',
  PENDING_HUMAN_APPROVAL: '#9b59b6',
}

// Map a real backend status string to an ONLINE / DEGRADED / OFFLINE badge.
function liveStatus(raw) {
  const s = String(raw || '').toLowerCase()
  if (['online', 'available', 'operational', 'active', 'healthy', 'ok'].includes(s)) {
    return { text: 'ONLINE', cls: 'ok' }
  }
  if (['degraded', 'unknown', 'pending'].includes(s)) {
    return { text: 'DEGRADED', cls: 'warn' }
  }
  return { text: 'OFFLINE', cls: 'bad' }
}

const TOAST_TONE = {
  CRITICAL: 'red',
  HIGH: 'red',
  MEDIUM: 'yellow',
  LOW: 'blue',
}

function DistributionList({ title, icon, data, emptyText, colorMap, total }) {
  const entries = useMemo(() => {
    if (!data) return []
    return Object.entries(data)
      .map(([label, value]) => ({ label, value }))
      .sort((a, b) => b.value - a.value)
  }, [data])

  if (!entries.length) {
    return (
      <div className="dist-card">
        <div className="dist-title">
          {icon}
          <h3>{title}</h3>
        </div>
        <div className="empty-state compact">{emptyText}</div>
      </div>
    )
  }

  const max = Math.max(...entries.map((e) => e.value), 1)
  const count = total ?? entries.reduce((s, e) => s + e.value, 0)

  return (
    <div className="dist-card">
      <div className="dist-title">
        {icon}
        <h3>{title}</h3>
      </div>
      <div className="dist-bars">
        {entries.map((entry, index) => {
          const color =
            (colorMap && colorMap[String(entry.label).toUpperCase()]) ||
            (Array.isArray(colorMap)
              ? colorMap[index % colorMap.length]
              : 'var(--blue)')
          const pct = Math.round((entry.value / max) * 100)
          return (
            <div className="dist-row" key={entry.label}>
              <span className="dist-label">{entry.label}</span>
              <div className="dist-track">
                <div
                  className="dist-fill"
                  style={{ width: `${pct}%`, background: color }}
                />
              </div>
              <span className="dist-value">
                {entry.value}
                <em>{count ? Math.round((entry.value / count) * 100) : 0}%</em>
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export default function Dashboard({
  rawLog,
  onRawLogChange,
  analyzing,
  analyzeError,
  result,
  onAnalyze,
  onReset,
  backendOnline,
}) {
  console.log('PASR DASHBOARD RESULT:', result)
  const [dash, setDash] = useState(null)
  const [dashLoading, setDashLoading] = useState(true)
  const [dashError, setDashError] = useState('')
  const [selected, setSelected] = useState(null)

  const [infra, setInfra] = useState(null)
  const [toasts, setToasts] = useState([])

  const feedInFlight = useRef(false)
  const infraInFlight = useRef(false)
  const knownIdsRef = useRef(new Set())
  const toastTimersRef = useRef([])

  const dismissToast = useCallback((key) => {
    setToasts((prev) => prev.filter((t) => t.key !== key))
  }, [])

  const notifyNewIncidents = useCallback(
    (events) => {
      const known = knownIdsRef.current

      // First successful load seeds the baseline — do not notify for history.
      if (!known.size) {
        events.forEach((e) => {
          if (e.id != null) known.add(e.id)
        })
        return
      }

      const fresh = events.filter((e) => e.id != null && !known.has(e.id))
      if (!fresh.length) return
      fresh.forEach((e) => {
        if (e.id != null) known.add(e.id)
      })

      // Coalesce — only surface the most recent few, never re-notify the same id.
      const items = fresh
        .slice(-3)
        .map((e) => ({
          key: e.id,
          attack_type: e.attack_type,
          source_ip: e.source_ip,
          severity: e.severity,
          action_taken: e.action_taken,
          timestamp: e.timestamp,
        }))
        .reverse()

      items.forEach((item) => {
        const timer = setTimeout(() => dismissToast(item.key), 6000)
        toastTimersRef.current.push(timer)
      })

      setToasts((prev) => {
        const merged = [...prev.filter((t) => !items.some((n) => n.key === t.key)), ...items]
        return merged.slice(-3)
      })
    },
    [dismissToast]
  )

  const loadDashboard = useCallback(async () => {
    if (feedInFlight.current) return
    feedInFlight.current = true
    setDashLoading(true)
    setDashError('')
    try {
      const data = await api.getDashboard()
      setDash(data)
      notifyNewIncidents(data.recent_events || [])
    } catch (err) {
      setDashError(err.message || 'Unable to load dashboard data.')
    } finally {
      setDashLoading(false)
      feedInFlight.current = false
    }
  }, [notifyNewIncidents])

  const loadInfra = useCallback(async () => {
    if (infraInFlight.current) return
    infraInFlight.current = true
    try {
      const data = await api.getInfrastructure()
      setInfra(data)
    } catch {
      setInfra(null)
    } finally {
      infraInFlight.current = false
    }
  }, [])

  useEffect(() => {
    // Async fetch on mount is intentional.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadDashboard()
    loadInfra()

    const feedId = setInterval(() => {
      // ~4s polling keeps the live incident feed and stats current.
      loadDashboard()
    }, 4000)

    const infraId = setInterval(() => {
      // Service health is refreshed on a gentler cadence.
      loadInfra()
    }, 5000)

    return () => {
      clearInterval(feedId)
      clearInterval(infraId)
      toastTimersRef.current.forEach((t) => clearTimeout(t))
      toastTimersRef.current = []
    }
  }, [loadDashboard, loadInfra])

  useEffect(() => {
    if (!result) return
    // Refresh dashboard data immediately after a fresh analysis lands.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadDashboard()
  }, [result, loadDashboard])

  const stats = dash?.stats || null
  const recentEvents = useMemo(() => dash?.recent_events || [], [dash])

  const activityColors = useMemo(() => {
    const colors = {}
    recentEvents.forEach((e, i) => {
      colors[e.id ?? `${e.timestamp}-${i}`] = i < 4 ? '#3b9dff' : '#7d8ba0'
    })
    return colors
  }, [recentEvents])

  return (
    <div className="dashboard">
      <div className="stats-grid">
        <StatCard
          icon={<Activity size={22} />}
          title="Total Incidents"
          value={dashLoading ? '…' : stats?.total_events}
          tone="blue"
        />
        <StatCard
          icon={<AlertTriangle size={22} />}
          title="Critical Alerts"
          value={dashLoading ? '…' : stats?.critical_events}
          tone="red"
        />
        <StatCard
          icon={<Ban size={22} />}
          title="Blocked Threats"
          value={dashLoading ? '…' : stats?.blocked_events}
          tone="green"
        />
        <StatCard
          icon={<UserCheck size={22} />}
          title="Pending Human Review"
          value={dashLoading ? '…' : stats?.pending_review ?? stats?.human_alerts}
          tone="yellow"
        />
        <StatCard
          icon={<ThumbsUp size={22} />}
          title="Guardrail Approved"
          value={dashLoading ? '…' : stats?.approved_events}
          tone="green"
        />
        <StatCard
          icon={<ShieldAlert size={22} />}
          title="Guardrail Rejected"
          value={dashLoading ? '…' : stats?.rejected_events}
          tone="red"
        />
        <StatCard
          icon={<HelpCircle size={22} />}
          title="Human Escalations"
          value={dashLoading ? '…' : stats?.human_alerts}
          tone="blue"
        />
        <StatCard
          icon={<BellRing size={22} />}
          title="Alerts Issued"
          value={dashLoading ? '…' : stats?.alerts}
          tone="yellow"
        />
      </div>

      <section className="analyzer-card">
        <div className="section-heading">
          <div>
            <h2>Analyze Security Event</h2>
            <p>Send a security event to the PASR autonomous pipeline</p>
          </div>
          {!backendOnline && (
            <span className="pill red">Backend offline</span>
          )}
        </div>

        <textarea
          value={rawLog}
          onChange={(e) => onRawLogChange(e.target.value)}
          placeholder="Paste a security log line to analyze..."
          rows={4}
        />

        <div className="analyzer-actions">
          <button
            className="analyze-btn"
            onClick={onAnalyze}
            disabled={analyzing || !rawLog.trim() || !backendOnline}
          >
            {analyzing ? (
              <>
                <RefreshCw size={18} className="spin" />
                Analyzing...
              </>
            ) : (
              <>
                <Send size={18} />
                Analyze Event
              </>
            )}
          </button>

          {result && (
            <button className="reset-btn" onClick={onReset}>
              Reset
            </button>
          )}
        </div>

        {analyzeError && <div className="error-box">{analyzeError}</div>}

        {analyzing && (
          <div className="analyzing-bar">
            <RefreshCw size={18} className="spin" />
            <span>PASR pipeline running — AI agents analyzing the event...</span>
          </div>
        )}
      </section>

      {result && (
        <>
          <section className="result-grid">
            <SectionCard title="Attack Analysis" icon={<Crosshair size={18} />}>
              <InfoRow label="Source IP" value={<span className="ip">{result.attack?.source_ip}</span>} />
              <InfoRow label="Attack Type" value={<AttackTypeBadge type={result.attack?.attack_type} />} />
              <InfoRow label="MITRE Technique" value={result.attack?.technique_id} />
              <InfoRow
                label="Confidence"
                value={`${Math.round((result.attack?.confidence || 0) * 100)}%`}
              />
              <InfoRow label="Summary" value={result.attack?.summary} />
            </SectionCard>

            <SectionCard title="Risk Assessment" icon={<Gauge size={18} />}>
              <InfoRow label="Severity" value={result.risk?.severity} />
              <InfoRow label="Impact" value={result.risk?.impact} />
              <InfoRow
                label="Risk Score"
                value={`${result.risk?.risk_score ?? '—'}/100`}
              />
              <InfoRow
                label="Confidence"
                value={`${Math.round((result.risk?.confidence || 0) * 100)}%`}
              />
              <InfoRow label="Summary" value={result.risk?.summary} />
            </SectionCard>

            <SectionCard title="Recommended Action" icon={<Ban size={18} />}>
              <InfoRow
                label="Action"
                value={<ActionBadge action={result.decision?.recommended_action} />}
              />
              <InfoRow label="Priority" value={result.decision?.priority} />
              <InfoRow label="Target" value={result.decision?.target} />
              <InfoRow
                label="Confidence"
                value={`${Math.round((result.decision?.decision_confidence || 0) * 100)}%`}
              />
              <InfoRow label="Reasoning" value={result.decision?.reasoning} />
            </SectionCard>

            <SectionCard title="Guardrails" icon={<ShieldCheck size={18} />}>
              <InfoRow
                label="Approved"
                value={<ApprovedTag approved={result.guardrail?.approved} />}
              />
              <InfoRow label="Override Action" value={result.guardrail?.override_action} />
              <InfoRow label="Reason" value={result.guardrail?.reason} />
            </SectionCard>
          </section>

          <section className="detail-card">
            <div className="section-heading">
              <h2>Explanation & Knowledge</h2>
              <p>Why PASR made this decision</p>
            </div>
            <div className="detail-2col">
              <div className="detail-block">
                <h4>Explanation</h4>
                <p>{result.explanation?.explanation || '—'}</p>
                <h4>Decision Summary</h4>
                <p>{result.explanation?.decision_summary || '—'}</p>
                {result.explanation?.analyst_recommendation && (
                  <>
                    <h4>Analyst Recommendation</h4>
                    <p>{result.explanation.analyst_recommendation}</p>
                  </>
                )}
              </div>
              <div className="detail-block">
                <h4>Reusable Pattern</h4>
                <p>{result.knowledge?.reusable_pattern || '—'}</p>
                <h4>Lesson Learned</h4>
                <p>{result.knowledge?.lesson || '—'}</p>
              </div>
            </div>
          </section>

          <section className="detail-card">
            <div className="section-heading">
              <h2>Rule Generated by PASR</h2>
              <p>Agent #5 output</p>
            </div>
            <div className="rule-box">
              <div className="rule-head">
                <span className={`action ${String(result.rule?.rule_type || '').toLowerCase() || 'neutral'}`}>
                  {result.rule?.rule_type || '—'}
                </span>
                <span className="pill">
                  <HelpCircle size={13} />
                  {result.rule?.requires_approval ? 'Requires approval' : 'Auto-apply'}
                </span>
              </div>
              <p className="rule-desc">{result.rule?.rule_description || '—'}</p>
              <div className="rule-meta">
                <span>Target: <strong>{result.rule?.target_ip || '—'}</strong></span>
                <span>Protocol: <strong>{result.rule?.protocol || '—'}</strong></span>
                <span>Direction: <strong>{result.rule?.direction || '—'}</strong></span>
              </div>
            </div>
          </section>

          <section className="detail-card">
            <div className="section-heading">
              <h2>Final Response</h2>
              <p>End-to-end pipeline outcome</p>
            </div>
            <div className="final-outcome">
              <div className="final-label">Final Action</div>
              <ActionBadge action={result.final_action} />
            </div>
          </section>
        </>
      )}

      {/* ================================================= */}
      {/* SOC analytics: distributions, activity, status   */}
      {/* ================================================= */}

      <section className="analytics-section">
        <div className="section-heading">
          <div>
            <h2>Attack Intelligence</h2>
            <p>Live distribution of detected threats from the threat database</p>
          </div>
          <button className="refresh-btn" onClick={loadDashboard} disabled={dashLoading}>
            <RefreshCw size={17} className={dashLoading ? 'spin' : ''} />
            Refresh
          </button>
        </div>

        {dashError && <div className="error-box">{dashError}</div>}

        {dashLoading && !dash ? (
          <div className="empty-state">
            <RefreshCw size={28} className="spin" />
            <p>Loading SOC metrics...</p>
          </div>
        ) : (
          <div className="dist-grid">
            <DistributionList
              title="Attack Type Distribution"
              icon={<Crosshair size={17} />}
              data={stats?.attack_types}
              colorMap={ATTACK_COLORS}
              total={stats?.total_events}
              emptyText="No attack type data yet."
            />
            <DistributionList
              title="Severity Distribution"
              icon={<Gauge size={17} />}
              data={stats?.severities}
              colorMap={SEVERITY_COLORS}
              total={stats?.total_events}
              emptyText="No severity data yet."
            />
            <DistributionList
              title="Action Distribution"
              icon={<Ban size={17} />}
              data={stats?.actions}
              colorMap={ACTION_COLORS}
              total={stats?.total_events}
              emptyText="No action data yet."
            />
          </div>
        )}
      </section>

      <div className="dashboard-2col">
        <section className="table-card">
          <div className="section-heading">
            <div>
              <h2>Recent Incidents</h2>
              <p>Latest events captured by PASR</p>
            </div>
          </div>
          <IncidentTable
            incidents={recentEvents}
            loading={dashLoading}
            onSelect={setSelected}
          />
        </section>

        <section className="table-card">
          <div className="section-heading">
            <div>
              <h2>SOC Activity</h2>
              <p>Recent system activity overview</p>
            </div>
          </div>
          <div className="activity-list">
            {dashLoading && !dash ? (
              <div className="empty-state compact">
                <RefreshCw size={22} className="spin" />
              </div>
            ) : !recentEvents.length ? (
              <div className="empty-state compact">
                <Activity size={22} />
                <p>No activity recorded yet.</p>
              </div>
            ) : (
              recentEvents.slice(0, 8).map((event, index) => {
                const key = event.id ?? `${event.timestamp}-${index}`
                return (
                  <div className="activity-item" key={key}>
                    <span className="activity-dot" style={{ background: activityColors[key] || '#3b9dff' }} />
                    <div className="activity-body">
                      <div className="activity-top">
                        <span className="ip">{event.source_ip}</span>
                        <span className="timestamp">{event.timestamp}</span>
                      </div>
                      <div className="activity-tags">
                        <AttackTypeBadge type={event.attack_type} />
                        <SeverityBadge severity={event.severity} />
                        <ActionBadge action={event.action_taken} />
                        <GuardrailBadge approved={event.guardrail_approved} />
                      </div>
                    </div>
                  </div>
                )
              })
            )}
          </div>
        </section>
      </div>

      <section className="table-card status-card">
        <div className="section-heading">
          <div>
            <h2>Live System Status</h2>
            <p>Current SOC operational state from live backend health checks</p>
          </div>
          <span className="ping-pill">
            <Clock size={13} />
            Last checked {infra?.checked_at || '…'}
          </span>
        </div>
        <div className="status-grid">
          <div className="status-item">
            <Server size={20} />
            <div>
              <strong>PASR API</strong>
              <span className={liveStatus(infra?.api?.status).cls}>
                {infra ? liveStatus(infra.api.status).text : 'CHECKING'}
              </span>
            </div>
          </div>
          <div className="status-item">
            <Database size={20} />
            <div>
              <strong>Threat Database</strong>
              <span className={liveStatus(infra?.database?.status).cls}>
                {infra ? liveStatus(infra.database.status).text : 'CHECKING'}
              </span>
            </div>
          </div>
          <div className="status-item">
            <Cpu size={20} />
            <div>
              <strong>AI Pipeline</strong>
              <span className={liveStatus(infra?.pipeline?.status).cls}>
                {infra ? liveStatus(infra.pipeline.status).text : 'CHECKING'}
              </span>
            </div>
          </div>
          <div className="status-item">
            <ShieldCheck size={20} />
            <div>
              <strong>Guardrails</strong>
              <span className={liveStatus(infra?.guardrails?.status).cls}>
                {infra ? liveStatus(infra.guardrails.status).text : 'CHECKING'}
              </span>
            </div>
          </div>
          <div className="status-item">
            <Bot size={20} />
            <div>
              <strong>AI Model (Ollama)</strong>
              <span className={liveStatus(infra?.ollama?.status).cls}>
                {infra ? liveStatus(infra.ollama.status).text : 'CHECKING'}
              </span>
            </div>
          </div>
          <div className="status-item">
            <Activity size={20} />
            <div>
              <strong>Pipeline Executions</strong>
              <span className="ok">{stats?.total_events ?? 0} saved</span>
            </div>
          </div>
        </div>
      </section>

      <section className="detail-card pipeline-card">
        <div className="section-heading">
          <h2>PASR Agent Pipeline</h2>
          <p>8-stage autonomous decision flow</p>
        </div>
        <Pipeline completed={false} reducing backendOnline={backendOnline} />
      </section>

      <div className="toast-stack">
        {toasts.map((toast) => {
          const tone = TOAST_TONE[String(toast.severity || '').toUpperCase()] || 'blue'
          const Icon = tone === 'red' ? ShieldAlert : tone === 'yellow' ? AlertTriangle : BellRing
          return (
            <div className={`toast toast-${tone}`} key={toast.key}>
              <div className="toast-icon">
                <Icon size={18} />
              </div>
              <div className="toast-body">
                <strong>New incident detected</strong>
                <span>
                  {toast.attack_type || 'Unknown'} from <span className="ip">{toast.source_ip}</span>
                </span>
                <span className="toast-meta">
                  {toast.severity || 'N/A'} · {toast.action_taken || 'N/A'} · {toast.timestamp}
                </span>
              </div>
              <button className="toast-close" onClick={() => dismissToast(toast.key)} aria-label="Dismiss">
                <X size={15} />
              </button>
            </div>
          )
        })}
      </div>

      <IncidentModal incident={selected} onClose={() => setSelected(null)} />
    </div>
  )
}