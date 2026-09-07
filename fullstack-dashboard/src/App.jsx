import { useEffect, useState } from 'react'
import Sidebar from './components/Sidebar'
import Header from './components/Header'
import Dashboard from './pages/Dashboard'
import Incidents from './pages/Incidents'
import ResponseActions from './pages/ResponseActions'
import AIAgents from './pages/AIAgents'
import Infrastructure from './pages/Infrastructure'
import { api } from './services/api'
import './App.css'

const PAGE_META = {
  dashboard: {
    title: 'Security Operations Center',
    subtitle: 'Autonomous threat detection and response',
  },
  incidents: {
    title: 'Security Incidents',
    subtitle: 'Historical security events detected by PASR',
  },
  response: {
    title: 'Response Actions',
    subtitle: 'Autonomous security response actions',
  },
  agents: {
    title: 'AI Agents',
    subtitle: 'PASR multi-agent security decision system',
  },
  infrastructure: {
    title: 'Infrastructure',
    subtitle: 'Protected infrastructure and critical assets',
  },
}

const EXAMPLE_LOG =
  'WARNING: Multiple failed SSH login attempts detected from 172.16.0.99 (200 attempts in 30 seconds)'

function App() {
  const [activePage, setActivePage] = useState('dashboard')

  const [backendOnline, setBackendOnline] = useState(true)

  const [rawLog, setRawLog] = useState(EXAMPLE_LOG)
  const [result, setResult] = useState(null)
  const [analyzing, setAnalyzing] = useState(false)
  const [analyzeError, setAnalyzeError] = useState('')

  const checkBackend = async () => {
    try {
      await api.getStats()
      setBackendOnline(true)
    } catch {
      setBackendOnline(false)
    }
  }

  useEffect(() => {
    // Async fetch on mount/interval is intentional.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    checkBackend()
    const id = setInterval(checkBackend, 30000)
    return () => clearInterval(id)
  }, [])

  const handleAnalyze = async () => {
  if (!rawLog.trim() || analyzing) return

  setAnalyzing(true)
  setAnalyzeError('')
  setResult(null)

  try {
    const data = await api.analyzeLog(rawLog)

    console.log('PASR API RESPONSE:', data)

    // Backend returns:
    // { status: "processed", result: { attack, correlation, ... } }
    // Dashboard expects the inner result object.
    setResult(data.result || data)

    setBackendOnline(true)
    checkBackend()
  } catch (err) {
    setAnalyzeError(
      err.message ||
        'Unable to reach the PASR backend. Verify FastAPI is running on port 8000.'
    )
    setBackendOnline(false)
  } finally {
    setAnalyzing(false)
  }
}

  const handleNavigate = (page) => {
    setActivePage(page)
    setAnalyzeError('')
  }

  const meta = PAGE_META[activePage]

  return (
    <div className="app">
      <Sidebar activePage={activePage} onNavigate={handleNavigate} />

      <main className="main">
        <Header title={meta.title} subtitle={meta.subtitle} live={backendOnline} />

        {!backendOnline && (
          <div className="banner-error">
            Backend connection lost. Showing cached data where available — start FastAPI on port 8000 to reconnect.
            <button className="banner-btn" onClick={checkBackend}>Reconnect</button>
          </div>
        )}

        {activePage === 'dashboard' && (
          <Dashboard
            rawLog={rawLog}
            onRawLogChange={setRawLog}
            analyzing={analyzing}
            analyzeError={analyzeError}
            result={result}
            onAnalyze={handleAnalyze}
            onReset={() => setResult(null)}
            backendOnline={backendOnline}
          />
        )}

        {activePage === 'incidents' && <Incidents />}
        {activePage === 'response' && <ResponseActions />}
        {activePage === 'agents' && <AIAgents backendOnline={backendOnline} />}
        {activePage === 'infrastructure' && <Infrastructure />}
      </main>
    </div>
  )
}

export default App
