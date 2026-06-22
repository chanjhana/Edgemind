import { useAppState } from '../../../core/store/AppContext.jsx'
import { POD_TO_PUMP } from '../../../core/constants/pods.js'
import Pump3DScene from './Pump3DScene.jsx'

export default function SensorSimPanel({ podName }) {
  const { sensorReadings, demoLab } = useAppState()
  const pumpId = POD_TO_PUMP[podName] || 'pump1'
  const readings = sensorReadings[pumpId] || {}
  const activeFault = demoLab.activeFaults[pumpId] || readings.active_fault || null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <Pump3DScene readings={readings} activeFault={activeFault} />
    </div>
  )
}
