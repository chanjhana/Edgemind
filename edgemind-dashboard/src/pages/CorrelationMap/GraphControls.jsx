import { useAppState } from '../../core/store/AppContext.jsx'
import { useDispatch } from '../../core/store/AppContext.jsx'

export default function GraphControls({
  showPvcEdges, setShowPvcEdges,
  showMonitoring, setShowMonitoring,
  onlyAnomalous, setOnlyAnomalous,
  scale, onScaleChange,
  onFit,
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
      height: 'var(--header-height)',
      borderBottom: '1px solid var(--color-border-card)',
      marginTop: 12,
      display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0,
      background: 'var(--color-bg-card)', position: 'relative',
      padding: '0 20px', flexWrap: 'wrap',
    }}>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, flexShrink: 0 }}>
        <span style={{ display: 'inline-block', width: 3, height: 14, borderRadius: 2, background: 'var(--color-danger)', flexShrink: 0 }} />
        <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.06em', color: 'var(--color-text-primary)', textTransform: 'uppercase' }}>
          Dependency Graph
        </span>
      </span>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {[
          ['PVC edges',       showPvcEdges,   setShowPvcEdges],
          ['Monitoring pods', showMonitoring, setShowMonitoring],
          ['Anomalous only',  onlyAnomalous,  setOnlyAnomalous],
        ].map(([label, val, setter]) => (
          <div key={label} onClick={() => setter(!val)} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, fontWeight: 600, color: val ? 'var(--color-info)' : 'var(--color-text-secondary)', cursor: 'pointer', background: val ? 'var(--color-info-tint)' : 'var(--color-bg-surface)', padding: '4px 10px', borderRadius: 16, border: `1px solid ${val ? 'var(--color-info)' : 'var(--color-border-card)'}`, transition: 'all 0.2s', userSelect: 'none' }}>
            <div style={{ width: 6, height: 6, borderRadius: '50%', background: val ? 'var(--color-info)' : 'var(--color-border-secondary)', transition: 'all 0.2s' }} />
            {label}
          </div>
        ))}
      </div>

      {/* Zoom controls */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0, marginLeft: 8 }}>
        <button onClick={() => onScaleChange(s => Math.min(2.0, parseFloat((s + 0.15).toFixed(2))))}
          style={zoomBtn}>+</button>
        <button onClick={() => onScaleChange(s => Math.max(0.4, parseFloat((s - 0.15).toFixed(2))))}
          style={zoomBtn}>−</button>
        <button onClick={onFit}
          style={{ ...zoomBtn, padding: '0 8px', fontSize: 10, width: 'auto', fontWeight: 700 }}>FIT</button>
        <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--color-text-tertiary)', minWidth: 32, textAlign: 'center', marginLeft: 4 }}>
          {Math.round(scale * 100)}%
        </span>
      </div>

      {/* Health counts (moved after zoom) */}
      <div style={{ display: 'flex', gap: 8, padding: '4px 10px', borderRadius: 16, background: 'var(--color-bg-surface)', border: '1px solid var(--color-border-card)', flexShrink: 0 }}>
        {criticalCount > 0 && chip(`● ${criticalCount} critical`, 'var(--color-danger)')}
        {warningCount  > 0 && chip(`◆ ${warningCount} warning`,  'var(--color-warning)')}
        {criticalCount === 0 && warningCount === 0 && chip('✓ nominal', 'var(--color-success)')}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginLeft: 'auto', flexShrink: 0 }}>
        {lastRebuild && (
          <span style={{ fontSize: 10, color: 'var(--color-text-tertiary)' }}>Last rebuild {lastRebuild}</span>
        )}
        <button
          onClick={handleRediscover}
          title="Polls the backend to instantly rebuild the dependency graph"
          style={{
            fontSize: 11, padding: '4px 12px', borderRadius: 6, cursor: 'pointer', fontWeight: 600,
            background: 'var(--color-info-tint)', color: 'var(--color-info)', border: '1px solid var(--color-info)',
            transition: 'all 0.2s'
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
  fontSize: 14, width: 26, height: 26, display: 'flex', alignItems: 'center', justifyContent: 'center',
  padding: 0, borderRadius: 6, cursor: 'pointer', fontWeight: 600,
  background: 'var(--color-bg-surface)', color: 'var(--color-text-primary)',
  border: '1px solid var(--color-border-card)',
  boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
  transition: 'all 0.2s',
}
