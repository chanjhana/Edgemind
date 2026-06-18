import { useState } from 'react'
import { useAppState } from '../../core/store/AppContext.jsx'
import { useFaultInjection } from '../../core/api/useFaultInjection.js'
import { FAULT_MODES } from '../../core/constants/faultModes.js'
import IsoZoneBadge from '../../components/ui/IsoZoneBadge.jsx'

const PUMP_TO_SENSOR = {
  pump1: 'sensor-sim-1',
  pump2: 'sensor-sim-2',
  pump3: 'sensor-sim-3',
}

function ReadingRow({ label, value, unit, warn, crit, flip = false }) {
  let color = 'var(--color-text-secondary)'
  if (value != null && warn != null && crit != null) {
    if (flip) {
      color = value < crit ? 'var(--color-danger)' : value < warn ? 'var(--color-warning)' : 'var(--color-success)'
    } else {
      color = value >= crit ? 'var(--color-danger)' : value >= warn ? 'var(--color-warning)' : 'var(--color-success)'
    }
  }
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, padding: '2px 0' }}>
      <span style={{ color: 'var(--color-text-tertiary)' }}>{label}</span>
      <span style={{ color, fontVariantNumeric: 'tabular-nums' }}>
        {value != null ? `${Number(value).toFixed(1)} ${unit}` : '—'}
      </span>
    </div>
  )
}

export default function SensorSimControl({ pumpId }) {
  const { sensorReadings, demoLab } = useAppState()
  const readings = sensorReadings[pumpId] || {}
  const { inject, clear, loading } = useFaultInjection(pumpId)
  const activeFault = demoLab.activeFaults?.[pumpId]
  const sensorName = PUMP_TO_SENSOR[pumpId] || pumpId

  const [mode, setMode] = useState('imbalance')
  const [duration, setDuration] = useState(120)
  const selectedMode = FAULT_MODES.find(f => f.id === mode)

  const emissionHz = readings.emission_hz ?? null
  const isFlooding = emissionHz != null && emissionHz > 2

  return (
    <div style={{
      background: 'var(--color-bg-card)', borderRadius: 6,
      border: activeFault ? '1px solid var(--color-danger)' : '1px solid var(--color-border-card)',
      padding: 12,
    }}>
      {/* Header: sensor name + pump */}
      <div style={{ marginBottom: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
          <span style={{ fontWeight: 700, fontSize: 12, color: 'var(--color-text-primary)' }}>{sensorName}</span>
          <span style={{ fontSize: 10, color: 'var(--color-text-tertiary)' }}>({pumpId})</span>
          {readings.vibration_axial != null && <IsoZoneBadge mmPerS={readings.vibration_axial} />}
        </div>
        {/* Status line */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11 }}>
            <span style={{
              width: 6, height: 6, borderRadius: '50%', flexShrink: 0,
              background: activeFault ? 'var(--color-warning)' : 'var(--color-success)',
            }} />
            <span style={{ color: activeFault ? 'var(--color-warning)' : 'var(--color-success)' }}>
              {activeFault ? `Fault: ${activeFault}` : 'Running'}
            </span>
          </div>
          {isFlooding && (
            <span style={{
              fontSize: 9, padding: '1px 5px', borderRadius: 8,
              background: 'var(--color-danger-tint)', color: 'var(--color-danger)',
              border: '1px solid var(--color-danger-border)',
            }}>âš¡ FLOOD</span>
          )}
        </div>
      </div>

      {/* Current readings */}
      <div style={{ marginBottom: 8, background: 'var(--color-bg-surface)', borderRadius: 4, padding: '6px 8px' }}>
        <div style={{ fontSize: 9, color: 'var(--color-text-tertiary)', fontWeight: 700, marginBottom: 4 }}>CURRENT READINGS</div>
        <ReadingRow label="Vib Axial"  value={readings.vibration_axial}    unit="mm/s" warn={1.5} crit={3.0} />
        <ReadingRow label="Vib Radial" value={readings.vibration_radial}   unit="mm/s" warn={2.0} crit={4.0} />
        <ReadingRow label="Temp"       value={readings.temperature}        unit="Â°C"   warn={55}  crit={65} />
        <ReadingRow label="RPM"        value={readings.rpm}                unit="rpm"  warn={1200} crit={900} flip />
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, padding: '2px 0', marginTop: 2, borderTop: '1px solid var(--color-border-card)' }}>
          <span style={{ color: 'var(--color-text-tertiary)' }}>Emission rate</span>
          <span style={{
            fontVariantNumeric: 'tabular-nums',
            color: isFlooding ? 'var(--color-danger)' : 'var(--color-success)',
          }}>
            {emissionHz != null ? `${emissionHz} Hz` : '—'}
            {isFlooding ? ' âš¡' : ''}
          </span>
        </div>
      </div>

      {/* Inject controls */}
      <div style={{ fontSize: 9, color: 'var(--color-text-tertiary)', fontWeight: 700, marginBottom: 6 }}>INJECT FAULT</div>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', marginBottom: 6 }}>
        <select value={mode} onChange={e => setMode(e.target.value)} style={{
          background: 'var(--color-bg-input)', color: 'var(--color-text-primary)',
          border: '1px solid var(--color-border-primary)', borderRadius: 4, padding: '3px 6px', fontSize: 11,
          flex: 1, minWidth: 120,
        }}>
          {FAULT_MODES.map(f => <option key={f.id} value={f.id}>{f.label}</option>)}
        </select>

        {selectedMode?.sustained ? (
          <span style={{ fontSize: 11, color: 'var(--color-text-tertiary)', fontStyle: 'italic' }}>sustained</span>
        ) : (
          <input
            type="number" value={duration} min={30} max={3600}
            onChange={e => setDuration(Number(e.target.value))}
            style={{
              width: 66, background: 'var(--color-bg-input)', color: 'var(--color-text-primary)',
              border: '1px solid var(--color-border-primary)', borderRadius: 4, padding: '3px 6px', fontSize: 11,
            }}
            title="Duration in seconds"
          />
        )}
      </div>

      <div style={{ display: 'flex', gap: 6 }}>
        <button
          onClick={() => inject(mode, selectedMode?.sustained ? undefined : duration)}
          disabled={loading || !!activeFault}
          style={{
            flex: 1, padding: '4px 0', borderRadius: 4, cursor: loading || activeFault ? 'not-allowed' : 'pointer',
            background: 'var(--color-danger)', color: '#fff', border: 'none', fontSize: 11, fontWeight: 700,
            opacity: loading || activeFault ? 0.5 : 1,
          }}
        >â–¶ Inject</button>

        <button
          onClick={clear}
          disabled={loading || !activeFault}
          style={{
            flex: 1, padding: '4px 0', borderRadius: 4, cursor: loading || !activeFault ? 'not-allowed' : 'pointer',
            background: 'transparent', color: 'var(--color-text-secondary)',
            border: '1px solid var(--color-border-primary)', fontSize: 11,
            opacity: loading || !activeFault ? 0.5 : 1,
          }}
        >âœ• Clear</button>
      </div>
    </div>
  )
}
