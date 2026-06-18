import { useAppState } from '../../../core/store/AppContext.jsx'
import TrendSparkline from '../../../components/charts/TrendSparkline.jsx'

const SENSOR_SIMS = [
  { id: 'sensor-sim-1', pump: 'pump1' },
  { id: 'sensor-sim-2', pump: 'pump2' },
  { id: 'sensor-sim-3', pump: 'pump3' },
]

export default function CollectorPanel({ podName }) {
  const { metrics, sensorReadings } = useAppState()
  const m = metrics[podName] || {}

  const netRxArr = m.net_rx || []
  const netRx = netRxArr.length ? netRxArr[netRxArr.length - 1] : null

  const fsWriteArr = m.fs_write || []
  const fsWrite = fsWriteArr.length ? fsWriteArr[fsWriteArr.length - 1] : null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ fontSize: 10, color: 'var(--color-text-tertiary)', fontWeight: 700 }}>COLLECTION STATS</div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <div style={{ background: 'var(--color-bg-surface)', borderRadius: 4, padding: '8px 10px' }}>
          <div style={{ fontSize: 10, color: 'var(--color-text-tertiary)' }}>OPC-UA Ingest</div>
          <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--color-text-primary)', fontVariantNumeric: 'tabular-nums' }}>
            {netRx != null ? `${(netRx / 1024).toFixed(1)}` : '—'}
          </div>
          <div style={{ fontSize: 10, color: 'var(--color-text-tertiary)' }}>KB/s from sensors</div>
        </div>
        <div style={{ background: 'var(--color-bg-surface)', borderRadius: 4, padding: '8px 10px' }}>
          <div style={{ fontSize: 10, color: 'var(--color-text-tertiary)' }}>InfluxDB Writes</div>
          <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--color-text-primary)', fontVariantNumeric: 'tabular-nums' }}>
            {fsWrite != null ? `${(fsWrite / 1024).toFixed(1)}` : '—'}
          </div>
          <div style={{ fontSize: 10, color: 'var(--color-text-tertiary)' }}>KB/s to historian</div>
        </div>
      </div>

      {/* Subscription status */}
      <div style={{ background: 'var(--color-bg-surface)', borderRadius: 4, padding: '8px 10px' }}>
        <div style={{ fontSize: 10, color: 'var(--color-text-tertiary)', fontWeight: 700, marginBottom: 6 }}>SENSOR SUBSCRIPTIONS</div>
        {SENSOR_SIMS.map(({ id, pump }) => {
          const hasData = sensorReadings[pump] && Object.keys(sensorReadings[pump]).length > 0
          return (
            <div key={id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '3px 0', fontSize: 11 }}>
              <div style={{ width: 6, height: 6, borderRadius: '50%', background: hasData ? 'var(--color-success)' : 'var(--color-border-primary)', flexShrink: 0 }} />
              <span style={{ flex: 1, color: 'var(--color-text-secondary)', fontFamily: 'monospace' }}>{id}</span>
              <span style={{ fontSize: 10, color: hasData ? 'var(--color-success)' : 'var(--color-text-tertiary)' }}>
                {hasData ? 'Connected' : 'No data'}
              </span>
            </div>
          )
        })}
        <div style={{ fontSize: 10, color: 'var(--color-text-tertiary)', marginTop: 6 }}>
          Completed/dropped/pending stats unavailable from Prometheus
        </div>
      </div>

      <div>
        <div style={{ fontSize: 10, color: 'var(--color-text-tertiary)', marginBottom: 4 }}>Network RX trend (bytes/s)</div>
        <TrendSparkline podName={podName} series="net_rx" />
      </div>

      <div style={{ fontSize: 11, color: 'var(--color-text-secondary)', background: 'var(--color-bg-surface)', borderRadius: 4, padding: '6px 10px' }}>
        Subscribes to all three sensor-sims via OPC-UA and batches telemetry into InfluxDB every 5 s.
      </div>
    </div>
  )
}
