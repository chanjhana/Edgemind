import { useState } from 'react'
import { useAppState } from '../../core/store/AppContext.jsx'
import SensorSimControl from './SensorSimControl.jsx'

const PUMPS = ['pump1', 'pump2', 'pump3']

export default function ManualFaultControls({ showError }) {
  const { demoLab } = useAppState()
  const [currentIndex, setCurrentIndex] = useState(0)

  const anyActiveFault = Object.values(demoLab.activeFaults || {}).some(Boolean)
  const isScenarioRunning = !!demoLab.activeScenarioId
  const blockInjection = anyActiveFault || isScenarioRunning

  const nextFault = () => setCurrentIndex((prev) => (prev + 1) % PUMPS.length)
  const prevFault = () => setCurrentIndex((prev) => (prev === 0 ? PUMPS.length - 1 : prev - 1))

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, flex: 1, minWidth: 0 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}>
          <span style={{ display: 'inline-block', width: 3, height: 14, borderRadius: 2, background: 'var(--color-danger)', flexShrink: 0 }} />
          <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: '0.06em', color: 'var(--color-text-primary)', textTransform: 'uppercase' }}>
            Manual Fault Injection
          </span>
        </span>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={prevFault} style={navBtn}>‹</button>
          <button onClick={nextFault} style={navBtn}>›</button>
        </div>
      </div>
      <div style={{ flex: 1, height: 210, overflow: 'hidden', position: 'relative' }}>
        <div style={{
          display: 'flex',
          width: `${PUMPS.length * 100}%`,
          height: '100%',
          transform: `translateX(-${(currentIndex / PUMPS.length) * 100}%)`,
          transition: 'transform 0.4s cubic-bezier(0.25, 1, 0.5, 1)'
        }}>
          {PUMPS.map(pump => (
            <div key={pump} style={{ width: `${100 / PUMPS.length}%`, height: '100%', paddingBottom: 4, paddingRight: 4, paddingLeft: 2 }}>
              <SensorSimControl
                pumpId={pump}
                showError={showError}
                disabled={isScenarioRunning || (anyActiveFault && !demoLab.activeFaults?.[pump])}
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

const navBtn = {
  width: 32, height: 32, borderRadius: '50%',
  background: 'var(--color-bg-card)', border: '1px solid var(--color-border-card)',
  color: 'var(--color-text-primary)', fontSize: 20,
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  cursor: 'pointer', boxShadow: '0 2px 4px var(--color-shadow)',
  lineHeight: 0, paddingBottom: 2
}
