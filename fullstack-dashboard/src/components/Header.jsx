import { Activity } from 'lucide-react'

export default function Header({ title, subtitle, live = true }) {
  return (
    <header className="header">
      <div className="header-text">
        <h1>{title}</h1>
        <p>{subtitle}</p>
      </div>
      {live && (
        <div className="live-indicator">
          <span className="live-dot" />
          <Activity size={14} />
          LIVE
        </div>
      )}
    </header>
  )
}
