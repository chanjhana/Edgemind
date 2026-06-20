import RollingLineChart from './RollingLineChart.jsx'
import DualLineChart from './DualLineChart.jsx'
import StackedAreaChart from './StackedAreaChart.jsx'
import { useAppState } from '../../core/store/AppContext.jsx'
import { findMetrics } from '../../core/selectors/podHealth.js'

function MetricSection({ title, children }) {
  return (
    <div style={{
      background: 'var(--color-bg-card)',
      border: '1px solid var(--color-border-card)',
      borderRadius: 6,
      padding: '10px 12px',
      display: 'flex',
      flexDirection: 'column',
      gap: 8,
    }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--color-text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
        {title}
      </div>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', gap: 8 }}>
        {children}
      </div>
    </div>
  )
}

export default function MetricTabs({ podName }) {
  const { metrics } = useAppState()
  const m = findMetrics(metrics, podName)

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
      <MetricSection title="CPU">
        <RollingLineChart data={m.cpu_usage || []} color="var(--color-warning)" unit=" cores" label="Usage" height={56} />
        <RollingLineChart data={m.cpu_throttle || []} color="var(--color-warning-border)" unit="%" label="Throttle" height={42} anomalyThreshold={0.2} />
      </MetricSection>

      <MetricSection title="Memory">
        <DualLineChart
          data1={m.mem_working_set || []}
          data2={m.mem_rss || []}
          label1="Working Set" label2="RSS"
          color1="var(--color-text-info)"
          color2="var(--color-info)"
          unit=" B"
          height={100}
        />
      </MetricSection>

      <MetricSection title="Network">
        <StackedAreaChart
          dataTx={m.net_tx || []}
          dataRx={m.net_rx || []}
          height={100}
        />
      </MetricSection>

      <MetricSection title="Storage">
        <RollingLineChart data={m.fs_write || []} color="var(--color-success)" unit=" B/s" label="Write" height={56} />
        <RollingLineChart data={m.fs_read  || []} color="var(--color-success-border)" unit=" B/s" label="Read" height={42} />
      </MetricSection>
    </div>
  )
}
