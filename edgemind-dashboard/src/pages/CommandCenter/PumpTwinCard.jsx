import CircularGauge from '../../components/ui/CircularGauge.jsx'
import IsoZoneBadge from '../../components/ui/IsoZoneBadge.jsx'

// One pump's digital-twin summary. Live sensor telemetry (temp / rpm /
// vibration) comes from the sensor-sim status feed; the health % and state
// come from the alert-manager pump-health scores. Thresholds mirror those
// used in DemoLab/SensorSimControl so coloring is consistent app-wide.

function Reading({ label, value, unit, warn, crit, flip = false, digits = 1 }) {
  let color = 'var(--color-text-secondary)'
  if (value != null && warn != null && crit != null) {
    color = flip
      ? (value < crit ? 'var(--color-danger)' : value < warn ? 'var(--color-warning)' : 'var(--color-success)')
      : (value >= crit ? 'var(--color-danger)' : value >= warn ? 'var(--color-warning)' : 'var(--color-success)')
  }
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, padding: '1px 0' }}>
      <span style={{ color: 'var(--color-text-tertiary)' }}>{label}</span>
      <span style={{ color, fontVariantNumeric: 'tabular-nums' }}>
        {value != null ? `${Number(value).toFixed(digits)} ${unit}` : '—'}
      </span>
    </div>
  )
}

export default function PumpTwinCard({ title, sensorName, readings = {}, alert, activeFault }) {
  const overall = alert?.overall_health ?? null
  const stateLabel = overall == null ? (activeFault ? 'WARNING' : 'HEALTHY')
    : overall < 50 ? 'CRITICAL'
    : overall < 75 ? 'WARNING'
    : 'HEALTHY'

  const stateColor = stateLabel === 'CRITICAL' ? 'var(--color-danger)'
    : stateLabel === 'WARNING' ? 'var(--color-warning)'
    : 'var(--color-success)'

  const vibAxial = readings.vibration_axial
  const vibRadial = readings.vibration_radial
  const vib = (vibAxial != null && vibRadial != null)
    ? Math.max(vibAxial, vibRadial)
    : (vibAxial ?? vibRadial)

  return (
    <div style={{
      background: 'var(--color-bg-card)',
      border: `1px solid ${stateLabel === 'CRITICAL' ? 'var(--color-danger)' : 'var(--color-border-secondary)'}`,
      borderLeft: `3px solid ${stateColor}`,
      borderRadius: 6, padding: '9px 11px',
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--color-text-primary)' }}>{title}</div>
          <div style={{ fontSize: 9.5, color: 'var(--color-text-tertiary)' }}>{sensorName}</div>
          <div style={{ marginTop: 4, display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
            <span style={{
              fontSize: 9, fontWeight: 700, padding: '1px 6px', borderRadius: 8,
              background: `${stateColor}22`, color: stateColor,
            }}>{stateLabel}</span>
            {vib != null && <IsoZoneBadge mmPerS={vib} />}
            {activeFault && (
              <span style={{
                fontSize: 9, padding: '1px 5px', borderRadius: 8,
                background: 'var(--color-danger-tint)', color: 'var(--color-danger)',
                border: '1px solid var(--color-danger-border)',
              }}>⚡ {activeFault}</span>
            )}
          </div>
        </div>
        <CircularGauge value={overall} size={46} sublabel="health" />
      </div>

      <div style={{ marginTop: 7, borderTop: '1px solid var(--color-border-secondary)', paddingTop: 5 }}>
        <Reading label="Temp"      value={readings.temperature}      unit="°C"   warn={55}   crit={65} />
        <Reading label="RPM"       value={readings.rpm}              unit="rpm"  warn={1200} crit={900} flip digits={0} />
        <Reading label="Vibration" value={vib}                       unit="mm/s" warn={2.0}  crit={4.0} />
      </div>
    </div>
  )
}
