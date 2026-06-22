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
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 11, marginBottom: 8 }}>
      <div style={{ width: 80, color: 'var(--color-text-secondary)', fontWeight: 600, flexShrink: 0 }}>{param.label}</div>
      <div style={{ flex: 1, height: 6, background: 'var(--color-bg-surface)', borderRadius: 3, overflow: 'hidden', border: '1px solid var(--color-border-card)' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 3, transition: 'width 0.4s cubic-bezier(0.25, 1, 0.5, 1)' }} />
      </div>
      <div style={{ width: 60, color, fontVariantNumeric: 'tabular-nums', textAlign: 'right', fontWeight: 800 }}>
        {Number(value).toFixed(1)} <span style={{ fontSize: 9, fontWeight: 600, opacity: 0.7 }}>{param.unit}</span>
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
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, minWidth: 64 }}>
      <div style={{
        width: 52, height: 52, borderRadius: 8,
        background: 'var(--color-bg-surface)',
        border: `2px solid ${dotColor}`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 12, color: dotColor, fontWeight: 800, textAlign: 'center',
        padding: 4, lineHeight: 1.2,
        boxShadow: health !== 'healthy' ? `0 0 12px ${dotColor}44` : '0 2px 4px var(--color-shadow)',
        transition: 'all 0.3s'
      }}>
        {short}
      </div>
      {worst && (
        <div style={{ fontSize: 9, color: dotColor, fontWeight: 700, textAlign: 'center', maxWidth: 64, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {worst.anomaly_type}
        </div>
      )}
    </div>
  )
}

function CheckRow({ label, checked }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 11, padding: '4px 0' }}>
      <span style={{
        width: 16, height: 16, borderRadius: 4, flexShrink: 0,
        background: checked ? 'var(--color-success)' : 'var(--color-bg-surface)',
        border: `1px solid ${checked ? 'var(--color-success)' : 'var(--color-border-primary)'}`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 10, color: '#fff', fontWeight: 900,
        boxShadow: checked ? '0 1px 3px var(--color-success-tint)' : 'none'
      }}>
        {checked ? '✓' : ''}
      </span>
      <span style={{ color: checked ? 'var(--color-text-primary)' : 'var(--color-text-tertiary)', fontWeight: checked ? 600 : 400 }}>
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

function DashboardCard({ title, children, accentColor }) {
  return (
    <div style={{
      background: 'var(--color-bg-card)', borderRadius: 8, padding: 16,
      border: `1px solid ${accentColor ? accentColor : 'var(--color-border-card)'}`, 
      boxShadow: accentColor ? `0 4px 12px ${accentColor}22` : '0 2px 8px var(--color-shadow)',
      display: 'flex', flexDirection: 'column', gap: 12, height: '100%'
    }}>
      <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--color-text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
        {title}
      </div>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        {children}
      </div>
    </div>
  )
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
      <div style={{ background: 'var(--color-bg-card)', borderRadius: 8, padding: 32, textAlign: 'center', border: '1px solid var(--color-border-card)', boxShadow: '0 2px 8px var(--color-shadow)' }}>
        <div style={{ fontSize: 32, marginBottom: 8, color: 'var(--color-success)' }}>✓</div>
        <div style={{ fontWeight: 800, color: 'var(--color-success)', fontSize: 16, marginBottom: 6 }}>System Nominal</div>
        <div style={{ fontSize: 13, color: 'var(--color-text-tertiary)' }}>
          All pumps operating at baseline. Select a scenario above to begin demo.
        </div>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginTop: 8 }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}>
          <span style={{ display: 'inline-block', width: 3, height: 14, borderRadius: 2, background: 'var(--color-danger)', flexShrink: 0 }} />
          <span style={{ fontSize: 12, fontWeight: 800, letterSpacing: '0.06em', color: 'var(--color-text-primary)', textTransform: 'uppercase' }}>Live Cascade Effect</span>
        </span>
        {elapsed && (
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--color-warning)', fontVariantNumeric: 'tabular-nums', background: 'var(--color-warning-tint)', padding: '4px 10px', borderRadius: 12, border: '1px solid var(--color-warning)' }}>
            ⏱ Elapsed: {elapsed}
          </div>
        )}
      </div>

      {/* Pipeline node row */}
      <div style={{ display: 'flex', justifyContent: 'center', gap: 12, alignItems: 'center', flexWrap: 'wrap', background: 'var(--color-bg-card)', padding: '16px 20px', borderRadius: 8, border: '1px solid var(--color-border-card)', boxShadow: '0 2px 8px var(--color-shadow)' }}>
        {watchPods.map((pod, i) => (
          <div key={pod} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <PodStatusBox podName={pod} findings={recentFindings} />
            {i < watchPods.length - 1 && (
              <span style={{ fontSize: 16, color: 'var(--color-border-primary)', fontWeight: 300 }}>→</span>
            )}
          </div>
        ))}
      </div>

      {/* 2-Column Grid for Panels */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 16 }}>
        
        {/* LEFT COLUMN */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {activePump && (
            <DashboardCard title={`Parameter Trends — ${activeSensor || activePump}`}>
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
            </DashboardCard>
          )}

          {recentFindings.length > 0 && (
            <DashboardCard title={`EdgeMind Findings ${startedAt ? 'Since Injection' : '(Last 20)'}`}>
              {recentFindings.slice(0, 10).map((f, i) => {
                const color =
                  f.severity === 'critical' ? 'var(--color-danger)' :
                  f.severity === 'warning'  ? 'var(--color-warning)' :
                  'var(--color-success)'
                return (
                  <div key={i} style={{
                    display: 'flex', gap: 8, alignItems: 'center', fontSize: 11,
                    padding: '6px 0', borderBottom: '1px solid var(--color-border-card)',
                  }}>
                    <span style={{ width: 7, height: 7, borderRadius: '50%', background: color, flexShrink: 0 }} />
                    <span style={{ flex: 1, color: 'var(--color-text-secondary)', fontWeight: 600 }}>{f.anomaly_type}</span>
                    <span style={{ color: 'var(--color-text-tertiary)' }}>{f.pod}</span>
                    <span style={{ color: 'var(--color-text-tertiary)', fontSize: 10, flexShrink: 0 }}>{fmtAgo(f.timestamp)}</span>
                  </div>
                )
              })}
            </DashboardCard>
          )}
        </div>

        {/* RIGHT COLUMN */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <DashboardCard title="Correlated Alert" accentColor={scenarioAlert ? 'var(--color-warning)' : null}>
            {!scenarioAlert ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--color-text-tertiary)', fontSize: 12 }}>
                <span style={{ fontSize: 16 }} className="animate-pulse-dot">⏳</span>
                <span>Waiting for orchestrator analysis…</span>
              </div>
            ) : (
              <div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8, flexWrap: 'wrap' }}>
                  <SeverityBadge severity={scenarioAlert.severity || 'warning'} />
                  <span style={{ fontSize: 13, fontWeight: 800, color: 'var(--color-text-primary)' }}>
                    {scenarioAlert.alert_type}
                  </span>
                  {scenarioAlert.confidence != null && (
                    <span style={{ fontSize: 11, color: 'var(--color-info)', fontWeight: 700, padding: '2px 6px', background: 'var(--color-info-tint)', borderRadius: 12 }}>
                      conf: {(scenarioAlert.confidence * 100).toFixed(0)}%
                    </span>
                  )}
                </div>
                {scenarioAlert.root_cause_pod && (
                  <div style={{ fontSize: 11, color: 'var(--color-text-secondary)', marginBottom: 8 }}>
                    Root cause: <strong style={{ color: 'var(--color-text-primary)' }}>{scenarioAlert.root_cause_pod}</strong>
                    {scenarioAlert.root_cause_metric && ` · ${scenarioAlert.root_cause_metric}`}
                  </div>
                )}
                {scenarioAlert.nlp_summary && (
                  <div style={{ fontSize: 11, color: 'var(--color-text-secondary)', lineHeight: 1.5, marginBottom: 8, background: 'var(--color-bg-surface)', padding: 8, borderRadius: 6 }}>
                    {scenarioAlert.nlp_summary}
                  </div>
                )}
                {scenarioAlert.recommendation && (
                  <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)', fontStyle: 'italic', borderLeft: '2px solid var(--color-info)', paddingLeft: 10, marginTop: 4 }}>
                    → {scenarioAlert.recommendation}
                  </div>
                )}
              </div>
            )}
          </DashboardCard>

          <DashboardCard title="Detection Scoreboard">
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 20px', marginBottom: 12 }}>
              <CheckRow label="Root cause found?"         checked={scoreboard.rootCauseFound} />
              <CheckRow label="Correct root cause pod?"   checked={scoreboard.correctRootCausePod} />
              <CheckRow label="Multi-agent correlation?"  checked={scoreboard.multiAgentCorr} />
              <CheckRow label="Indirect dependency?"      checked={scoreboard.indirectDependency} />
              <CheckRow label="Causal chain complete?"    checked={scoreboard.causalChainComplete} />
              <CheckRow label="Confidence tier ≥ 0.7?"    checked={scoreboard.confidenceHigh} />
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
              <span style={{ fontSize: 9, fontWeight: 800, color: 'var(--color-text-tertiary)', letterSpacing: '0.05em' }}>AGENTS FIRED:</span>
              {scoreboard.agentsFired.length > 0
                ? scoreboard.agentsFired.map(a => <AgentTag key={a} agent={a} />)
                : <span style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>None</span>
              }
            </div>
            {scoreboard.logBridgeOnly && (
              <div style={{
                marginTop: 10, fontSize: 11, color: 'var(--color-warning)', fontStyle: 'italic',
                padding: '6px 10px', background: 'var(--color-warning-tint)', borderRadius: 4,
              }}>
                Detected via pump health log, not infra-level multi-agent correlation
              </div>
            )}
          </DashboardCard>

          {Object.keys(pumpHealthMap).length > 0 && (
            <DashboardCard title="Health Scorer Output">
              {Object.entries(pumpHealthMap).map(([pid, a]) => {
                const sev = a.severity || (
                  (a.overall_health ?? 100) < 50 ? 'critical' :
                  (a.overall_health ?? 100) < 75 ? 'warning' : 'healthy'
                )
                return (
                  <div key={pid} style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 11, padding: '6px 0', borderBottom: '1px solid var(--color-border-card)', flexWrap: 'wrap' }}>
                    <span style={{ color: 'var(--color-text-secondary)', minWidth: 52, fontWeight: 700 }}>{pid}</span>
                    <SeverityBadge severity={sev} />
                    {a.overall_health  != null && <span style={{ color: 'var(--color-text-tertiary)' }}>overall: <strong style={{ color: 'var(--color-text-primary)' }}>{Number(a.overall_health).toFixed(1)}</strong></span>}
                    {a.bearing_health  != null && <span style={{ color: 'var(--color-text-tertiary)' }}>bearing: <strong style={{ color: 'var(--color-text-primary)' }}>{Number(a.bearing_health).toFixed(1)}</strong></span>}
                    {(a.vibration_score ?? a.vib_score) != null && <span style={{ color: 'var(--color-text-tertiary)' }}>vib: <strong style={{ color: 'var(--color-text-primary)' }}>{Number(a.vibration_score ?? a.vib_score).toFixed(1)}</strong></span>}
                    {(a.trigger || a.trigger_type)     && <span style={{ color: 'var(--color-warning)' }}>{a.trigger || a.trigger_type}</span>}
                  </div>
                )
              })}
            </DashboardCard>
          )}
        </div>
      </div>
    </div>
  )
}
