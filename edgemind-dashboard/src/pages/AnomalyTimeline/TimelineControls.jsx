const EVENT_TYPES = [
  'cpu_spike', 'cpu_throttle', 'memory_leak', 'pre_oom', 'oomkill_detected',
  'io_saturation', 'write_burst', 'pvc_fill', 'network_flood', 'crash_loop',
  'log_error_surge', 'data_stale', 'pump_health_critical', 'correlated_alert',
]

export default function TimelineControls({
  windowMs, setWindowMs,
  typeFilter, setTypeFilter,
  nsFilter, setNsFilter,
  paused, setPaused,
  panOffsetMs, setPanOffsetMs,
}) {
  const windows = [
    { label: '15 min', ms: 15 * 60 * 1000 },
    { label: '30 min', ms: 30 * 60 * 1000 },
    { label: '1 hr',   ms: 60 * 60 * 1000 },
    { label: '6 hr',   ms: 6 * 60 * 60 * 1000 },
  ]
  const zoomMinutes = Math.round(windowMs / 60000)
  const isLive = !paused && panOffsetMs === 0

  const buttonStyle = active => ({
    fontSize: 11, padding: '3px 10px', borderRadius: 4, cursor: 'pointer',
    background: active ? 'var(--color-info)' : 'transparent',
    color: active ? '#fff' : 'var(--color-text-secondary)',
    border: `1px solid ${active ? 'var(--color-info)' : 'var(--color-border-primary)'}`,
  })

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10, padding: '6px 16px',
      borderBottom: '1px solid var(--color-border-card)',
      background: 'var(--color-bg-surface)', flexWrap: 'wrap',
    }}>
      {/* Title + live indicator */}
      <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--color-text-primary)', marginRight: 2 }}>Anomaly Timeline</span>
      <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11 }}>
        <span className={isLive ? 'animate-blink' : ''} style={{
          width: 7, height: 7, borderRadius: '50%',
          background: isLive ? 'var(--color-success)' : 'var(--color-text-tertiary)',
          display: 'inline-block', flexShrink: 0,
        }} />
        <span style={{ color: isLive ? 'var(--color-success)' : 'var(--color-text-tertiary)' }}>
          {isLive ? 'Live' : 'Paused'}
        </span>
      </span>

      {/* Time window buttons */}
      <div style={{ display: 'flex', gap: 2 }}>
        {windows.map(w => (
          <button key={w.ms} onClick={() => setWindowMs(w.ms)} style={buttonStyle(windowMs === w.ms)}>
            {w.label}
          </button>
        ))}
      </div>

      {/* Zoom slider */}
      <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--color-text-secondary)' }}>
        Zoom
        <input
          type="range"
          min="1"
          max="360"
          value={Math.min(360, Math.max(1, zoomMinutes))}
          onChange={e => setWindowMs(Number(e.target.value) * 60 * 1000)}
          style={{ width: 100 }}
        />
        <span style={{ color: 'var(--color-text-tertiary)', width: 40 }}>{zoomMinutes}m</span>
      </label>

      {/* Event type filter */}
      <select
        value={typeFilter}
        onChange={e => setTypeFilter(e.target.value)}
        style={{
          background: 'var(--color-bg-input)', color: 'var(--color-text-primary)',
          border: '1px solid var(--color-border-primary)', borderRadius: 4, padding: '3px 8px', fontSize: 11,
        }}
      >
        <option value="all">All event types</option>
        {EVENT_TYPES.map(type => <option key={type} value={type}>{type}</option>)}
      </select>

      {/* Namespace filter */}
      <select
        value={nsFilter}
        onChange={e => setNsFilter(e.target.value)}
        style={{
          background: 'var(--color-bg-input)', color: 'var(--color-text-primary)',
          border: '1px solid var(--color-border-primary)', borderRadius: 4, padding: '3px 8px', fontSize: 11,
        }}
      >
        <option value="">All namespaces</option>
        <option value="pump-station">pump-station</option>
        <option value="monitoring">monitoring</option>
      </select>

      {/* Live / Pause toggle */}
      <button
        onClick={() => {
          if (!paused) window.__timelinePauseTs = Date.now() - panOffsetMs
          setPaused(p => !p)
        }}
        style={{
          fontSize: 11, padding: '3px 10px', borderRadius: 4, cursor: 'pointer',
          background: paused ? 'var(--color-warning-tint)' : 'transparent',
          color: paused ? 'var(--color-warning)' : 'var(--color-text-secondary)',
          border: `1px solid ${paused ? 'var(--color-warning)' : 'var(--color-border-primary)'}`,
        }}
      >
        {paused ? 'â–¶ Resume' : 'â¸ Pause'}
      </button>

      {/* Pan buttons */}
      <div style={{ display: 'flex', gap: 4 }}>
        <button onClick={() => setPanOffsetMs(v => v + 5 * 60 * 1000)} style={buttonStyle(false)}>
          â† Back 5m
        </button>
        <button
          onClick={() => setPanOffsetMs(v => Math.max(0, v - 5 * 60 * 1000))}
          disabled={panOffsetMs === 0}
          style={{ ...buttonStyle(false), cursor: panOffsetMs === 0 ? 'not-allowed' : 'pointer', opacity: panOffsetMs === 0 ? 0.45 : 1 }}
        >
          Forward 5m →
        </button>
        {panOffsetMs > 0 && (
          <button onClick={() => { setPanOffsetMs(0); setPaused(false) }} style={buttonStyle(true)}>
            Live edge
          </button>
        )}
      </div>
    </div>
  )
}
