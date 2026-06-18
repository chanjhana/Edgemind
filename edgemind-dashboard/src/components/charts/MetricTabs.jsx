import { useState } from 'react'
import RollingLineChart from './RollingLineChart.jsx'
import DualLineChart from './DualLineChart.jsx'
import StackedAreaChart from './StackedAreaChart.jsx'
import { useAppState } from '../../core/store/AppContext.jsx'

const TABS = ['CPU', 'Memory', 'Network', 'Storage']

export default function MetricTabs({ podName }) {
  const [tab, setTab] = useState('CPU')
  const { metrics } = useAppState()
  const m = metrics[podName] || {}

  return (
    <div>
      {/* Tab bar */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 8 }}>
        {TABS.map(t => (
          <button key={t} onClick={() => setTab(t)} style={{
            padding: '3px 10px', borderRadius: 4, fontSize: 11, cursor: 'pointer',
            border: `1px solid ${tab === t ? 'var(--color-info)' : 'var(--color-border-primary)'}`,
            background: tab === t ? 'var(--color-info-tint)' : 'transparent',
            color: tab === t ? 'var(--color-info)' : 'var(--color-text-secondary)',
          }}>
            {t}
          </button>
        ))}
      </div>

      {tab === 'CPU' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <RollingLineChart data={m.cpu_usage || []} color="var(--color-warning)" unit=" cores" label="Usage" height={72} />
          <RollingLineChart data={m.cpu_throttle || []} color="var(--color-warning-border)" unit="%" label="Throttle" height={56} anomalyThreshold={0.2} />
        </div>
      )}

      {tab === 'Memory' && (
        <DualLineChart
          data1={m.mem_working_set || []}
          data2={m.mem_rss || []}
          label1="Working Set" label2="RSS"
          color1="var(--color-text-info)"
          color2="var(--color-info)"
          unit=" B"
          height={100}
        />
      )}

      {tab === 'Network' && (
        <StackedAreaChart
          dataTx={m.net_tx || []}
          dataRx={m.net_rx || []}
          height={100}
        />
      )}

      {tab === 'Storage' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <RollingLineChart data={m.fs_write || []} color="var(--color-success)" unit=" B/s" label="Write" height={56} />
          <RollingLineChart data={m.fs_read  || []} color="var(--color-success-border)" unit=" B/s" label="Read" height={56} />
        </div>
      )}
    </div>
  )
}
