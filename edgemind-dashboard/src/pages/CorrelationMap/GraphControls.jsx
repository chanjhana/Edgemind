import { useAppState } from '../../core/store/AppContext.jsx'
import { useDispatch } from '../../core/store/AppContext.jsx'

export default function GraphControls({
  showPvcEdges, setShowPvcEdges,
  showMonitoring, setShowMonitoring,
  onlyAnomalous, setOnlyAnomalous,
  scale, onScaleChange,
}) {
  const { graph, findings } = useAppState()
  const dispatch = useDispatch()

  const lastRebuild = graph?.timestamp
    ? new Date(graph.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : null

  const criticalCount = findings.filter(f => f.severity === 'critical').length
  const warningCount  = findings.filter(f => f.severity === 'warning').length
  const healthyCount  = findings.filter(f => f.severity === 'info' || (f.severity !== 'critical' && f.severity !== 'warning')).length

  function handleRediscover() {
    fetch('/api/graph').then(r => r.json()).then(data => {
      dispatch({ type: 'GRAPH_UPDATE', payload: data })
    }).catch(() => {})
  }

  const chip = (label, color) => (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 3,
      fontSize: 10, color, fontWeight: 600,
    }}>{label}</span>
  )

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10, padding: '7px 14px',
      borderBottom: '1px solid var(--color-border-card)',
      background: 'var(--color-bg-surface)', flexWrap: 'wrap',
    }}>
      <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--color-text-primary)', flexShrink: 0 }}>
        Dependency Graph
      </span>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {[
          ['PVC edges',       showPvcEdges,   setShowPvcEdges],
          ['Monitoring pods', showMonitoring, setShowMonitoring],
          ['Anomalous only',  onlyAnomalous,  setOnlyAnomalous],
        ].map(([label, val, setter]) => (
          <label key={label} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--color-text-secondary)', cursor: 'pointer' }}>
            <input type="checkbox" checked={val} onChange={e => setter(e.target.checked)} />
            {label}
          </label>
        ))}
      </div>

      {/* Health counts */}
      <div style={{ display: 'flex', gap: 8, padding: '2px 8px', borderRadius: 4, background: 'var(--color-overlay)', flexShrink: 0 }}>
        {criticalCount > 0 && chip(`â— ${criticalCount} critical`, 'var(--color-danger)')}
        {warningCount  > 0 && chip(`â—† ${warningCount} warning`,  'var(--color-warning)')}
        {criticalCount === 0 && warningCount === 0 && chip('âœ“ nominal', 'var(--color-success)')}
      </div>

      {/* Zoom controls */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 3, flexShrink: 0 }}>
        <button onClick={() => onScaleChange(s => Math.min(2.0, parseFloat((s + 0.15).toFixed(2))))}
          style={zoomBtn}>+</button>
        <button onClick={() => onScaleChange(s => Math.max(0.4, parseFloat((s - 0.15).toFixed(2))))}
          style={zoomBtn}>âˆ’</button>
        <button onClick={() => onScaleChange(1.0)}
          style={{ ...zoomBtn, padding: '2px 6px', fontSize: 9, color: 'var(--color-text-tertiary)' }}>Fit</button>
        <span style={{ fontSize: 9, color: 'var(--color-text-tertiary)', minWidth: 28 }}>
          {Math.round(scale * 100)}%
        </span>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 'auto', flexShrink: 0 }}>
        {lastRebuild && (
          <span style={{ fontSize: 10, color: 'var(--color-text-tertiary)' }}>Last rebuild {lastRebuild}</span>
        )}
        <button
          onClick={handleRediscover}
          style={{
            fontSize: 11, padding: '3px 10px', borderRadius: 4, cursor: 'pointer',
            background: 'transparent', color: 'var(--color-info)', border: '1px solid var(--color-info)',
          }}
        >
          Rediscover
        </button>
      </div>

      {/* Legend */}
      <div style={{ display: 'flex', gap: 10, fontSize: 10, color: 'var(--color-text-tertiary)', flexShrink: 0 }}>
        <span><span style={{ display: 'inline-block', width: 16, borderTop: '2px solid var(--color-text-tertiary)', marginRight: 4, verticalAlign: 'middle' }} />pipeline</span>
        <span><span style={{ display: 'inline-block', width: 16, borderTop: '2px dashed var(--color-text-tertiary)', marginRight: 4, verticalAlign: 'middle' }} />shared PVC</span>
        <span><span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: 'var(--color-danger)', marginRight: 4, verticalAlign: 'middle' }} />critical</span>
        <span><span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: 'var(--color-warning)', marginRight: 4, verticalAlign: 'middle' }} />warning</span>
      </div>
    </div>
  )
}

const zoomBtn = {
  fontSize: 12, width: 22, height: 22, lineHeight: '20px',
  textAlign: 'center', padding: 0, borderRadius: 4, cursor: 'pointer',
  background: 'var(--color-overlay)', color: 'var(--color-text-secondary)',
  border: '1px solid var(--color-border-card)',
}
