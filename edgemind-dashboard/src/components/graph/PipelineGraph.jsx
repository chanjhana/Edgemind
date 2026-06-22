import { useMemo, useState, useRef, useEffect } from 'react'
import { useAppState } from '../../core/store/AppContext.jsx'
import { findMetrics } from '../../core/selectors/podHealth.js'
import { latestActiveCorrelation } from '../../core/selectors/correlations.js'
import { useNow } from '../../core/hooks/useNow.js'
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
  fitTrigger = 0,
  width,
  height,
}) {
  const { findings, correlatedAlerts, metrics, pvcs } = useAppState()
  const now = useNow(5000)
  const activeIncident = useMemo(
    () => latestActiveCorrelation(correlatedAlerts, findings, now),
    [correlatedAlerts, findings, now]
  )

  // Panning state
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const isDragging = useRef(false)
  const lastMouse = useRef({ x: 0, y: 0 })

  useEffect(() => {
    if (fitTrigger > 0) setPan({ x: 0, y: 0 })
  }, [fitTrigger])

  const handleMouseDown = (e) => {
    isDragging.current = true
    lastMouse.current = { x: e.clientX, y: e.clientY }
  }

  const handleMouseMove = (e) => {
    if (!isDragging.current) return
    const dx = e.clientX - lastMouse.current.x
    const dy = e.clientY - lastMouse.current.y
    // Multiply by a factor so dragging feels 1:1. It depends on screen size, 
    // but dividing by scale makes panning speed consistent across zoom levels.
    setPan(p => ({ x: p.x + dx / scale, y: p.y + dy / scale }))
    lastMouse.current = { x: e.clientX, y: e.clientY }
  }

  const handleMouseUp = () => {
    isDragging.current = false
  }

  const causalChain   = activeIncident?.causal_chain  || []
  const rootCausePod  = activeIncident?.root_cause_pod || null

  // Prometheus uses full pod names; graph nodes use short deployment names.
  // Strip the two trailing k8s hash segments so matching works correctly.
  const toShortName = name => name.replace(/-[a-z0-9]+-[a-z0-9]+$/, '')
  const causalSet      = useMemo(() => new Set(causalChain.map(toShortName)), [causalChain])
  const rootCauseShort = rootCausePod ? toShortName(rootCausePod) : null

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
      if (!onlyAnomalous || podHealthMap[pod] !== 'unknown' || causalSet.has(pod)) {
        set.add(pod)
      }
    })
    return set
  }, [visiblePods, onlyAnomalous, podHealthMap, causalChain])

  // Calculate bounding box dynamically so the graph perfectly centers.
  // The layout's max column is 5 (x=690). Plus node width (~72px), the rightmost edge is ~762.
  const minX = -50
  const maxX = 780
  const minY = -40
  const maxY = showMonitoring ? 420 : 320
  
  const cx = (minX + maxX) / 2
  const cy = (minY + maxY) / 2
  
  const vbWidth = (maxX - minX) / scale
  const vbHeight = (maxY - minY) / scale
  
  // Subtract pan to move the view
  const vX = cx - vbWidth / 2 - pan.x
  const vY = cy - vbHeight / 2 - pan.y

  return (
    <svg
      width="100%"
      height="100%"
      viewBox={`${vX} ${vY} ${vbWidth} ${vbHeight}`}
      style={{ overflow: 'hidden', fontFamily: 'inherit', cursor: isDragging.current ? 'grabbing' : 'grab' }}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
    >
      <GraphEdgeMarkers />

      {/* Dot-grid background */}
      <defs>
        <pattern id="pg-dot-grid" x="0" y="0" width="20" height="20" patternUnits="userSpaceOnUse">
          <circle cx="1" cy="1" r="0.8" fill="var(--color-text-tertiary)" opacity="0.12" />
        </pattern>
      </defs>
      {/* Massive rect to ensure the dot grid covers the entire visible area regardless of scaling */}
      <rect x={vX - 5000} y={vY - 5000} width={10000} height={10000} fill="url(#pg-dot-grid)" />

      {/* Service edges — only render when both endpoints are visible */}
      {SERVICE_EDGES
        .filter(e => visiblePodSet.has(e.from) && visiblePodSet.has(e.to))
        .map((e, i) => (
          <GraphEdge
            key={`se-${i}`}
            fromPos={NODE_POSITIONS[e.from]}
            toPos={NODE_POSITIONS[e.to]}
            type="service"
            routing={e.routing}
            health={podHealthMap[e.from] || 'unknown'}
            isActive={causalSet.has(e.from) && causalSet.has(e.to)}
            noArrow={e.noArrow}
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
            routing={e.routing}
            health="unknown"
            isActive={false}
          />
        ))}

      {/* Causal path overlay */}
      <CausalPathOverlay causalChain={[...causalSet]} />

      {/* Pipeline pod nodes */}
      {visiblePods
        .filter(pod => visiblePodSet.has(pod))
        .map(pod => {
          const pos = NODE_POSITIONS[pod]
          if (!pos) return null
          const podMetrics = findMetrics(metrics, pod)
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
              isRootCause={pod === rootCauseShort}
              isInCausalPath={causalSet.has(pod)}
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
        
        // Hide orphaned PVCs if anomalous-only is selected
        if (onlyAnomalous) {
          const connectedEdges = DATA_EDGES.filter(e => e.to === pvc.id)
          const hasVisibleSource = connectedEdges.some(e => visiblePodSet.has(e.from))
          if (!hasVisibleSource) return null
        }

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
