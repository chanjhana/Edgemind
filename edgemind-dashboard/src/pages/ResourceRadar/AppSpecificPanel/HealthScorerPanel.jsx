import { useMemo } from 'react'
import { useAppState } from '../../../core/store/AppContext.jsx'

const PUMPS = ['pump1', 'pump2', 'pump3']

function ScoreBar({ label, value, max = 100 }) {
  if (value == null) return null
  const pct = Math.min(100, Math.round((value / max) * 100))
  const color = pct >= 75 ? 'var(--color-success)' : pct >= 50 ? 'var(--color-warning)' : 'var(--color-danger)'
  return (
    <div style={{ marginTop: 4 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--color-text-tertiary)', marginBottom: 2 }}>
        <span>{label}</span><span style={{ fontVariantNumeric: 'tabular-nums', color }}>{value}</span>
      </div>
      <div style={{ height: 4, background: 'var(--color-border-secondary)', borderRadius: 2, overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 2, transition: 'width 0.4s' }} />
      </div>
    </div>
  )
}

function PumpHealthCard({ pump, alert }) {
  const overall = alert?.overall_health ?? null
  const vib = alert?.vibration_score ?? null
  const thermal = alert?.thermal_score ?? null
  const consecutive = alert?.consecutive_cycles ?? null
  const trigger = alert?.trigger ?? null
  const stateLabel = !alert ? 'HEALTHY'
    : overall != null && overall < 50 ? 'CRITICAL'
    : overall != null && overall < 75 ? 'WARNING'
    : 'HEALTHY'

  const stateColor = stateLabel === 'CRITICAL' ? 'var(--color-danger)'
    : stateLabel === 'WARNING' ? 'var(--color-warning)'
    : 'var(--color-success)'

  return (
    <div style={{ padding: '8px 10px', background: 'var(--color-bg-card)', border: '1px solid var(--color-border-card)', boxShadow: '0 1px 3px var(--color-shadow)', borderRadius: 6, borderLeft: `3px solid ${stateColor}` }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-primary)', fontFamily: 'monospace' }}>{pump}</span>
        <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 8, background: `${stateColor}22`, color: stateColor, fontWeight: 700 }}>
          {stateLabel}
        </span>
      </div>

      <ScoreBar label="Overall health" value={overall} />
      <ScoreBar label="Vibration score" value={vib} />
      <ScoreBar label="Thermal score" value={thermal} />

      {(consecutive != null || trigger) && (
        <div style={{ display: 'flex', gap: 10, marginTop: 6, fontSize: 10, color: 'var(--color-text-tertiary)' }}>
          {consecutive != null && <span>Cycles: <b style={{ color: 'var(--color-text-secondary)' }}>{consecutive}</b></span>}
          {trigger && <span>Trigger: <b style={{ color: 'var(--color-text-secondary)' }}>{trigger}</b></span>}
        </div>
      )}
    </div>
  )
}

export default function HealthScorerPanel({ podName }) {
  const { pumpAlerts, liveScores } = useAppState()

  const alertsByPump = useMemo(() => {
    const map = {}
    pumpAlerts.forEach(a => {
      const id = a.pump_id || a.pump
      if (!id) return
      if (!map[id] || new Date(a.timestamp) > new Date(map[id].timestamp)) map[id] = a
    })
    return map
  }, [pumpAlerts])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, height: '100%', justifyContent: 'center' }}>

      {PUMPS.map(pump => (
        <PumpHealthCard key={pump} pump={pump} alert={alertsByPump[pump] || liveScores[pump] || null} />
      ))}

      <div style={{ marginTop: 2, fontSize: 11, color: 'var(--color-text-secondary)', background: 'var(--color-bg-card)', border: '1px solid var(--color-border-card)', boxShadow: '0 1px 3px var(--color-shadow)', borderRadius: 4, padding: '6px 10px' }}>
        Scores sourced from alert-manager. ≥75 = Healthy · 50–74 = Warning · &lt;50 = Critical.
      </div>
    </div>
  )
}
