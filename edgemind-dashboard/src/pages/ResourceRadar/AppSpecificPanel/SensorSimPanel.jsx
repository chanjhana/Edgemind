import { useState } from 'react'
import { useAppState } from '../../../core/store/AppContext.jsx'
import { useFaultInjection } from '../../../core/api/useFaultInjection.js'
import { POD_TO_PUMP } from '../../../core/constants/pods.js'
import { FAULT_MODES } from '../../../core/constants/faultModes.js'
import IsoZoneBadge from '../../../components/ui/IsoZoneBadge.jsx'

function ReadingRow({ label, value, unit, warn }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, padding: '3px 0', borderBottom: '1px solid var(--color-border-card)' }}>
      <span style={{ color: 'var(--color-text-secondary)' }}>{label}</span>
      <span style={{ color: warn ? 'var(--color-warning)' : 'var(--color-text-primary)', fontVariantNumeric: 'tabular-nums' }}>
        {value != null ? `${Number(value).toFixed(2)} ${unit}` : '—'}
      </span>
    </div>
  )
}

export default function SensorSimPanel({ podName }) {
  const { sensorReadings, demoLab } = useAppState()
  const pumpId = POD_TO_PUMP[podName] || 'pump1'
  const readings = sensorReadings[pumpId] || {}
  const { inject, clear, loading, error } = useFaultInjection(pumpId)

  const [mode, setMode] = useState('imbalance')
  const [duration, setDuration] = useState(120)
  const activeFault = demoLab.activeFaults[pumpId]
  const selectedMode = FAULT_MODES.find(f => f.id === mode)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ fontSize: 10, color: 'var(--color-text-tertiary)', fontWeight: 700 }}>LIVE SENSOR READINGS</div>

      <ReadingRow label="Vibration Radial"     value={readings.vibration_radial}     unit="mm/s" />
      <ReadingRow label="Vibration Tangential" value={readings.vibration_tangential} unit="mm/s" />
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12, padding: '3px 0', borderBottom: '1px solid var(--color-border-card)' }}>
        <span style={{ color: 'var(--color-text-secondary)' }}>Vibration Axial</span>
        <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <span style={{ fontVariantNumeric: 'tabular-nums' }}>{readings.vibration_axial != null ? `${Number(readings.vibration_axial).toFixed(2)} mm/s` : '—'}</span>
          <IsoZoneBadge mmPerS={readings.vibration_axial} />
        </span>
      </div>
      <ReadingRow label="Temperature" value={readings.temperature} unit="Â°C" warn={readings.temperature > 80} />
      <ReadingRow label="RPM"         value={readings.rpm}         unit="rpm" />

      {readings.emission_hz && (
        <div style={{ fontSize: 11, color: readings.emission_hz >= 10 ? 'var(--color-danger)' : 'var(--color-success)' }}>
          Emission rate: {readings.emission_hz} Hz {readings.emission_hz >= 10 ? 'âš¡ FLOOD' : 'âœ“ normal'}
        </div>
      )}

      {activeFault && (
        <div style={{ background: 'var(--color-danger-tint)', border: '1px solid var(--color-danger-border)', borderRadius: 4, padding: '6px 8px', fontSize: 11 }}>
          <span style={{ color: 'var(--color-danger)' }}>Active: {activeFault}</span>
        </div>
      )}

      <div style={{ borderTop: '1px solid var(--color-border-card)', paddingTop: 10 }}>
        <div style={{ fontSize: 10, color: 'var(--color-text-tertiary)', fontWeight: 700, marginBottom: 6 }}>INJECT FAULT</div>
        <select value={mode} onChange={e => setMode(e.target.value)} style={{
          width: '100%', marginBottom: 6,
          background: 'var(--color-bg-input)', color: 'var(--color-text-primary)',
          border: '1px solid var(--color-border-primary)', borderRadius: 4, padding: '4px 8px', fontSize: 12,
        }}>
          {FAULT_MODES.map(f => <option key={f.id} value={f.id}>{f.label}</option>)}
        </select>
        {!selectedMode?.sustained && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, fontSize: 12 }}>
            <label style={{ color: 'var(--color-text-secondary)' }}>Duration (s):</label>
            <input
              type="number" value={duration} min={30} max={3600}
              onChange={e => setDuration(Number(e.target.value))}
              style={{
                width: 70, background: 'var(--color-bg-input)', color: 'var(--color-text-primary)',
                border: '1px solid var(--color-border-primary)', borderRadius: 4, padding: '3px 6px', fontSize: 12,
              }}
            />
          </div>
        )}
        {selectedMode?.sustained && (
          <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)', marginBottom: 6 }}>Sustained — runs until cleared</div>
        )}
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={() => inject(mode, selectedMode?.sustained ? undefined : duration)}
            disabled={loading || !!activeFault}
            style={{
              flex: 1, padding: '5px 0', borderRadius: 4, cursor: loading || activeFault ? 'not-allowed' : 'pointer',
              background: 'var(--color-danger)', color: '#fff', border: 'none', fontSize: 12, fontWeight: 700,
              opacity: loading || activeFault ? 0.5 : 1,
            }}
          >
            â–¶ Inject
          </button>
          <button
            onClick={clear}
            disabled={loading || !activeFault}
            style={{
              padding: '5px 12px', borderRadius: 4, cursor: loading || !activeFault ? 'not-allowed' : 'pointer',
              background: 'transparent', color: 'var(--color-text-secondary)',
              border: '1px solid var(--color-border-primary)', fontSize: 12,
              opacity: loading || !activeFault ? 0.5 : 1,
            }}
          >
            Clear
          </button>
        </div>
        {error && <div style={{ fontSize: 11, color: 'var(--color-danger)', marginTop: 4 }}>{error}</div>}
      </div>
    </div>
  )
}
