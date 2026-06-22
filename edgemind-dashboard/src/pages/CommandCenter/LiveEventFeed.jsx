import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAppState } from '../../core/store/AppContext.jsx'
import { SEVERITY_COLORS } from '../../core/constants/colors.js'
import PanelHeader from '../../components/ui/PanelHeader.jsx'

// Band 4 — unified chronological stream merging agent findings, AI correlated
// alerts, and application pump alerts. Conveys the "live scanning" story.

function relTime(ts) {
  if (!ts) return ''
  const diff = Math.round((Date.now() - new Date(ts)) / 1000)
  if (diff < 60) return `${diff}s ago`
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  return `${Math.floor(diff / 3600)}h ago`
}

const KIND_LABEL = {
  finding: 'AGENT',
  alert:   'AI',
  pump:    'PUMP',
}

export default function LiveEventFeed() {
  const navigate = useNavigate()
  const { findings, correlatedAlerts, pumpAlerts } = useAppState()

  const events = useMemo(() => {
    const out = []

    findings.forEach(f => out.push({
      kind: 'finding',
      ts: f.timestamp,
      sev: f.severity || 'info',
      text: `${f.pod || 'pod'} — ${f.anomaly_type || 'anomaly'}`,
    }))

    correlatedAlerts.forEach(a => out.push({
      kind: 'alert',
      ts: a.timestamp,
      sev: a.severity || 'warning',
      text: `${a.alert_type || 'correlated alert'}${a.root_cause_pod ? ` · root cause ${a.root_cause_pod}` : ''}`,
    }))

    pumpAlerts.forEach(p => out.push({
      kind: 'pump',
      ts: p.timestamp || p.received_at,
      sev: (p.overall_health != null && p.overall_health < 50) ? 'critical' : 'warning',
      text: `${p.pump_id || p.pump || 'pump'} — ${p.trigger || p.trigger_type || p.state || 'health alert'}`,
    }))

    return out
      .filter(e => e.ts)
      .sort((x, y) => new Date(y.ts) - new Date(x.ts))
      .slice(0, 30)
  }, [findings, correlatedAlerts, pumpAlerts])

  return (
    <div style={{
      background: 'var(--color-bg-card)',
      border: '1.5px solid var(--color-border-card)',
      borderRadius: 6, padding: '10px 12px',
      display: 'flex', flexDirection: 'column', gap: 8,
      cursor: 'pointer',
    }}
      onClick={() => navigate('/timeline')}
      title="Click for full anomaly timeline"
    >
      <PanelHeader title="Live Active Event Feed" hint="chronological stream →" />
      {events.length === 0 ? (
        <div style={{ fontSize: 12, color: 'var(--color-text-tertiary)', padding: '10px 0', textAlign: 'center' }}>
          ✓ All clear — no events yet
        </div>
      ) : (
        <div style={{ maxHeight: 170, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
          {events.map((e, i) => {
            const color = SEVERITY_COLORS[e.sev] || SEVERITY_COLORS.info
            return (
              <div key={i} style={{
                display: 'flex', alignItems: 'center', gap: 8,
                fontSize: 11, padding: '3px 0',
                borderBottom: i < events.length - 1 ? '1px solid var(--color-border-secondary)' : 'none',
              }}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: color, flexShrink: 0 }} />
                <span style={{
                  fontSize: 8.5, fontWeight: 700, color: 'var(--color-text-tertiary)',
                  width: 40, flexShrink: 0,
                }}>{KIND_LABEL[e.kind]}</span>
                <span style={{
                  flex: 1, color: 'var(--color-text-secondary)', minWidth: 0,
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>{e.text}</span>
                <span style={{ fontSize: 10, color: 'var(--color-text-tertiary)', flexShrink: 0 }}>{relTime(e.ts)}</span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
