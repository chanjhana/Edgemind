import PvcFillRow from './PvcFillRow.jsx'
import PodCard from './PodCard.jsx'
import { PUMP_STATION_PODS, MONITORING_PODS } from '../../core/constants/pods.js'

const KUBE_SYSTEM_PODS = ['coredns', 'local-path-provisioner', 'metrics-server']

const NAMESPACE_GROUPS = [
  { ns: 'pump-station', pods: PUMP_STATION_PODS },
  { ns: 'monitoring',   pods: MONITORING_PODS },
  { ns: 'kube-system',  pods: KUBE_SYSTEM_PODS },
]

export default function OverviewGrid({ onSelectPod, nsFilter = 'all' }) {
  const groups = nsFilter === 'all'
    ? NAMESPACE_GROUPS
    : NAMESPACE_GROUPS.filter(g => g.ns === nsFilter)

  const showPvcs = nsFilter === 'all' || nsFilter === 'pump-station'

  return (
    <div>
      {showPvcs && <PvcFillRow />}
      {groups.map(({ ns, pods }) => (
        <div key={ns} style={{ marginBottom: 24 }}>
          <div style={{
            fontSize: 10, fontWeight: 700, letterSpacing: '0.06em',
            color: 'var(--color-text-tertiary)',
            paddingBottom: 6, marginBottom: 10,
            borderBottom: '1px solid var(--color-border-card)',
          }}>
            {ns.toUpperCase()}
          </div>
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
            gap: 10,
          }}>
            {pods.map(pod => (
              <PodCard key={pod} podName={pod} onClick={onSelectPod} />
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
