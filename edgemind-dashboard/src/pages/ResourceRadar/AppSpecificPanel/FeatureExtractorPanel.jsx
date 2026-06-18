import { useMemo } from 'react'
import { useAppState } from '../../../core/store/AppContext.jsx'
import TrendSparkline from '../../../components/charts/TrendSparkline.jsx'
import IsoZoneBadge from '../../../components/ui/IsoZoneBadge.jsx'

const PUMPS = ['pump1', 'pump2', 'pump3']

function PumpBearingRow({ pump, alertsByPump, sensorReadings }) {
  const alert = alertsByPump[pump]
  const bearingHealth = alert?.bearing_health ?? null
  const readings = sensorReadings[pump] || {}
  const vib = readings.vibration_axial ?? readings.vibration_radial ?? null

  const color = bearingHealth == null ? 'var(--color-text-tertiary)'
    : bearingHealth >= 75 ? 'var(--color-success)'
    : bearingHealth >= 50 ? 'var(--color-warning)'
    : 'var(--color-danger)'

  return (
    <div style={{ padding: '6px 0', borderBottom: '1px solid var(--color-border-card)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, marginBottom: 5 }}>
        <span style={{ width: 52, color: 'var(--color-text-tertiary)', fontFamily: 'monospace', flexShrink: 0 }}>{pump}</span>
        <span style={{ flex: 1, fontVariantNumeric: 'tabular-nums', color: 'var(--color-text-secondary)', fontSize: 11 }}>
          {vib != null ? `${Number(vib).toFixed(2)} mm/s axial` : '— no sensor'}
        </span>
        {vib != null && <IsoZoneBadge mmPerS={vib} />}
        {bearingHealth != null && (
          <span style={{
            fontSize: 11, padding: '1px 6px', borderRadius: 10, flexShrink: 0,
            background: `${color}22`, color,
          }}>
            BH {bearingHealth}%
          </span>
        )}
      </div>
      {bearingHealth != null && (
        <div style={{ height: 5, background: 'var(--color-border-secondary)', borderRadius: 3, overflow: 'hidden' }}>
          <div style={{ width: `${bearingHealth}%`, height: '100%', background: color, borderRadius: 3, transition: 'width 0.4s' }} />
        </div>
      )}
      {bearingHealth == null && (
        <div style={{ height: 5, background: 'var(--color-border-secondary)', borderRadius: 3 }} />
      )}
    </div>
  )
}

export default function FeatureExtractorPanel({ podName }) {
  const { pumpAlerts, sensorReadings, metrics } = useAppState()
  const m = metrics[podName] || {}

  const alertsByPump = useMemo(() => {
    const map = {}
    pumpAlerts.forEach(a => {
      const id = a.pump_id || a.pump
      if (id && !map[id]) map[id] = a
    })
    return map
  }, [pumpAlerts])

  // LEAK_MODE: RSS slope > 0.1 MB/min over last 10 samples
  const leakMode = useMemo(() => {
    const rssArr = (m.mem_rss || []).filter(v => v != null)
    if (rssArr.length < 4) return false
    const w = rssArr.slice(Math.max(0, rssArr.length - 10))
    const intervals = w.length - 1
    if (intervals <= 0) return false
    const slopePer15s = (w[w.length - 1] - w[0]) / intervals
    const slopeMbPerMin = (slopePer15s * 4) / (1024 * 1024)
    return slopeMbPerMin > 0.1
  }, [m.mem_rss])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ fontSize: 10, color: 'var(--color-text-tertiary)', fontWeight: 700 }}>BEARING HEALTH PER PUMP</div>
        {leakMode && (
          <span style={{
            fontSize: 9, padding: '2px 6px', borderRadius: 8,
            background: 'var(--color-danger-tint)', color: 'var(--color-danger)',
            border: '1px solid var(--color-danger)', fontWeight: 700,
          }}>
            LEAK MODE
          </span>
        )}
      </div>

      {PUMPS.map(pump => (
        <PumpBearingRow key={pump} pump={pump} alertsByPump={alertsByPump} sensorReadings={sensorReadings} />
      ))}

      <div style={{ marginTop: 4 }}>
        <div style={{ fontSize: 10, color: 'var(--color-text-tertiary)', marginBottom: 4 }}>RSS memory trend</div>
        <TrendSparkline podName={podName} series="mem_rss" />
      </div>

      <div style={{ fontSize: 11, color: 'var(--color-text-secondary)', background: 'var(--color-bg-surface)', borderRadius: 4, padding: '6px 10px' }}>
        Queries InfluxDB every 10 s. Computes vibration features (RMS, kurtosis, crest factor) and bearing health score via a lightweight ML model.
      </div>
    </div>
  )
}
