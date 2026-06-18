import { useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import SeverityBadge from '../../components/ui/SeverityBadge.jsx'
import ConfidenceTier from '../../components/ui/ConfidenceTier.jsx'

export default function AlertBracketPopover({ alert: a, onClose }) {
  const ref = useRef(null)

  useEffect(() => {
    function handler(e) { if (ref.current && !ref.current.contains(e.target)) onClose() }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [onClose])

  if (!a) return null

  const analysisTime = a.analysis_duration_s ?? a.analysis_time_s

  return (
    <div
      ref={ref}
      style={{
        position: 'fixed', left: '50%', top: '50%',
        transform: 'translate(-50%, -50%)',
        zIndex: 50, width: 440,
        background: 'var(--color-bg-card)', border: '1px solid var(--color-border-primary)',
        borderRadius: 8, padding: 16, boxShadow: '0 8px 32px rgba(0,0,0,0.12)',
        maxHeight: '80vh', overflowY: 'auto',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <SeverityBadge severity={a.severity || 'critical'} />
        <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-text-primary)', flex: 1 }}>
          {a.alert_type || 'Correlated Alert'}
        </span>
        <ConfidenceTier value={a.confidence} />
        <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: 'var(--color-text-secondary)', cursor: 'pointer', fontSize: 16, lineHeight: 1 }}>Ã—</button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '130px 1fr', gap: 4, fontSize: 11, marginBottom: 10 }}>
        <span style={{ color: 'var(--color-text-tertiary)' }}>Alert ID</span>
        <span style={{ color: 'var(--color-text-primary)', fontFamily: 'monospace' }}>{String(a.id || a.alert_id || 'recent').slice(0, 12)}</span>
        <span style={{ color: 'var(--color-text-tertiary)' }}>Severity</span>
        <span style={{ color: 'var(--color-text-primary)' }}>{a.severity || '—'}</span>
        <span style={{ color: 'var(--color-text-tertiary)' }}>Root cause pod</span>
        <span style={{ color: 'var(--color-text-primary)' }}>{a.root_cause_pod || 'unknown'}</span>
        <span style={{ color: 'var(--color-text-tertiary)' }}>Root cause metric</span>
        <span style={{ color: 'var(--color-text-primary)' }}>{a.root_cause_metric || '—'}</span>
        <span style={{ color: 'var(--color-text-tertiary)' }}>Analysis time</span>
        <span style={{ color: 'var(--color-text-primary)' }}>{analysisTime != null ? `${analysisTime}s` : '—'}</span>
      </div>

      {a.causal_chain?.length > 0 && (
        <div style={{ marginBottom: 10 }}>
          <div style={{ fontSize: 10, color: 'var(--color-text-tertiary)', marginBottom: 6, fontWeight: 700 }}>CAUSAL CHAIN</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 2, alignItems: 'center' }}>
            {a.causal_chain.map((pod, i) => (
              <span key={i} style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                <span style={{ fontSize: 11, color: 'var(--color-info)', background: 'var(--color-info-tint)', padding: '1px 5px', borderRadius: 3 }}>{pod}</span>
                {i < a.causal_chain.length - 1 && (
                  <span style={{ color: 'var(--color-text-tertiary)', fontSize: 12 }}>→</span>
                )}
              </span>
            ))}
          </div>
        </div>
      )}

      {a.nlp_summary && (
        <div style={{ marginBottom: 10 }}>
          <div style={{ fontSize: 10, color: 'var(--color-text-tertiary)', fontWeight: 700, marginBottom: 4 }}>AI SUMMARY</div>
          <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', lineHeight: 1.6 }}>{a.nlp_summary}</div>
        </div>
      )}

      {a.recommendation && (
        <div style={{ marginBottom: 8, background: 'var(--color-info-tint)', borderRadius: 4, padding: '8px 10px', borderLeft: '3px solid var(--color-info)' }}>
          <div style={{ fontSize: 10, color: 'var(--color-text-tertiary)', fontWeight: 700, marginBottom: 3 }}>RECOMMENDATION</div>
          <div style={{ fontSize: 11, color: 'var(--color-text-secondary)' }}>{a.recommendation}</div>
        </div>
      )}

      {a.business_impact && (
        <div style={{ marginBottom: 8, fontSize: 11, color: 'var(--color-text-secondary)' }}>
          <span style={{ fontSize: 10, color: 'var(--color-text-tertiary)', fontWeight: 700 }}>BUSINESS IMPACT  </span>
          {a.business_impact}
        </div>
      )}

      {/* Related findings */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--color-border-card)' }}>
        <span style={{ fontSize: 11, color: 'var(--color-text-secondary)' }}>
          Related findings: <b style={{ color: 'var(--color-text-primary)' }}>{a.finding_ids?.length ?? '—'}</b>
        </span>
        <Link to="/timeline" onClick={onClose} style={{ fontSize: 11, color: 'var(--color-info)' }}>
          View in History Panel →
        </Link>
      </div>
    </div>
  )
}
