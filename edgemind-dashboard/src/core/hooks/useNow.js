import { useState, useEffect } from 'react'

// Ticking clock so time-based derivations (e.g. correlation staleness) recompute
// on an interval even when no new events arrive. Returns Date.now(), updated
// every `intervalMs`.
export function useNow(intervalMs = 5000) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(id)
  }, [intervalMs])
  return now
}
