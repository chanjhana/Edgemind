import { useState } from 'react'
import { useAppState } from '../../core/store/AppContext.jsx'
import SeverityBadge from '../../components/ui/SeverityBadge.jsx'

export default function ActiveAlertsBanner() {
  const { pumpAlerts } = useAppState()
  const [open, setOpen] = useState(true)

  const activeAlerts = pumpAlerts.slice(0, 10)
  if (activeAlerts.length === 0) return null

  const critCount = activeAlerts.filter(a => a.severity === 'critical').length

  return (
    <div style={{ background: critCount > 0 ? 'var(--color-danger-tint)' : 'var(--color-warning-tint)', borderBottom: '1px solid var(--color-border-card)' }}>
      <div
        onClick={() => setOpen(o => !o)}
        style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 16px', cursor: 'pointer' }}
      >
        <span style={{ fontSize: 10, color: critCount > 0 ? 'var(--color-danger)' : 'var(--color-warning)', fontWeight: 700 }}>
          â–² {activeAlerts.length} ACTIVE ALERT{activeAlerts.length !== 1 ? 'S' : ''}
        </span>
        {critCount > 0 && <span style={{ fontSize: 10, color: 'var(--color-danger)' }}>{critCount} critical</span>}
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 10, color: 'var(--color-text-tertiary)' }}>{open ? 'collapse' : 'expand'}</span>
      </div>

      {open && (
        <div style={{ display: 'flex', gap: 8, padding: '4px 16px 8px', flexWrap: 'wrap' }}>
          {activeAlerts.map((a, i) => (
            <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 11, background: 'var(--color-bg-surface)', borderRadius: 4, padding: '3px 8px' }}>
              <SeverityBadge severity={a.severity || 'warning'} />
              <span style={{ color: 'var(--color-text-primary)' }}>{a.pump_id || a.pump || '—'}</span>
              <span style={{ color: 'var(--color-text-tertiary)' }}>·</span>
              <span style={{ color: 'var(--color-text-secondary)' }}>{a.fault_mode || a.anomaly_type || '—'}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
