import { useEffect, useState, useMemo, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useAppState } from '../../core/store/AppContext.jsx'
import OverviewGrid from './OverviewGrid.jsx'
import PodDetailView from './PodDetailView.jsx'
import { PUMP_STATION_PODS, MONITORING_PODS } from '../../core/constants/pods.js'

const NS_OPTIONS = ['pump-station', 'monitoring', 'kube-system']
const ALL_TRACKED = [...PUMP_STATION_PODS, ...MONITORING_PODS]

function useLastUpdatedSecs(metrics) {
  const lastChangeRef = useRef(null)
  const [secsAgo, setSecsAgo] = useState(null)

  useEffect(() => {
    lastChangeRef.current = Date.now()
  }, [metrics])

  useEffect(() => {
    const id = setInterval(() => {
      if (lastChangeRef.current) {
        setSecsAgo(Math.floor((Date.now() - lastChangeRef.current) / 1000))
      }
    }, 1000)
    return () => clearInterval(id)
  }, [])

  return secsAgo
}

export default function ResourceRadar() {
  const [searchParams] = useSearchParams()
  const [selectedPod, setSelectedPod] = useState(searchParams.get('pod') || 'sensor-sim-1')
  const [nsFilter, setNsFilter] = useState('pump-station')
  const { findings, metrics } = useAppState()
  const secsAgo = useLastUpdatedSecs(metrics)

  useEffect(() => {
    const pod = searchParams.get('pod')
    if (pod) setSelectedPod(pod)
  }, [searchParams])

  const healthCounts = useMemo(() => {
    let running = 0, warning = 0, critical = 0
    ALL_TRACKED.forEach(pod => {
      const pf = findings.filter(f => f.pod === pod)
      if      (pf.some(f => f.severity === 'critical')) critical++
      else if (pf.some(f => f.severity === 'warning'))  warning++
      else running++
    })
    return { running, warning, critical }
  }, [findings])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, width: '100%' }}>

      {/* ── Top bar ─────────────────────────────────────────────────── */}
      <div style={{
        flex: '0 0 var(--header-height)', 
        borderBottom: '1px solid var(--color-border-card)',
        marginTop: '1vh',
        display: 'flex', alignItems: 'center', flexShrink: 0,
        background: 'var(--color-bg-card)', position: 'relative',
        padding: '0 2vw',
      }}>
        {/* Title on the left */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginRight: 28 }}>
          <span style={{ display: 'inline-block', width: 3, height: 14, borderRadius: 2, background: 'var(--color-danger)', flexShrink: 0 }} />
          <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.06em', color: 'var(--color-text-primary)', textTransform: 'uppercase' }}>
            Pod Metrics &amp; Health
          </span>
        </div>

        {/* Centered navigation-style namespace selector */}
        <nav style={{
          display: 'flex', alignItems: 'stretch', height: '100%', gap: 0,
          position: 'absolute', left: '50%', transform: 'translateX(-50%)'
        }}>
          {NS_OPTIONS.map(ns => (
            <div
              key={ns}
              onClick={() => {
                setNsFilter(ns)
                if (ns === 'pump-station') setSelectedPod(PUMP_STATION_PODS[0])
                else if (ns === 'monitoring') setSelectedPod(MONITORING_PODS[0])
                else if (ns === 'kube-system') setSelectedPod('coredns')
              }}
              className={`nav-link-hover ${nsFilter === ns ? 'active' : ''}`}
              style={{
                display: 'flex',
                alignItems: 'center',
                padding: '0 24px',
                color: nsFilter === ns ? 'var(--color-danger)' : 'var(--color-text-primary)',
                fontSize: 13,
                fontWeight: 700,
                cursor: 'pointer',
                whiteSpace: 'nowrap',
                transition: 'all 0.15s',
              }}
            >
              {ns}
            </div>
          ))}
        </nav>

        <div style={{ flex: 1 }} />

        {/* Health counts + last-updated */}
        <div style={{ display: 'flex', gap: 14, alignItems: 'center', fontSize: 11 }}>
          <span style={{ color: 'var(--color-success)' }}>✓ {healthCounts.running} Running</span>
          <span style={{ color: 'var(--color-warning)' }}>⚠ {healthCounts.warning} Warning</span>
          <span style={{ color: 'var(--color-danger)' }}>✗ {healthCounts.critical} Critical</span>
          {secsAgo != null && (
            <span style={{ color: 'var(--color-text-tertiary)' }}>
              Updated {secsAgo}s ago
            </span>
          )}
        </div>
      </div>

      {/* ── Body ────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', flexDirection: 'column', flex: 1, width: '100%', overflowY: 'auto' }}>
        <div style={{ padding: '16px 24px 0 24px', borderBottom: '1px solid var(--color-border-card)' }}>
          <OverviewGrid onSelectPod={setSelectedPod} nsFilter={nsFilter} selectedPod={selectedPod} />
        </div>
        
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {selectedPod && (
            <PodDetailView podName={selectedPod} />
          )}
        </div>
      </div>
    </div>
  )
}
