import { useNavigate } from 'react-router-dom'
import { useAppState } from '../../core/store/AppContext.jsx'
import { POD_ROLES, POD_NAMESPACES } from '../../core/constants/pods.js'
import { UPSTREAM, DOWNSTREAM } from '../../core/constants/topology.js'
import MetricTabs from '../../components/charts/MetricTabs.jsx'
import SeverityBadge from '../../components/ui/SeverityBadge.jsx'
import AgentTag from '../../components/ui/AgentTag.jsx'
import PanelHeader from '../../components/ui/PanelHeader.jsx'

const PUMP_DOMAIN_PODS = new Set(['health-scorer', 'feature-extractor', 'alert-manager'])

function MiniGaugeBar({ label, value, max = 1, color = 'var(--color-info)' }) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0
  return (
    <div style={{ marginBottom: 4 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
        <span style={{ fontSize: 9, color: 'var(--color-text-tertiary)' }}>{label}</span>
        <span style={{ fontSize: 9, color }}>{typeof value === 'number' ? value.toFixed(2) : '—'}</span>
      </div>
      <div style={{ height: 4, background: 'rgba(0,0,0,0.08)', borderRadius: 2 }}>
        <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 2 }} />
      </div>
    </div>
  )
}

function fmtBytes(b) {
  if (b == null) return '—'
  if (b >= 1e9) return `${(b / 1e9).toFixed(1)} GB`
  if (b >= 1e6) return `${(b / 1e6).toFixed(0)} MB`
  return `${b} B`
}

function PvcDrawer({ podName, pvcs, findings, onClose }) {
  const pvcKey = podName.replace(/^pvc-/, '')
  const pvc = pvcs[pvcKey] || {}
  const fill = pvc.fill_pct
  const pvcFindings = findings.filter(f => f.pvc_name === pvcKey).slice(0, 5)
  const fillColor = fill == null ? 'var(--color-text-tertiary)'
    : fill >= 85 ? 'var(--color-danger)'
    : fill >= 70 ? 'var(--color-warning)'
    : 'var(--color-success)'

  return (
    <div style={drawerShell}>
      <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--color-border-card)', display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-text-primary)' }}>{pvcKey}</div>
          <div style={{ fontSize: 10, color: 'var(--color-text-tertiary)', marginTop: 1 }}>persistent volume claim</div>
        </div>
        <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: 'var(--color-text-secondary)', cursor: 'pointer', fontSize: 16 }}>✕</button>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: 14, display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div>
          <PanelHeader title="Capacity" style={{ marginBottom: 6 }} />
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginBottom: 4 }}>
            <span style={{ color: 'var(--color-text-tertiary)' }}>Fill</span>
            <span style={{ color: fillColor, fontWeight: 700 }}>{fill != null ? `${fill}%` : '—'}</span>
          </div>
          <div style={{ height: 6, background: 'var(--color-border-secondary)', borderRadius: 3, overflow: 'hidden' }}>
            <div style={{ width: `${fill || 0}%`, height: '100%', background: fillColor, borderRadius: 3, transition: 'width 0.4s' }} />
          </div>
          <div style={{ fontSize: 10, color: 'var(--color-text-tertiary)', marginTop: 6 }}>
            {fmtBytes(pvc.used)} / {fmtBytes(pvc.capacity)} used
          </div>
          {pvc.ttf_minutes != null && (
            <div style={{ fontSize: 10, color: 'var(--color-warning)', marginTop: 3 }}>
              Est. time to full: {pvc.ttf_minutes} min
            </div>
          )}
        </div>

        {pvcFindings.length > 0 && (
          <div>
            <PanelHeader title="Storage Findings" style={{ marginBottom: 6 }} />
            {pvcFindings.map((f, i) => (
              <div key={i} style={{ padding: '5px 0', borderBottom: '1px solid var(--color-border-card)', display: 'flex', gap: 6, alignItems: 'center', fontSize: 11 }}>
                <SeverityBadge severity={f.severity} />
                <AgentTag agent={f.agent} />
                <span style={{ flex: 1, color: 'var(--color-text-secondary)' }}>{f.deviation || f.anomaly_type}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

export default function NodeDetailDrawer({ podName, onClose }) {
  const { findings, metrics, pumpAlerts, pvcs } = useAppState()
  const navigate = useNavigate()

  if (!podName) return null

  if (podName.startsWith('pvc-')) {
    return <PvcDrawer podName={podName} pvcs={pvcs} findings={findings} onClose={onClose} />
  }

  const role = POD_ROLES[podName] || ''
  const ns   = POD_NAMESPACES[podName] || 'unknown'
  const podFindings = findings.filter(f => f.pod === podName).slice(0, 5)
  const upstream   = UPSTREAM[podName]   || []
  const downstream = DOWNSTREAM[podName] || []

  const podMetrics = metrics[podName] || {}
  const restarts   = podMetrics.restarts ?? null

  // Latest pump alert for bearing health display
  const latestPumpAlert = PUMP_DOMAIN_PODS.has(podName) && pumpAlerts.length > 0
    ? pumpAlerts[0]
    : null

  return (
    <div style={{
      position: 'absolute', right: 16, top: 16, bottom: 16, width: 320,
      background: 'var(--color-bg-card)', borderRadius: 12,
      boxShadow: '0 4px 20px rgba(0,0,0,0.15)', border: '1px solid var(--color-border-card)',
      display: 'flex', flexDirection: 'column', zIndex: 20, overflow: 'hidden'
    }}>
      {/* Header */}
      <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--color-border-card)', display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-text-primary)' }}>{podName}</div>
          <div style={{ fontSize: 10, color: 'var(--color-text-tertiary)', marginTop: 1 }}>
            {ns} · {role.slice(0, 50)}{role.length > 50 ? '…' : ''}
          </div>
        </div>
        {restarts != null && restarts > 0 && (
          <span style={{
            fontSize: 9, padding: '1px 5px', borderRadius: 3,
            background: 'var(--color-danger-tint)', color: 'var(--color-danger)', fontWeight: 700,
          }}>
            {restarts} restart{restarts !== 1 ? 's' : ''}
          </span>
        )}
        <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: 'var(--color-text-secondary)', cursor: 'pointer', fontSize: 16 }}>✕</button>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: 14, display: 'flex', flexDirection: 'column', gap: 14 }}>

        {/* Active findings */}
        {podFindings.length > 0 && (
          <div>
            <PanelHeader title="Active Findings" style={{ marginBottom: 6 }} />
            {podFindings.map((f, i) => (
              <div key={i} style={{ padding: '5px 0', borderBottom: '1px solid var(--color-border-card)' }}>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 11 }}>
                  <SeverityBadge severity={f.severity} />
                  <AgentTag agent={f.agent} />
                  <span style={{ flex: 1, color: 'var(--color-text-secondary)' }}>{f.anomaly_type}</span>
                </div>
                {(f.deviation != null || f.baseline_value != null) && (
                  <div style={{ marginTop: 3, fontSize: 9, color: 'var(--color-text-tertiary)', paddingLeft: 4 }}>
                    {f.baseline_value != null && `baseline: ${typeof f.baseline_value === 'number' ? f.baseline_value.toFixed(3) : f.baseline_value}`}
                    {f.deviation != null && `  deviation: ${typeof f.deviation === 'number' ? (f.deviation > 0 ? '+' : '') + f.deviation.toFixed(3) : f.deviation}`}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Bearing / pump health (only for pump-domain pods) */}
        {latestPumpAlert && (
          <div>
            <PanelHeader title={`Pump Health · ${latestPumpAlert.pump_id?.toUpperCase()}`} style={{ marginBottom: 6 }} />
            <MiniGaugeBar
              label="Overall health"
              value={latestPumpAlert.overall_health}
              max={100}
              color={latestPumpAlert.overall_health >= 75 ? 'var(--color-success)' : latestPumpAlert.overall_health >= 50 ? 'var(--color-warning)' : 'var(--color-danger)'}
            />
            <MiniGaugeBar label="Vibration score" value={latestPumpAlert.vibration_score} max={1} color="var(--color-warning)" />
            <MiniGaugeBar label="Thermal score"   value={latestPumpAlert.thermal_score}   max={1} color="var(--color-danger)" />
            <div style={{ fontSize: 9, color: 'var(--color-text-tertiary)', marginTop: 4 }}>
              State: <span style={{ color: 'var(--color-text-secondary)', fontWeight: 600 }}>{latestPumpAlert.state}</span>
              {latestPumpAlert.trigger && (
                <span style={{ marginLeft: 8 }}>Trigger: {latestPumpAlert.trigger.replace(/_/g, ' ')}</span>
              )}
            </div>
          </div>
        )}

        {/* Metrics */}
        <div>
          <PanelHeader title="Metrics" style={{ marginBottom: 4 }} />
          <MetricTabs podName={podName} layout="column" />
        </div>

        {/* Topology */}
        {(upstream.length > 0 || downstream.length > 0) && (
          <div>
            <PanelHeader title="Topology" style={{ marginBottom: 6 }} />
            {upstream.length > 0 && (
              <div style={{ marginBottom: 4 }}>
                <span style={{ fontSize: 10, color: 'var(--color-text-tertiary)' }}>Upstream: </span>
                {upstream.map(p => (
                  <button key={p} onClick={() => navigate(`/graph?node=${p}`)}
                    style={{ fontSize: 11, color: 'var(--color-info)', marginRight: 4, background: 'transparent', border: 'none', padding: 0, cursor: 'pointer' }}>
                    {p}
                  </button>
                ))}
              </div>
            )}
            {downstream.length > 0 && (
              <div>
                <span style={{ fontSize: 10, color: 'var(--color-text-tertiary)' }}>Downstream: </span>
                {downstream.map(p => (
                  <button key={p} onClick={() => navigate(`/graph?node=${p}`)}
                    style={{ fontSize: 11, color: 'var(--color-info)', marginRight: 4, background: 'transparent', border: 'none', padding: 0, cursor: 'pointer' }}>
                    {p}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Footer actions */}
      <div style={{ padding: 14, borderTop: '1px solid var(--color-border-card)', display: 'flex', flexDirection: 'column', gap: 6 }}>
        <button
          onClick={() => navigate(`/radar?pod=${podName}`)}
          style={actionBtn('var(--color-info)', 'var(--color-info-tint)')}
        >
          View in Pod Stats
        </button>
        <button
          onClick={() => navigate(`/investigate?pod=${podName}`)}
          style={actionBtn('var(--color-info)', 'var(--color-info-tint)')}
        >
          Diagnose with AI
        </button>
        <button
          onClick={() => navigate('/timeline')}
          style={actionBtn('var(--color-info)', 'var(--color-info-tint)')}
        >
          View in Anomaly Timeline
        </button>
      </div>
    </div>
  )
}

function actionBtn(color, bg) {
  return {
    width: '100%', padding: '5px 0', borderRadius: 4, cursor: 'pointer',
    background: bg, color, border: `1px solid ${color}`, fontSize: 11,
  }
}

const drawerShell = {
  position: 'absolute', right: 16, top: 16, bottom: 16, width: 320,
  background: 'var(--color-bg-card)', borderRadius: 12,
  boxShadow: '0 4px 20px rgba(0,0,0,0.15)', border: '1px solid var(--color-border-card)',
  display: 'flex', flexDirection: 'column', zIndex: 20, overflow: 'hidden',
}
