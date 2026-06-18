import { Outlet } from 'react-router-dom'
import { useWebSocket } from '../../core/ws/useWebSocket.js'
import { useGraph } from '../../core/api/useGraph.js'
import { usePumpAlerts } from '../../core/api/usePumpAlerts.js'
import { useSensorReadings } from '../../core/api/useSensorReadings.js'
import GlobalHeader from './GlobalHeader.jsx'

function DataHooks() {
  useWebSocket()
  useGraph()
  usePumpAlerts()
  useSensorReadings()
  return null
}

export default function Shell({ children }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}>
      <DataHooks />
      <GlobalHeader />
      <main style={{
        flex: 1,
        overflow: 'auto',
        background: 'var(--color-bg-surface)',
        padding: '16px',
      }}>
        {children}
      </main>
    </div>
  )
}
