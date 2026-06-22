import { useMemo } from 'react'
import { useAppState } from '../../core/store/AppContext.jsx'
import AgentCard from './AgentCard.jsx'
import PanelHeader from '../../components/ui/PanelHeader.jsx'

// Band 3 (left) — the four cognitive agents that make up EdgeMind's detection
// layer + DMD early-warning forecaster shown in a separate row.

const AGENTS = [
  { id: 'cpu',         label: 'CPU Agent' },
  { id: 'memory',      label: 'Memory Agent' },
  { id: 'storage',     label: 'Storage Agent' },
  { id: 'network_log', label: 'Network / Log Agent' },
]

export default function AgentGrid() {
  const { findings, agentHeartbeats, dmdForecasts } = useAppState()

  const byAgent = useMemo(() => {
    const map = {}
    AGENTS.forEach(a => { map[a.id] = { latest: null, activeCount: 0 } })
    const sorted = [...findings].sort((x, y) => new Date(y.timestamp) - new Date(x.timestamp))
    const cutoff = Date.now() - 10 * 60 * 1000
    sorted.forEach(f => {
      const slot = map[f.agent]
      if (!slot) return
      if (!slot.latest) slot.latest = f
      const recent = f.timestamp && new Date(f.timestamp).getTime() >= cutoff
      if (recent && (f.severity === 'critical' || f.severity === 'warning')) slot.activeCount++
    })
    return map
  }, [findings])

  const dmdAlive = agentHeartbeats['dmd'] != null
  const dmdWarnCount = (dmdForecasts?.warnings ?? []).length
  const dmdInstCount = (dmdForecasts?.instabilities ?? []).length
  const dmdActiveCount = dmdWarnCount + dmdInstCount
  const dmdLastUpdated = dmdForecasts?.lastUpdated

  return (
    <div style={{
      background: 'var(--color-bg-card)',
      border: '1.5px solid var(--color-border-card)',
      borderRadius: 6, padding: '10px 12px',
      display: 'flex', flexDirection: 'column', gap: 8,
    }}>
      <PanelHeader title="Multi-Agent Intelligence Grid" hint="cognitive agent telemetry" />
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {AGENTS.map(a => (
          <AgentCard
            key={a.id}
            agent={a.id}
            label={a.label}
            alive={agentHeartbeats[a.id] != null}
            latest={byAgent[a.id].latest}
            activeCount={byAgent[a.id].activeCount}
          />
        ))}
      </div>

      {/* DMD agent — separate row, advisory forecaster */}
      <div style={{
        borderTop: '1px solid var(--color-border-secondary)',
        paddingTop: 8,
        display: 'flex',
        alignItems: 'center',
        gap: 10,
      }}>
        {/* Status dot */}
        <span style={{
          width: 7, height: 7, borderRadius: '50%', flexShrink: 0,
          background: dmdAlive ? 'var(--color-success)' : 'var(--color-text-tertiary)',
          display: 'inline-block',
        }} />

        {/* DMD badge */}
        <span style={{
          fontSize: 9, fontWeight: 700, padding: '2px 5px',
          borderRadius: 3,
          background: 'rgba(255,190,0,0.12)',
          color: 'var(--color-warning)',
          letterSpacing: '0.04em',
        }}>DMD</span>

        <span style={{ fontSize: 11, color: 'var(--color-text-secondary)', fontWeight: 600 }}>
          Forecast Engine
        </span>
        <span style={{ fontSize: 10, color: 'var(--color-text-tertiary)' }}>
          multivariate eigenstructure
        </span>

        <div style={{ marginLeft: 'auto', display: 'flex', gap: 6, alignItems: 'center' }}>
          {dmdActiveCount > 0 ? (
            <span style={{
              fontSize: 9, fontWeight: 700, padding: '2px 6px',
              borderRadius: 3,
              background: dmdInstCount > 0 ? 'rgba(255,0,15,0.1)' : 'rgba(255,190,0,0.1)',
              color: dmdInstCount > 0 ? 'var(--color-danger)' : 'var(--color-warning)',
            }}>
              {dmdActiveCount} active
            </span>
          ) : (
            <span style={{ fontSize: 9, color: 'var(--color-text-tertiary)' }}>no warnings</span>
          )}
          {dmdLastUpdated && (
            <span style={{ fontSize: 9, color: 'var(--color-text-tertiary)' }}>
              {new Date(dmdLastUpdated).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </span>
          )}
        </div>
      </div>
    </div>
  )
}
