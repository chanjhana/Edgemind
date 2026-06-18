import { useAppState } from '../../core/store/AppContext.jsx'

export default function PodEventLog({ podName }) {
  const { podEvents } = useAppState()
  const events = (podEvents || []).filter(e => !podName || e.pod === podName).slice(0, 20)

  if (events.length === 0) {
    return (
      <div style={{ padding: '8px 0', fontSize: 11, color: 'var(--color-text-tertiary)' }}>
        No K8s events — pod_event stream not yet implemented
      </div>
    )
  }

  return (
    <div>
      <div style={{ fontSize: 10, color: 'var(--color-text-tertiary)', fontWeight: 700, marginBottom: 6 }}>POD EVENTS</div>
      {events.map((e, i) => (
        <div key={i} style={{ fontSize: 11, padding: '3px 0', borderBottom: '1px solid var(--color-border-card)' }}>
          <span style={{ color: e.type === 'Warning' ? 'var(--color-warning)' : 'var(--color-text-tertiary)', marginRight: 6 }}>{e.type}</span>
          <span style={{ color: 'var(--color-text-secondary)' }}>{e.reason}: {e.message}</span>
        </div>
      ))}
    </div>
  )
}
