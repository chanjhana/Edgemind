import { useAppState } from '../../../core/store/AppContext.jsx'
import PvcGauge from '../../../components/ui/PvcGauge.jsx'
import TrendSparkline from '../../../components/charts/TrendSparkline.jsx'

export default function HistorianPanel({ podName }) {
  const { pvcs, metrics } = useAppState()
  const pvc1 = pvcs['historian-data'] || {}
  const m = metrics[podName] || {}

  const fsReadArr  = m.fs_read  || []
  const fsWriteArr = m.fs_write || []
  const ioArr      = m.fs_io_time || []

  const fsRead  = fsReadArr.length  ? fsReadArr[fsReadArr.length - 1]   : null
  const fsWrite = fsWriteArr.length ? fsWriteArr[fsWriteArr.length - 1] : null
  const ioSat   = ioArr.length      ? ioArr[ioArr.length - 1]           : null

  const ioColor = ioSat == null ? 'var(--color-text-tertiary)'
    : ioSat >= 0.95 ? 'var(--color-danger)'
    : ioSat >= 0.8  ? 'var(--color-warning)'
    : 'var(--color-success)'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ fontSize: 10, color: 'var(--color-text-tertiary)', fontWeight: 700 }}>STORAGE (PVC-1)</div>

      <PvcGauge
        pvcName="historian-data"
        used={pvc1.used}
        capacity={pvc1.capacity}
        fillPct={pvc1.fill_pct}
        consumers={['data-historian', 'feature-extractor']}
      />

      {/* FS Write / Read rates */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <div style={{ background: 'var(--color-bg-surface)', borderRadius: 4, padding: '8px 10px' }}>
          <div style={{ fontSize: 10, color: 'var(--color-text-tertiary)' }}>FS Write Rate</div>
          <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--color-text-primary)', fontVariantNumeric: 'tabular-nums' }}>
            {fsWrite != null ? `${(fsWrite / 1024).toFixed(1)} KB/s` : '—'}
          </div>
        </div>
        <div style={{ background: 'var(--color-bg-surface)', borderRadius: 4, padding: '8px 10px' }}>
          <div style={{ fontSize: 10, color: 'var(--color-text-tertiary)' }}>FS Read Rate</div>
          <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--color-text-primary)', fontVariantNumeric: 'tabular-nums' }}>
            {fsRead != null ? `${(fsRead / 1024).toFixed(1)} KB/s` : '—'}
          </div>
        </div>
      </div>

      {/* IO Saturation gauge */}
      <div style={{ background: 'var(--color-bg-surface)', borderRadius: 4, padding: '10px 12px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginBottom: 6 }}>
          <span style={{ color: 'var(--color-text-secondary)' }}>IO Saturation</span>
          <span style={{ color: ioColor, fontVariantNumeric: 'tabular-nums', fontWeight: 700 }}>
            {ioSat != null ? ioSat.toFixed(2) : '—'}
          </span>
        </div>
        <div style={{ height: 8, background: 'var(--color-border-secondary)', borderRadius: 4, overflow: 'hidden' }}>
          {ioSat != null && (
            <div style={{ width: `${Math.min(100, ioSat * 100)}%`, height: '100%', background: ioColor, borderRadius: 4, transition: 'width 0.4s' }} />
          )}
        </div>
        {ioSat != null && ioSat >= 0.8 && (
          <div style={{ fontSize: 10, color: ioColor, marginTop: 4 }}>
            {ioSat >= 0.95 ? 'Critical — TSM compaction or write storm' : 'Elevated — watch for read latency'}
          </div>
        )}
      </div>

      {/* Data stored */}
      <div style={{ background: 'var(--color-bg-surface)', borderRadius: 4, padding: '8px 10px' }}>
        <div style={{ fontSize: 10, color: 'var(--color-text-tertiary)', fontWeight: 700, marginBottom: 6 }}>DATA STORED</div>
        {[
          'pump_telemetry · 3 pumps · 7-day retention',
          'pump_features  · 3 pumps · 7-day retention',
          'pump_health    · 3 pumps · 7-day retention',
        ].map(line => (
          <div key={line} style={{ fontSize: 11, color: 'var(--color-text-secondary)', padding: '2px 0', fontFamily: 'monospace' }}>{line}</div>
        ))}
        <div style={{ fontSize: 10, color: 'var(--color-text-tertiary)', marginTop: 4 }}>Bucket: pump_station</div>
      </div>

      {/* FS Write trend sparkline */}
      <div>
        <div style={{ fontSize: 10, color: 'var(--color-text-tertiary)', marginBottom: 4 }}>FS Write trend</div>
        <TrendSparkline podName={podName} series="fs_write" />
      </div>
    </div>
  )
}
