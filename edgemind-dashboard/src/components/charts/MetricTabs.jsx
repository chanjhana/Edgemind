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
      padding: '12px 16px',
      display: 'flex',
      flexDirection: 'column',
      gap: 10,
      minHeight: 220,
    }}>
      <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--color-text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em', flexShrink: 0 }}>
        {title}
      </div>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', gap: 10, minHeight: 0 }}>
        {children}
      </div>
    </div>
  )
}

export default function MetricTabs({ podName, isKubeSystem, layout }) {
  const { metrics } = useAppState()
  const m = findMetrics(metrics, podName)

  let gridColumns = isKubeSystem ? 'repeat(4, 1fr)' : '1fr 1fr'
  if (layout === 'column') gridColumns = '1fr'

  return (
    <div style={{ display: 'grid', gridTemplateColumns: gridColumns, gridTemplateRows: layout === 'column' ? 'repeat(4, auto)' : 'auto auto', gap: 12 }}>
      <MetricSection title="CPU">
        <RollingLineChart style={{ flex: 1, minHeight: 0 }} data={m.cpu_usage || []} color="var(--color-warning)" unit=" cores" label="Usage" height="100%" />
        <RollingLineChart style={{ flex: 1, minHeight: 0 }} data={m.cpu_throttle || []} color="var(--color-warning-border)" unit="%" label="Throttle" height="100%" anomalyThreshold={0.2} />
      </MetricSection>

      <MetricSection title="Memory">
        <DualLineChart
          style={{ flex: 1, minHeight: 0 }}
          data1={m.mem_working_set || []}
          data2={m.mem_rss || []}
          label1="Working Set" label2="RSS"
          color1="var(--color-text-info)"
          color2="var(--color-info)"
          unit=" B"
          height="100%"
        />
      </MetricSection>

      <MetricSection title="Network">
        <StackedAreaChart
          style={{ flex: 1, minHeight: 0 }}
          dataTx={m.net_tx || []}
          dataRx={m.net_rx || []}
          height="100%"
        />
      </MetricSection>

      <MetricSection title="Storage">
        <RollingLineChart style={{ flex: 1, minHeight: 0 }} data={m.fs_write || []} color="var(--color-success)" unit=" B/s" label="Write" height="100%" />
        <RollingLineChart style={{ flex: 1, minHeight: 0 }} data={m.fs_read  || []} color="var(--color-success-border)" unit=" B/s" label="Read" height="100%" />
      </MetricSection>
    </div>
  )
}
