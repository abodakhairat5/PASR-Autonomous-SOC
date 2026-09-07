import { useEffect, useRef, useState } from 'react'
import {
  ScanSearch,
  GitMerge,
  Gauge,
  Bot,
  FileCode2,
  MessageSquareText,
  BookOpenCheck,
  ShieldCheck,
  RefreshCw,
} from 'lucide-react'
import { api } from '../services/api'

const ICONS = {
  attack: ScanSearch,
  correlation: GitMerge,
  risk: Gauge,
  decision: Bot,
  rule: FileCode2,
  explanation: MessageSquareText,
  knowledge: BookOpenCheck,
  guardrail: ShieldCheck,
}

function statusTone(status) {
  if (status === 'Operational') return { cls: 'ok', dot: 'green' }
  if (status === 'Degraded') return { cls: 'degraded', dot: 'yellow' }
  return { cls: 'offline', dot: 'red' }
}

export default function AIAgents({ backendOnline }) {
  const [agents, setAgents] = useState([])
  const [pipelineStatus, setPipelineStatus] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const inFlight = useRef(false)

  const load = async () => {
    if (inFlight.current) return
    inFlight.current = true
    setLoading(true)
    setError('')

    try {
      const data = await api.getAgents()

      if (Array.isArray(data)) {
        setAgents(data)
        setPipelineStatus('')
      } else {
        setAgents(Array.isArray(data?.agents) ? data.agents : [])
        setPipelineStatus(data?.pipeline_status || '')
      }
    } catch (err) {
      setError(err.message || 'Unable to load agent status.')
      setAgents([])
      setPipelineStatus('')
    } finally {
      setLoading(false)
      inFlight.current = false
    }
  }


  useEffect(() => {
    // Async fetch on mount is intentional.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load()

    const id = setInterval(() => {
      // Keep the agent pipeline status live.
      load()
    }, 5000)

    return () => clearInterval(id)
  }, [])

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

  const operational = backendOnline && !!agents.length

  const banner = (() => {
    if (!operational) return 'Backend offline — agent status is unavailable.'
    const statuses = new Set(agents.map((a) => a.status))
    if (statuses.has('Offline')) return 'Some agents report offline — check the backend and AI runtime.'
    if (statuses.has('Degraded')) return 'Pipeline degraded — a required dependency is unavailable.'
    return 'All 8 agents are operational and connected to the PASR engine.'
  })()

  return (
    <div className="agents-page">
      <div className="agents-banner">
        <div className="agents-banner-icon"><Bot size={32} /></div>
        <div>
          <h2>PASR Autonomous Agent Pipeline</h2>
          <p>{banner}</p>
        </div>
      </div>

      <section className="detail-card pipeline-card">
        <div className="section-heading">
          <div>
            <h2>Agent Pipeline</h2>
            <p>8-stage autonomous decision flow</p>
          </div>
          {pipelineStatus && (
            <span className={`ping-pill status-${pipelineStatus}`}>
              <span className={`dot ${pipelineStatus === 'operational' ? 'green' : pipelineStatus === 'degraded' ? 'yellow' : 'red'}`} />
              Pipeline: {String(pipelineStatus).toUpperCase()}
            </span>
          )}
        </div>
        <div className="agents-flow">
          {agents.map((agent, index) => {
            const Icon = ICONS[agent.key] || Bot
            const tone = statusTone(agent.status)
            return (
              <div className="agents-flow-step" key={agent.key}>
                <div className="agents-flow-icon">
                  <Icon size={20} />
                </div>
                <span>{agent.stage}. {agent.name}</span>
                <span className={`agents-flow-status ${tone.cls}`}>{agent.status}</span>
                {index < agents.length - 1 && <i className="agents-flow-link" />}
              </div>
            )
          })}
        </div>
      </section>

      <div className="agents-grid">
        {agents.map((agent) => {
          const Icon = ICONS[agent.key] || Bot
          const status = agent.status || (operational ? 'Operational' : 'Offline')
          const tone = statusTone(status)
          return (
            <div className={`agent-card ${tone.cls}`} key={agent.key}>
              <div className="agent-card-top">
                <div className="agent-icon"><Icon size={22} /></div>
                <div className="stage-pill">Stage {agent.stage}</div>
              </div>
              <h3>{agent.name}</h3>
              <p>{agent.description}</p>
              <div className="agent-meta">
                {agent.last_execution ? (
                  <span className="agent-meta-item">
                    Last run: <strong>{agent.last_execution}</strong>
                  </span>
                ) : (
                  <span className="agent-meta-item muted">
                    Last run: <strong>Unavailable</strong>
                  </span>
                )}
              </div>
              {agent.last_output ? (
                <div className="agent-output">
                  <span className="agent-output-label">Last output</span>
                  <p className="agent-output-text">{agent.last_output}</p>
                </div>
              ) : (
                <div className="agent-output muted">
                  <span className="agent-output-label">Last output</span>
                  <p className="agent-output-text">No stored analysis yet.</p>
                </div>
              )}
              <div className={`agent-status ${tone.cls}`}>
                <span className={`dot ${tone.dot}`} />
                <span>{status}</span>
              </div>
            </div>
          )
        })}
      </div>

      <div className="agents-legend">
        <span className="ping-pill">
          <span className="dot green" />Operational — backend, database and AI runtime reachable
        </span>
        <span className="ping-pill">
          <span className="dot yellow" />Degraded — required dependency unavailable
        </span>
        <span className="ping-pill">
          <span className="dot red" />Offline — backend unreachable
        </span>
        <br />
        {loading && (
          <span className="ping-pill">
            <RefreshCw size={11} className="spin" /> Refreshing...
          </span>
        )}
      </div>
    </div>
  )
}