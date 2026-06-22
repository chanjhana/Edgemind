import { useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAppState } from '../../core/store/AppContext.jsx'
import { latestActiveCorrelation } from '../../core/selectors/correlations.js'
import { useNow } from '../../core/hooks/useNow.js'

export default function IncidentOverlay() {
  const { correlatedAlerts, findings } = useAppState()
  const now = useNow(5000)
  const activeIncident = useMemo(
    () => latestActiveCorrelation(correlatedAlerts, findings, now),
    [correlatedAlerts, findings, now]
  )
  const navigate = useNavigate()
  const [dismissed, setDismissed] = useState(false)

  if (!activeIncident || dismissed) return null

  const {
    root_cause_pod,
    causal_chain = [],
    confidence,
    insight,
    recommendation,
    alert_type,
  } = activeIncident

  const confLabel = confidence >= 0.9 ? 'HIGH' :
                    confidence >= 0.7 ? 'MED'  :
                    confidence >= 0.5 ? 'LOW'  : 'INSUF'

  const confColor = confidence >= 0.9 ? 'var(--color-success)' :
                    confidence >= 0.7 ? 'var(--color-warning)' :
                    'var(--color-text-tertiary)'

  const borderColor = 'var(--color-danger)'

  const chainLabel = causal_chain.length
    ? causal_chain.map(p => p.split('-').slice(0, 2).join('-')).join(' → ')
    : root_cause_pod || '—'

  return (
    <div style={{
      position: 'absolute', top: 12, right: 12, width: 280, zIndex: 15,
      background: 'var(--color-bg-card)',
      border: `1px solid ${borderColor}`,
      borderRadius: 6,
      boxShadow: '0 4px 20px rgba(0,0,0,0.10)',
      display: 'flex', flexDirection: 'column', gap: 0,
      overflow: 'hidden',
    }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 6,
        padding: '8px 10px',
        background: 'var(--color-danger-tint)',
        borderBottom: '1px solid var(--color-border-card)',
      }}>
        <span style={{ fontSize: 11, color: 'var(--color-danger)', fontWeight: 700 }}>⚑ ACTIVE INCIDENT</span>
        {alert_type && (
          <span style={{
            fontSize: 9, padding: '1px 5px', borderRadius: 3,
            background: 'rgba(255,0,15,0.12)', color: 'var(--color-danger)',
            textTransform: 'uppercase', fontWeight: 700,
          }}>{alert_type}</span>
        )}
        <button
          onClick={() => setDismissed(true)}
          style={{ marginLeft: 'auto', background: 'transparent', border: 'none', color: 'var(--color-text-tertiary)', cursor: 'pointer', fontSize: 13, lineHeight: 1 }}
        >✕</button>
      </div>

      <div style={{ padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
        {/* Root cause */}
        <div>
          <div style={{ fontSize: 9, color: 'var(--color-text-tertiary)', fontWeight: 700, marginBottom: 2 }}>ROOT CAUSE</div>
          <div style={{ fontSize: 12, color: 'var(--color-danger)', fontWeight: 700 }}>{root_cause_pod || '—'}</div>
        </div>

        {/* Causal chain */}
        {causal_chain.length > 1 && (
          <div>
            <div style={{ fontSize: 9, color: 'var(--color-text-tertiary)', fontWeight: 700, marginBottom: 2 }}>CAUSAL CHAIN</div>
            <div style={{ fontSize: 10, color: 'var(--color-coral)', lineHeight: 1.4 }}>{chainLabel}</div>
          </div>
        )}

        {/* Confidence */}
        {confidence != null && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 9, color: 'var(--color-text-tertiary)', fontWeight: 700 }}>CONFIDENCE</span>
            <span style={{ fontSize: 11, color: confColor, fontWeight: 700 }}>{confLabel}</span>
            <span style={{ fontSize: 10, color: 'var(--color-text-tertiary)' }}>{Math.round(confidence * 100)}%</span>
          </div>
        )}

        {/* AI insight */}
        {insight && (
          <div style={{
            fontSize: 10, color: 'var(--color-text-secondary)', lineHeight: 1.5,
            borderLeft: '2px solid var(--color-info)', paddingLeft: 8,
          }}>
            {insight.length > 140 ? insight.slice(0, 137) + '…' : insight}
          </div>
        )}

        {/* Recommendation */}
        {recommendation && (
          <div style={{ fontSize: 10, color: 'var(--color-text-tertiary)', fontStyle: 'italic' }}>
            {recommendation.length > 100 ? recommendation.slice(0, 97) + '…' : recommendation}
          </div>
        )}

        {/* CTA */}
        <button
          onClick={() => navigate('/investigate')}
          style={{
            width: '100%', padding: '5px 0', borderRadius: 4, cursor: 'pointer',
            background: 'var(--color-info-tint)', color: 'var(--color-info)',
            border: '1px solid var(--color-info)', fontSize: 11, fontWeight: 600,
          }}
        >
          View in AI Investigation →
        </button>
      </div>
    </div>
  )
}
