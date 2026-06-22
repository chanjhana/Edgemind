import * as A from '../store/actions.js'

export function routeEvent(event, dispatch) {
  const { type, data } = event
  switch (type) {
    case 'initial_state':
      dispatch({ type: A.INITIAL_STATE, payload: data })
      break
    case 'metric_update':
      dispatch({ type: A.METRIC_UPDATE, payload: data })
      break
    case 'agent_finding':
      dispatch({ type: A.AGENT_FINDING, payload: data })
      break
    case 'correlated_alert':
      dispatch({ type: A.CORRELATED_ALERT, payload: data })
      break
    case 'agent_heartbeat':
      dispatch({ type: A.AGENT_HEARTBEAT, payload: data })
      break
    case 'alerts_cleared':
      dispatch({ type: A.ALERTS_CLEARED })
      break
    default:
      if (import.meta.env.DEV) {
        console.debug('[WS] unhandled event:', type, data)
      }
  }
}
