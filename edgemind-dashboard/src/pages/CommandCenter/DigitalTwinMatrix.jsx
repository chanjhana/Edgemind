import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAppState } from '../../core/store/AppContext.jsx'
import { PUMP_TO_SENSOR } from '../../core/constants/pods.js'
import PumpTwinCard from './PumpTwinCard.jsx'
import PanelHeader from '../../components/ui/PanelHeader.jsx'

// Band 2 (left) — the physical asset layer. Three monitored pumps, each as a
// live digital twin. This is the "what we protect" half of the story; the
// dependency graph beside it is the "how it can fail" half.

const PUMPS = [
  { id: 'pump1', title: 'Pump 1' },
  { id: 'pump2', title: 'Pump 2' },
  { id: 'pump3', title: 'Pump 3' },
]

export default function DigitalTwinMatrix() {
  const navigate = useNavigate()
  const { sensorReadings, pumpAlerts, demoLab, liveScores } = useAppState()

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
    <div style={{
      background: 'var(--color-bg-card)',
      border: '1.5px solid var(--color-border-card)',
      borderRadius: 6, padding: '10px 12px',
      display: 'flex', flexDirection: 'column', gap: 8,
      cursor: 'pointer',
    }}
      onClick={() => navigate('/radar')}
      title="Click for full resource radar"
    >
      <PanelHeader title="Digital Twin Matrix" hint="3 pumps live →" />
      {PUMPS.map(p => (
        <PumpTwinCard
          key={p.id}
          title={p.title}
          sensorName={PUMP_TO_SENSOR[p.id]}
          readings={sensorReadings[p.id] || {}}
          alert={alertsByPump[p.id] || liveScores[p.id] || null}
          activeFault={demoLab.activeFaults?.[p.id] || sensorReadings[p.id]?.active_fault || null}
        />
      ))}
    </div>
  )
}
