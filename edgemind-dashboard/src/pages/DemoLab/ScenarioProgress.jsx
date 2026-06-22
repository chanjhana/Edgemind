import { useAppState } from '../../core/store/AppContext.jsx'
import { stepIsDone } from '../../core/selectors/scenarioMatch.js'

function StepRow({ step, status }) {
  const color =
    status === 'done'   ? 'var(--color-success)' :
    status === 'active' ? 'var(--color-warning)' :
    'var(--color-text-tertiary)'
  const icon =
    status === 'done'   ? '✓' :
    status === 'active' ? '⏳' :
    '○'

  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 11, padding: '3px 0' }}>
      <span style={{ color, width: 14, flexShrink: 0 }}>{icon}</span>
      <span style={{ color: status === 'pending' ? 'var(--color-text-tertiary)' : 'var(--color-text-secondary)' }}>
        {step.label}
      </span>
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
    <div>
      {scenario.steps.map((step, i) => (
        <StepRow key={step.id} step={step} status={finalStatuses[i]} />
      ))}
    </div>
  )
}
