import { useEffect, useRef } from 'react'
import { useDispatch } from '../store/AppContext.jsx'
import { LIVE_SCORES_UPDATE } from '../store/actions.js'

const POLL_INTERVAL = 15000

export function useLiveScores() {
  const dispatch = useDispatch()
  const timer = useRef(null)

  useEffect(() => {
    async function fetchScores() {
      try {
        const res = await fetch('/alertmanager/scores')
        if (!res.ok) return
        const data = await res.json()
        dispatch({ type: LIVE_SCORES_UPDATE, payload: Array.isArray(data) ? data : data.scores || [] })
      } catch {
        // alert-manager not reachable; skip
      }
    }

    fetchScores()
    timer.current = setInterval(fetchScores, POLL_INTERVAL)
    return () => clearInterval(timer.current)
  }, [dispatch])
}
