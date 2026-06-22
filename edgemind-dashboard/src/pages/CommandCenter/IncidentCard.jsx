import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAppState } from '../../core/store/AppContext.jsx'
import { latestActiveCorrelation } from '../../core/selectors/correlations.js'
import { useNow } from '../../core/hooks/useNow.js'
import ConfidenceTier from '../../components/ui/ConfidenceTier.jsx'
import AgentTag from '../../components/ui/AgentTag.jsx'
import WarmingUpBanner from '../../components/ui/WarmingUpBanner.jsx'
import DegradedBanner from '../../components/ui/DegradedBanner.jsx'
import EmptyNominal from '../../components/ui/EmptyNominal.jsx'
import PanelHeader from '../../components/ui/PanelHeader.jsx'

function Panel({ children, onClick }) {
  return (
    <div
      onClick={onClick}
      title={onClick ? 'Click to open AI Investigation' : undefined}
      style={{
        background: 'var(--color-bg-card)',
        border: '1.5px solid var(--color-border-card)',
        borderRadius: 6, padding: '10px 14px',
        display: 'flex', flexDirection: 'column', gap: 10,
        cursor: onClick ? 'pointer' : 'default',
      }}
    >
      <PanelHeader title="AI Root Cause Engine" hint="orchestrator analysis" />
      {children}
    </div>
  )
}

function CausalChainInline({ chain = [] }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap', fontSize: 11 }}>
      {chain.map((pod, i) => (
        <span key={pod} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          {i > 0 && <span style={{ color: 'var(--color-text-tertiary)' }}>→</span>}
          <span style={{
            padding: '1px 6px', borderRadius: 3,
            background: 'var(--color-bg-chip)',
            color: 'var(--color-text-primary)',
          }}>{pod}</span>
        </span>
      ))}
    </div>
  )
}

function TwoDomainContrast({ alert }) {
  const bundle = alert.bundle || {}
  const pumpAlert = bundle.findings?.find(f => f.anomaly_type === 'pump_health_critical')
  if (!pumpAlert && !alert.root_cause_pod) return null
  return (
    <div style={{
      background: 'var(--color-info-tint)',
      border: '1px solid var(--color-info-border)',
      borderRadius: 4,
      padding: '8px 10px',
      fontSize: 11,
      marginTop: 8,
    }}>
      {pumpAlert && (
        <div style={{ color: 'var(--color-warning)', marginBottom: 4 }}>
          Application: {pumpAlert.pump || 'Pump'} health alert triggered
        </div>
      )}
      {alert.root_cause_pod && (
        <div style={{ color: 'var(--color-info)' }}>
          EdgeMind: root cause is <strong>{alert.root_cause_pod}</strong> — {alert.alert_type}
        </div>
      )}
    </div>
  )
}

export default function IncidentCard() {
  const navigate = useNavigate()
  const { correlatedAlerts, findings, agentsReady, llmAvailable } = useAppState()
  const now = useNow(5000)
  const activeIncident = useMemo(
    () => latestActiveCorrelation(correlatedAlerts, findings, now),
    [correlatedAlerts, findings, now]
  )

  if (!agentsReady) return (
    <Panel>
      <WarmingUpBanner />
    </Panel>
  )

  if (!activeIncident) return (
    <Panel>
      <EmptyNominal message="No active incident — pipeline correlations clear" />
    </Panel>
  )

  const a = activeIncident

  return (
    <Panel onClick={() => navigate('/investigate')}>
      {!llmAvailable && <DegradedBanner />}

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span style={{
          padding: '1px 8px', borderRadius: 4,
          background: 'var(--color-bg-chip)', color: 'var(--color-text-tertiary)', fontSize: 11,
        }}>
          {a.timestamp ? new Date(a.timestamp).toLocaleTimeString() : 'Recent'}
        </span>
        {a.alert_type && (
          <span style={{
            padding: '1px 8px', borderRadius: 4,
            background: 'var(--color-info-tint)', color: 'var(--color-info)', fontSize: 11,
          }}>
            {a.alert_type}
          </span>
        )}
        <ConfidenceTier confidence={a.confidence} />
      </div>

      {a.root_cause_pod && (
        <div style={{ fontSize: 13, color: 'var(--color-text-primary)' }}>
          Root cause: <strong style={{ color: 'var(--color-danger)' }}>{a.root_cause_pod}</strong>
        </div>
      )}

      {a.nlp_summary && (
        <p style={{ fontSize: 12, color: 'var(--color-text-secondary)', margin: 0, lineHeight: 1.6 }}>
          {a.nlp_summary}
        </p>
      )}

      {a.causal_chain?.length > 0 && (
        <div>
          <div style={{ fontSize: 10, color: 'var(--color-text-tertiary)', marginBottom: 4 }}>CAUSAL CHAIN</div>
          <CausalChainInline chain={a.causal_chain} />
        </div>
      )}

      {a.recommendation && (
        <div style={{
          background: 'var(--color-info-background)', border: '1px solid var(--color-info-border)',
          borderRadius: 4, padding: '6px 10px', fontSize: 11, color: 'var(--color-text-primary)',
        }}>
          <span style={{ color: 'var(--color-info)', fontWeight: 700 }}>→ </span>{a.recommendation}
        </div>
      )}

      <TwoDomainContrast alert={a} />

      {a.bundle?.unique_agents && (
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {a.bundle.unique_agents.map(ag => <AgentTag key={ag} agent={ag} />)}
        </div>
      )}
    </Panel>
  )
}
