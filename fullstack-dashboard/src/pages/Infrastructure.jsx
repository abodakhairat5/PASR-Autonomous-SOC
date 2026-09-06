import { useEffect, useRef, useState } from 'react'
import { Server, Database, Cpu, ShieldCheck, Wifi, RefreshCw, Bot, Clock } from 'lucide-react'
import { api } from '../services/api'

function InfraCard({ icon, title, status, tone, detail }) {
  const ok = tone === 'green'
  return (
    <div className={`infra-card tone-${tone}`}>
      <div className="infra-icon">{icon}</div>
      <div className="infra-body">
        <h3>{title}</h3>
        <div className="status-line">
          <span className={`dot ${ok ? 'green' : tone === 'yellow' ? 'yellow' : 'red'}`} />
          <span>{status}</span>
        </div>
        {detail && <p className="infra-detail">{detail}</p>}
      </div>
    </div>
  )
}

function toTone(status) {
  const s = String(status || '').toLowerCase()
  if (['online', 'available', 'operational', 'active', 'ok', 'healthy'].includes(s)) return 'green'
  if (['degraded', 'unknown', 'pending'].includes(s)) return 'yellow'
  return 'red'
}

function fmt(value) {
  return String(value || '')
    .replace(/^./, (c) => c.toUpperCase())
    .replace(/_/g, ' ')
}

export default function Infrastructure() {
  const [infra, setInfra] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const inFlight = useRef(false)

  const check = async () => {
    if (inFlight.current) return
    inFlight.current = true
    setLoading(true)
    setError('')
    try {
      const data = await api.getInfrastructure()
      setInfra(data)
    } catch (err) {
      setInfra(null)
      setError(err.message || 'Backend unreachable.')
    } finally {
      setLoading(false)
      inFlight.current = false
    }
  }

  useEffect(() => {
    // Async fetch on mount is intentional.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    check()

    const id = setInterval(() => {
      // Keep service health current without aggressive polling.
      check()
    }, 5000)

    return () => clearInterval(id)
  }, [])

  const apiCfg = infra?.api
  const dbCfg = infra?.database
  const pipelineCfg = infra?.pipeline
  const guardrailCfg = infra?.guardrails
  const ollamaCfg = infra?.ollama

  const allOk =
    apiCfg && dbCfg && pipelineCfg && guardrailCfg && ollamaCfg &&
    ['online', 'available', 'operational', 'active'].includes(String(apiCfg.status).toLowerCase()) &&
    ['online', 'available', 'operational', 'active'].includes(String(dbCfg.status).toLowerCase()) &&
    ['online', 'operational'].includes(String(ollamaCfg.status).toLowerCase())

  return (
    <div className="infrastructure-page">
      <div className="infra-toolbar">
        <div>
          <h2>Infrastructure Monitoring</h2>
          <p>Live status of the PASR Autonomous SOC stack</p>
        </div>
        <button className="refresh-btn" onClick={check} disabled={loading}>
          <RefreshCw size={17} className={loading ? 'spin' : ''} />
          Check Status
        </button>
      </div>

      {error && <div className="error-box">{error}</div>}

      <div className="infra-grid">
        <InfraCard
          icon={<Server size={24} />}
          title={apiCfg?.name || 'PASR API'}
          status={apiCfg ? fmt(apiCfg.status) : 'Unavailable'}
          tone={apiCfg ? toTone(apiCfg.status) : 'red'}
          detail={apiCfg?.detail || 'FastAPI backend unavailable'}
        />
        <InfraCard
          icon={<Database size={24} />}
          title={dbCfg?.name || 'Threat Database'}
          status={dbCfg ? fmt(dbCfg.status) : 'Unavailable'}
          tone={dbCfg ? toTone(dbCfg.status) : 'red'}
          detail={dbCfg?.detail || 'Cannot verify database'}
        />
        <InfraCard
          icon={<Cpu size={24} />}
          title={pipelineCfg?.name || 'AI Pipeline'}
          status={pipelineCfg ? fmt(pipelineCfg.status) : 'Degraded'}
          tone={pipelineCfg ? toTone(pipelineCfg.status) : 'yellow'}
          detail={pipelineCfg?.detail || 'Pipeline status unknown'}
        />
        <InfraCard
          icon={<Bot size={24} />}
          title={ollamaCfg?.name || 'Ollama / Qwen'}
          status={ollamaCfg ? fmt(ollamaCfg.status) : 'Offline'}
          tone={ollamaCfg ? toTone(ollamaCfg.status) : 'red'}
          detail={ollamaCfg?.detail || 'Ollama unreachable'}
        />
        <InfraCard
          icon={<ShieldCheck size={24} />}
          title={guardrailCfg?.name || 'Guardrails'}
          status={guardrailCfg ? fmt(guardrailCfg.status) : 'Unknown'}
          tone={guardrailCfg ? toTone(guardrailCfg.status) : 'yellow'}
          detail={guardrailCfg?.detail || 'Guardrail status unknown'}
        />
      </div>

      <div className="infra-summary">
        <div className="infra-endpoint">
          <Wifi size={16} />
          <span>API Endpoint</span>
          <code>{infra?.endpoints?.api || 'http://127.0.0.1:8000'}</code>
        </div>
        <div className="infra-endpoint">
          <Wifi size={16} />
          <span>Frontend</span>
          <code>{infra?.endpoints?.frontend || 'http://localhost:5174'}</code>
        </div>
        <div className="infra-endpoint">
          <Clock size={16} />
          <span>Last checked</span>
          <code>{infra?.checked_at || '…'}</code>
        </div>
        <div className="infra-endpoint">
          <Wifi size={16} />
          <span>Status</span>
          <code className={allOk ? 'ok' : 'bad'}>
            {allOk ? 'ALL SYSTEMS OPERATIONAL' : 'CHECK SERVICES'}
          </code>
        </div>
      </div>
    </div>
  )
}