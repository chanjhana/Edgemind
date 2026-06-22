import { useState } from 'react'
import { useDispatch } from '../store/AppContext.jsx'
import { SET_ACTIVE_FAULT } from '../store/actions.js'

const SENSOR_PROXIES = {
  pump1: '/sensor1',
  pump2: '/sensor2',
  pump3: '/sensor3',
}

export function useFaultInjection(pumpId) {
  const dispatch = useDispatch()
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState(null)
  const base = SENSOR_PROXIES[pumpId]

  async function inject(mode, duration) {
    setLoading(true)
    setError(null)
    try {
      const body = { mode }
      if (duration) body.duration_s = duration
      const res = await fetch(`${base}/inject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) throw new Error(`Inject failed: ${res.status}`)
      dispatch({ type: SET_ACTIVE_FAULT, payload: { pump: pumpId, fault: mode } })
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  async function clear() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`${base}/inject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'clear' }),
      })
      if (!res.ok) throw new Error(`Clear failed: ${res.status}`)
      dispatch({ type: SET_ACTIVE_FAULT, payload: { pump: pumpId, fault: null } })
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  return { inject, clear, loading, error }
}
