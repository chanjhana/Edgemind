import { useMemo } from 'react'
import { useAppState } from '../../core/store/AppContext.jsx'

// Storage + Resource Forecast
// - PVC fill % from kubelet volume stats; fill rate and est-time-to-full
//   derived in the reducer from 15s metric deltas. (linear)
// - DMD memory OOM ETA derived from DMD agent findings in dmdForecasts slice.

function fmtMin(min) {
  if (min == null) return '—'
  if (min <= 0) return 'full'
  const h = Math.floor(min / 60)
  const m = min % 60
  return h > 0 ? `${h}h ${m}m` : `${m}m`
}

function fmtSeconds(s) {
  if (s == null) return '—'
  if (s <= 0) return 'now'
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  const rem = s % 60
  return rem > 0 ? `${m}m ${rem}s` : `${m}m`
}

function PvcRow({ label, pvc }) {
  const pct = pvc?.fill_pct
  const color = pct == null ? 'var(--color-text-tertiary)'
    : pct >= 85 ? 'var(--color-danger)'
    : pct >= 70 ? 'var(--color-warning)'
    : 'var(--color-success)'
  return (
    <div style={{ marginBottom: 6 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10.5, marginBottom: 3 }}>
        <span style={{ color: 'var(--color-text-tertiary)' }}>{label}</span>
        <span style={{ color, fontVariantNumeric: 'tabular-nums' }}>{pct != null ? `${pct}%` : '—'}</span>
      </div>
      <div style={{ height: 5, borderRadius: 3, background: 'var(--color-border-secondary)', overflow: 'hidden' }}>
        {pct != null && (
          <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 3, transition: 'width 0.4s' }} />
        )}
      </div>
    </div>
  )
}

function DmdRow({ label, breachSeconds, severity }) {
  const color = severity === 'critical' ? 'var(--color-danger)'
    : severity === 'warning' ? 'var(--color-warning)'
    : 'var(--color-text-tertiary)'
  const urgencyPct = breachSeconds != null
    ? Math.max(0, Math.min(100, Math.round((1 - breachSeconds / 120) * 100)))
    : 0
  return (
    <div style={{ marginBottom: 6 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10.5, marginBottom: 3 }}>
        <span style={{ color: 'var(--color-text-tertiary)' }}>{label}</span>
        <span style={{ color, fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>
          {breachSeconds != null ? `in ${fmtSeconds(breachSeconds)}` : '—'}
        </span>
      </div>
      {breachSeconds != null && (
        <div style={{ height: 3, borderRadius: 2, background: 'var(--color-border-secondary)', overflow: 'hidden' }}>
          <div style={{
            width: `${urgencyPct}%`, height: '100%',
            background: color, borderRadius: 2, transition: 'width 0.4s',
          }} />
        </div>
      )}
    </div>
  )
}

export default function StorageForecast() {
  const { pvcs, forecasts, dmdForecasts } = useAppState()

  const ratePerMin = forecasts.pvc2_fill_rate_bytes_per_min
  const ratePerHr = ratePerMin != null ? (ratePerMin * 60) / 1e6 : null  // MB/hr

  // Find DMD memory forecast warnings (most urgent first)
  const dmdMemWarnings = useMemo(() => {
    const w = (dmdForecasts?.warnings ?? []).filter(w => w.metric === 'mem_rss_bytes')
    return w.sort((a, b) => (a.predicted_breach_seconds ?? 9999) - (b.predicted_breach_seconds ?? 9999))
  }, [dmdForecasts?.warnings])

  const topMemWarning = dmdMemWarnings[0] ?? null

  return (
    <div>
      <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--color-text-tertiary)', marginBottom: 5 }}>
        STORAGE & RESOURCE FORECAST
      </div>
      <PvcRow label="PVC-1 historian-data" pvc={pvcs['historian-data']} />
      <PvcRow label="PVC-2 export-data" pvc={pvcs['export-data']} />
      <div style={{
        display: 'flex', justifyContent: 'space-between', fontSize: 10,
        marginTop: 4, paddingTop: 4, borderTop: '1px solid var(--color-border-secondary)',
        color: 'var(--color-text-tertiary)',
      }}>
        <span>Growth <b style={{ color: 'var(--color-text-secondary)' }}>{ratePerHr != null ? `+${ratePerHr.toFixed(1)} MB/hr` : '—'}</b></span>
        <span>Est. full <b style={{ color: forecasts.pvc2_ttf_minutes != null && forecasts.pvc2_ttf_minutes <= 120 ? 'var(--color-warning)' : 'var(--color-text-secondary)' }}>{fmtMin(forecasts.pvc2_ttf_minutes)}</b></span>
      </div>

      {/* DMD-derived OOM ETA (shows when DMD agent emits memory forecasts) */}
      {topMemWarning && (
        <div style={{ marginTop: 8, paddingTop: 6, borderTop: '1px solid var(--color-border-secondary)' }}>
          <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--color-text-tertiary)', marginBottom: 4 }}>
            DMD MEMORY FORECAST
          </div>
          <DmdRow
            label={`${topMemWarning.pod?.replace(/-[a-z0-9]+-[a-z0-9]+$/, '') ?? '—'} OOM ETA`}
            breachSeconds={topMemWarning.predicted_breach_seconds}
            severity={topMemWarning.severity}
          />
          {dmdMemWarnings.length > 1 && (
            <div style={{ fontSize: 9, color: 'var(--color-text-tertiary)', marginTop: 2 }}>
              +{dmdMemWarnings.length - 1} more pod{dmdMemWarnings.length > 2 ? 's' : ''}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
