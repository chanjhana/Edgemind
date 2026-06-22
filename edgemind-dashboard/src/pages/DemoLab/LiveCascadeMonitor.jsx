import { useMemo } from 'react'
import { useAppState } from '../../core/store/AppContext.jsx'
import PanelHeader from '../../components/ui/PanelHeader.jsx'
import { SCENARIOS } from '../../core/constants/faultModes.js'
import SeverityBadge from '../../components/ui/SeverityBadge.jsx'
import AgentTag from '../../components/ui/AgentTag.jsx'

const PIPELINE_TAIL = ['opc-ua-collector', 'data-historian', 'feature-extractor', 'health-scorer']
const PUMP_TO_SENSOR_SIM = { pump1: 'sensor-sim-1', pump2: 'sensor-sim-2', pump3: 'sensor-sim-3' }

// Thresholds for sensor reading trend bars
const SENSOR_PARAMS = [
  { key: 'vibration_axial',      label: 'Vib Axial',  unit: 'mm/s', baseline: 0.5,  warn: 1.5,  crit: 3.0,  max: 6.0  },
  { key: 'vibration_radial',     label: 'Vib Radial', unit: 'mm/s', baseline: 0.5,  warn: 2.0,  crit: 4.0,  max: 8.0  },
  { key: 'temperature',          label: 'Temperature', unit: '°C',  baseline: 35.0, warn: 50.0, crit: 60.0, max: 80.0 },
  { key: 'rpm',                  label: 'RPM',         unit: 'rpm', baseline: 1450, warn: 1200, crit: 900,  max: 1800 },
]

function paramColor(param, value) {
  if (value == null) return 'var(--color-text-tertiary)'
  if (param.key === 'rpm') {
    // RPM: lower is worse
    if (value < param.crit) return 'var(--color-danger)'
    if (value < param.warn) return 'var(--color-warning)'
    return 'var(--color-success)'
  }
  if (value >= param.crit) return 'var(--color-danger)'
  if (value >= param.warn) return 'var(--color-warning)'
  return 'var(--color-success)'
}

function SensorTrendBar({ param, value }) {
  if (value == null) return null
  const pct = Math.min(100, (value / param.max) * 100)
  const color = paramColor(param, value)
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, marginBottom: 5 }}>
      <div style={{ width: 82, color: 'var(--color-text-secondary)', flexShrink: 0 }}>{param.label}</div>
      <div style={{ flex: 1, height: 8, background: 'var(--color-border-secondary)', borderRadius: 4, overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 4, transition: 'width 0.4s' }} />
      </div>
      <div style={{ width: 78, color, fontVariantNumeric: 'tabular-nums', textAlign: 'right' }}>
        {Number(value).toFixed(1)} {param.unit}
      </div>
      <div style={{ width: 72, color: 'var(--color-text-tertiary)', fontSize: 10, textAlign: 'right' }}>
        base {param.baseline}
      </div>
    </div>
  )
}

function PodStatusBox({ podName, findings }) {
  const podFindings = findings.filter(f => f.pod === podName)
  const worst = podFindings.find(f => f.severity === 'critical') || podFindings.find(f => f.severity === 'warning')
  const health = worst?.severity === 'critical' ? 'critical' : worst?.severity === 'warning' ? 'warning' : 'healthy'
  const dotColor =
    health === 'critical' ? 'var(--color-danger)' :
    health === 'warning'  ? 'var(--color-warning)' :
    'var(--color-success)'
  const short = podName
    .replace('sensor-sim-', 'ss-')
    .replace('opc-ua-collector', 'opc')
    .replace('data-historian', 'dh')
    .replace('feature-extractor', 'fe')
    .replace('health-scorer', 'hs')
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, minWidth: 64 }}>
      <div style={{
        width: 48, height: 48, borderRadius: 6,
        background: 'var(--color-bg-surface)',
        border: `2px solid ${dotColor}`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 10, color: dotColor, fontWeight: 700, textAlign: 'center',
        padding: 2, lineHeight: 1.2,
        boxShadow: health !== 'healthy' ? `0 0 6px ${dotColor}44` : 'none',
      }}>
        {short}
      </div>
      {worst && (
        <div style={{ fontSize: 9, color: dotColor, textAlign: 'center', maxWidth: 64, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {worst.anomaly_type}
        </div>
      )}
    </div>
  )
}

function CheckRow({ label, checked }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 11, padding: '3px 0' }}>
      <span style={{
        width: 16, height: 16, borderRadius: 3, flexShrink: 0,
        background: checked ? 'var(--color-success)' : 'var(--color-bg-surface)',
        border: `1px solid ${checked ? 'var(--color-success)' : 'var(--color-border-primary)'}`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 10, color: '#fff', fontWeight: 900,
      }}>
        {checked ? '✓' : ''}
      </span>
      <span style={{ color: checked ? 'var(--color-text-primary)' : 'var(--color-text-tertiary)' }}>
        {label}
      </span>
    </div>
  )
}

function fmtElapsed(startedAt) {
  if (!startedAt) return null
  const s = Math.max(0, Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000))
  return `${Math.floor(s / 60)}m ${s % 60}s`
}

function fmtAgo(ts) {
  if (!ts) return ''
  const s = Math.max(0, Math.floor((Date.now() - new Date(ts).getTime()) / 1000))
  return s < 60 ? `${s}s ago` : `${Math.floor(s / 60)}m ${s % 60}s ago`
}

export default function LiveCascadeMonitor() {
  const { findings, metrics, correlatedAlerts, pumpAlerts, sensorReadings, demoLab } = useAppState()

  const activeScenario = demoLab.activeScenarioId
    ? SCENARIOS.find(s => s.id === demoLab.activeScenarioId)
    : null

  const startedAt = demoLab.scenarioStartedAt

  // Support both scenario-based and manual fault injection
  const activeFaults = demoLab.activeFaults || {}
  const manualFaultPump =
    Object.entries(activeFaults).find(([, v]) => v)?.[0] ||
    Object.entries(sensorReadings).find(([, r]) => r?.active_fault)?.[0] ||
    null
  const activePump   = activeScenario?.targetPump   || manualFaultPump
  const activeSensor = activeScenario?.targetSensor || (manualFaultPump ? PUMP_TO_SENSOR_SIM[manualFaultPump] : null)
  const sensorData   = activePump ? (sensorReadings[activePump] || {}) : {}

  const watchPods = activeSensor
    ? [activeSensor, ...PIPELINE_TAIL]
    : PIPELINE_TAIL

  // Findings scoped to scenario window (or last 20 if no scenario)
  const recentFindings = useMemo(() => {
    if (!startedAt) return findings.slice(0, 20)
    const cutoff = new Date(startedAt).getTime()
    return findings.filter(f => f.timestamp && new Date(f.timestamp).getTime() >= cutoff)
  }, [findings, startedAt])

  // Most recent correlated alert in scenario window
  const scenarioAlert = useMemo(() => {
    if (!startedAt) return correlatedAlerts[0] || null
    const cutoff = new Date(startedAt).getTime()
    return correlatedAlerts.find(a => a.timestamp && new Date(a.timestamp).getTime() >= cutoff) || null
  }, [correlatedAlerts, startedAt])

  // Latest health score per pump from pumpAlerts
  const pumpHealthMap = useMemo(() => {
    const map = {}
    pumpAlerts.forEach(a => {
      const pid = a.pump_id || a.pumpId
      if (!pid) return
      if (!map[pid] || new Date(a.timestamp) > new Date(map[pid].timestamp)) map[pid] = a
    })
    return map
  }, [pumpAlerts])

  // Detection scoreboard
  const scoreboard = useMemo(() => {
    const agentsFired = [...new Set(recentFindings.map(f => f.agent).filter(Boolean))]
    const alert       = scenarioAlert
    const chain       = alert?.causal_chain || []

    return {
      rootCauseFound:       !!alert,
      correctRootCausePod:  !!(alert && activeSensor && alert.root_cause_pod === activeSensor),
      multiAgentCorr:       agentsFired.length > 1,
      indirectDependency:   chain.length > 2,
      causalChainComplete:  chain.length > 0,
      confidenceHigh:       !!(alert && (alert.confidence || 0) >= 0.7),
      agentsFired,
      logBridgeOnly:
        agentsFired.length === 1 &&
        agentsFired[0] === 'network_log' &&
        recentFindings.some(f => f.anomaly_type === 'pump_health_critical'),
    }
  }, [recentFindings, scenarioAlert, activeSensor])

  const anyActiveFault =
    Object.values(demoLab.activeFaults || {}).some(Boolean) ||
    Object.values(sensorReadings).some(r => r?.active_fault)
  const elapsed = fmtElapsed(startedAt)

  // ── Idle state ────────────────────────────────────────────────────────
  if (!activeScenario && !anyActiveFault) {
    return (
      <div style={{ background: 'var(--color-bg-card)', borderRadius: 8, padding: 24, textAlign: 'center', border: '1px solid var(--color-border-card)' }}>
        <div style={{ fontSize: 28, marginBottom: 8, color: 'var(--color-success)' }}>✓</div>
        <div style={{ fontWeight: 700, color: 'var(--color-success)', fontSize: 14, marginBottom: 6 }}>System Nominal</div>
        <div style={{ fontSize: 12, color: 'var(--color-text-tertiary)' }}>
          All pumps operating at baseline. Select a scenario above to begin demo.
        </div>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}>
          <span style={{ display: 'inline-block', width: 3, height: 14, borderRadius: 2, background: 'var(--color-danger)', flexShrink: 0 }} />
          <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: '0.06em', color: 'var(--color-text-primary)', textTransform: 'uppercase' }}>Live Cascade Effect</span>
        </span>
        {elapsed && (
          <div style={{ fontSize: 11, color: 'var(--color-warning)', fontVariantNumeric: 'tabular-nums' }}>
            Elapsed: {elapsed}
          </div>
        )}
      </div>

      {/* ── Pipeline node row ─────────────────────────────────────────── */}
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
        {watchPods.map((pod, i) => (
          <div key={pod} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <PodStatusBox podName={pod} findings={recentFindings} />
            {i < watchPods.length - 1 && (
              <span style={{ fontSize: 14, color: 'var(--color-text-tertiary)' }}>→</span>
            )}
          </div>
        ))}
      </div>

      {/* ── Parameter Trends ──────────────────────────────────────────── */}
      {activePump && (
        <div style={{ background: 'var(--color-bg-surface)', borderRadius: 6, padding: 12 }}>
          <PanelHeader title={`Parameter Trends — ${activeSensor || activePump}`} style={{ marginBottom: 10 }} />
          {SENSOR_PARAMS.map(p => (
            <SensorTrendBar key={p.key} param={p} value={sensorData[p.key]} />
          ))}
          <div style={{ display: 'flex', gap: 16, marginTop: 8, fontSize: 10, color: 'var(--color-text-tertiary)' }}>
            {sensorData.emission_hz != null && (
              <span style={{ color: sensorData.emission_hz > 2 ? 'var(--color-danger)' : 'var(--color-text-tertiary)' }}>
                Emission: {sensorData.emission_hz} Hz
                {sensorData.emission_hz > 2 ? ' ⚡ FLOOD' : ' ● normal'}
              </span>
            )}
            {sensorData.active_fault && (
              <span style={{ color: 'var(--color-warning)' }}>
                Fault: {sensorData.active_fault}
                {sensorData.elapsed_s != null && ` · ${Math.floor(sensorData.elapsed_s / 60)}m ${Math.round(sensorData.elapsed_s % 60)}s`}
              </span>
            )}
          </div>
        </div>
      )}

      {/* ── Health Scorer Output ──────────────────────────────────────── */}
      {Object.keys(pumpHealthMap).length > 0 && (
        <div style={{ background: 'var(--color-bg-surface)', borderRadius: 6, padding: 12 }}>
          <PanelHeader title="Health Scorer Output" style={{ marginBottom: 8 }} />
          {Object.entries(pumpHealthMap).map(([pid, a]) => {
            const sev = a.severity || (
              (a.overall_health ?? 100) < 50 ? 'critical' :
              (a.overall_health ?? 100) < 75 ? 'warning' : 'healthy'
            )
            return (
              <div key={pid} style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 11, marginBottom: 5, flexWrap: 'wrap' }}>
                <span style={{ color: 'var(--color-text-secondary)', minWidth: 52 }}>{pid}</span>
                <SeverityBadge severity={sev} />
                {a.overall_health  != null && <span style={{ color: 'var(--color-text-tertiary)' }}>overall: <strong style={{ color: 'var(--color-text-primary)' }}>{Number(a.overall_health).toFixed(1)}</strong></span>}
                {a.bearing_health  != null && <span style={{ color: 'var(--color-text-tertiary)' }}>bearing: <strong style={{ color: 'var(--color-text-primary)' }}>{Number(a.bearing_health).toFixed(1)}</strong></span>}
                {(a.vibration_score ?? a.vib_score) != null && <span style={{ color: 'var(--color-text-tertiary)' }}>vib: <strong style={{ color: 'var(--color-text-primary)' }}>{Number(a.vibration_score ?? a.vib_score).toFixed(1)}</strong></span>}
                {(a.trigger || a.trigger_type)     && <span style={{ color: 'var(--color-warning)' }}>{a.trigger || a.trigger_type}</span>}
              </div>
            )
          })}
        </div>
      )}

      {/* ── EdgeMind Findings since injection ────────────────────────── */}
      {recentFindings.length > 0 && (
        <div style={{ background: 'var(--color-bg-surface)', borderRadius: 6, padding: 12 }}>
          <PanelHeader title={`EdgeMind Findings ${startedAt ? 'Since Injection' : '(Last 20)'}`} style={{ marginBottom: 8 }} />
          {recentFindings.slice(0, 10).map((f, i) => {
            const color =
              f.severity === 'critical' ? 'var(--color-danger)' :
              f.severity === 'warning'  ? 'var(--color-warning)' :
              'var(--color-success)'
            return (
              <div key={i} style={{
                display: 'flex', gap: 8, alignItems: 'center', fontSize: 11,
                padding: '4px 0', borderBottom: '1px solid var(--color-border-card)',
              }}>
                <span style={{ width: 7, height: 7, borderRadius: '50%', background: color, flexShrink: 0 }} />
                <span style={{ flex: 1, color: 'var(--color-text-secondary)' }}>{f.anomaly_type}</span>
                <span style={{ color: 'var(--color-text-tertiary)' }}>{f.pod}</span>
                <span style={{ color: 'var(--color-text-tertiary)', fontSize: 10, flexShrink: 0 }}>{fmtAgo(f.timestamp)}</span>
              </div>
            )
          })}
        </div>
      )}

      {/* ── Correlated Alert ─────────────────────────────────────────── */}
      <div style={{ background: 'var(--color-bg-surface)', borderRadius: 6, padding: 12 }}>
        <PanelHeader title="Correlated Alert" style={{ marginBottom: 8 }} />
        {!scenarioAlert ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--color-text-tertiary)', fontSize: 12 }}>
            <span style={{ fontSize: 16 }}>⏳</span>
            <span>Waiting for orchestrator analysis…</span>
          </div>
        ) : (
          <div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6, flexWrap: 'wrap' }}>
              <SeverityBadge severity={scenarioAlert.severity || 'warning'} />
              <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--color-text-primary)' }}>
                {scenarioAlert.alert_type}
              </span>
              {scenarioAlert.confidence != null && (
                <span style={{ fontSize: 11, color: 'var(--color-info)' }}>
                  conf: {(scenarioAlert.confidence * 100).toFixed(0)}%
                </span>
              )}
            </div>
            {scenarioAlert.root_cause_pod && (
              <div style={{ fontSize: 11, color: 'var(--color-text-secondary)', marginBottom: 4 }}>
                Root cause: <strong style={{ color: 'var(--color-text-primary)' }}>{scenarioAlert.root_cause_pod}</strong>
                {scenarioAlert.root_cause_metric && ` · ${scenarioAlert.root_cause_metric}`}
              </div>
            )}
            {scenarioAlert.nlp_summary && (
              <div style={{ fontSize: 11, color: 'var(--color-text-secondary)', lineHeight: 1.5, marginBottom: 6 }}>
                {scenarioAlert.nlp_summary}
              </div>
            )}
            {scenarioAlert.recommendation && (
              <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)', fontStyle: 'italic', borderLeft: '2px solid var(--color-info)', paddingLeft: 8 }}>
                → {scenarioAlert.recommendation}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Detection Scoreboard ─────────────────────────────────────── */}
      <div style={{ background: 'var(--color-bg-surface)', borderRadius: 6, padding: 12 }}>
        <PanelHeader title="Detection Scoreboard" style={{ marginBottom: 10 }} />
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2px 20px', marginBottom: 10 }}>
          <CheckRow label="Root cause found?"         checked={scoreboard.rootCauseFound} />
          <CheckRow label="Correct root cause pod?"   checked={scoreboard.correctRootCausePod} />
          <CheckRow label="Multi-agent correlation?"  checked={scoreboard.multiAgentCorr} />
          <CheckRow label="Indirect dependency shown?" checked={scoreboard.indirectDependency} />
          <CheckRow label="Causal chain complete?"    checked={scoreboard.causalChainComplete} />
          <CheckRow label="Confidence tier ≥ 0.7?"   checked={scoreboard.confidenceHigh} />
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {scoreboard.agentsFired.length > 0
            ? scoreboard.agentsFired.map(a => <AgentTag key={a} agent={a} />)
            : <span style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>No agents fired yet</span>
          }
        </div>
        {scoreboard.logBridgeOnly && (
          <div style={{
            marginTop: 8, fontSize: 11, color: 'var(--color-text-tertiary)', fontStyle: 'italic',
            padding: '6px 8px', background: 'var(--color-bg-card)', borderRadius: 4,
            borderLeft: '2px solid var(--color-warning)',
          }}>
            Detected via pump health log, not infra-level multi-agent correlation
          </div>
        )}
      </div>
    </div>
  )
}
