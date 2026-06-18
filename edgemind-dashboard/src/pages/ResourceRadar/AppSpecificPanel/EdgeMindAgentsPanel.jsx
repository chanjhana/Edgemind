import { useAppState } from '../../../core/store/AppContext.jsx'
import AgentTag from '../../../components/ui/AgentTag.jsx'
import SeverityBadge from '../../../components/ui/SeverityBadge.jsx'

const AGENTS = ['cpu', 'memory', 'storage', 'network_log']

function fmtAge(isoStr) {
  if (!isoStr) return 'never'
  const diffMs = Date.now() - new Date(isoStr).getTime()
  if (diffMs < 0) return 'just now'
  if (diffMs < 60000) return `${Math.floor(diffMs / 1000)}s ago`
  return `${Math.floor(diffMs / 60000)}m ago`
}

function fmtMetricValue(f) {
  const v = f.metric_value ?? f.value ?? null
  if (v == null) return null
  if (typeof v === 'number') return v.toFixed(2)
  return String(v)
}

export default function EdgeMindAgentsPanel({ podName }) {
  const { agentHeartbeats, findings, agentsReady } = useAppState()

  const recentFindings = findings.slice(0, 5)
  const totalFindings = findings.length

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ fontSize: 10, color: 'var(--color-text-tertiary)', fontWeight: 700 }}>AGENT HEARTBEATS</div>
        <span style={{
          fontSize: 10, padding: '2px 8px', borderRadius: 10,
          background: agentsReady ? 'var(--color-success-tint)' : 'var(--color-warning-tint)',
          color: agentsReady ? 'var(--color-success)' : 'var(--color-warning)',
        }}>
          {agentsReady ? 'All Ready' : 'Warming up'}
        </span>
      </div>

      {AGENTS.map(agent => {
        const ts = agentHeartbeats[agent]
        const alive = ts && (Date.now() - new Date(ts).getTime()) < 60000
        return (
          <div key={agent} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0', borderBottom: '1px solid var(--color-border-card)' }}>
            <div style={{ width: 6, height: 6, borderRadius: '50%', background: alive ? 'var(--color-success)' : ts ? 'var(--color-warning)' : 'var(--color-border-primary)', flexShrink: 0 }} />
            <AgentTag agent={agent} />
            <span style={{ flex: 1, fontSize: 11, color: 'var(--color-text-tertiary)' }}>{fmtAge(ts)}</span>
          </div>
        )
      })}

      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
          <div style={{ fontSize: 10, color: 'var(--color-text-tertiary)', fontWeight: 700 }}>RECENT FINDINGS</div>
          <span style={{ fontSize: 10, color: 'var(--color-text-tertiary)' }}>Total (session): {totalFindings}</span>
        </div>
        {recentFindings.length === 0 && (
          <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>No findings yet</div>
        )}
        {recentFindings.map((f, i) => {
          const metVal = fmtMetricValue(f)
          return (
            <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'center', padding: '4px 0', borderBottom: '1px solid var(--color-border-card)', fontSize: 11 }}>
              <SeverityBadge severity={f.severity} />
              <AgentTag agent={f.agent} />
              <span style={{ color: 'var(--color-text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 80 }}>{f.pod}</span>
              <span style={{ color: 'var(--color-text-tertiary)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.anomaly_type}</span>
              {metVal && (
                <span style={{ fontSize: 10, color: 'var(--color-text-tertiary)', fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>{metVal}</span>
              )}
              <span style={{ fontSize: 10, color: 'var(--color-text-tertiary)', flexShrink: 0 }}>{fmtAge(f.timestamp)}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
