import { useEffect, useState, useMemo, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useAppState } from '../../core/store/AppContext.jsx'
import PodListSidebar from './PodListSidebar.jsx'
import OverviewGrid from './OverviewGrid.jsx'
import PodDetailView from './PodDetailView.jsx'
import { PUMP_STATION_PODS, MONITORING_PODS } from '../../core/constants/pods.js'

const NS_OPTIONS = ['all', 'pump-station', 'monitoring', 'kube-system']
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
  const [selectedPod, setSelectedPod] = useState(searchParams.get('pod'))
  const [nsFilter, setNsFilter] = useState('all')
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
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>

      {/* â”€â”€ Top bar â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
      <div style={{
        padding: '7px 16px', borderBottom: '1px solid var(--color-border-card)',
        display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0,
        background: 'var(--color-bg-card)', flexWrap: 'wrap',
      }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-text-primary)', marginRight: 4 }}>
          Pod Metrics &amp; Health
        </span>

        {/* Namespace filter pills */}
        <div style={{ display: 'flex', gap: 4 }}>
          {NS_OPTIONS.map(ns => (
            <button
              key={ns}
              onClick={() => setNsFilter(ns)}
              style={{
                padding: '3px 10px', borderRadius: 12, fontSize: 11, cursor: 'pointer',
                border: 'none', fontWeight: nsFilter === ns ? 700 : 400,
                background: nsFilter === ns ? 'var(--color-info)' : 'var(--color-bg-surface)',
                color: nsFilter === ns ? '#fff' : 'var(--color-text-secondary)',
              }}
            >
              {ns}
            </button>
          ))}
        </div>

        {/* Health counts + last-updated */}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 14, alignItems: 'center', fontSize: 11 }}>
          <span style={{ color: 'var(--color-success)' }}>âœ“ {healthCounts.running} Running</span>
          <span style={{ color: 'var(--color-warning)' }}>âš  {healthCounts.warning} Warning</span>
          <span style={{ color: 'var(--color-danger)' }}>âœ— {healthCounts.critical} Critical</span>
          {secsAgo != null && (
            <span style={{ color: 'var(--color-text-tertiary)' }}>
              Updated {secsAgo}s ago
            </span>
          )}
        </div>
      </div>

      {/* â”€â”€ Body â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        <PodListSidebar
          selectedPod={selectedPod}
          onSelectPod={setSelectedPod}
          nsFilter={nsFilter}
        />
        <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          {selectedPod ? (
            <PodDetailView podName={selectedPod} onBack={() => setSelectedPod(null)} />
          ) : (
            <div style={{ flex: 1, overflowY: 'auto', padding: 16 }}>
              <OverviewGrid onSelectPod={setSelectedPod} nsFilter={nsFilter} />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
