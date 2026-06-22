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

function ReadingRow({ label, value, unit, warn, crit, flip = false, digits = 1 }) {
  let color = 'var(--color-text-secondary)'
  if (value != null && warn != null && crit != null) {
    if (flip) {
      color = value < crit ? 'var(--color-danger)' : value < warn ? 'var(--color-warning)' : 'var(--color-success)'
    } else {
      color = value >= crit ? 'var(--color-danger)' : value >= warn ? 'var(--color-warning)' : 'var(--color-success)'
    }
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 1, padding: '2px 0' }}>
      <span style={{ color: 'var(--color-text-tertiary)', fontSize: 9, fontWeight: 700 }}>{label}</span>
      <span style={{ color, fontVariantNumeric: 'tabular-nums', fontSize: 12, fontWeight: 800 }}>
        {value != null ? `${Number(value).toFixed(digits)} ${unit}` : '—'}
      </span>
    </div>
  )
}

export default function SensorSimControl({ pumpId, showError, disabled }) {
  const { sensorReadings, demoLab } = useAppState()
  const readings = sensorReadings[pumpId] || {}
  const { inject, clear, loading } = useFaultInjection(pumpId)
  const activeFault = demoLab.activeFaults?.[pumpId] || readings.active_fault || null
  const sensorName = PUMP_TO_SENSOR[pumpId] || pumpId

  const [mode, setMode] = useState('imbalance')
  const [duration, setDuration] = useState(300)
  const selectedMode = FAULT_MODES.find(f => f.id === mode)

  const emissionHz = readings.emission_hz ?? null
  const isFlooding = emissionHz != null && emissionHz > 2
  return (
    <div style={{
      background: 'var(--color-bg-card)', borderRadius: 8,
      border: activeFault ? '1px solid var(--color-danger)' : '1px solid var(--color-border-card)',
      padding: 10, display: 'flex', flexDirection: 'column', height: '100%',
      boxShadow: '0 2px 8px var(--color-shadow)', gap: 8,
      opacity: disabled ? 0.4 : 1, pointerEvents: disabled ? 'none' : 'auto', filter: disabled ? 'grayscale(100%)' : 'none', transition: 'all 0.3s'
    }}>
      {/* Header: sensor name + pump */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 0 }}>
            <span style={{ fontWeight: 800, fontSize: 13, color: 'var(--color-text-primary)' }}>{sensorName}</span>
            {(readings.vibration_axial != null || readings.vibration_radial != null) && (
              <IsoZoneBadge mmPerS={Math.max(readings.vibration_axial ?? 0, readings.vibration_radial ?? 0)} />
            )}
          </div>
          <div style={{ fontSize: 9, color: 'var(--color-text-tertiary)' }}>Target: {pumpId}</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          {isFlooding && (
            <span style={{
              fontSize: 9, fontWeight: 800, padding: '2px 4px', borderRadius: 8,
              background: 'var(--color-danger-tint)', color: 'var(--color-danger)',
              border: '1px solid var(--color-danger-border)',
            }}>⚡ FLOOD</span>
          )}
          <div style={{ 
            display: 'flex', alignItems: 'center', gap: 4, fontSize: 8, fontWeight: 800,
            padding: '3px 8px', borderRadius: 12, background: 'var(--color-bg-surface)',
            border: '1px solid var(--color-border-card)', letterSpacing: '0.05em'
          }}>
            <span style={{
              width: 5, height: 5, borderRadius: '50%', flexShrink: 0,
              background: activeFault ? 'var(--color-warning)' : 'var(--color-success)',
            }} className={activeFault ? 'animate-pulse-dot' : ''} />
            <span style={{ color: activeFault ? 'var(--color-warning)' : 'var(--color-success)' }}>
              {activeFault ? `FAULT: ${activeFault.toUpperCase()}` : 'RUNNING'}
            </span>
          </div>
        </div>
      </div>

      {/* Current readings */}
      <div style={{ flex: 1, background: 'var(--color-bg-surface)', borderRadius: 4, padding: '8px 10px', border: '1px solid var(--color-border-card)' }}>
        <div style={{ fontSize: 8, color: 'var(--color-text-tertiary)', fontWeight: 800, marginBottom: 4, letterSpacing: '0.05em' }}>LIVE READINGS</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2px 8px' }}>
          <ReadingRow label="Vibration Axial"      value={readings.vibration_axial}      unit="mm/s" warn={1.5} crit={3.0} />
          <ReadingRow label="Vibration Tangential" value={readings.vibration_tangential} unit="mm/s" warn={2.0} crit={4.0} />
          <ReadingRow label="Vibration Radial"     value={readings.vibration_radial}     unit="mm/s" warn={2.0} crit={4.0} />
          <ReadingRow label="RPM"                  value={readings.rpm}                  unit="rpm"  warn={1200} crit={900} flip digits={0} />
          <ReadingRow label="Temperature"          value={readings.temperature}          unit="°C"   warn={55}  crit={65} />
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 10, fontWeight: 700, padding: '4px 0 0', marginTop: 4, borderTop: '1px solid var(--color-border-primary)' }}>
          <span style={{ color: 'var(--color-text-secondary)' }}>Emission Rate</span>
          <span style={{
            fontVariantNumeric: 'tabular-nums', fontSize: 12, fontWeight: 800,
            color: isFlooding ? 'var(--color-danger)' : 'var(--color-success)',
          }}>
            {emissionHz != null ? `${emissionHz} Hz` : '—'}
            {isFlooding ? ' ⚡' : ''}
          </span>
        </div>
      </div>

      {/* Inject controls */}
      <div style={{ marginTop: 'auto', paddingTop: 2 }}>
        <div style={{ fontSize: 8, color: 'var(--color-text-tertiary)', fontWeight: 800, marginBottom: 4, letterSpacing: '0.05em' }}>INJECTION CONTROLS</div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 6 }}>
          <select value={mode} onChange={e => setMode(e.target.value)} style={{
            background: 'var(--color-bg-input)', color: 'var(--color-text-primary)',
            border: '1px solid var(--color-border-primary)', borderRadius: 4, padding: '4px 6px', fontSize: 10, fontWeight: 500,
            flex: 1, minWidth: 100, cursor: 'pointer', outline: 'none'
          }}>
            {FAULT_MODES.map(f => <option key={f.id} value={f.id}>{f.label}</option>)}
          </select>

          {selectedMode?.sustained ? (
            <div style={{ width: 80, textAlign: 'center', fontSize: 9, color: 'var(--color-text-tertiary)', fontStyle: 'italic', fontWeight: 600 }}>sustained</div>
          ) : (
            <div style={{ position: 'relative', width: 80 }}>
              <input
                type="number" value={duration} min={30} max={3600}
                onChange={e => setDuration(Number(e.target.value))}
                style={{
                  width: '100%', background: 'var(--color-bg-input)', color: 'var(--color-text-primary)',
                  border: '1px solid var(--color-border-primary)', borderRadius: 4, padding: '4px 14px 4px 6px', fontSize: 10, fontWeight: 600,
                  outline: 'none'
                }}
                title="Duration in seconds"
              />
              <span style={{ position: 'absolute', right: 4, top: 4, fontSize: 9, fontWeight: 700, color: 'var(--color-text-tertiary)', pointerEvents: 'none' }}>s</span>
            </div>
          )}
        </div>

        <div style={{ display: 'flex', gap: 6 }}>
          <button
            onClick={() => {
              if (disabled && !activeFault) {
                showError("Cannot inject fault: Another fault or scenario is currently active. Please stop it first.")
                return
              }
              inject(mode, selectedMode?.sustained ? undefined : duration)
            }}
            disabled={loading || !!activeFault}
            style={{
              flex: 1, padding: '6px 0', borderRadius: 4, cursor: loading || activeFault ? 'not-allowed' : 'pointer',
              background: 'var(--color-danger)', color: '#fff', border: 'none', fontSize: 11, fontWeight: 700,
              opacity: loading || activeFault ? 0.5 : 1, transition: 'all 0.2s', boxShadow: '0 1px 3px var(--color-shadow)'
            }}
          >▶ Inject Fault</button>

          <button
            onClick={clear}
            disabled={loading || !activeFault}
            style={{
              flex: 1, padding: '6px 0', borderRadius: 4, cursor: loading || !activeFault ? 'not-allowed' : 'pointer',
              background: 'transparent', color: 'var(--color-text-secondary)',
              border: '1px solid var(--color-border-primary)', fontSize: 11, fontWeight: 700,
              opacity: loading || !activeFault ? 0.5 : 1, transition: 'all 0.2s'
            }}
          >✕ Clear</button>
        </div>
      </div>
    </div>
  )
}
