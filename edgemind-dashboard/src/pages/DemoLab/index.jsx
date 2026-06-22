import { useState, useEffect } from 'react'
import DemoTopBar from './DemoTopBar.jsx'
import ScenarioLauncher from './ScenarioLauncher.jsx'
import ManualFaultControls from './ManualFaultControls.jsx'
import LiveCascadeMonitor from './LiveCascadeMonitor.jsx'

export default function DemoLab() {
  const [notification, setNotification] = useState(null)

  useEffect(() => {
    if (notification) {
      const timer = setTimeout(() => setNotification(null), 3000)
      return () => clearTimeout(timer)
    }
  }, [notification])

  const showError = (msg) => {
    setNotification(msg)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden', position: 'relative' }}>
      {notification && (
        <div style={{
          position: 'absolute', top: 60, left: '50%', transform: 'translateX(-50%)',
          background: 'var(--color-danger)', color: '#fff', padding: '10px 20px',
          borderRadius: 8, fontSize: 13, fontWeight: 600, zIndex: 100,
          boxShadow: '0 4px 12px rgba(200, 0, 10, 0.3)',
          animation: 'fadeInDown 0.3s ease-out'
        }}>
          {notification}
        </div>
      )}
      <DemoTopBar />
      <div style={{ flex: 1, overflowY: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 20 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
          <ScenarioLauncher showError={showError} />
          <ManualFaultControls showError={showError} />
        </div>
        <LiveCascadeMonitor />
      </div>
    </div>
  )
}
