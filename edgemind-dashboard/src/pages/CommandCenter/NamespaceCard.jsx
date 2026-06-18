import { useMemo } from 'react'
import { useAppState } from '../../core/store/AppContext.jsx'
import { NAMESPACE_COLORS } from '../../core/constants/colors.js'
import { POD_NAMESPACES } from '../../core/constants/pods.js'
import StatusDot from '../../components/ui/StatusDot.jsx'

function worstSeverity(findings) {
  if (findings.some(f => f.severity === 'critical')) return 'critical'
  if (findings.some(f => f.severity === 'warning'))  return 'warning'
  if (findings.length > 0)                           return 'healthy'
  return 'unknown'
}

export default function NamespaceCard({ namespace }) {
  const { findings, metrics } = useAppState()

  const { nsFindins, health, topFinding } = useMemo(() => {
    const nsFindins = findings.filter(f => {
      const pod = f.pod || ''
      return POD_NAMESPACES[pod] === namespace
    })
    const health = worstSeverity(nsFindins)
    const topFinding = nsFindins[0] || null
    return { nsFindins, health, topFinding }
  }, [findings, namespace])

  const podCount = Object.values(POD_NAMESPACES).filter(ns => ns === namespace).length
  const nsColor = NAMESPACE_COLORS[namespace] || 'var(--color-text-tertiary)'

  return (
    <div style={{
      background: 'var(--color-bg-card)',
      border: `1px solid ${health === 'unknown' ? 'var(--color-border-secondary)' :
               health === 'critical' ? 'var(--color-danger)' :
               health === 'warning' ? 'var(--color-warning)' : 'var(--color-success)'}`,
      borderRadius: 6,
      padding: '12px 14px',
      flex: 1,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <StatusDot health={health} />
        <span style={{ color: nsColor, fontWeight: 700, fontSize: 13 }}>{namespace}</span>
        <span style={{ color: 'var(--color-text-tertiary)', fontSize: 11, marginLeft: 'auto' }}>
          {podCount} pods
        </span>
      </div>
      <div style={{ fontSize: 11, color: 'var(--color-text-secondary)', marginBottom: 4 }}>
        {nsFindins.length > 0
          ? `${nsFindins.length} active finding${nsFindins.length !== 1 ? 's' : ''}`
          : 'No active findings'}
      </div>
      {topFinding && (
        <div style={{
          fontSize: 11,
          color: topFinding.severity === 'critical' ? 'var(--color-danger)' :
                 topFinding.severity === 'warning'  ? 'var(--color-warning)' : 'var(--color-text-secondary)',
          borderTop: '1px solid var(--color-border-card)',
          paddingTop: 6,
          marginTop: 4,
        }}>
          {topFinding.pod}: {topFinding.anomaly_type}
        </div>
      )}
    </div>
  )
}
