export default function StatCard({ icon, title, value, tone = 'blue', subtitle }) {
  return (
    <div className={`stat-card tone-${tone}`}>
      <div className="stat-icon">{icon}</div>
      <div className="stat-body">
        <span className="stat-title">{title}</span>
        <strong className="stat-value">{value ?? '—'}</strong>
        {subtitle && <span className="stat-subtitle">{subtitle}</span>}
      </div>
    </div>
  )
}
