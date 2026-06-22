import { useEffect, useRef } from 'react'
import { useDispatch } from '../store/AppContext.jsx'
import { PUMP_ALERTS_UPDATE } from '../store/actions.js'

const POLL_INTERVAL = 15000

export function usePumpAlerts() {
  const dispatch = useDispatch()
  const timer = useRef(null)

  useEffect(() => {
    async function fetchAlerts() {
      try {
        const res = await fetch('/alertmanager/alerts/active')
        if (!res.ok) return
        const data = await res.json()
        const alerts = Array.isArray(data) ? data : data.alerts || []
        dispatch({ type: PUMP_ALERTS_UPDATE, payload: alerts })
      } catch (e) {
        // alert-manager may not be port-forwarded; silently skip
      }
    }

    fetchAlerts()
    timer.current = setInterval(fetchAlerts, POLL_INTERVAL)
    return () => clearInterval(timer.current)
  }, [dispatch])
}
