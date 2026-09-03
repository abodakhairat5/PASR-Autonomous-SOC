import { Link, Route, Routes, useLocation } from 'react-router-dom';
import { HealthBadge } from './components/HealthBadge';
import { EngagementDetailPage } from './pages/EngagementDetail';
import { EngagementsPage } from './pages/Engagements';
import { FindingsPage } from './pages/Findings';

const nav = [
  { to: '/', label: 'Engagements' },
  { to: '/findings', label: 'Findings' },
];

export function App() {
  const loc = useLocation();

  return (
    <div
      style={{
        fontFamily: 'system-ui, -apple-system, sans-serif',
        color: '#e0e0e0',
        background: '#0a0a0f',
        minHeight: '100vh',
      }}
    >
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '12px 24px',
          borderBottom: '1px solid #1a1a2e',
          background: '#0f0f1a',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 24 }}>
          <Link
            to="/"
            style={{ fontSize: 18, fontWeight: 700, color: '#7c5cff', textDecoration: 'none' }}
          >
            PentesterFlow
          </Link>
          <nav style={{ display: 'flex', gap: 16 }}>
            {nav.map((n) => (
              <Link
                key={n.to}
                to={n.to}
                style={{
                  color:
                    loc.pathname === n.to || (n.to !== '/' && loc.pathname.startsWith(n.to))
                      ? '#7c5cff'
                      : '#888',
                  textDecoration: 'none',
                  fontSize: 14,
                  fontWeight: 500,
                }}
              >
                {n.label}
              </Link>
            ))}
          </nav>
        </div>
        <HealthBadge />
      </header>
      <main style={{ maxWidth: 1200, margin: '0 auto', padding: 24 }}>
        <Routes>
          <Route path="/" element={<EngagementsPage />} />
          <Route path="/engagements/:id" element={<EngagementDetailPage />} />
          <Route path="/findings" element={<FindingsPage />} />
        </Routes>
      </main>
    </div>
  );
}
