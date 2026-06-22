import { useMemo } from 'react'
import MetricTabs from '../../components/charts/MetricTabs.jsx'
import PanelHeader from '../../components/ui/PanelHeader.jsx'
import { useAppState } from '../../core/store/AppContext.jsx'
import { findMetrics } from '../../core/selectors/podHealth.js'
import DMDForecastChart from '../../components/charts/DMDForecastChart.jsx'

export default function CommonInfraPanel({ podName, isKubeSystem }) {
  const { metrics, findings, dmdForecasts } = useAppState()
  const m = findMetrics(metrics, podName)
  const restarts = m.restarts || 0
  const podFindings = findings.filter(f => f.pod === podName)

  // Find DMD warnings for this pod — sorted most urgent first
  const shortName = podName.replace(/-[a-z0-9]+-[a-z0-9]+$/, '')
  const podDmdWarnings = useMemo(() => {
    const w = (dmdForecasts?.warnings ?? []).filter(
      w => w.pod === podName ||
           (w.pod ?? '').replace(/-[a-z0-9]+-[a-z0-9]+$/, '') === shortName
    )
    return w.sort((a, b) => (a.predicted_breach_seconds ?? 9999) - (b.predicted_breach_seconds ?? 9999))
  }, [dmdForecasts?.warnings, podName, shortName])

  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1vh', flexShrink: 0 }}>
        <PanelHeader title="Infrastructure Metrics" />
        <div style={{ display: 'flex', gap: 12, fontSize: 11, color: 'var(--color-text-secondary)' }}>
          <span>Status: <span style={{ color: 'var(--color-success)' }}>Running</span></span>
          {restarts > 0 && <span>Restarts: <span style={{ color: 'var(--color-warning)' }}>{restarts}</span></span>}
          {podFindings.length > 0 && (
            <span style={{ color: 'var(--color-warning)' }}>{podFindings.length} active finding{podFindings.length !== 1 ? 's' : ''}</span>
          )}
        </div>
      </div>
      <MetricTabs podName={podName} isKubeSystem={isKubeSystem} />

      {/* DMD Forecast Charts — shown when DMD has predictions for this pod */}
      {podDmdWarnings.length > 0 && (
        <div style={{
          marginTop: 14,
          paddingTop: 10,
          borderTop: '1px solid var(--color-border-secondary)',
        }}>
          <div style={{
            fontSize: 9, fontWeight: 700, color: 'var(--color-text-tertiary)',
            marginBottom: 8, letterSpacing: '0.05em',
          }}>
            DMD FORECAST  ·  2 MIN HORIZON
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
            {podDmdWarnings.slice(0, 3).map(w => {
              const metricKey = w.metric
              // Pull rolling history from metrics store
              const historyRaw = m[metricKey === 'mem_rss_bytes' ? 'mem_usage'
                : metricKey === 'cpu_usage_cores' ? 'cpu_usage'
                : metricKey === 'fs_io_saturation' ? 'fs_io'
                : 'cpu_usage'] || []
              const threshold = w.threshold_ratio ?? 0.85
              const color = w.severity === 'critical' ? 'var(--color-danger)' : 'var(--color-warning)'
              // Build forecast array (normalised values)
              const forecastVals = Array.from({ length: w.dmd_forecast_horizon_steps ?? 8 }, (_, i) => {
                if (i + 1 === w.predicted_breach_step) return w.predicted_value_at_breach ?? threshold
                if (i + 1 > (w.predicted_breach_step ?? 99)) return Math.min(1.05, (w.predicted_value_at_breach ?? threshold) + 0.01 * i)
                return w.current_ratio + ((w.predicted_value_at_breach ?? threshold) - w.current_ratio) * ((i + 1) / (w.predicted_breach_step ?? 8))
              })
              // Normalise history to ratios using a rough divisor
              const histNorm = historyRaw.map(v => v / Math.max(...historyRaw, 0.001))
              return (
                <DMDForecastChart
                  key={metricKey}
                  history={histNorm.slice(-20)}
                  forecast={forecastVals}
                  threshold={threshold}
                  label={w.metric_label ?? metricKey}
                  color={color}
                  width={240}
                  height={80}
                />
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
