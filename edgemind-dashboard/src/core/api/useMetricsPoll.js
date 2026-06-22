import { useEffect } from 'react'
import { useDispatch } from '../store/AppContext.jsx'
import { apiFetch } from './client.js'
import { METRIC_UPDATE } from '../store/actions.js'

const POLL_MS = 15000

export function useMetricsPoll() {
  const dispatch = useDispatch()

  useEffect(() => {
    let cancelled = false

    async function poll() {
      try {
        const data = await apiFetch('/api/metrics')
        if (!cancelled) {
          const podCount = Object.keys(data.pods || {}).length
          console.debug('[metrics poll] ok —', podCount, 'pods')
          dispatch({ type: METRIC_UPDATE, payload: data })
        }
      } catch (e) {
        console.warn('[metrics poll] failed:', e.message)
      }
    }

    poll()
    const id = setInterval(poll, POLL_MS)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [dispatch])
}
