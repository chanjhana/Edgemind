import AgentTag from '../../components/ui/AgentTag.jsx'
import { useAppState } from '../../core/store/AppContext.jsx'

export default function CausalChainSteps({ chain }) {
  const { findings } = useAppState()

  if (!chain?.length) return null

  return (
    <div style={{ display: 'flex', gap: 0, flexWrap: 'wrap', alignItems: 'center' }}>
      {chain.map((pod, i) => {
        const podFinding = findings.find(f => f.pod === pod)
        return (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <div style={{
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2,
              background: 'var(--color-bg-surface)', border: '1px solid var(--color-border-card)',
              borderRadius: 6, padding: '4px 8px', minWidth: 80,
            }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--color-text-primary)' }}>{pod}</span>
              {podFinding && (
                <>
                  <AgentTag agent={podFinding.agent} />
                  {podFinding.anomaly_type && (
                    <span style={{ fontSize: 9, color: 'var(--color-text-tertiary)' }}>{podFinding.anomaly_type}</span>
                  )}
                </>
              )}
            </div>
            {i < chain.length - 1 && (
              <span style={{ fontSize: 14, color: 'var(--color-danger)', margin: '0 2px' }}>→</span>
            )}
          </div>
        )
      })}
    </div>
  )
}
