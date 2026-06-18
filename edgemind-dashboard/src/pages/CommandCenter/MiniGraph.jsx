import { useNavigate } from 'react-router-dom'
import PipelineGraph from '../../components/graph/PipelineGraph.jsx'
import { CANVAS_WIDTH, CANVAS_HEIGHT } from '../../core/constants/topology.js'

export default function MiniGraph() {
  const navigate = useNavigate()
  const scale = 0.58
  const W = Math.round(CANVAS_WIDTH * scale)
  const H = Math.round(CANVAS_HEIGHT * scale)

  return (
    <div
      style={{
        background: 'var(--color-bg-card)',
        border: '1px solid var(--color-border-card)',
        borderRadius: 6,
        padding: 8,
        cursor: 'pointer',
        overflow: 'hidden',
      }}
      onClick={() => navigate('/graph')}
      title="Click to open Correlation Map"
    >
      <div style={{ fontSize: 10, color: 'var(--color-text-tertiary)', marginBottom: 4 }}>
        DEPENDENCY GRAPH — click to expand
      </div>
      <div style={{ overflow: 'hidden', width: W, height: H }}>
        <div style={{ transform: `scale(${scale})`, transformOrigin: 'top left', pointerEvents: 'none' }}>
          <PipelineGraph />
        </div>
      </div>
    </div>
  )
}
