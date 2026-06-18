import { useState } from 'react'
import PodListItem from './PodListItem.jsx'
import { PUMP_STATION_PODS, MONITORING_PODS } from '../../core/constants/pods.js'

const KUBE_SYSTEM_PODS = ['coredns', 'local-path-provisioner', 'metrics-server']

const ALL_GROUPS = [
  { ns: 'pump-station', pods: PUMP_STATION_PODS },
  { ns: 'monitoring',   pods: MONITORING_PODS },
  { ns: 'kube-system',  pods: KUBE_SYSTEM_PODS },
]

export default function PodListSidebar({ selectedPod, onSelectPod, nsFilter = 'all' }) {
  const [open, setOpen] = useState({ 'pump-station': true, monitoring: true, 'kube-system': false })

  const groups = nsFilter === 'all' ? ALL_GROUPS : ALL_GROUPS.filter(g => g.ns === nsFilter)

  return (
    <div style={{
      width: 210, flexShrink: 0,
      borderRight: '1px solid var(--color-border-card)',
      overflowY: 'auto', height: '100%',
    }}>
      {groups.map(({ ns, pods }) => (
        <div key={ns}>
          <div
            onClick={() => setOpen(p => ({ ...p, [ns]: !p[ns] }))}
            style={{
              padding: '6px 12px', cursor: 'pointer',
              fontSize: 10, fontWeight: 700, letterSpacing: '0.05em',
              color: 'var(--color-text-tertiary)',
              display: 'flex', justifyContent: 'space-between',
              background: 'var(--color-bg-card)',
              borderBottom: '1px solid var(--color-border-card)',
              userSelect: 'none',
            }}
          >
            <span>{ns.toUpperCase()}</span>
            <span>{open[ns] ? 'â–¾' : 'â–¸'}</span>
          </div>
          {open[ns] && pods.map(pod => (
            <PodListItem
              key={pod}
              podName={pod}
              isSelected={selectedPod === pod}
              onClick={onSelectPod}
            />
          ))}
        </div>
      ))}
    </div>
  )
}
