import { useAppState } from '../../core/store/AppContext.jsx'
import SeverityBadge from '../../components/ui/SeverityBadge.jsx'
import ConfidenceTier from '../../components/ui/ConfidenceTier.jsx'

function fmtTs(isoStr) {
  if (!isoStr) return ''
  try { return new Date(isoStr).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) } catch { return '' }
}

export default function IncidentList({ selectedId, onSelect }) {
  const { correlatedAlerts } = useAppState()

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--color-border-card)', fontSize: 11, fontWeight: 700, color: 'var(--color-text-tertiary)' }}>
        INCIDENTS ({correlatedAlerts.length})
      </div>
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {correlatedAlerts.length === 0 && (
          <div style={{ padding: 12, fontSize: 11, color: 'var(--color-text-tertiary)' }}>No incidents yet</div>
        )}
        {correlatedAlerts.map((a, i) => {
          const id = a.id || i
          const selected = selectedId === id
          return (
            <div
              key={i}
              onClick={() => onSelect(id)}
              style={{
                padding: '8px 12px', cursor: 'pointer',
                background: selected ? 'var(--color-info-tint)' : 'transparent',
                borderBottom: '1px solid var(--color-border-card)',
                borderLeft: `3px solid ${selected ? 'var(--color-info)' : 'transparent'}`,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                <SeverityBadge severity={a.severity || 'critical'} />
                <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-text-primary)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {a.alert_type || 'Incident'}
                </span>
                <span style={{ fontSize: 10, color: 'var(--color-text-tertiary)' }}>{fmtTs(a.timestamp)}</span>
              </div>
              <div style={{ fontSize: 11, color: 'var(--color-text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {a.nlp_summary?.slice(0, 60) || a.root_cause_pod || '—'}
              </div>
              <ConfidenceTier value={a.confidence} compact />
            </div>
          )
        })}
      </div>
    </div>
  )
}
