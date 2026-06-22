import { useMemo, useState, useRef, useEffect } from 'react'
import { scaleTime } from 'd3'
import { useAppState } from '../../core/store/AppContext.jsx'
import { PUMP_STATION_PODS, MONITORING_PODS, POD_NAMESPACES } from '../../core/constants/pods.js'
import TimelineRow from './TimelineRow.jsx'
import NamespaceHeader from './NamespaceHeader.jsx'
import CorrelationBracket from './CorrelationBracket.jsx'
import EmptyNominal from '../../components/ui/EmptyNominal.jsx'

const ROW_HEIGHT = 28
const LABEL_WIDTH = 140
const NS_ORDER = ['pump-station', 'monitoring']

function TimeAxis({ xScale, ticks }) {
  return (
    <div style={{ display: 'flex', height: 28, position: 'relative', marginLeft: LABEL_WIDTH, borderBottom: '2px solid var(--color-border-card)', background: 'linear-gradient(to bottom, var(--color-bg-surface), var(--color-bg-card))', borderTopLeftRadius: 8, borderTopRightRadius: 8 }}>
      {ticks.map((t, i) => {
        const x = xScale(t)
        return (
          <div key={i} style={{ position: 'absolute', left: x, bottom: 0, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <span style={{ fontSize: 9, fontWeight: 700, color: 'var(--color-text-secondary)', whiteSpace: 'nowrap', transform: 'translateX(-50%)', paddingBottom: 6, letterSpacing: '0.02em' }}>
              {new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </span>
            <div style={{ width: 2, height: 6, background: 'var(--color-text-tertiary)', opacity: 0.6, borderRadius: '2px 2px 0 0' }} />
          </div>
        )
      })}
    </div>
  )
}

export default function TimelineCanvas({ windowMs, typeFilter, nsFilter, paused, panOffsetMs = 0 }) {
  const { findings, correlatedAlerts } = useAppState()
  const [collapsed, setCollapsed] = useState({})
  const containerRef = useRef(null)
  const [canvasWidth, setCanvasWidth] = useState(760)

  // Dynamic canvas width from container
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const update = () => {
      const w = el.offsetWidth - LABEL_WIDTH - 24
      if (w > 200) setCanvasWidth(w)
    }
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const now = paused ? (window.__timelinePauseTs || Date.now()) : Date.now() - panOffsetMs
  const domainStart = now - windowMs

  const xScale = useMemo(() => (
    scaleTime().domain([domainStart, now]).range([0, canvasWidth])
  ), [domainStart, now, canvasWidth])

  const ticks = useMemo(() => xScale.ticks(6).map(t => t.getTime()), [xScale])

  const filteredFindings = useMemo(() => {
    return findings.filter(f => {
      const ms = f.timestamp ? new Date(f.timestamp).getTime() : 0
      if (ms < domainStart || ms > now) return false
      if (typeFilter !== 'all' && f.anomaly_type !== typeFilter) return false
      if (nsFilter && f.namespace && f.namespace !== nsFilter) return false
      return true
    })
  }, [findings, domainStart, now, typeFilter, nsFilter])

  const allPods = [...PUMP_STATION_PODS, ...MONITORING_PODS]
  const podsByNs = {}
  NS_ORDER.forEach(ns => { podsByNs[ns] = allPods.filter(p => POD_NAMESPACES[p] === ns) })

  const filteredAlerts = useMemo(() => {
    return correlatedAlerts.filter(a => {
      const startMs = a.window_start ? new Date(a.window_start).getTime()
        : a.timestamp ? new Date(a.timestamp).getTime() : 0
      const endMs = a.window_end ? new Date(a.window_end).getTime()
        : startMs + (a.duration_s || 60) * 1000
      if (endMs < domainStart || startMs > now) return false
      return typeFilter === 'all' || typeFilter === 'correlated_alert'
    })
  }, [correlatedAlerts, domainStart, now, typeFilter])

  const eventCount = filteredFindings.length + filteredAlerts.length

  return (
    <div ref={containerRef} style={{ overflowX: 'auto', overflowY: 'auto', flex: 1, paddingBottom: 16 }}>
      <TimeAxis xScale={xScale} ticks={ticks} />
      <style>{`
        .timeline-ns-group {
          margin-bottom: 16px;
          border-radius: 0 0 8px 8px;
          background: var(--color-bg-card);
          overflow: hidden;
          box-shadow: 0 2px 8px rgba(0,0,0,0.02);
        }
        .timeline-pod-row {
          transition: background 0.15s ease;
        }
        .timeline-pod-row:hover {
          background: var(--color-bg-card-hover) !important;
        }
      `}</style>
      <div style={{ position: 'relative', minWidth: canvasWidth + LABEL_WIDTH }}>
        {NS_ORDER.filter(ns => !nsFilter || ns === nsFilter).map(ns => {
          const pods = podsByNs[ns] || []
          const isCollapsed = collapsed[ns]

          return (
            <div key={ns} className="timeline-ns-group">
              <div style={{ display: 'flex' }}>
                <div style={{ width: LABEL_WIDTH, flexShrink: 0 }}>
                  <NamespaceHeader
                    ns={ns} podCount={pods.length}
                    collapsed={isCollapsed}
                    onToggle={() => setCollapsed(c => ({ ...c, [ns]: !c[ns] }))}
                  />
                </div>
                <div style={{ flex: 1 }} />
              </div>

              {!isCollapsed && pods.map((pod, i) => (
                <div key={pod} className="timeline-pod-row" style={{ display: 'flex', alignItems: 'stretch', background: i % 2 === 0 ? 'var(--color-bg-surface)' : 'var(--color-bg-card)' }}>
                  <div style={{
                    width: LABEL_WIDTH, flexShrink: 0, height: ROW_HEIGHT,
                    display: 'flex', alignItems: 'center', padding: '0 12px',
                    borderBottom: '1px solid var(--color-border-card)',
                    borderRight: '1px solid var(--color-border-card)',
                    fontSize: 11, fontWeight: 500, color: 'var(--color-text-secondary)',
                    overflow: 'hidden',
                  }}>
                    <span style={{ textOverflow: 'ellipsis', whiteSpace: 'nowrap', overflow: 'hidden' }}>{pod}</span>
                  </div>
                  <div style={{ flex: 1, position: 'relative' }}>
                    <TimelineRow
                      podName={pod} findings={filteredFindings}
                      xScale={x => xScale(x)} rowHeight={ROW_HEIGHT}
                      windowMs={windowMs}
                    />
                  </div>
                </div>
              ))}
            </div>
          )
        })}

        {/* Correlation brackets zone — rendered as horizontal bars below all pod rows */}
        {filteredAlerts.length > 0 && (
          <div style={{ display: 'flex', borderTop: '1px solid var(--color-border-card)', background: 'var(--color-bg-card)' }}>
            <div style={{
              width: LABEL_WIDTH, flexShrink: 0,
              display: 'flex', alignItems: 'flex-start', padding: '12px',
              height: filteredAlerts.length * 26 + 24,
              borderRight: '1px solid var(--color-border-card)',
              background: 'var(--color-bg-surface)'
            }}>
              <span style={{ fontSize: 10, color: 'var(--color-info)', fontWeight: 800, letterSpacing: '0.06em' }}>CORRELATIONS</span>
            </div>
            <div style={{ flex: 1, position: 'relative', height: filteredAlerts.length * 26 + 12 }}>
              {filteredAlerts.map((a, i) => (
                <CorrelationBracket
                  key={i} alert={a}
                  xScale={xScale}
                  index={i}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
