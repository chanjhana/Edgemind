import { useNavigate } from 'react-router-dom'
import { useAppState } from '../../core/store/AppContext.jsx'
import SeverityBadge from '../../components/ui/SeverityBadge.jsx'

function relTime(ts) {
  if (!ts) return ''
  const diff = Math.round((Date.now() - new Date(ts)) / 1000)
  if (diff < 60) return `${diff}s`
  if (diff < 3600) return `${Math.floor(diff / 60)}m`
  return `${Math.floor(diff / 3600)}h`
}

export default function RecentAlertsStrip() {
  const { pumpAlerts } = useAppState()
  const navigate = useNavigate()

  if (pumpAlerts.length === 0) return null

  const recent = pumpAlerts.slice(0, 8)

  return (
    <div style={{ background: 'var(--color-bg-card)', border: '1px solid var(--color-border-card)', borderRadius: 6, padding: '10px 12px' }}>
      <div style={{ fontSize: 10, color: 'var(--color-text-tertiary)', marginBottom: 8, fontWeight: 700 }}>
        PUMP STATION ALERTS
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {recent.map((alert, i) => (
          <div
            key={i}
            style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '5px 6px', borderRadius: 4, cursor: 'pointer',
              background: 'var(--color-bg-chip)',
              fontSize: 11,
            }}
            onClick={() => navigate('/investigate')}
          >
            <SeverityBadge severity={alert.severity || alert.state} />
            <span style={{ color: 'var(--color-text-primary)' }}>
              {alert.pump_id || alert.pump || 'Pump'}
            </span>
            <span style={{ color: 'var(--color-text-secondary)', flex: 1 }}>
              {alert.trigger_type || alert.type || ''}
            </span>
            <span style={{ color: 'var(--color-text-tertiary)' }}>
              {relTime(alert.timestamp || alert.received_at)}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
