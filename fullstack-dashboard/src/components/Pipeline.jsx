import {
  ScanSearch,
  GitMerge,
  Gauge,
  Bot,
  FileCode2,
  MessageSquareText,
  BookOpenCheck,
  ShieldCheck,
} from 'lucide-react'

const STEPS = [
  { key: 'attack', number: 1, name: 'Attack Analyzer', icon: ScanSearch },
  { key: 'correlation', number: 2, name: 'Threat Correlator', icon: GitMerge },
  { key: 'risk', number: 3, name: 'Risk Assessment', icon: Gauge },
  { key: 'decision', number: 4, name: 'Decision Agent', icon: Bot },
  { key: 'rule', number: 5, name: 'Rule Generator', icon: FileCode2 },
  { key: 'explanation', number: 6, name: 'Explanation Agent', icon: MessageSquareText },
  { key: 'knowledge', number: 7, name: 'Knowledge Agent', icon: BookOpenCheck },
  { key: 'guardrail', number: 8, name: 'Guardrails', icon: ShieldCheck },
]

export default function Pipeline({ completed = false, reducing = false, backendOnline = true }) {
  return (
    <div className={`pipeline ${reducing ? 'reduce' : ''}`}>
      <div className="pipeline-grid">
        {STEPS.map((step) => {
          const Icon = step.icon
          return (
            <div
              key={step.key}
              className={`pipeline-step ${completed ? 'done' : ''} ${backendOnline ? '' : 'offline'}`}
            >
              <div className="step-icon">
                <Icon size={20} />
              </div>
              <div className="step-meta">
                <span className="step-number">#{String(step.number).padStart(2, '0')}</span>
                <strong>{step.name}</strong>
                <span className="step-status">
                  {completed ? 'Completed' : backendOnline ? 'Operational' : 'Offline'}
                </span>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
