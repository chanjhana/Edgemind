import * as A from './actions.js'

const MAX_FINDINGS = 200
const MAX_ALERTS   = 50
const ROLLING_PTS  = 30

const METRIC_SERIES = [
  'cpu_usage', 'cpu_throttle', 'mem_rss', 'mem_working_set',
  'net_tx', 'net_rx', 'fs_write', 'fs_read', 'fs_io_time',
]

const SCALAR_SERIES = ['cpu_limit', 'mem_limit', 'restarts']

export const initialState = {
  ws: { connected: false, status: 'connecting' },

  agentsReady: false,
  agentHeartbeats: { cpu: null, memory: null, storage: null, network_log: null },
  llmAvailable: true,

  // { [podName]: { cpu_usage: [...], mem_rss: [...], ..., cpu_limit: null, mem_limit: null } }
  metrics: {},

  sensorReadings: {},

  graph: { nodes: {}, edges: [] },
  graphLastRebuild: null,

  findings: [],

  correlatedAlerts: [],
  activeIncident: null,

  pumpAlerts: [],

  liveScores: {},

  podEvents: [],

  forecasts: {
    pvc2_ttf_minutes: null,
    pvc2_fill_rate_bytes_per_min: null,
    pvc2_used_bytes: null,
    pvc2_capacity_bytes: null,
    featureExtractor_oom_minutes: null,
    featureExtractor_rss_slope_mb_per_min: null,
    lastUpdated: null,
  },

  pvcs: {
    'historian-data':    { used: null, capacity: null, fill_pct: null },
    'export-data':       { used: null, capacity: null, fill_pct: null, ttf_minutes: null },
    'prometheus-tsdb':   { used: null, capacity: null, fill_pct: null },
  },

  demoLab: {
    activeScenarioId: null,
    completedScenarioId: null,
    scenarioStartedAt: null,
    scenarioSteps: [],
    activeFaults: { pump1: null, pump2: null, pump3: null },
  },

  selectedPod: null,
  selectedNamespaceFilter: 'all',
  selectedIncidentId: null,
  timelineWindow: '30m',
  timelineEventFilter: 'all',
  timelineNamespaceFilter: 'all',
  timelineLive: true,
}

function pushRolling(arr, val) {
  const next = [...arr, val]
  return next.length > ROLLING_PTS ? next.slice(next.length - ROLLING_PTS) : next
}

function updateMetricsPod(existing, podName, snapshot) {
  const prev = existing[podName] || {}
  const updated = { ...prev }

  METRIC_SERIES.forEach(key => {
    const val = snapshot[key] ?? null
    updated[key] = pushRolling(prev[key] || [], val)
  })

  SCALAR_SERIES.forEach(key => {
    if (snapshot[key] != null) updated[key] = snapshot[key]
  })

  return updated
}

function derivePvcState(pvcs, pvcData) {
  const next = { ...pvcs }
  Object.entries(pvcData).forEach(([pvcName, data]) => {
    const used = data.used_bytes ?? null
    const cap  = data.capacity_bytes ?? null
    const fill_pct = used != null && cap ? Math.round((used / cap) * 100) : null
    if (next[pvcName] !== undefined) {
      next[pvcName] = { ...next[pvcName], used, capacity: cap, fill_pct }
    }
  })
  return next
}

function derivePvc2Ttf(pvcs, prevForecasts) {
  const pvc2 = pvcs['export-data']
  if (!pvc2 || pvc2.used == null || !pvc2.capacity) return prevForecasts

  const free  = pvc2.capacity - pvc2.used
  const prev  = prevForecasts.pvc2_used_bytes

  let ttf = prevForecasts.pvc2_ttf_minutes
  let rate = prevForecasts.pvc2_fill_rate_bytes_per_min

  if (prev != null && pvc2.used > prev) {
    rate = (pvc2.used - prev) / (15 / 60)  // bytes per min (15s interval)
    if (rate > 0) ttf = Math.round(free / rate)
  }

  return {
    ...prevForecasts,
    pvc2_ttf_minutes: ttf,
    pvc2_fill_rate_bytes_per_min: rate,
    pvc2_used_bytes: pvc2.used,
    pvc2_capacity_bytes: pvc2.capacity,
    lastUpdated: new Date().toISOString(),
  }
}

function deriveFeatureExtractorOom(metrics, prevForecasts) {
  const feName = Object.keys(metrics).find(k => k === 'feature-extractor' || k.startsWith('feature-extractor-'))
  const fe = feName ? metrics[feName] : null
  if (!fe) return prevForecasts

  const rssArr = (fe.mem_rss || []).filter(v => v != null)
  if (rssArr.length < 4) return prevForecasts

  const memLimit = fe.mem_limit
  if (!memLimit) return prevForecasts

  // Use last min(10, n) points; each point is a 15 s scrape interval
  const window = rssArr.slice(Math.max(0, rssArr.length - 10))
  const intervals = window.length - 1
  if (intervals <= 0) return prevForecasts

  const slopePer15s = (window[window.length - 1] - window[0]) / intervals
  const slopeBytesPerMin = slopePer15s * 4          // 4 × 15 s = 1 min
  const slopeMbPerMin = slopeBytesPerMin / (1024 * 1024)

  // Only forecast when RSS is actively growing (> 0.05 MB/min)
  if (slopeMbPerMin <= 0.05) {
    return { ...prevForecasts, featureExtractor_oom_minutes: null, featureExtractor_rss_slope_mb_per_min: null }
  }

  const currentRss = window[window.length - 1]
  const freeBytes = memLimit - currentRss
  const oomMinutes = freeBytes > 0 ? Math.round(freeBytes / slopeBytesPerMin) : 0

  return {
    ...prevForecasts,
    featureExtractor_oom_minutes: oomMinutes,
    featureExtractor_rss_slope_mb_per_min: Math.round(slopeMbPerMin * 100) / 100,
    lastUpdated: new Date().toISOString(),
  }
}

function checkAgentsReady(heartbeats, findings) {
  const allAlive = ['cpu', 'memory', 'storage', 'network_log'].every(a => heartbeats[a] != null)
  return allAlive && findings.length > 0
}

export default function reducer(state, action) {
  switch (action.type) {
    case A.WS_STATUS:
      return { ...state, ws: { ...state.ws, ...action.payload } }

    case A.INITIAL_STATE: {
      const { recent_findings = [], recent_alerts = [], dependency_graph = {}, metrics: metricsSnap } = action.payload
      const alerts = recent_alerts.slice(0, MAX_ALERTS)
      let metrics = { ...state.metrics }
      if (metricsSnap?.pods) {
        Object.entries(metricsSnap.pods).forEach(([pod, snap]) => {
          if (snap) metrics[pod] = updateMetricsPod(metrics, pod, snap)
        })
      }
      const pvcs = metricsSnap?.pvcs ? derivePvcState(state.pvcs, metricsSnap.pvcs) : state.pvcs
      return {
        ...state,
        findings: recent_findings.slice(0, MAX_FINDINGS),
        correlatedAlerts: alerts,
        activeIncident: alerts.find(a => !a.resolved) || alerts[0] || null,
        graph: dependency_graph,
        graphLastRebuild: dependency_graph.timestamp || null,
        metrics,
        pvcs,
      }
    }

    case A.METRIC_UPDATE: {
      const { pods = {}, pvcs: pvcData = {} } = action.payload
      let metrics = { ...state.metrics }
      Object.entries(pods).forEach(([pod, snap]) => {
        metrics[pod] = updateMetricsPod(metrics, pod, snap)
      })
      const pvcs     = derivePvcState(state.pvcs, pvcData)
      const forecasts = deriveFeatureExtractorOom(metrics, derivePvc2Ttf(pvcs, state.forecasts))
      return { ...state, metrics, pvcs, forecasts }
    }

    case A.AGENT_FINDING: {
      const finding = action.payload
      const findings = [finding, ...state.findings].slice(0, MAX_FINDINGS)
      const agent = finding.agent
      const heartbeats = agent
        ? { ...state.agentHeartbeats, [agent]: finding.timestamp || new Date().toISOString() }
        : state.agentHeartbeats
      const agentsReady = state.agentsReady || checkAgentsReady(heartbeats, findings)
      return { ...state, findings, agentHeartbeats: heartbeats, agentsReady }
    }

    case A.CORRELATED_ALERT: {
      const alert = action.payload
      const correlatedAlerts = [alert, ...state.correlatedAlerts].slice(0, MAX_ALERTS)
      const activeIncident = correlatedAlerts.find(a => !a.resolved) || correlatedAlerts[0] || null
      const llmAvailable = alert.llm_available !== false
      return { ...state, correlatedAlerts, activeIncident, llmAvailable }
    }

    case A.AGENT_HEARTBEAT: {
      const { agent, timestamp } = action.payload
      const heartbeats = { ...state.agentHeartbeats, [agent]: timestamp }
      const agentsReady = state.agentsReady || checkAgentsReady(heartbeats, state.findings)
      return { ...state, agentHeartbeats: heartbeats, agentsReady }
    }

    case A.GRAPH_UPDATE:
      return {
        ...state,
        graph: action.payload,
        graphLastRebuild: action.payload.timestamp || new Date().toISOString(),
      }

    case A.PUMP_ALERTS_UPDATE:
      return { ...state, pumpAlerts: action.payload }

    case A.LIVE_SCORES_UPDATE: {
      const map = {}
      action.payload.forEach(s => { if (s.pump_id) map[s.pump_id] = s })
      return { ...state, liveScores: map }
    }

    case A.SENSOR_READINGS_UPDATE: {
      const { pumpId, data } = action.payload
      return { ...state, sensorReadings: { ...state.sensorReadings, [pumpId]: data } }
    }

    case A.SELECT_POD:
      return { ...state, selectedPod: action.payload }

    case A.SELECT_INCIDENT:
      return { ...state, selectedIncidentId: action.payload }

    case A.SET_TIMELINE_WINDOW:
      return { ...state, timelineWindow: action.payload }

    case A.SET_TIMELINE_FILTER:
      return { ...state, timelineEventFilter: action.payload }

    case A.SET_TIMELINE_NS_FILTER:
      return { ...state, timelineNamespaceFilter: action.payload }

    case A.SET_TIMELINE_LIVE:
      return { ...state, timelineLive: action.payload }

    case A.SET_NS_FILTER:
      return { ...state, selectedNamespaceFilter: action.payload }

    case A.SET_DEMO_SCENARIO:
      return { ...state, demoLab: { ...state.demoLab, ...action.payload } }

    case A.SET_ACTIVE_FAULT: {
      const { pump, fault } = action.payload
      return {
        ...state,
        demoLab: {
          ...state.demoLab,
          activeFaults: { ...state.demoLab.activeFaults, [pump]: fault },
        },
      }
    }

    case A.ALERTS_CLEARED:
      return { ...state, correlatedAlerts: [], activeIncident: null }

    default:
      return state
  }
}
