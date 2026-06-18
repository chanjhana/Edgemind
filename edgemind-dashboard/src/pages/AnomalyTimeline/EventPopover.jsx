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
        top: 30, zIndex: 30, width: 280,
        background: 'var(--color-bg-card)', border: '1px solid var(--color-border-primary)',
        borderRadius: 6, padding: 12, boxShadow: '0 4px 16px rgba(0,0,0,0.10)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
        <SeverityBadge severity={f.severity} />
        <AgentTag agent={f.agent} />
        <span style={{ fontSize: 11, color: 'var(--color-text-primary)', flex: 1, fontWeight: 600 }}>{f.anomaly_type}</span>
        <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: 'var(--color-text-tertiary)', cursor: 'pointer', fontSize: 14, lineHeight: 1 }}>Ã—</button>
      </div>

      <Row label="Pod" value={f.pod} />
      <Row label="Namespace" value={f.namespace} />
      <Row label="Timestamp" value={ts} />
      <Row label="Agent" value={f.agent} />
      <Row label="Severity" value={f.severity} />
      <Row label="Metric" value={metric} />
      <Row label="Value" value={value} />
      <Row label="Baseline" value={baseline} />
      <Row label="Deviation" value={deviation != null ? `${deviation}Ïƒ` : null} />

      {f.confidence != null && (
        <div style={{ padding: '5px 0' }}>
          <ConfidenceTier value={f.confidence} />
        </div>
      )}

      {evidenceEntries.length > 0 && (
        <div style={{ marginTop: 6, fontSize: 10, color: 'var(--color-text-tertiary)' }}>
          <div style={{ fontWeight: 700, marginBottom: 3 }}>EVIDENCE</div>
          {evidenceEntries.slice(0, 4).map(([k, v]) => (
            <div key={k} style={{ marginBottom: 1 }}>â€¢ <span style={{ color: 'var(--color-text-secondary)' }}>{String(v)}</span></div>
          ))}
        </div>
      )}

      {corrAlert ? (
        <div style={{ marginTop: 8, padding: '6px 8px', background: 'var(--color-info-tint)', borderRadius: 4, border: '1px solid rgba(0,76,151,0.25)' }}>
          <div style={{ fontSize: 10, color: 'var(--color-text-tertiary)', marginBottom: 3 }}>CORRELATED ALERT</div>
          <div style={{ fontSize: 11, color: 'var(--color-info)', fontWeight: 600 }}>
            {corrAlert.alert_type}
            {corrAlert.confidence != null && (
              <span style={{ fontSize: 10, color: 'var(--color-text-tertiary)', marginLeft: 6, fontWeight: 400 }}>
                conf {(corrAlert.confidence * 100).toFixed(0)}%
              </span>
            )}
          </div>
          <Link to="/investigate" style={{ display: 'inline-block', marginTop: 4, fontSize: 10, color: 'var(--color-info)' }}>
            View full AI analysis →
          </Link>
        </div>
      ) : corrId ? (
        <Link to="/investigate" style={{ display: 'inline-block', marginTop: 8, fontSize: 11, color: 'var(--color-info)' }}>
          View full AI analysis →
        </Link>
      ) : null}
    </div>
  )
}
