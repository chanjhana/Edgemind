import { useAppState } from '../../core/store/AppContext.jsx'
import { stepIsDone } from '../../core/selectors/scenarioMatch.js'

function StepRow({ step, status, isLast }) {
  const isDone = status === 'done'
  const isActive = status === 'active'
  const color = isDone ? 'var(--color-success)' : isActive ? 'var(--color-warning)' : 'var(--color-border-primary)'
  const textColor = isDone ? 'var(--color-text-primary)' : isActive ? 'var(--color-text-primary)' : 'var(--color-text-tertiary)'
  const fontWeight = isActive ? 700 : 500

  return (
    <div style={{ display: 'flex', gap: 14, position: 'relative', paddingBottom: isLast ? 0 : 20 }}>
      {!isLast && (
        <div style={{ 
          position: 'absolute', left: 9, top: 24, bottom: 0, width: 2, 
          background: isDone ? 'var(--color-success)' : 'var(--color-border-secondary)',
          zIndex: 0
        }} />
      )}
      <div style={{
        width: 20, height: 20, borderRadius: '50%', background: isDone ? 'var(--color-success)' : isActive ? 'var(--color-bg-card)' : 'var(--color-bg-surface)',
        border: `2px solid ${color}`, display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1,
        marginTop: 0, flexShrink: 0
      }}>
        {isDone && <span style={{ color: '#fff', fontSize: 10, fontWeight: 900 }}>✓</span>}
        {isActive && <div style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--color-warning)' }} className="animate-pulse-dot" />}
      </div>
      <div style={{ color: textColor, fontSize: 13, fontWeight, paddingTop: 0, lineHeight: 1.4 }}>
        {step.label}
      </div>
    </div>
  )
}

export default function ScenarioProgress({ scenario, running, startedAt }) {
  const { findings, correlatedAlerts } = useAppState()

  const startCutoff = startedAt ? new Date(startedAt).getTime() : 0

  const stepStatuses = scenario.steps.map(step => {
    if (stepIsDone(step, { findings, correlatedAlerts, startCutoff, startedAt })) return 'done'
    // Injection step: no anomalyType, no waitForAlert — mark done once running
    if (!step.anomalyType && !step.waitForAlert && running) return 'done'
    return 'pending'
  })

  const activeIdx = running ? stepStatuses.findIndex(s => s !== 'done') : -1
  const finalStatuses = stepStatuses.map((s, i) => (i === activeIdx ? 'active' : s))

  return (
    <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', height: '100%', alignItems: 'flex-start' }}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
        {scenario.steps.map((step, i) => (
          <StepRow key={step.id} step={step} status={finalStatuses[i]} isLast={i === scenario.steps.length - 1} />
        ))}
      </div>
    </div>
  )
}
