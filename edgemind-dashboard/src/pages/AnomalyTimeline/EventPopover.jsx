import { useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import { useAppState } from '../../core/store/AppContext.jsx'
import AgentTag from '../../components/ui/AgentTag.jsx'
import SeverityBadge from '../../components/ui/SeverityBadge.jsx'
import ConfidenceTier from '../../components/ui/ConfidenceTier.jsx'

function Row({ label, value }) {
  if (value == null || value === '') return null
  return (
    <div style={{ display: 'flex', gap: 8, fontSize: 11, padding: '2px 0', borderBottom: '1px solid var(--color-border-card)' }}>
      <span style={{ color: 'var(--color-text-tertiary)', width: 90, flexShrink: 0 }}>{label}</span>
      <span style={{ color: 'var(--color-text-primary)', overflowWrap: 'anywhere' }}>{String(value)}</span>
    </div>
  )
}

export default function EventPopover({ finding: f, onClose, xLeft }) {
  const ref = useRef(null)
  const { correlatedAlerts } = useAppState()
  const [verticalPos, setVerticalPos] = useState({ top: 32, bottom: 'auto' })

  useEffect(() => {
    if (ref.current) {
      const rect = ref.current.getBoundingClientRect()
      if (rect.bottom > window.innerHeight - 20) {
        setVerticalPos({ top: 'auto', bottom: 28 })
      }
    }
  }, [])

  useEffect(() => {
    function handler(e) { if (ref.current && !ref.current.contains(e.target)) onClose() }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [onClose])

  const ts = f.timestamp ? new Date(f.timestamp).toLocaleString() : '-'
  const evidenceEntries = Array.isArray(f.evidence)
    ? f.evidence.map((v, i) => [i + 1, v])
    : Object.entries(f.evidence || {})
  const metric = f.metric || f.metric_name || f.evidence?.metric
  const value = f.value ?? f.current_value ?? f.metric_value ?? f.evidence?.value
  const baseline = f.baseline ?? f.baseline_value ?? f.evidence?.baseline
  const deviation = f.deviation ?? f.z_score ?? f.ratio ?? f.evidence?.deviation

  // Cross-reference correlated alert: by correlated_alert_id field, or by finding_id appearing in finding_ids[]
  const corrId = f.correlated_alert_id || f.correlated_id
  const corrAlert = correlatedAlerts.find(a =>
    (corrId && (a.id === corrId || a.alert_id === corrId)) ||
    (f.finding_id && Array.isArray(a.finding_ids) && a.finding_ids.includes(f.finding_id))
  )

  return (
    <div
      ref={ref}
      style={{
        position: 'absolute',
        left: Math.max(0, Math.min(Number(xLeft) || 0, 660)),
        top: verticalPos.top,
        bottom: verticalPos.bottom,
        zIndex: 30, width: 300,
        background: 'var(--color-bg-card)', 
        border: '1px solid var(--color-border-card)',
        borderRadius: 12, padding: 16, 
        boxShadow: '0 12px 48px rgba(0,0,0,0.15), 0 4px 16px rgba(0,0,0,0.08)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <SeverityBadge severity={f.severity} />
        <AgentTag agent={f.agent} />
        <span style={{ fontSize: 13, color: 'var(--color-text-primary)', flex: 1, fontWeight: 700 }}>{f.anomaly_type}</span>
        <button onClick={onClose} style={{ background: 'var(--color-bg-surface)', border: 'none', borderRadius: '50%', width: 24, height: 24, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--color-text-tertiary)', cursor: 'pointer', fontSize: 16, transition: 'background 0.2s' }}>×</button>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <Row label="Pod" value={f.pod} />
        <Row label="Namespace" value={f.namespace} />
        <Row label="Timestamp" value={ts} />
        <Row label="Agent" value={f.agent} />
        <Row label="Metric" value={metric} />
        <Row label="Value" value={value} />
        <Row label="Baseline" value={baseline} />
        <Row label="Deviation" value={deviation != null ? `${deviation}σ` : null} />
      </div>

      {f.confidence != null && (
        <div style={{ padding: '8px 0', borderBottom: '1px solid var(--color-border-card)' }}>
          <ConfidenceTier value={f.confidence} />
        </div>
      )}

      {evidenceEntries.length > 0 && (
        <div style={{ marginTop: 12, padding: '10px 12px', background: 'var(--color-bg-surface)', borderRadius: 8 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--color-text-tertiary)', letterSpacing: '0.05em', marginBottom: 6 }}>EVIDENCE LOGS</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {evidenceEntries.slice(0, 4).map(([k, v]) => (
              <div key={k} style={{ display: 'flex', gap: 6, fontSize: 11, color: 'var(--color-text-secondary)' }}>
                <span style={{ color: 'var(--color-info)', fontSize: 14, lineHeight: 1 }}>•</span>
                <span style={{ lineHeight: 1.3 }}>{String(v)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {corrAlert ? (
        <div style={{ marginTop: 12, padding: '10px 12px', background: 'var(--color-info-tint)', borderRadius: 8, border: '1px solid rgba(0,76,151,0.25)' }}>
          <div style={{ fontSize: 10, color: 'var(--color-text-tertiary)', marginBottom: 4, fontWeight: 700, letterSpacing: '0.05em' }}>CORRELATED ALERT</div>
          <div style={{ fontSize: 12, color: 'var(--color-info)', fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span>{corrAlert.alert_type}</span>
            {corrAlert.confidence != null && (
              <span style={{ fontSize: 10, color: 'var(--color-text-secondary)', background: 'var(--color-bg-card)', padding: '2px 6px', borderRadius: 4 }}>
                {(corrAlert.confidence * 100).toFixed(0)}% Match
              </span>
            )}
          </div>
          <Link to="/investigate" style={{ display: 'inline-block', marginTop: 8, fontSize: 11, fontWeight: 600, color: 'var(--color-info)', textDecoration: 'none' }}>
            View full AI analysis →
          </Link>
        </div>
      ) : corrId ? (
        <Link to="/investigate" style={{ display: 'inline-block', marginTop: 12, fontSize: 11, fontWeight: 600, color: 'var(--color-info)', textDecoration: 'none' }}>
          View full AI analysis →
        </Link>
      ) : null}
    </div>
  )
}
