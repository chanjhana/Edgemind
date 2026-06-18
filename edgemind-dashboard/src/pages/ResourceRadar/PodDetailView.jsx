import CommonInfraPanel from './CommonInfraPanel.jsx'
import AppSpecificPanel from './AppSpecificPanel/index.jsx'
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

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--color-border-card)', display: 'flex', alignItems: 'center', gap: 10 }}>
        <button
          onClick={onBack}
          style={{ background: 'transparent', border: 'none', color: 'var(--color-text-secondary)', cursor: 'pointer', fontSize: 13, padding: '2px 4px' }}
        >
          â† Back
        </button>
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontWeight: 700, fontSize: 14, color: 'var(--color-text-primary)' }}>{podName}</span>
            <span style={{
              fontSize: 10, padding: '1px 6px', borderRadius: 10,
              background: 'var(--color-info-tint)',
              color: 'var(--color-info)',
            }}>{ns}</span>
            {worst && <SeverityBadge severity={worst.severity} />}
          </div>
          <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)', marginTop: 2 }}>{role}</div>
        </div>
      </div>

      <div style={{ flex: 1, overflow: 'auto', display: 'flex', gap: 0 }}>
        {!infoOnly && (
          <div style={{
            width: 340, flexShrink: 0, borderRight: '1px solid var(--color-border-card)',
            padding: 16, overflowY: 'auto',
          }}>
            <div style={{ fontSize: 10, color: 'var(--color-text-tertiary)', fontWeight: 700, marginBottom: 10 }}>INFRASTRUCTURE METRICS</div>
            <CommonInfraPanel podName={podName} />
          </div>
        )}

        <div style={{ flex: 1, padding: 16, overflowY: 'auto' }}>
          <div style={{ fontSize: 10, color: 'var(--color-text-tertiary)', fontWeight: 700, marginBottom: 10 }}>APP-SPECIFIC</div>
          <AppSpecificPanel podName={podName} />
        </div>
      </div>
    </div>
  )
}
