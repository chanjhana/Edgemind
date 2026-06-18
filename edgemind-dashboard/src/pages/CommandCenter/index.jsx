import { useNavigate } from 'react-router-dom'
import StatusStrip from '../../components/layout/StatusStrip.jsx'
import PipelineGraph from '../../components/graph/PipelineGraph.jsx'
import VitalCards from './VitalCards.jsx'
import IncidentCard from './IncidentCard.jsx'
import TopRiskyPods from './TopRiskyPods.jsx'
import ForecastStrip from './ForecastStrip.jsx'
import RecentAlertsStrip from './RecentAlertsStrip.jsx'

export default function CommandCenter() {
  const navigate = useNavigate()

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, maxWidth: 1400 }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>Command Center</h1>
        <StatusStrip />
      </div>

      {/* Row 1 — Vital-sign floater cards */}
      <VitalCards />

      {/* Row 2 — Left panel | Dependency graph (center) | Right panel */}
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>

        {/* Left: incident + pump alerts */}
        <div style={{ flex: '0 0 260px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          <IncidentCard />
          <RecentAlertsStrip />
        </div>

        {/* Center: dependency graph — main focus */}
        <div
          style={{
            flex: 1,
            background: 'var(--color-bg-card)',
            border: '1px solid var(--color-border-card)',
            borderRadius: 6,
            padding: '10px 12px',
            overflow: 'hidden',
            cursor: 'pointer',
          }}
          onClick={() => navigate('/graph')}
          title="Click to open full Correlation Map"
        >
          <div style={{
            fontSize: 10, color: 'var(--color-text-tertiary)',
            fontWeight: 700, marginBottom: 8, letterSpacing: '0.06em',
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          }}>
            <span>DEPENDENCY GRAPH</span>
            <span style={{ color: 'var(--color-info)', fontWeight: 400, fontSize: 10 }}>
              click to expand →
            </span>
          </div>
          <div style={{ overflowX: 'auto', pointerEvents: 'none' }}>
            <PipelineGraph />
          </div>
        </div>

        {/* Right: top risky pods */}
        <div style={{ flex: '0 0 230px' }}>
          <TopRiskyPods />
        </div>
      </div>

      {/* Row 3 — Forecast strip (full width) */}
      <ForecastStrip />
    </div>
  )
}
