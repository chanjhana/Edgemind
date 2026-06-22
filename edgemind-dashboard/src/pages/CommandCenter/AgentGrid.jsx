import { useMemo } from 'react'
import { useAppState } from '../../core/store/AppContext.jsx'
import AgentCard from './AgentCard.jsx'
import PanelHeader from '../../components/ui/PanelHeader.jsx'

// Band 3 (left) — the four cognitive agents that make up EdgeMind's detection
// layer. Shows judges that detection is distributed across specialised agents,
// each watching one resource dimension. All live from findings + heartbeats.

const AGENTS = [
  { id: 'cpu',         label: 'CPU Agent' },
  { id: 'memory',      label: 'Memory Agent' },
  { id: 'storage',     label: 'Storage Agent' },
  { id: 'network_log', label: 'Network / Log Agent' },
]

export default function AgentGrid() {
  const { findings, agentHeartbeats } = useAppState()

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
    </div>
  )
}
