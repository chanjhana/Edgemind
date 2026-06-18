import { useAppState } from '../../core/store/AppContext.jsx'
import SeverityBadge from '../../components/ui/SeverityBadge.jsx'
import AgentTag from '../../components/ui/AgentTag.jsx'

function fmtTs(isoStr) {
  if (!isoStr) return ''
  try { return new Date(isoStr).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) } catch { return '' }
}

export default function AppAlertsFeed({ compact = false }) {
  const { findings, pumpAlerts } = useAppState()
  const recentFindings = findings.slice(0, 10)
  const recentPump = pumpAlerts.slice(0, 5)

  return (
    <div style={{ display: 'flex', flexDirection: compact ? 'row' : 'column', height: compact ? 'auto' : '100%', overflow: 'hidden', gap: compact ? 16 : 0 }}>
      <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--color-border-card)' }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--color-text-tertiary)', marginBottom: 2 }}>PUMP ALERTS</div>
        {recentPump.length === 0 && <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>None active</div>}
        {recentPump.map((a, i) => (
          <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 11, padding: '3px 0', borderBottom: '1px solid var(--color-border-card)' }}>
            <SeverityBadge severity={a.severity || 'warning'} />
            <span style={{ color: 'var(--color-text-primary)' }}>{a.pump_id || '—'}</span>
            <span style={{ flex: 1, color: 'var(--color-text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.fault_mode || a.anomaly_type}</span>
          </div>
        ))}
      </div>

      <div style={{ padding: '8px 12px', flex: 1, overflowY: compact ? 'visible' : 'auto' }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--color-text-tertiary)', marginBottom: 4 }}>EDGEMIND FINDINGS</div>
        {recentFindings.length === 0 && <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>No findings</div>}
        {recentFindings.map((f, i) => (
          <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 11, padding: '3px 0', borderBottom: '1px solid var(--color-border-card)' }}>
            <SeverityBadge severity={f.severity} />
            <AgentTag agent={f.agent} />
            <span style={{ flex: 1, color: 'var(--color-text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.pod}</span>
            <span style={{ color: 'var(--color-text-tertiary)', whiteSpace: 'nowrap' }}>{fmtTs(f.timestamp)}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
