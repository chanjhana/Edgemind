import { useEffect, useRef } from 'react'
import { useDispatch } from '../store/AppContext.jsx'
import { routeEvent } from './eventRouter.js'
import { WS_STATUS } from '../store/actions.js'

const WS_URL = '/ws'
const MIN_BACKOFF = 1000
const MAX_BACKOFF = 30000

export function useWebSocket() {
  const dispatch = useDispatch()
  const wsRef    = useRef(null)
  const backoff  = useRef(MIN_BACKOFF)
  const stopped  = useRef(false)

  useEffect(() => {
    stopped.current = false

    function connect() {
      if (stopped.current) return

      dispatch({ type: WS_STATUS, payload: { connected: false, status: 'connecting' } })

      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
      const ws = new WebSocket(`${protocol}//${window.location.host}${WS_URL}`)
      wsRef.current = ws

      ws.onopen = () => {
        backoff.current = MIN_BACKOFF
        dispatch({ type: WS_STATUS, payload: { connected: true, status: 'connected' } })
      }

      ws.onmessage = (evt) => {
        try {
          const event = JSON.parse(evt.data)
          routeEvent(event, dispatch)
        } catch (e) {
          console.warn('[WS] bad JSON:', e)
        }
      }

      ws.onclose = () => {
        if (stopped.current) return
        dispatch({ type: WS_STATUS, payload: { connected: false, status: 'reconnecting' } })
        setTimeout(connect, backoff.current)
        backoff.current = Math.min(backoff.current * 2, MAX_BACKOFF)
      }

      ws.onerror = () => {
        ws.close()
      }
    }

    connect()

    return () => {
      stopped.current = true
      if (wsRef.current) {
        wsRef.current.onclose = null
        wsRef.current.close()
      }
      dispatch({ type: WS_STATUS, payload: { connected: false, status: 'lost' } })
    }
  }, [dispatch])
}
