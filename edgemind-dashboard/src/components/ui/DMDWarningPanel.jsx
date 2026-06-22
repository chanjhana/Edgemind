import { useMemo } from 'react'
import { useAppState } from '../../core/store/AppContext.jsx'

const HORIZON_S = 120  // 8 steps × 15s — full forecast window

function severityColor(seconds) {
  if (seconds == null) return 'var(--color-text-tertiary)'
  if (seconds <= 30)  return 'var(--color-danger)'
  if (seconds <= 75)  return 'var(--color-warning)'
  return 'var(--color-text-info)'
}

function urgencyPct(seconds) {
  if (seconds == null) return 0
  // 0 s → 100% urgent, HORIZON_S → 0% urgent
  return Math.max(0, Math.min(100, Math.round((1 - seconds / HORIZON_S) * 100)))
}

function fmtSeconds(s) {
  if (s == null) return '—'
  if (s <= 0)   return 'now'
  if (s < 60)   return `${s}s`
  const m = Math.floor(s / 60)
  const rem = s % 60
  return rem > 0 ? `${m}m ${rem}s` : `${m}m`
}

function metricLabel(metric) {
  const MAP = {
    cpu_usage_cores:       'CPU',
    mem_rss_bytes:         'Memory RSS',
    net_tx_bytes_per_sec:  'Network TX',
    fs_io_saturation:      'I/O Saturation',
  }
  return MAP[metric] || metric
}

function UrgencyBar({ seconds, color }) {
  const pct = urgencyPct(seconds)
  return (
    <div style={{
      height: 3,
      borderRadius: 2,
      background: 'var(--color-border-secondary)',
      overflow: 'hidden',
      marginTop: 4,
    }}>
      <div style={{
        width: `${pct}%`,
        height: '100%',
        background: color,
        borderRadius: 2,
        transition: 'width 0.6s ease',
      }} />
    </div>
  )
}

function WarningRow({ w, isLast }) {
  const color = severityColor(w.predicted_breach_seconds)
  const pct = w.predicted_breach_seconds != null
    ? Math.round((w.current_ratio ?? 0) * 100)
    : null
  const predPct = w.predicted_value_at_breach != null
    ? Math.round(w.predicted_value_at_breach * 100)
    : null
  const growthPct = w.dominant_growth_rate_per_sec != null
    ? (w.dominant_growth_rate_per_sec * 100).toFixed(3)
    : null

  return (
    <div style={{
      paddingBottom: isLast ? 0 : 8,
      marginBottom: isLast ? 0 : 8,
      borderBottom: isLast ? 'none' : '1px solid var(--color-border-secondary)',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--color-text-primary)' }}>
            {w.pod?.replace(/-[a-z0-9]+-[a-z0-9]+$/, '') ?? '—'}
          </span>
          <span style={{
            marginLeft: 8,
            fontSize: 10,
            color: 'var(--color-text-tertiary)',
            fontFamily: 'monospace',
          }}>
            {metricLabel(w.metric)}
          </span>
        </div>
        <span style={{
          fontSize: 11,
          fontWeight: 700,
          color,
          fontVariantNumeric: 'tabular-nums',
        }}>
          in {fmtSeconds(w.predicted_breach_seconds)}
        </span>
      </div>

      <div style={{
        fontSize: 10,
        color: 'var(--color-text-tertiary)',
        marginTop: 2,
        display: 'flex',
        alignItems: 'center',
        gap: 6,
      }}>
        <span>Now: <b style={{ color: 'var(--color-text-secondary)' }}>{pct != null ? `${pct}%` : '—'}</b></span>
        <span style={{ opacity: 0.5 }}>→</span>
        <span>Predicted: <b style={{ color }}>{predPct != null ? `${predPct}%` : '—'}</b></span>
        {growthPct && (
          <span style={{ marginLeft: 'auto', color: 'var(--color-text-tertiary)' }}>
            ↑ {growthPct}%/s
          </span>
        )}
      </div>

      <UrgencyBar seconds={w.predicted_breach_seconds} color={color} />
    </div>
  )
}

function InstabilityRow({ inst }) {
  const rate = inst.dominant_growth_rate_per_sec
  const doublingS = rate > 0 ? Math.round(0.693 / rate) : null
  const n = inst.n_growing_modes ?? 0

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      padding: '4px 0',
      borderTop: '1px solid var(--color-border-secondary)',
      marginTop: 8,
    }}>
      <span style={{ fontSize: 10, color: 'var(--color-warning)', fontWeight: 700 }}>⚠ MODE</span>
      <span style={{ fontSize: 10, color: 'var(--color-text-secondary)' }}>
        <b>{inst.pod?.replace(/-[a-z0-9]+-[a-z0-9]+$/, '') ?? '—'}</b>
        {' '}— {n} growing mode{n !== 1 ? 's' : ''}
        {doublingS ? `, doubles in ${doublingS}s` : ''}
      </span>
    </div>
  )
}

// ── Main panel ─────────────────────────────────────────────────────────────

export default function DMDWarningPanel() {
  const { dmdForecasts } = useAppState()
  const { warnings = [], instabilities = [], lastUpdated } = dmdForecasts ?? {}

  // Sort warnings: most urgent (smallest breach_seconds) first
  const sorted = useMemo(
    () => [...warnings].sort(
      (a, b) => (a.predicted_breach_seconds ?? 9999) - (b.predicted_breach_seconds ?? 9999)
    ),
    [warnings]
  )

  const hasData = sorted.length > 0 || instabilities.length > 0

  // Hide the panel entirely when no DMD data is available yet
  if (!hasData) return null

  const critCount = sorted.filter(w => w.severity === 'critical').length
  const warnCount = sorted.filter(w => w.severity === 'warning').length

  return (
    <div style={{
      background: 'var(--color-bg-card)',
      border: '1.5px solid var(--color-border-card)',
      borderRadius: 6,
      padding: '10px 14px',
      animation: 'fadeIn 0.4s ease',
    }}>
      {/* Header */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: 8,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {/* DMD Icon */}
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
            stroke="var(--color-warning)" strokeWidth="2.5"
            strokeLinecap="round" strokeLinejoin="round">
            <path d="M2 12h4l3-9 4 18 3-9h4" />
          </svg>
          <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--color-text-primary)', letterSpacing: '0.04em' }}>
            DMD EARLY WARNINGS
          </span>
          <span style={{ fontSize: 10, color: 'var(--color-text-tertiary)' }}>
            2 min forecast horizon
          </span>
        </div>

        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          {critCount > 0 && (
            <span style={{
              fontSize: 9, fontWeight: 700, padding: '2px 6px',
              borderRadius: 3, background: 'rgba(255,0,15,0.12)',
              color: 'var(--color-danger)', letterSpacing: '0.03em',
            }}>
              {critCount} CRITICAL
            </span>
          )}
          {warnCount > 0 && (
            <span style={{
              fontSize: 9, fontWeight: 700, padding: '2px 6px',
              borderRadius: 3, background: 'rgba(255,190,0,0.12)',
              color: 'var(--color-warning)', letterSpacing: '0.03em',
            }}>
              {warnCount} WARNING
            </span>
          )}
          {lastUpdated && (
            <span style={{ fontSize: 9, color: 'var(--color-text-tertiary)' }}>
              {new Date(lastUpdated).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
            </span>
          )}
        </div>
      </div>

      {/* Warning rows */}
      <div>
        {sorted.map((w, i) => (
          <WarningRow
            key={`${w.pod}-${w.metric}-${w.timestamp}`}
            w={w}
            isLast={i === sorted.length - 1 && instabilities.length === 0}
          />
        ))}
        {instabilities.map(inst => (
          <InstabilityRow key={`${inst.pod}-${inst.timestamp}`} inst={inst} />
        ))}
      </div>

      {/* Footer hint */}
      <div style={{
        marginTop: 8,
        fontSize: 9,
        color: 'var(--color-text-tertiary)',
        borderTop: '1px solid var(--color-border-secondary)',
        paddingTop: 6,
        fontStyle: 'italic',
      }}>
        Dynamic Mode Decomposition — multivariate eigenstructure analysis across CPU, memory, I/O and network
      </div>
    </div>
  )
}
