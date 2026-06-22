import { useState, useMemo } from 'react'
import { useAppState } from '../../core/store/AppContext.jsx'
import { useFaultInjection } from '../../core/api/useFaultInjection.js'

export default function DemoTopBar() {
  const { demoLab, findings, ws: wsStatus } = useAppState()
  const [confirming, setConfirming] = useState(false)

  const pump1 = useFaultInjection('pump1')
  const pump2 = useFaultInjection('pump2')
  const pump3 = useFaultInjection('pump3')

  const activeFaults = Object.entries(demoLab.activeFaults || {}).filter(([, v]) => v)
  const activeFaultCount = activeFaults.length
  const anyActive = activeFaultCount > 0
  // Scenarios 2 (leak) and 3 (PVC fill) run without a per-pump fault, so the
  // pump-fault map alone misses them — track the active scenario too.
  const scenarioActive = demoLab.activeScenarioId != null

  // Determine system status: CRITICAL if any finding in the last 2 min is critical severity
  const isCritical = useMemo(() => {
    const cutoff = Date.now() - 2 * 60 * 1000
    return findings.some(f =>
      f.severity === 'critical' && f.timestamp && new Date(f.timestamp).getTime() > cutoff
    )
  }, [findings])

  const degraded = anyActive || scenarioActive

  const statusColor = isCritical ? 'var(--color-danger)'
    : degraded ? 'var(--color-warning)'
    : 'var(--color-success)'

  const statusIcon = isCritical ? '⚡' : degraded ? '⚠' : '✓'

  const statusLabel = isCritical ? 'CRITICAL'
    : anyActive ? `${activeFaultCount} Active Fault${activeFaultCount > 1 ? 's' : ''}`
    : scenarioActive ? 'Scenario Running'
    : 'System Nominal'

  async function clearAll() {
    await Promise.all([pump1.clear(), pump2.clear(), pump3.clear()])
    setConfirming(false)
  }

  return (
    <div style={{
      height: 'var(--header-height)',
      borderBottom: '1px solid var(--color-border-card)',
      marginTop: 12,
      display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0,
      background: 'var(--color-bg-card)', position: 'relative',
      padding: '0 20px', flexWrap: 'wrap',
    }}>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, flexShrink: 0 }}>
        <span style={{ display: 'inline-block', width: 3, height: 14, borderRadius: 2, background: 'var(--color-danger)', flexShrink: 0 }} />
        <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.06em', color: 'var(--color-text-primary)', textTransform: 'uppercase' }}>
          Fault Demo
        </span>
      </span>

      {/* System status indicator */}
      <span style={{
        display: 'flex', alignItems: 'center', gap: 5, fontSize: 11,
        padding: '2px 10px', borderRadius: 10,
        background: `${statusColor}18`,
        border: `1px solid ${statusColor}44`,
        color: statusColor, fontWeight: 600,
      }}>
        <span>{statusIcon}</span>
        <span>{statusLabel}</span>
      </span>

      {/* Per-pump active fault chips */}
      {activeFaults.map(([pump, fault]) => (
        <span key={pump} style={{
          fontSize: 10, background: 'var(--color-danger-tint)', color: 'var(--color-danger)',
          padding: '1px 7px', borderRadius: 10, border: '1px solid var(--color-danger-border)',
        }}>
          {pump}: {fault}
        </span>
      ))}

      {/* Backend connectivity */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
        <div style={{
          width: 6, height: 6, borderRadius: '50%',
          background: wsStatus?.connected ? 'var(--color-success)' : 'var(--color-danger)',
        }} />
        <span style={{ fontSize: 10, color: 'var(--color-text-tertiary)' }}>
          {wsStatus?.connected ? 'online' : 'offline'}
        </span>
      </div>

      <span style={{ flex: 1 }} />

      {anyActive && !confirming && (
        <button
          onClick={() => setConfirming(true)}
          style={{
            fontSize: 11, padding: '4px 12px', borderRadius: 4, cursor: 'pointer',
            background: 'transparent', color: 'var(--color-danger)', border: '1px solid var(--color-danger)',
          }}
        >
          ✕ Clear All Faults
        </button>
      )}
      {confirming && (
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 11 }}>
          <span style={{ color: 'var(--color-text-secondary)' }}>Clear all active faults?</span>
          <button
            onClick={clearAll}
            style={{ padding: '3px 10px', borderRadius: 4, cursor: 'pointer', background: 'var(--color-danger)', color: '#fff', border: 'none', fontSize: 11 }}
          >Confirm</button>
          <button
            onClick={() => setConfirming(false)}
            style={{ padding: '3px 10px', borderRadius: 4, cursor: 'pointer', background: 'transparent', color: 'var(--color-text-secondary)', border: '1px solid var(--color-border-primary)', fontSize: 11 }}
          >Cancel</button>
        </div>
      )}
    </div>
  )
}
