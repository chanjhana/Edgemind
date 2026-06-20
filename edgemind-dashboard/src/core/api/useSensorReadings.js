import { useEffect, useRef } from 'react'
import { useDispatch } from '../store/AppContext.jsx'
import { SENSOR_READINGS_UPDATE } from '../store/actions.js'

const SENSOR_PROXIES = {
  pump1: '/sensor1',
  pump2: '/sensor2',
  pump3: '/sensor3',
}
const POLL_INTERVAL = 1000

export function useSensorReadings() {
  const dispatch = useDispatch()
  const timers   = useRef([])

  useEffect(() => {
    Object.entries(SENSOR_PROXIES).forEach(([pumpId, base]) => {
      async function poll() {
        try {
          const res = await fetch(`${base}/status`)
          if (!res.ok) return
          const data = await res.json()
          const flattened = {
            ...data,
            ...(data.readings || {}),
            emission_hz: data.flood ? 10.0 : 1.0,
          }
          dispatch({ type: SENSOR_READINGS_UPDATE, payload: { pumpId, data: flattened } })
        } catch {
          // sensor-sim not port-forwarded — skip
        }
      }
      poll()
      timers.current.push(setInterval(poll, POLL_INTERVAL))
    })
    return () => timers.current.forEach(clearInterval)
  }, [dispatch])
}
