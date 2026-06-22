import { useMemo } from 'react'
import { useAppState } from '../../core/store/AppContext.jsx'
import AgentTag from '../../components/ui/AgentTag.jsx'
import MiniProgressBar from '../../components/ui/MiniProgressBar.jsx'
import ScenarioProgress from './ScenarioProgress.jsx'
import { stepIsDone } from '../../core/selectors/scenarioMatch.js'

export default function ScenarioCard({ scenario, running, completed, onLaunch, onClear, disabled }) {
  const { findings, correlatedAlerts, demoLab } = useAppState()

  const startedAt = running ? demoLab.scenarioStartedAt : null
  const startCutoff = startedAt ? new Date(startedAt).getTime() : 0

  // Count completed steps to drive the progress bar
  const doneCount = useMemo(() => {
    return scenario.steps.filter(step => {
      if (step.anomalyType || step.waitForAlert) {
        return stepIsDone(step, { findings, correlatedAlerts, startCutoff, startedAt })
      }
      // Injection step (no anomalyType / waitForAlert): done while running/completed
      return running || completed
    }).length
  }, [scenario.steps, findings, correlatedAlerts, running, completed, startCutoff, startedAt])

  const totalCount = scenario.steps.length
  const progressPct = totalCount ? Math.round((doneCount / totalCount) * 100) : 0
  const elapsed = running && demoLab.scenarioStartedAt
    ? Math.max(0, Math.round((Date.now() - new Date(demoLab.scenarioStartedAt).getTime()) / 1000))
    : null

  const borderColor = completed ? 'var(--color-success)' : running ? 'var(--color-warning)' : 'var(--color-border-secondary)'

  return (
    <div
      className={running ? 'animate-running-glow' : ''}
      style={{
        background: 'var(--color-bg-card)', border: `1px solid ${borderColor}`,
        borderRadius: 8, padding: 14, display: 'flex', flexDirection: 'column', gap: 10, minWidth: 200,
      }}
    >
      <div>
        <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--color-text-primary)', marginBottom: 3 }}>
          {scenario.title}
        </div>
        <div style={{ fontSize: 11, color: 'var(--color-text-secondary)', lineHeight: 1.4 }}>{scenario.description}</div>
      </div>

      <div style={{ fontSize: 10, color: 'var(--color-text-tertiary)' }}>
        Expected: {scenario.expectedDuration}
      </div>

      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
        {(scenario.expectedAgents || []).map(agent => <AgentTag key={agent} agent={agent} />)}
      </div>

      <ScenarioProgress scenario={scenario} running={running} startedAt={startedAt} />

      {running && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--color-warning)' }}>
            <span>Progress: {doneCount}/{totalCount} steps</span>
            {elapsed != null && <span>{Math.floor(elapsed / 60)}m {elapsed % 60}s</span>}
          </div>
          <MiniProgressBar value={progressPct} max={100} label="" />
        </div>
      )}

      <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
        {!running && !completed && (
          <button
            onClick={onLaunch}
            disabled={disabled}
            style={{
              flex: 1, padding: '5px 0', borderRadius: 4, cursor: disabled ? 'not-allowed' : 'pointer',
              background: disabled ? 'var(--color-border-primary)' : 'var(--color-info)',
              color: '#fff', border: 'none', fontSize: 12, fontWeight: 700, opacity: disabled ? 0.5 : 1,
            }}
          >
            Launch
          </button>
        )}
        {(running || completed) && (
          <button
            onClick={onClear}
            style={{
              flex: 1, padding: '5px 0', borderRadius: 4, cursor: 'pointer',
              background: 'transparent', color: 'var(--color-text-secondary)',
              border: '1px solid var(--color-border-primary)', fontSize: 12,
            }}
          >
            {completed ? 'Reset' : '⏹ Stop & Clear'}
          </button>
        )}
      </div>
    </div>
  )
}
