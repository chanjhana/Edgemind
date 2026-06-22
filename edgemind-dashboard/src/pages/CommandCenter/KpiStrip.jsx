import { useMemo } from 'react'
import { useAppState } from '../../core/store/AppContext.jsx'
import { healthCounts, worstPod } from '../../core/selectors/podHealth.js'
import { countActiveCorrelations, latestActiveCorrelation } from '../../core/selectors/correlations.js'
import { useNow } from '../../core/hooks/useNow.js'

function fmtMinutes(min) {
  if (min == null) return '—'
  if (min <= 0) return 'now'
  const h = Math.floor(min / 60)
  const m = min % 60
  if (h <= 0) return `${m}m`
  return `${h}h ${m}m`
}

function KpiCard({ label, value, sub, accent }) {
  return (
    <div style={{
      flex: '1 1 0', minWidth: 0,
      padding: '12px 16px',
      background: '#ffffff',
      border: '1px solid #d1d5db',
      borderRadius: 6,
      display: 'flex', flexDirection: 'column', gap: 4,
    }}>
      <div style={{
        fontSize: 9.5, fontWeight: 800, letterSpacing: '0.07em',
        color: 'var(--color-text-primary)', textTransform: 'uppercase',
        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
      }}>
        {label}
      </div>
      <div style={{
        fontSize: 26, fontWeight: 700, lineHeight: 1,
        color: accent || 'var(--color-text-primary)',
        fontVariantNumeric: 'tabular-nums',
      }}>
        {value ?? '—'}
      </div>
      {sub && (
        <div style={{
          fontSize: 10, color: 'var(--color-text-primary)',
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>
          {sub}
        </div>
      )}
    </div>
  )
}

export default function KpiStrip() {
  const { findings, correlatedAlerts, forecasts } = useAppState()
  const now = useNow(5000)

  const { healthy, warning, critical, total } = useMemo(
    () => healthCounts(findings), [findings]
  )
  const topCritical = useMemo(() => worstPod(findings), [findings])

  const activeAlertCount = useMemo(
    () => countActiveCorrelations(correlatedAlerts, findings, now),
    [correlatedAlerts, findings, now]
  )

  // AI Confidence / incident type follow the live incident, not stale history.
  const activeIncident = useMemo(
    () => latestActiveCorrelation(correlatedAlerts, findings, now),
    [correlatedAlerts, findings, now]
  )

  const confidence = activeIncident?.confidence
  const confColor = confidence == null ? 'var(--color-success)'
    : confidence >= 0.9 ? 'var(--color-success)'
    : confidence >= 0.7 ? 'var(--color-info)'
    : confidence >= 0.5 ? 'var(--color-warning)'
    : 'var(--color-danger)'

  const ttf = useMemo(() => {
    const candidates = [
      { m: forecasts.pvc2_ttf_minutes, src: 'export-data PVC fill' },
      { m: forecasts.featureExtractor_oom_minutes, src: 'feature-extractor OOM' },
    ].filter(c => c.m != null)
    if (candidates.length === 0) return null
    return candidates.reduce((a, b) => (b.m < a.m ? b : a))
  }, [forecasts])

  const ttfColor = ttf == null ? 'var(--color-success)'
    : ttf.m <= 30 ? 'var(--color-danger)'
    : ttf.m <= 120 ? 'var(--color-warning)'
    : 'var(--color-success)'

  const cards = [
    {
      label: 'Healthy Assets',
      value: healthy,
      sub: `of ${total} pods nominal`,
      accent: 'var(--color-success)',
    },
    {
      label: 'Warning Assets',
      value: warning,
      sub: warning > 0 ? 'degraded — watch' : 'none',
      accent: warning > 0 ? 'var(--color-warning)' : 'var(--color-success)',
    },
    {
      label: 'Critical Assets',
      value: critical,
      sub: critical > 0 && topCritical ? topCritical : 'all clear',
      accent: critical > 0 ? 'var(--color-danger)' : 'var(--color-success)',
    },
    {
      label: 'Active Correlations',
      value: activeAlertCount,
      sub: activeAlertCount > 0 ? (activeIncident?.alert_type || 'cascade') : 'no cascade',
      accent: activeAlertCount > 0 ? 'var(--color-danger)' : 'var(--color-success)',
    },
    {
      label: 'AI Confidence',
      value: confidence != null ? `${Math.round(confidence * 100)}%` : '—',
      sub: confidence != null ? (confidence >= 0.7 ? 'reliable' : 'tentative') : 'no active incident',
      accent: confColor,
    },
    {
      label: 'Predicted Time to Failure',
      value: fmtMinutes(ttf?.m),
      sub: ttf ? ttf.src : 'no resource at risk',
      accent: ttfColor,
    },
  ]

  return (
    <div style={{
      display: 'flex',
      gap: 12,
    }}>
      {cards.map(c => (
        <KpiCard key={c.label} {...c} />
      ))}
    </div>
  )
}
