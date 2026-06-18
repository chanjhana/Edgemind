import { useRef } from 'react'
import PipelineGraph from '../../components/graph/PipelineGraph.jsx'
import { CANVAS_WIDTH, CANVAS_HEIGHT } from '../../core/constants/topology.js'

export default function GraphCanvas({ showPvcEdges, showMonitoring, onlyAnomalous, onNodeClick, scale = 1 }) {
  const containerRef = useRef(null)

  return (
    <div
      ref={containerRef}
      style={{
        flex: 1,
        overflow: 'auto',
        background: 'var(--color-bg-surface)',
        position: 'relative',
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'flex-start',
        padding: 20,
      }}
    >
      <PipelineGraph
        showPvcEdges={showPvcEdges}
        showMonitoring={showMonitoring}
        onlyAnomalous={onlyAnomalous}
        onNodeClick={onNodeClick}
        scale={scale}
        width={CANVAS_WIDTH}
        height={CANVAS_HEIGHT}
      />
    </div>
  )
}
