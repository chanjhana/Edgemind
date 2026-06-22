import CommonInfraPanel from './CommonInfraPanel.jsx'
import AppSpecificPanel from './AppSpecificPanel/index.jsx'
import PanelHeader from '../../components/ui/PanelHeader.jsx'
import { POD_ROLES, POD_NAMESPACES, INFO_ONLY_PODS } from '../../core/constants/pods.js'
import { useAppState } from '../../core/store/AppContext.jsx'
import SeverityBadge from '../../components/ui/SeverityBadge.jsx'

export default function PodDetailView({ podName, onBack }) {
  const { findings } = useAppState()
  const role = POD_ROLES[podName] || ''
  const ns = POD_NAMESPACES[podName] || 'unknown'
  const podFindings = findings.filter(f => f.pod === podName)
  const worst = podFindings.find(f => f.severity === 'critical') || podFindings.find(f => f.severity === 'warning') || null
  const infoOnly = INFO_ONLY_PODS.has(podName)
  const isKubeSystem = ns === 'kube-system'

  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '16px 24px', borderBottom: '1px solid var(--color-border-card)', display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'nowrap' }}>
            <span style={{ fontWeight: 700, fontSize: 14, color: 'var(--color-text-primary)', whiteSpace: 'nowrap' }}>{podName}</span>
            <span style={{
              fontSize: 10, padding: '1px 6px', borderRadius: 10,
              background: 'var(--color-info-tint)',
              color: 'var(--color-info)',
              whiteSpace: 'nowrap'
            }}>{ns}</span>
            {worst && <SeverityBadge severity={worst.severity} />}
            <span style={{ fontSize: 11, color: 'var(--color-text-tertiary)', marginLeft: 8, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{role}</span>
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 0 }}>
        {!infoOnly && (
          <div style={{
            flex: 1, borderRight: isKubeSystem ? 'none' : '1px solid var(--color-border-card)',
            padding: '12px 24px 24px', minWidth: 0
          }}>
            <CommonInfraPanel podName={podName} isKubeSystem={isKubeSystem} />
          </div>
        )}

        {!isKubeSystem && (
          <div style={{ flex: 1, padding: '12px 24px 24px', minWidth: 0 }}>
            <AppSpecificPanel podName={podName} />
          </div>
        )}
      </div>
    </div>
  )
}
