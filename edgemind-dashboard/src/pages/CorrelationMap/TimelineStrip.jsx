import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAppState } from '../../core/store/AppContext.jsx'
import { SEVERITY_COLORS } from '../../core/constants/colors.js'

const STRIP_HEIGHT = 60
const WINDOW_MS = 10 * 60 * 1000

export default function TimelineStrip() {
  const { findings, correlatedAlerts } = useAppState()
  const navigate = useNavigate()
  const now = Date.now()

  const recent = useMemo(() => {
    const cutoff = now - WINDOW_MS
    return findings.filter(f => f.timestamp && new Date(f.timestamp).getTime() > cutoff).slice(0, 60)
  }, [findings, now])

  // Correlated alert brackets within window
  const brackets = useMemo(() => {
    const cutoff = now - WINDOW_MS
    return correlatedAlerts
      .filter(a => a.timestamp && new Date(a.timestamp).getTime() > cutoff)
      .slice(0, 5)
      .map(a => {
        const ts   = new Date(a.timestamp).getTime()
        const left = Math.max(0, ((ts - cutoff) / WINDOW_MS) * 100)
        return { left, alert: a }
      })
  }, [correlatedAlerts, now])

  return (
    <div
      style={{
        height: STRIP_HEIGHT, background: 'var(--color-bg-surface)',
        borderTop: '1px solid var(--color-border-card)',
        display: 'flex', alignItems: 'center', padding: '0 14px', gap: 8,
        cursor: 'pointer', position: 'relative',
      }}
      onClick={() => navigate('/timeline')}
      title="Click to open Anomaly Timeline"
    >
      <span style={{ fontSize: 10, color: 'var(--color-text-tertiary)', flexShrink: 0 }}>âˆ’10 min</span>

      <div style={{ flex: 1, height: 36, position: 'relative' }}>
        {/* Incident brackets */}
        {brackets.map((b, i) => (
          <div
            key={i}
            title={`Correlated alert · ${b.alert.alert_type || 'incident'}`}
            style={{
              position: 'absolute',
              left: `${b.left}%`,
              top: 0, bottom: 0, width: 2,
              background: 'var(--color-danger)',
              opacity: 0.5,
              borderRadius: 1,
            }}
          />
        ))}
        {brackets.map((b, i) => (
          <div
            key={`bk-${i}`}
            title={`Correlated alert · ${b.alert.alert_type || 'incident'}`}
            style={{
              position: 'absolute',
              left: `${b.left}%`,
              right: 0,
              top: 2, bottom: 2,
              background: 'var(--color-danger-tint)',
              borderLeft: '2px solid rgba(255,0,15,0.35)',
              borderRadius: 2,
              pointerEvents: 'none',
            }}
          />
        ))}

        {/* Finding pills */}
        {recent.map((f, i) => {
          const ms  = new Date(f.timestamp).getTime()
          const pct = ((ms - (now - WINDOW_MS)) / WINDOW_MS) * 100
          const color = SEVERITY_COLORS[f.severity] || 'var(--color-info)'
          return (
            <div
              key={i}
              title={`${f.pod} · ${f.anomaly_type} · ${f.severity}`}
              style={{
                position: 'absolute',
                left: `${Math.max(0, Math.min(98, pct))}%`,
                top: 8, width: 6, height: 20,
                background: color,
                borderRadius: 3,
                opacity: 0.88,
              }}
            />
          )
        })}

        {recent.length === 0 && (
          <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', fontSize: 10, color: 'var(--color-text-tertiary)' }}>
            No findings in last 10 min
          </div>
        )}
      </div>

      <span style={{ fontSize: 10, color: 'var(--color-text-tertiary)', flexShrink: 0 }}>now</span>
      <span style={{ fontSize: 10, color: 'var(--color-info)', flexShrink: 0 }}>→ Timeline</span>
    </div>
  )
}
