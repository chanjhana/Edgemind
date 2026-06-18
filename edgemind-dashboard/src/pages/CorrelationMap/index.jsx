import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import GraphControls from './GraphControls.jsx'
import GraphCanvas from './GraphCanvas.jsx'
import NodeDetailDrawer from './NodeDetailDrawer.jsx'
import TimelineStrip from './TimelineStrip.jsx'
import IncidentOverlay from './IncidentOverlay.jsx'
import { MONITORING_LAYER } from '../../core/constants/topology.js'

export default function DependencyGraph() {
  const [searchParams] = useSearchParams()
  const [showPvcEdges,  setShowPvcEdges]  = useState(true)
  const [showMonitoring,setShowMonitoring]= useState(false)
  const [onlyAnomalous, setOnlyAnomalous] = useState(false)
  const [selectedNode,  setSelectedNode]  = useState(searchParams.get('node'))
  const [scale, setScale] = useState(1.0)

  useEffect(() => {
    const node = searchParams.get('node')
    if (node) {
      setSelectedNode(node)
      if (MONITORING_LAYER.includes(node)) setShowMonitoring(true)
    }
  }, [searchParams])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      <GraphControls
        showPvcEdges={showPvcEdges}   setShowPvcEdges={setShowPvcEdges}
        showMonitoring={showMonitoring} setShowMonitoring={setShowMonitoring}
        onlyAnomalous={onlyAnomalous} setOnlyAnomalous={setOnlyAnomalous}
        scale={scale} onScaleChange={setScale}
      />

      <div style={{ flex: 1, overflow: 'hidden', position: 'relative', display: 'flex', flexDirection: 'column' }}>
        <GraphCanvas
          showPvcEdges={showPvcEdges}
          showMonitoring={showMonitoring}
          onlyAnomalous={onlyAnomalous}
          scale={scale}
          onNodeClick={pod => setSelectedNode(pod)}
        />
        <TimelineStrip />

        {/* Incident overlay — only when drawer is closed */}
        {!selectedNode && <IncidentOverlay />}

        {selectedNode && (
          <NodeDetailDrawer podName={selectedNode} onClose={() => setSelectedNode(null)} />
        )}
      </div>
    </div>
  )
}
