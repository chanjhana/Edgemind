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
        borderRadius: 8, padding: 10, display: 'flex', flexDirection: 'column', gap: 6, minWidth: 200,
        height: '100%', boxShadow: '0 2px 8px var(--color-shadow)',
        opacity: disabled ? 0.4 : 1, pointerEvents: disabled ? 'none' : 'auto', filter: disabled ? 'grayscale(100%)' : 'none', transition: 'all 0.3s'
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--color-text-primary)', marginBottom: 2 }}>
            {scenario.title}
          </div>
          <div style={{ fontSize: 10, color: 'var(--color-text-secondary)', lineHeight: 1.3 }}>
            {scenario.description}
          </div>
        </div>
        <div style={{ 
          background: 'var(--color-bg-surface)', padding: '2px 6px', borderRadius: 12, 
          fontSize: 9, fontWeight: 700, color: 'var(--color-text-tertiary)',
          display: 'flex', alignItems: 'center', gap: 3, flexShrink: 0, border: '1px solid var(--color-border-card)'
        }}>
          ⏱ {scenario.expectedDuration}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center' }}>
        <span style={{ fontSize: 8, fontWeight: 800, color: 'var(--color-text-tertiary)', letterSpacing: '0.05em' }}>AGENTS:</span>
        {(scenario.expectedAgents || []).map(agent => <AgentTag key={agent} agent={agent} />)}
      </div>

      <div style={{ 
        flex: 1, background: 'var(--color-bg-surface)', borderRadius: 4, padding: '6px 10px', 
        border: '1px solid var(--color-border-card)', overflowY: 'auto'
      }}>
        <ScenarioProgress scenario={scenario} running={running} startedAt={startedAt} />
      </div>

      {running && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, fontWeight: 700, color: 'var(--color-warning)' }}>
            <span>Progress: {doneCount} of {totalCount}</span>
            {elapsed != null && <span>Elapsed: {Math.floor(elapsed / 60)}m {elapsed % 60}s</span>}
          </div>
          <MiniProgressBar value={progressPct} max={100} label="" />
        </div>
      )}

      <div style={{ display: 'flex', gap: 6, marginTop: 'auto', paddingTop: 4 }}>
        {!running && !completed && (
          <button
            onClick={onLaunch}
            disabled={disabled}
            style={{
              flex: 1, padding: '6px 0', borderRadius: 4, cursor: disabled ? 'not-allowed' : 'pointer',
              background: disabled ? 'var(--color-border-primary)' : 'var(--color-info)',
              color: '#fff', border: 'none', fontSize: 11, fontWeight: 700, opacity: disabled ? 0.5 : 1,
              transition: 'background 0.2s', boxShadow: '0 1px 3px var(--color-shadow)'
            }}
          >
            Launch Scenario
          </button>
        )}
        {(running || completed) && (
          <button
            onClick={onClear}
            style={{
              flex: 1, padding: '6px 0', borderRadius: 4, cursor: 'pointer',
              background: completed ? 'var(--color-bg-surface)' : 'var(--color-danger-tint)',
              color: completed ? 'var(--color-text-primary)' : 'var(--color-danger)',
              border: `1px solid ${completed ? 'var(--color-border-primary)' : 'var(--color-danger-border)'}`,
              fontSize: 11, fontWeight: 700, transition: 'all 0.2s'
            }}
          >
            {completed ? 'Reset Scenario' : '⏹ Stop'}
          </button>
        )}
      </div>
    </div>
  )
}
