import {
  Shield,
  LayoutDashboard,
  AlertTriangle,
  Ban,
  BrainCircuit,
  ServerCog,
} from 'lucide-react'

const NAV_ITEMS = [
  { key: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { key: 'incidents', label: 'Incidents', icon: AlertTriangle },
  { key: 'response', label: 'Response Actions', icon: Ban },
  { key: 'agents', label: 'AI Agents', icon: BrainCircuit },
  { key: 'infrastructure', label: 'Infrastructure', icon: ServerCog },
]

export default function Sidebar({ activePage, onNavigate }) {
  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-icon">
          <Shield size={26} />
        </div>
        <div className="brand-text">
          <h2>PASR</h2>
          <span>Autonomous SOC</span>
        </div>
      </div>

      <div className="sidebar-label">Navigation</div>

      <nav>
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon
          return (
            <button
              key={item.key}
              className={`nav-item ${activePage === item.key ? 'active' : ''}`}
              onClick={() => onNavigate(item.key)}
              aria-current={activePage === item.key ? 'page' : undefined}
            >
              <Icon size={19} />
              <span>{item.label}</span>
            </button>
          )
        })}
      </nav>

      <div className="sidebar-footer">
        <div className="sidebar-health">
          <span className="dot green" />
          <div>
            <strong>PASR Engine</strong>
            <span>System operational</span>
          </div>
        </div>
      </div>
    </aside>
  )
}
