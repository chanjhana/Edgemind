import { useMemo } from 'react'
import { useAppState } from '../../core/store/AppContext.jsx'
import {
  LAYERS, MONITORING_LAYER, PVC_NODES,
  NODE_POSITIONS, SERVICE_EDGES, DATA_EDGES,
  CANVAS_WIDTH, CANVAS_HEIGHT,
} from '../../core/constants/topology.js'
import GraphNode from './GraphNode.jsx'
import GraphEdge, { GraphEdgeMarkers } from './GraphEdge.jsx'
import CausalPathOverlay from './CausalPathOverlay.jsx'

function podHealth(findings, podName) {
  const podFindings = findings.filter(f => f.pod === podName)
  if (podFindings.some(f => f.severity === 'critical')) return 'critical'
  if (podFindings.some(f => f.severity === 'warning'))  return 'warning'
  if (podFindings.length > 0)                           return 'healthy'
  return 'unknown'
}

export default function PipelineGraph({
  onNodeClick,
  showPvcEdges = true,
  showMonitoring = true,
  onlyAnomalous = false,
  scale = 1,
  width,
  height,
}) {
  const { findings, activeIncident, metrics, pvcs } = useAppState()

  const causalChain   = activeIncident?.causal_chain  || []
  const rootCausePod  = activeIncident?.root_cause_pod || null

  const allPods = useMemo(() => [...LAYERS.flat(), ...MONITORING_LAYER], [])
  const visiblePods = useMemo(() => (
    showMonitoring ? allPods : allPods.filter(pod => !MONITORING_LAYER.includes(pod))
  ), [allPods, showMonitoring])

  const podHealthMap = useMemo(() => {
    const map = {}
    allPods.forEach(pod => { map[pod] = podHealth(findings, pod) })
    return map
  }, [findings, allPods])

  const activeFindingPods = useMemo(() => new Set(findings.map(f => f.pod)), [findings])

  // Pods that should actually render when anomalous-only is active
  const visiblePodSet = useMemo(() => {
    const set = new Set()
    visiblePods.forEach(pod => {
      if (!onlyAnomalous || podHealthMap[pod] !== 'unknown' || causalChain.includes(pod)) {
        set.add(pod)
      }
    })
    return set
  }, [visiblePods, onlyAnomalous, podHealthMap, causalChain])

  const svgW = (width  || CANVAS_WIDTH)  * scale
  const svgH = (height || CANVAS_HEIGHT) * scale

  return (
    <svg
      width={svgW}
      height={svgH}
      viewBox={`0 0 ${width || CANVAS_WIDTH} ${height || CANVAS_HEIGHT}`}
      style={{ overflow: 'visible', fontFamily: 'inherit' }}
    >
      <GraphEdgeMarkers />

      {/* Dot-grid background */}
      <defs>
        <pattern id="pg-dot-grid" x="0" y="0" width="20" height="20" patternUnits="userSpaceOnUse">
          <circle cx="1" cy="1" r="0.8" fill="var(--color-text-tertiary)" opacity="0.12" />
        </pattern>
      </defs>
      <rect width={width || CANVAS_WIDTH} height={height || CANVAS_HEIGHT} fill="url(#pg-dot-grid)" />

      {/* Service edges — only render when both endpoints are visible */}
      {SERVICE_EDGES
        .filter(e => visiblePodSet.has(e.from) && visiblePodSet.has(e.to))
        .map((e, i) => (
          <GraphEdge
            key={`se-${i}`}
            fromPos={NODE_POSITIONS[e.from]}
            toPos={NODE_POSITIONS[e.to]}
            type="service"
            health={podHealthMap[e.from] || 'unknown'}
            isActive={causalChain.includes(e.from) && causalChain.includes(e.to)}
          />
        ))}

      {/* Data (PVC) edges — only render when source pod is visible */}
      {showPvcEdges && DATA_EDGES
        .filter(e => {
          if (!showMonitoring && MONITORING_LAYER.includes(e.from)) return false
          return visiblePodSet.has(e.from)
        })
        .map((e, i) => (
          <GraphEdge
            key={`de-${i}`}
            fromPos={NODE_POSITIONS[e.from]}
            toPos={NODE_POSITIONS[e.to]}
            type="shared-data"
            health="unknown"
            isActive={false}
          />
        ))}

      {/* Causal path overlay */}
      <CausalPathOverlay causalChain={causalChain} />

      {/* Pipeline pod nodes */}
      {visiblePods
        .filter(pod => visiblePodSet.has(pod))
        .map(pod => {
          const pos = NODE_POSITIONS[pod]
          if (!pos) return null
          const podMetrics = metrics[pod] || {}
          const cpuArr   = podMetrics.cpu_usage || []
          const cpuRate  = cpuArr.length ? cpuArr[cpuArr.length - 1] || 0 : 0
          const cpuLimit = podMetrics.cpu_limit || null
          const health   = podHealthMap[pod]
          return (
            <GraphNode
              key={pod}
              id={pod}
              label={pod}
              health={health}
              cpuRate={cpuRate}
              cpuLimit={cpuLimit}
              hasActiveFinding={activeFindingPods.has(pod)}
              isRootCause={pod === rootCausePod}
              isInCausalPath={causalChain.includes(pod)}
              isPvc={false}
              x={pos.x}
              y={pos.y}
              onClick={onNodeClick}
            />
          )
        })}

      {/* PVC nodes */}
      {PVC_NODES.map(pvc => {
        if (!showMonitoring && pvc.id === 'pvc-prometheus-tsdb') return null
        const pos = NODE_POSITIONS[pvc.id]
        if (!pos) return null
        const pvcState = pvcs[pvc.sublabel]
        const fillPct  = pvcState?.fill_pct ?? null
        return (
          <GraphNode
            key={pvc.id}
            id={pvc.id}
            label={pvc.label}
            sublabel={pvc.sublabel}
            health="unknown"
            isPvc={true}
            fillPct={fillPct}
            x={pos.x}
            y={pos.y}
            onClick={onNodeClick}
          />
        )
      })}
    </svg>
  )
}
