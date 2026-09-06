import { useEffect, useMemo, useRef, useState } from 'react'
import { Search, RefreshCw, Filter, Activity, AlertTriangle, Ban, ShieldAlert, Radio } from 'lucide-react'
import IncidentTable from '../components/IncidentTable'
import IncidentModal from '../components/IncidentModal'
import StatCard from '../components/StatCard'
import { api } from '../services/api'

export default function Incidents() {
  const [incidents, setIncidents] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [severityFilter, setSeverityFilter] = useState('all')
  const [actionFilter, setActionFilter] = useState('all')
  const [attackFilter, setAttackFilter] = useState('all')
  const [selected, setSelected] = useState(null)
  const [lastUpdated, setLastUpdated] = useState('')

  const inFlight = useRef(false)

  const loadIncidents = async () => {
    if (inFlight.current) return
    inFlight.current = true
    setError('')
    try {
      const data = await api.getIncidents()
      setIncidents(data.incidents || [])
      setLastUpdated(new Date().toLocaleTimeString())
    } catch (err) {
      setError(
        err.message || 'Unable to load incidents from the PASR backend.'
      )
      setIncidents([])
    } finally {
      setLoading(false)
      inFlight.current = false
    }
  }

  useEffect(() => {
    // Async fetch on mount is intentional.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadIncidents()

    const id = setInterval(() => {
      loadIncidents()
    }, 5000)

    return () => clearInterval(id)
  }, [])

  const severityOptions = useMemo(
    () => [...new Set(incidents.map((i) => i.severity).filter(Boolean))].sort(),
    [incidents]
  )
  const actionOptions = useMemo(
    () => [...new Set(incidents.map((i) => i.action_taken).filter(Boolean))].sort(),
    [incidents]
  )
  const attackOptions = useMemo(
    () => [...new Set(incidents.map((i) => i.attack_type).filter(Boolean))].sort(),
    [incidents]
  )

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return incidents.filter((incident) => {
      if (severityFilter !== 'all' && incident.severity !== severityFilter) return false
      if (actionFilter !== 'all' && incident.action_taken !== actionFilter) return false
      if (attackFilter !== 'all' && incident.attack_type !== attackFilter) return false
      if (!q) return true
      const text = [
        incident.source_ip,
        incident.attack_type,
        incident.severity,
        incident.action_taken,
        incident.reason,
        incident.timestamp,
      ]
        .join(' ')
        .toLowerCase()
      return text.includes(q)
    })
  }, [incidents, search, severityFilter, actionFilter, attackFilter])

  const counts = useMemo(() => {
    return {
      total: incidents.length,
      high: incidents.filter((i) => ['HIGH', 'CRITICAL'].includes(i.severity)).length,
      blocked: incidents.filter((i) => i.action_taken === 'BLOCK').length,
      rejected: incidents.filter((i) => !i.guardrail_approved).length,
    }
  }, [incidents])

  const hasActiveFilters =
    search.trim() || severityFilter !== 'all' || actionFilter !== 'all' || attackFilter !== 'all'

  return (
    <div className="incidents-page">
      <div className="stats-grid small">
        <StatCard icon={<Activity size={20} />} title="Total Incidents" value={counts.total} tone="blue" />
        <StatCard icon={<AlertTriangle size={20} />} title="High / Critical" value={counts.high} tone="red" />
        <StatCard icon={<Ban size={20} />} title="Blocked" value={counts.blocked} tone="green" />
        <StatCard icon={<ShieldAlert size={20} />} title="Guardrail Rejected" value={counts.rejected} tone="yellow" />
      </div>

      <div className="table-card">
        <div className="incident-toolbar">
          <div className="search-box">
            <Search size={18} />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search IP, attack type, reason, timestamp..."
            />
          </div>

          <select value={severityFilter} onChange={(e) => setSeverityFilter(e.target.value)}>
            <option value="all">All Severities</option>
            {severityOptions.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>

          <select value={actionFilter} onChange={(e) => setActionFilter(e.target.value)}>
            <option value="all">All Actions</option>
            {actionOptions.map((a) => (
              <option key={a} value={a}>{a}</option>
            ))}
          </select>

          <select value={attackFilter} onChange={(e) => setAttackFilter(e.target.value)}>
            <option value="all">All Attack Types</option>
            {attackOptions.map((a) => (
              <option key={a} value={a}>{a}</option>
            ))}
          </select>

          <button
            className="refresh-btn"
            onClick={() => loadIncidents()}
            disabled={loading}
          >
            <RefreshCw size={17} className={loading ? 'spin' : ''} />
            Refresh
          </button>
        </div>

        <div className="table-subbar">
          <span className="filter-indicator">
            <Filter size={14} />
            {filtered.length} of {incidents.length} incidents
            {hasActiveFilters ? ' (filtered)' : ''}
          </span>
          <span className="ping-pill">
            <Radio size={12} />
            Live · refreshed {lastUpdated || '…'}
          </span>
        </div>

        {error && <div className="error-box">{error}</div>}

        <IncidentTable
          incidents={filtered}
          loading={loading}
          onSelect={setSelected}
        />
      </div>

      <IncidentModal incident={selected} onClose={() => setSelected(null)} />
    </div>
  )
}
