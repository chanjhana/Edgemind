/**
 * WebSocket hook — mirrors dashboard's useWebSocket.js.
 * Connects to the EdgeMind FastAPI server, parses events,
 * dispatches them to AppContext, and fires push notifications
 * on CRITICAL alerts.
 */

import { useEffect, useRef, useCallback } from 'react';
import { AppState as RNAppState } from 'react-native';
import { useApp } from '../store/AppContext';
import { API_CONFIG } from '../config';
import { scheduleAlertNotification } from '../../components/notifications/notificationService';

const RECONNECT_DELAY_MS = [1000, 2000, 4000, 8000, 16000]; // exponential backoff

export function useWebSocket() {
  const { dispatch } = useApp();
  const wsRef      = useRef<WebSocket | null>(null);
  const retryCount = useRef(0);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mounted    = useRef(true);

  const connect = useCallback(() => {
    if (!mounted.current) return;
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    const ws = new WebSocket(API_CONFIG.wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      if (!mounted.current) return;
      retryCount.current = 0;
      dispatch({ type: 'SET_WS_CONNECTED', payload: true });
      dispatch({ type: 'SET_TOAST', payload: null });
      console.log('[WS] Connected to', API_CONFIG.wsUrl);
    };

    ws.onmessage = (event) => {
      if (!mounted.current) return;
      try {
        const data = JSON.parse(event.data);
        handleWsEvent(data);
      } catch {
        // non-JSON message — ignore
      }
    };

    ws.onerror = (error) => {
      console.warn('[WS] Error:', error);
    };

    ws.onclose = () => {
      if (!mounted.current) return;
      dispatch({ type: 'SET_WS_CONNECTED', payload: false });

      const delay = RECONNECT_DELAY_MS[Math.min(retryCount.current, RECONNECT_DELAY_MS.length - 1)];
      retryCount.current += 1;
      console.log(`[WS] Reconnecting in ${delay}ms (attempt ${retryCount.current})`);

      retryTimer.current = setTimeout(connect, delay);
    };
  }, [dispatch]);

  function handleWsEvent(data: any) {
    const type = data.type || data.event;
    dispatch({ type: 'SET_WS_LAST_EVENT', payload: type });

    switch (type) {
      case 'alert':
      case 'new_alert': {
        const alert = data.alert || data.payload || data;
        dispatch({ type: 'ADD_ALERT', payload: alert });

        if (alert.severity === 'CRITICAL') {
          // Fire OS push notification + in-app toast for CRITICAL
          scheduleAlertNotification(alert);
          dispatch({
            type: 'SET_TOAST',
            payload: `CRITICAL: ${alert.pod_id || alert.title}`,
          });
          setTimeout(() => dispatch({ type: 'SET_TOAST', payload: null }), 5000);
        } else if (alert.severity === 'WARNING') {
          // In-app toast only for WARNING (no OS push)
          dispatch({
            type: 'SET_TOAST',
            payload: `WARNING: ${alert.pod_id || alert.title}`,
          });
          setTimeout(() => dispatch({ type: 'SET_TOAST', payload: null }), 4000);
        }
        break;
      }
      case 'alert_list': {
        dispatch({ type: 'SET_ALERTS', payload: data.alerts || [] });
        break;
      }
      case 'sensor_update': {
        const { pump_id, readings } = data;
        if (pump_id) {
          dispatch({ type: 'SET_SENSORS', payload: { pump_id, readings: readings || [data] } });
        }
        break;
      }
      case 'graph_update': {
        dispatch({ type: 'SET_GRAPH', payload: { nodes: data.nodes || [], edges: data.edges || [] } });
        break;
      }
      default:
        break;
    }
  }

  useEffect(() => {
    mounted.current = true;
    connect();

    // Reconnect when app comes back to foreground
    const sub = RNAppState.addEventListener('change', (state) => {
      if (state === 'active') connect();
    });

    return () => {
      mounted.current = false;
      sub.remove();
      if (retryTimer.current) clearTimeout(retryTimer.current);
      wsRef.current?.close();
    };
  }, [connect]);
}
