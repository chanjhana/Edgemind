import { useNavigate } from 'react-router-dom'
import PipelineGraph from '../../components/graph/PipelineGraph.jsx'
import KpiStrip from './KpiStrip.jsx'
import DigitalTwinMatrix from './DigitalTwinMatrix.jsx'
import IncidentCard from './IncidentCard.jsx'
import AgentGrid from './AgentGrid.jsx'
import InfraMonitor from './InfraMonitor.jsx'
import LiveEventFeed from './LiveEventFeed.jsx'
import PanelHeader from '../../components/ui/PanelHeader.jsx'
import DMDWarningPanel from '../../components/ui/DMDWarningPanel.jsx'

// Command Center — the prototype's main dashboard, laid out in five bands:
//   0  Live ops header (identity + connectivity)
//   1  KPI strip (six live system KPIs)
//   2  Asset twins | dependency graph | AI root cause
//   3  Agent grid | infrastructure monitoring
//   4  Live event feed
// Each panel is a summary; clicking opens the relevant detail sub-page.

export default function CommandCenter() {
  const navigate = useNavigate()

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* Band 1 */}
      <KpiStrip />

      {/* Band 1.5 — DMD Early Warnings (hidden when no active forecasts) */}
      <DMDWarningPanel />

      {/* Band 2 — twins | graph | root cause */}
      <div style={{ display: 'flex', gap: 12, alignItems: 'stretch' }}>
        <div style={{ flex: '0 0 248px', minWidth: 0 }}>
          <DigitalTwinMatrix />
        </div>

        <div
          style={{
            flex: 1, minWidth: 0,
            display: 'flex', flexDirection: 'column',
            background: 'var(--color-bg-card)',
            border: '1.5px solid var(--color-border-card)',
            borderRadius: 6, padding: '10px 12px',
            overflow: 'hidden', cursor: 'pointer',
          }}
          onClick={() => navigate('/graph')}
          title="Click to open full Correlation Map"
        >
          <PanelHeader title="Anomaly Propagation Graph" hint="click to expand →" />
          <div style={{ flex: 1, overflowX: 'auto', pointerEvents: 'none', marginTop: 8, display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
            <PipelineGraph showMonitoring={false} />
          </div>
        </div>

        <div style={{ flex: '0 0 300px', minWidth: 0 }}>
          <IncidentCard />
        </div>
      </div>

      {/* Band 3 — agents | infrastructure */}
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
        <div style={{ flex: '1 1 0', minWidth: 0 }}>
          <AgentGrid />
        </div>
        <div style={{ flex: '1 1 0', minWidth: 0 }}>
          <InfraMonitor />
        </div>
      </div>

      {/* Band 4 — live event feed */}
      <LiveEventFeed />
    </div>
  )
}
