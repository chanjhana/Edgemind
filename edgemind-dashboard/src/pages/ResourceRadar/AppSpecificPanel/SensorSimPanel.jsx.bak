import { useState } from 'react'
import { useAppState } from '../../../core/store/AppContext.jsx'
import { POD_TO_PUMP } from '../../../core/constants/pods.js'
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

  const activeFault = demoLab.activeFaults[pumpId]

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
      <ReadingRow label="Temperature" value={readings.temperature} unit="°C" warn={readings.temperature > 80} />
      <ReadingRow label="RPM"         value={readings.rpm}         unit="rpm" />

      {readings.emission_hz && (
        <div style={{ fontSize: 11, color: readings.emission_hz >= 10 ? 'var(--color-danger)' : 'var(--color-success)' }}>
          Emission rate: {readings.emission_hz} Hz {readings.emission_hz >= 10 ? '⚡ FLOOD' : '✓ normal'}
        </div>
      )}

      {activeFault && (
        <div style={{ background: 'var(--color-danger-tint)', border: '1px solid var(--color-danger-border)', borderRadius: 4, padding: '6px 8px', fontSize: 11 }}>
          <span style={{ color: 'var(--color-danger)' }}>Active: {activeFault}</span>
        </div>
      )}
    </div>
  )
}
