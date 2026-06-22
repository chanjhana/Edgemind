import { useRef, useEffect } from 'react'
import PipelineGraph from '../../components/graph/PipelineGraph.jsx'
import { CANVAS_WIDTH, CANVAS_HEIGHT } from '../../core/constants/topology.js'

export default function GraphCanvas({ showPvcEdges, showMonitoring, onlyAnomalous, onNodeClick, scale = 1, fitTrigger = 0 }) {
  const containerRef = useRef(null)

  useEffect(() => {
    if (containerRef.current) {
      const el = containerRef.current
      el.scrollTo({
        left: (el.scrollWidth - el.clientWidth) / 2,
        top: (el.scrollHeight - el.clientHeight) / 2,
        behavior: 'smooth'
      })
    }
  }, [fitTrigger])

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
        alignItems: 'center',
        padding: 20,
      }}
    >
      <PipelineGraph
        showPvcEdges={showPvcEdges}
        showMonitoring={showMonitoring}
        onlyAnomalous={onlyAnomalous}
        onNodeClick={onNodeClick}
        scale={scale}
        fitTrigger={fitTrigger}
        width={CANVAS_WIDTH}
        height={CANVAS_HEIGHT}
      />
    </div>
  )
}
