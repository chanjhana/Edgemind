import { useState } from 'react'
import AlertBracketPopover from './AlertBracketPopover.jsx'

export default function CorrelationBracket({ alert: a, xScale, index }) {
  const [open, setOpen] = useState(false)
  const [hovered, setHovered] = useState(false)

  // Use window_start/window_end if available (from backend spec), else fall back to timestamp + duration_s
  const startMs = a.window_start ? new Date(a.window_start).getTime()
    : a.timestamp ? new Date(a.timestamp).getTime() : null
  const endMs = a.window_end ? new Date(a.window_end).getTime()
    : startMs ? startMs + (a.duration_s || 60) * 1000 : null

  if (startMs == null) return null

  const xLeft = Math.max(0, xScale(startMs))
  const xRight = endMs ? xScale(endMs) : xLeft + 80
  const width = Math.max(40, xRight - xLeft)
  const top = index * 26 + 8

  return (
    <>
      <div
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onClick={e => { e.stopPropagation(); setOpen(o => !o) }}
        title={`${a.alert_type} · click for detail`}
        style={{
          position: 'absolute',
          left: xLeft,
          top,
          width,
          height: 22,
          background: hovered ? 'var(--color-info-tint)' : 'var(--color-bg-card)',
          border: `1px solid ${hovered ? 'var(--color-info)' : 'rgba(0, 102, 204, 0.3)'}`,
          borderRadius: 11,
          boxShadow: hovered ? '0 2px 8px rgba(0, 102, 204, 0.2)' : '0 1px 3px rgba(0,0,0,0.05)',
          cursor: 'pointer',
          display: 'flex', alignItems: 'center', paddingLeft: 8,
          overflow: 'hidden',
          transition: 'all 0.2s',
          transform: hovered ? 'scale(1.02)' : 'scale(1)',
          zIndex: hovered ? 10 : 1,
        }}
      >
        <span style={{ fontSize: 10, color: 'var(--color-info)', fontWeight: 800, whiteSpace: 'nowrap' }}>
          {a.alert_type?.slice(0, 18)}
          {a.confidence != null ? ` · ${(a.confidence * 100).toFixed(0)}%` : ''}
        </span>
      </div>
      {open && <AlertBracketPopover alert={a} onClose={() => setOpen(false)} />}
    </>
  )
}
