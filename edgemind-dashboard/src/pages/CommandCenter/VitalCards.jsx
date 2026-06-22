import { useMemo } from 'react'
import { useAppState } from '../../core/store/AppContext.jsx'
import { LAYERS, MONITORING_LAYER } from '../../core/constants/topology.js'
import { countActiveCorrelations, latestActiveCorrelation } from '../../core/selectors/correlations.js'
import { useNow } from '../../core/hooks/useNow.js'

const ALL_PODS = [...LAYERS.flat(), ...MONITORING_LAYER]

function podIsCritical(findings, podName) {
  return findings.some(f => f.pod === podName && f.severity === 'critical')
}

function relTime(ts) {
  if (!ts) return '—'
  const diff = Math.round((Date.now() - new Date(ts)) / 1000)
  if (diff < 60) return `${diff}s ago`
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  return `${Math.floor(diff / 3600)}h ago`
}

function VitalCard({ label, value, sub, accent, borderAccent }) {
  return (
    <div style={{
      flex: 1,
      background: 'var(--color-bg-card)',
      border: `1px solid ${borderAccent || 'var(--color-border-secondary)'}`,
      borderRadius: 6,
      padding: '12px 16px',
      display: 'flex',
      flexDirection: 'column',
      gap: 4,
      minWidth: 0,
    }}>
      <div style={{
        fontSize: 10, fontWeight: 700, letterSpacing: '0.06em',
        color: 'var(--color-text-tertiary)', textTransform: 'uppercase',
      }}>
        {label}
      </div>
      <div style={{
        fontSize: 24, fontWeight: 700, lineHeight: 1,
        color: accent || 'var(--color-text-primary)',
      }}>
        {value ?? '—'}
      </div>
      {sub && (
        <div style={{ fontSize: 11, color: 'var(--color-text-secondary)', marginTop: 2 }}>
          {sub}
        </div>
      )}
    </div>
  )
}

export default function VitalCards() {
  const { correlatedAlerts, findings, pvcs } = useAppState()
  const now = useNow(5000)

  const activeAlertCount = useMemo(
    () => countActiveCorrelations(correlatedAlerts, findings, now),
    [correlatedAlerts, findings, now]
  )

  const activeIncident = useMemo(
    () => latestActiveCorrelation(correlatedAlerts, findings, now),
    [correlatedAlerts, findings, now]
  )

  const { healthy, total } = useMemo(() => {
    let h = 0
    ALL_PODS.forEach(pod => { if (!podIsCritical(findings, pod)) h++ })
    return { healthy: h, total: ALL_PODS.length }
  }, [findings])

  const pvc2Fill = pvcs['export-data']?.fill_pct

  const pvc2Accent = pvc2Fill == null
    ? 'var(--color-text-primary)'
    : pvc2Fill >= 80 ? 'var(--color-danger)'
    : pvc2Fill >= 60 ? 'var(--color-warning)'
    : 'var(--color-success)'

  return (
    <div style={{ display: 'flex', gap: 12 }}>
      <VitalCard
        label="Active Correlated Alerts"
        value={activeAlertCount}
        sub={activeAlertCount === 0 ? 'All clear' : `${activeAlertCount} unresolved`}
        accent={activeAlertCount > 0 ? 'var(--color-danger)' : 'var(--color-success)'}
        borderAccent={activeAlertCount > 0 ? 'var(--color-danger-border)' : undefined}
      />
      <VitalCard
        label="Pods Healthy / Total"
        value={`${healthy} / ${total}`}
        sub={healthy === total ? 'All pods nominal' : `${total - healthy} in critical state`}
        accent={healthy === total ? 'var(--color-success)' : 'var(--color-warning)'}
        borderAccent={healthy < total ? 'var(--color-warning-border)' : undefined}
      />
      <VitalCard
        label="PVC-2 Utilisation"
        value={pvc2Fill != null ? `${pvc2Fill}%` : '—'}
        sub="export-data volume"
        accent={pvc2Accent}
        borderAccent={pvc2Fill != null && pvc2Fill >= 80 ? 'var(--color-danger-border)' : undefined}
      />
      <VitalCard
        label="Last AI Insight"
        value={activeIncident?.timestamp ? relTime(activeIncident.timestamp) : '—'}
        sub={activeIncident?.alert_type || 'No active incident'}
        accent="var(--color-info)"
      />
    </div>
  )
}
