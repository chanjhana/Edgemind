import StatusDot from '../../components/ui/StatusDot.jsx'
import { useAppState } from '../../core/store/AppContext.jsx'
import { INFO_ONLY_PODS } from '../../core/constants/pods.js'

function podHealth(findings, podName) {
  const pf = findings.filter(f => f.pod === podName)
  if (pf.some(f => f.severity === 'critical')) return 'critical'
  if (pf.some(f => f.severity === 'warning'))  return 'warning'
  if (pf.length > 0)                           return 'healthy'
  return INFO_ONLY_PODS.has(podName) ? 'unknown' : 'healthy'
}

export default function PodListItem({ podName, isSelected, onClick }) {
  const { findings } = useAppState()
  const health = podHealth(findings, podName)
  const podFindings = findings.filter(f => f.pod === podName)
  const worst = podFindings.find(f => f.severity === 'critical') || podFindings.find(f => f.severity === 'warning')
  const anomalyColor = health === 'critical' ? 'var(--color-danger)' : 'var(--color-warning)'

  return (
    <div
      onClick={() => onClick(podName)}
      style={{
        display: 'flex', alignItems: 'center', gap: 7,
        padding: '5px 12px', cursor: 'pointer',
        borderLeft: `3px solid ${isSelected ? 'var(--color-info)' : 'transparent'}`,
        background: isSelected ? 'var(--color-info-tint)' : 'transparent',
        fontSize: 11,
      }}
    >
      <StatusDot health={health} />
      <span style={{
        color: isSelected ? 'var(--color-text-primary)' : 'var(--color-text-secondary)',
        flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>
        {podName}
      </span>
      {worst && (
        <span style={{
          fontSize: 9, padding: '1px 4px', borderRadius: 3, flexShrink: 0,
          background: `${anomalyColor}1a`,
          color: anomalyColor,
          border: `1px solid ${anomalyColor}`,
          maxWidth: 64, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {worst.anomaly_type}
        </span>
      )}
    </div>
  )
}
