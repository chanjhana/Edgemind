import ConfidenceTier from '../../components/ui/ConfidenceTier.jsx'
import DegradedBanner from '../../components/ui/DegradedBanner.jsx'
import WarmingUpBanner from '../../components/ui/WarmingUpBanner.jsx'
import EmptyNominal from '../../components/ui/EmptyNominal.jsx'
import CausalChainSteps from './CausalChainSteps.jsx'
import TwoDomainContrast from './TwoDomainContrast.jsx'
import WhyNotSection from './WhyNotSection.jsx'
import { useAppState } from '../../core/store/AppContext.jsx'

export default function AIExplanationCard({ alert }) {
  const { agentsReady, llmAvailable } = useAppState()

  if (!agentsReady) return <WarmingUpBanner />
  if (!alert) return <EmptyNominal />

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, padding: 16, overflowY: 'auto' }}>
      {!llmAvailable && <DegradedBanner />}

      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
        <div>
          <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)', fontWeight: 700, marginBottom: 4 }}>
            {alert.id ? `INC-${String(alert.id).slice(0, 6)}` : 'INC-RECENT'} - {alert.alert_type || 'CORRELATED ALERT'}
          </div>
          {(alert.root_cause_pod || alert.root_cause_metric) && (
            <div style={{ fontSize: 12, color: 'var(--color-danger)', marginBottom: 6 }}>
              Root cause: {alert.root_cause_pod || 'unknown'} {alert.root_cause_metric ? `- ${alert.root_cause_metric}` : ''}
            </div>
          )}
          <div style={{ fontSize: 14, color: 'var(--color-text-primary)', lineHeight: 1.6 }}>
            {alert.nlp_summary || alert.insight || '-'}
          </div>
        </div>
        <ConfidenceTier value={alert.confidence} />
      </div>

      {alert.causal_chain?.length > 0 && (
        <div>
          <div style={{ fontSize: 10, color: 'var(--color-text-tertiary)', fontWeight: 700, marginBottom: 6 }}>CAUSAL CHAIN</div>
          <CausalChainSteps chain={alert.causal_chain} />
        </div>
      )}

      <TwoDomainContrast alert={alert} />

      {alert.why_not && <WhyNotSection alternatives={alert.why_not} />}

      {alert.recommendation && (
        <div style={{ background: 'var(--color-info-background)', border: '1px solid var(--color-info-border)', borderRadius: 6, padding: '10px 12px' }}>
          <div style={{ fontSize: 10, color: 'var(--color-info)', fontWeight: 700, marginBottom: 4 }}>RECOMMENDATION</div>
          <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', lineHeight: 1.6 }}>{alert.recommendation}</div>
        </div>
      )}

      {alert.business_impact && (
        <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', lineHeight: 1.6 }}>
          <span style={{ color: 'var(--color-text-tertiary)', fontSize: 10, fontWeight: 700 }}>BUSINESS IMPACT </span>
          {alert.business_impact}
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', fontSize: 10, color: 'var(--color-text-tertiary)' }}>
        {alert.tool_calls_made != null && <span>{alert.tool_calls_made} tool calls</span>}
        {alert.turns_taken != null && <span>{alert.turns_taken} turns</span>}
        {alert.analysis_time_s != null && <span>{alert.analysis_time_s}s analysis</span>}
      </div>
    </div>
  )
}
