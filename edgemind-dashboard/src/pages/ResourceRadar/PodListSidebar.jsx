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
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              background: 'var(--color-bg-card)',
              borderBottom: '1px solid var(--color-border-card)',
              userSelect: 'none',
            }}
          >
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}>
              <span style={{ display: 'inline-block', width: 3, height: 14, borderRadius: 2, background: 'var(--color-danger)', flexShrink: 0 }} />
              <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: '0.06em', color: 'var(--color-text-primary)', textTransform: 'uppercase' }}>{ns}</span>
            </span>
            <span style={{ fontSize: 10, color: 'var(--color-text-tertiary)' }}>{open[ns] ? '▾' : '▸'}</span>
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
