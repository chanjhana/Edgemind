import { useMemo } from 'react'
import { useAppState } from '../../core/store/AppContext.jsx'
import StatusDot from '../../components/ui/StatusDot.jsx'
import SeverityBadge from '../../components/ui/SeverityBadge.jsx'
import AgentTag from '../../components/ui/AgentTag.jsx'

function relTime(ts) {
  if (!ts) return ''
  const diff = Math.round((Date.now() - new Date(ts)) / 1000)
  if (diff < 60) return `${diff}s ago`
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  return `${Math.floor(diff / 3600)}h ago`
}

export default function TopRiskyPods() {
  const { findings } = useAppState()

  const top = useMemo(() => {
    const worst = {}
    findings.forEach(f => {
      const pod = f.pod
      if (!pod) return
      if (!worst[pod] || f.severity === 'critical') worst[pod] = f
    })
    return Object.values(worst)
      .sort((a, b) => {
        if (a.severity === 'critical' && b.severity !== 'critical') return -1
        if (b.severity === 'critical' && a.severity !== 'critical') return 1
        return 0
      })
      .slice(0, 5)
  }, [findings])

  if (top.length === 0) return null

  return (
    <div style={{ background: 'var(--color-bg-card)', border: '1px solid var(--color-border-card)', borderRadius: 6, padding: '10px 12px' }}>
      <div style={{ fontSize: 10, color: 'var(--color-text-tertiary)', marginBottom: 8, fontWeight: 700 }}>TOP RISKY PODS</div>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
        <tbody>
          {top.map(f => (
            <tr key={f.finding_id || f.pod} style={{ borderBottom: '1px solid var(--color-border-card)' }}>
              <td style={{ padding: '5px 4px', display: 'flex', alignItems: 'center', gap: 6 }}>
                <StatusDot health={f.severity === 'critical' ? 'critical' : f.severity === 'warning' ? 'warning' : 'healthy'} />
                <span style={{ color: 'var(--color-text-primary)' }}>{f.pod}</span>
              </td>
              <td style={{ padding: '5px 4px', color: 'var(--color-text-secondary)' }}>{f.anomaly_type}</td>
              <td style={{ padding: '5px 4px' }}><AgentTag agent={f.agent} /></td>
              <td style={{ padding: '5px 4px', color: 'var(--color-text-tertiary)', textAlign: 'right' }}>{relTime(f.timestamp)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
