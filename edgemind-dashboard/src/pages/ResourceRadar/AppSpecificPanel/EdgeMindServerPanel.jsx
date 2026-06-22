import { useNavigate } from 'react-router-dom'
import { useAppState } from '../../../core/store/AppContext.jsx'
import MiniProgressBar from '../../../components/ui/MiniProgressBar.jsx'
import { findMetrics } from '../../../core/selectors/podHealth.js'

function StatBox({ label, value }) {
  return (
    <div style={{ background: 'var(--color-bg-card)', border: '1px solid var(--color-border-card)', boxShadow: '0 1px 3px var(--color-shadow)', borderRadius: 4, padding: '8px 10px' }}>
      <div style={{ fontSize: 10, color: 'var(--color-text-tertiary)' }}>{label}</div>
      <div style={{ fontSize: 16, fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: 'var(--color-text-primary)' }}>{value ?? '—'}</div>
    </div>
  )
}

function fmtAge(isoStr) {
  if (!isoStr) return ''
  const diffMs = Date.now() - new Date(isoStr).getTime()
  if (diffMs < 0) return 'just now'
  if (diffMs < 60000) return `${Math.floor(diffMs / 1000)}s ago`
  return `${Math.floor(diffMs / 60000)}m ago`
}

function CorrelatedAlertCard({ alert }) {
  const borderColor = (alert.severity === 'critical' || (alert.confidence ?? 1) >= 0.8)
    ? 'var(--color-danger)'
    : 'var(--color-warning)'

  const chainStr = Array.isArray(alert.causal_chain)
    ? alert.causal_chain.join(' → ')
    : (alert.causal_chain || null)

  return (
    <div style={{ border: `1px solid ${borderColor}`, borderRadius: 5, padding: '8px 10px', background: 'var(--color-bg-card)', boxShadow: '0 1px 3px var(--color-shadow)', marginBottom: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--color-text-primary)' }}>{alert.alert_type || 'correlated_alert'}</span>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          {alert.confidence != null && (
            <span style={{ fontSize: 10, color: 'var(--color-text-tertiary)' }}>conf {(alert.confidence * 100).toFixed(0)}%</span>
          )}
          <span style={{ fontSize: 10, color: 'var(--color-text-tertiary)' }}>{fmtAge(alert.timestamp)}</span>
        </div>
      </div>
      {alert.root_cause && (
        <div style={{ fontSize: 11, color: 'var(--color-text-secondary)', marginBottom: 3 }}>
          Root cause: <b style={{ color: 'var(--color-text-primary)' }}>{alert.root_cause}</b>
        </div>
      )}
      {chainStr && (
        <div style={{ fontSize: 10, color: 'var(--color-text-tertiary)', fontFamily: 'monospace', marginBottom: 4 }}>{chainStr}</div>
      )}
      {alert.nlp_summary && (
        <div style={{ fontSize: 11, color: 'var(--color-text-secondary)', lineHeight: 1.4, marginBottom: 4 }}>
          {alert.nlp_summary.slice(0, 120)}{alert.nlp_summary.length > 120 ? '…' : ''}
        </div>
      )}
      {alert.recommendation && (
        <div style={{ fontSize: 10, color: 'var(--color-info)', padding: '2px 6px', background: 'var(--color-info-tint)', borderRadius: 3, borderLeft: '2px solid var(--color-info)' }}>
          {alert.recommendation}
        </div>
      )}
    </div>
  )
}

export default function EdgeMindServerPanel({ podName }) {
  const navigate = useNavigate()
  const { correlatedAlerts, findings, ws: wsStatus, metrics } = useAppState()

  const m = findMetrics(metrics, podName)
  const cpuArr = m.cpu_usage || []
  const cpu = cpuArr.length ? cpuArr[cpuArr.length - 1] : null
  const cpuLimit = m.cpu_limit || null
  const cpuPct = cpu != null && cpuLimit ? ((cpu / cpuLimit) * 100) : null

  const memArr = m.mem_working_set || []
  const mem = memArr.length ? memArr[memArr.length - 1] : null
  const memLimit = m.mem_limit || null
  const memPct = mem != null && memLimit ? ((mem / memLimit) * 100) : null

  const connected = wsStatus?.connected
  const recentAlerts = correlatedAlerts.slice(0, 2)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, height: '100%', justifyContent: 'flex-start' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        
        <span style={{
          fontSize: 10, padding: '2px 8px', borderRadius: 10,
          background: connected ? 'var(--color-success-tint)' : 'var(--color-danger-tint)',
          color: connected ? 'var(--color-success)' : 'var(--color-danger)',
        }}>
          WS {connected ? 'connected' : 'disconnected'}
        </span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <StatBox label="Correlated Alerts" value={correlatedAlerts.length} />
        <StatBox label="Total Findings" value={findings.length} />
      </div>

      {cpuPct != null && <MiniProgressBar label="CPU" value={cpuPct} max={100} />}
      {memPct != null && <MiniProgressBar label="MEM" value={memPct} max={100} />}

      {/* Orchestrator config */}
      <div style={{ background: 'var(--color-bg-card)', border: '1px solid var(--color-border-card)', boxShadow: '0 1px 3px var(--color-shadow)', borderRadius: 4, padding: '8px 10px' }}>
        <div style={{ fontSize: 10, color: 'var(--color-text-tertiary)', fontWeight: 700, marginBottom: 5 }}>ORCHESTRATOR CONFIG</div>
        {[
          ['Correlation window', '45 s'],
          ['Alert cooldown', '10 min'],
        ].map(([k, v]) => (
          <div key={k} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, padding: '2px 0' }}>
            <span style={{ color: 'var(--color-text-secondary)' }}>{k}</span>
            <span style={{ color: 'var(--color-text-primary)', fontVariantNumeric: 'tabular-nums' }}>{v}</span>
          </div>
        ))}
      </div>

      {/* Recent correlated alerts */}
      {recentAlerts.length > 0 && (
        <div>
          <div style={{ fontSize: 10, color: 'var(--color-text-tertiary)', fontWeight: 700, marginBottom: 6 }}>RECENT CORRELATIONS</div>
          {recentAlerts.map((a, i) => <CorrelatedAlertCard key={i} alert={a} />)}
        </div>
      )}

      <button
        onClick={() => navigate('/graph')}
        style={{
          fontSize: 11, padding: '4px 10px', borderRadius: 4, cursor: 'pointer',
          background: 'transparent', color: 'var(--color-text-secondary)',
          border: '1px solid var(--color-border-primary)', textAlign: 'left',
        }}
      >
        View Correlation Map →
      </button>
    </div>
  )
}
