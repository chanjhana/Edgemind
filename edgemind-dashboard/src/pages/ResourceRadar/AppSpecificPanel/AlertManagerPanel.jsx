import { useNavigate } from 'react-router-dom'
import { useAppState } from '../../../core/store/AppContext.jsx'
import SeverityBadge from '../../../components/ui/SeverityBadge.jsx'
import PvcGauge from '../../../components/ui/PvcGauge.jsx'

function fmtTime(isoStr) {
  if (!isoStr) return ''
  try {
    return new Date(isoStr).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  } catch { return '' }
}

function ScoreChip({ label, value, flip = false }) {
  if (value == null) return null
  const pct = Math.min(100, Math.max(0, value))
  const ok = flip ? pct <= 30 : pct >= 70
  const mid = flip ? pct <= 60 : pct >= 40
  const color = ok ? 'var(--color-success)' : mid ? 'var(--color-warning)' : 'var(--color-danger)'
  return (
    <span style={{ fontSize: 10, padding: '1px 5px', borderRadius: 4, background: `${color}18`, color }}>
      {label}: {pct}
    </span>
  )
}

function AlertCard({ alert }) {
  const pumpLabel = alert.pump_id || alert.pump || '—'
  const faultMode = alert.fault_mode || alert.anomaly_type || alert.message || '—'
  const description = alert.description || null
  const recommendation = alert.recommended_action || null
  const overallHealth = alert.overall_health ?? null
  const vibScore = alert.vibration_score ?? null
  const thermalScore = alert.thermal_score ?? null

  const sev = alert.severity || 'info'
  const borderColor = sev === 'critical' ? 'var(--color-danger)' : sev === 'warning' ? 'var(--color-warning)' : 'var(--color-border-secondary)'

  return (
    <div style={{ border: `1px solid ${borderColor}`, borderRadius: 6, padding: '8px 10px', background: 'var(--color-bg-card)', boxShadow: '0 1px 3px var(--color-shadow)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 5 }}>
        <SeverityBadge severity={sev} />
        <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-primary)', fontFamily: 'monospace' }}>{pumpLabel}</span>
        <span style={{ fontSize: 11, color: 'var(--color-text-secondary)', flex: 1 }}>{faultMode}</span>
        <span style={{ fontSize: 10, color: 'var(--color-text-tertiary)' }}>{fmtTime(alert.timestamp)}</span>
      </div>

      {(overallHealth != null || vibScore != null || thermalScore != null) && (
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 5 }}>
          <ScoreChip label="Health" value={overallHealth} />
          <ScoreChip label="Vib" value={vibScore} />
          <ScoreChip label="Thermal" value={thermalScore} />
        </div>
      )}

      {description && (
        <div style={{ fontSize: 11, color: 'var(--color-text-secondary)', marginBottom: 4, lineHeight: 1.4 }}>{description}</div>
      )}
      {recommendation && (
        <div style={{ fontSize: 10, color: 'var(--color-info)', padding: '3px 6px', background: 'var(--color-info-tint)', borderRadius: 4, borderLeft: '2px solid var(--color-info)' }}>
          {recommendation}
        </div>
      )}
    </div>
  )
}

export default function AlertManagerPanel({ podName }) {
  const navigate = useNavigate()
  const { pumpAlerts, pvcs } = useAppState()
  const exportPvc = pvcs['export-data'] || {}
  const alerts = pumpAlerts.slice(0, 8)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, height: '100%', justifyContent: 'center' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        {alerts.length > 0 && (
          <button
            onClick={() => navigate('/investigate')}
            style={{
              fontSize: 10, padding: '2px 8px', borderRadius: 4, cursor: 'pointer',
              background: 'transparent', color: 'var(--color-info)',
              border: '1px solid var(--color-info)',
            }}
          >
            View All →
          </button>
        )}
      </div>

      {alerts.length === 0 && (
        <div style={{ fontSize: 12, color: 'var(--color-text-tertiary)', textAlign: 'center', padding: '12px 0' }}>No active alerts</div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {alerts.map((a, i) => <AlertCard key={i} alert={a} />)}
      </div>

      <div style={{ marginTop: 4 }}>
        <div style={{ fontSize: 10, color: 'var(--color-text-tertiary)', marginBottom: 6 }}>EXPORT STORAGE (PVC-2)</div>
        <PvcGauge
          pvcName="export-data"
          used={exportPvc.used}
          capacity={exportPvc.capacity}
          fillPct={exportPvc.fill_pct}
          consumers={['alert-manager', 'batch-sync']}
        />
      </div>
    </div>
  )
}
