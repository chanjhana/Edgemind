import { useMemo, useState } from 'react'
import { useAppState } from '../../core/store/AppContext.jsx'
import SeverityBadge from '../../components/ui/SeverityBadge.jsx'
import AgentTag from '../../components/ui/AgentTag.jsx'

function exportCsv(rows) {
  const header = 'timestamp,namespace,pod,agent,severity,anomaly_type,confidence\n'
  const body = rows.map(f =>
    [f.timestamp, f.namespace, f.pod, f.agent, f.severity, f.anomaly_type, f.confidence].map(v => `"${v ?? ''}"`).join(',')
  ).join('\n')
  const blob = new Blob([header + body], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'edgemind-incident-findings.csv'
  a.click()
  URL.revokeObjectURL(url)
}

export default function FindingsTable({ alert }) {
  const { findings } = useAppState()
  const [agentFilter, setAgentFilter] = useState('all')
  const [podFilter, setPodFilter] = useState('all')
  const [nsFilter, setNsFilter] = useState('all')

  const incidentWindow = useMemo(() => {
    if (!alert?.timestamp) return null
    const alertMs = new Date(alert.timestamp).getTime()
    const duration = (alert.duration_s || 120) * 1000
    return { start: alertMs - 5000, end: alertMs + duration }
  }, [alert])

  const baseRows = useMemo(() => {
    if (!alert) return findings.slice(0, 50)
    if (incidentWindow) {
      return findings.filter(f => {
        const ms = f.timestamp ? new Date(f.timestamp).getTime() : 0
        return ms >= incidentWindow.start && ms <= incidentWindow.end
      })
    }
    return findings.filter(f => alert.causal_chain?.includes(f.pod) || f.correlated_id === alert.id)
  }, [findings, alert, incidentWindow])

  const pods = [...new Set(baseRows.map(f => f.pod).filter(Boolean))]
  const rows = baseRows
    .filter(f => agentFilter === 'all' || f.agent === agentFilter)
    .filter(f => podFilter === 'all' || f.pod === podFilter)
    .filter(f => nsFilter === 'all' || f.namespace === nsFilter)
    .slice(0, 50)

  if (baseRows.length === 0) return null

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 10, color: 'var(--color-text-tertiary)', fontWeight: 700, padding: '6px 0', borderBottom: '1px solid var(--color-border-card)' }}>
        <span>RELATED FINDINGS ({rows.length})</span>
        <span style={{ flex: 1 }} />
        <select value={agentFilter} onChange={e => setAgentFilter(e.target.value)} style={{ fontSize: 10, background: 'var(--color-bg-input)', color: 'var(--color-text-primary)', border: '1px solid var(--color-border-primary)', borderRadius: 4 }}>
          <option value="all">all agents</option>
          <option value="cpu">cpu</option>
          <option value="memory">memory</option>
          <option value="storage">storage</option>
          <option value="network_log">network_log</option>
        </select>
        <select value={podFilter} onChange={e => setPodFilter(e.target.value)} style={{ fontSize: 10, background: 'var(--color-bg-input)', color: 'var(--color-text-primary)', border: '1px solid var(--color-border-primary)', borderRadius: 4 }}>
          <option value="all">all pods</option>
          {pods.map(p => <option key={p} value={p}>{p}</option>)}
        </select>
        <select value={nsFilter} onChange={e => setNsFilter(e.target.value)} style={{ fontSize: 10, background: 'var(--color-bg-input)', color: 'var(--color-text-primary)', border: '1px solid var(--color-border-primary)', borderRadius: 4 }}>
          <option value="all">all namespaces</option>
          <option value="pump-station">pump-station</option>
          <option value="monitoring">monitoring</option>
        </select>
        <button onClick={() => exportCsv(rows)} style={{ fontSize: 10, padding: '1px 8px', borderRadius: 4, cursor: 'pointer', background: 'transparent', color: 'var(--color-info)', border: '1px solid var(--color-info)' }}>
          Export CSV
        </button>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
          <tbody>
            {rows.map((f, i) => (
              <tr key={i} style={{ borderBottom: '1px solid var(--color-border-card)' }}>
                <td style={{ padding: '3px 6px', color: 'var(--color-text-tertiary)' }}>{f.timestamp ? new Date(f.timestamp).toLocaleTimeString() : '-'}</td>
                <td style={{ padding: '3px 6px' }}><SeverityBadge severity={f.severity} /></td>
                <td style={{ padding: '3px 6px', color: 'var(--color-text-primary)' }}>{f.pod}</td>
                <td style={{ padding: '3px 6px' }}><AgentTag agent={f.agent} /></td>
                <td style={{ padding: '3px 6px', color: 'var(--color-text-secondary)' }}>{f.anomaly_type}</td>
                <td style={{ padding: '3px 6px', color: 'var(--color-text-tertiary)', fontVariantNumeric: 'tabular-nums' }}>
                  {f.confidence != null ? `${(f.confidence * 100).toFixed(0)}%` : '-'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
