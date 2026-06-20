import { Outlet, useLocation } from 'react-router-dom'
import { useWebSocket } from '../../core/ws/useWebSocket.js'
import { useGraph } from '../../core/api/useGraph.js'
import { usePumpAlerts } from '../../core/api/usePumpAlerts.js'
import { useSensorReadings } from '../../core/api/useSensorReadings.js'
import GlobalHeader from './GlobalHeader.jsx'
import CopilotChat from '../ui/CopilotChat.jsx'

function DataHooks() {
  useWebSocket()
  useGraph()
  usePumpAlerts()
  useSensorReadings()
  return null
}

export default function Shell({ children }) {
  const location = useLocation()
  const isEdgeToEdge = ['/radar', '/graph', '/timeline', '/demo'].includes(location.pathname)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden', position: 'relative' }}>
      <DataHooks />
      <GlobalHeader />
      <main style={{
        flex: 1,
        overflow: 'auto',
        background: 'var(--color-bg-surface)',
        padding: isEdgeToEdge ? 0 : '16px',
      }}>
        {children}
      </main>
      <CopilotChat />
    </div>
  )
}
