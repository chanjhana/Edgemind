import { useState } from 'react'
import AlertBracketPopover from './AlertBracketPopover.jsx'

export default function CorrelationBracket({ alert: a, xScale, index }) {
  const [open, setOpen] = useState(false)

  // Use window_start/window_end if available (from backend spec), else fall back to timestamp + duration_s
  const startMs = a.window_start ? new Date(a.window_start).getTime()
    : a.timestamp ? new Date(a.timestamp).getTime() : null
  const endMs = a.window_end ? new Date(a.window_end).getTime()
    : startMs ? startMs + (a.duration_s || 60) * 1000 : null

  if (startMs == null) return null

  const xLeft = Math.max(0, xScale(startMs))
  const xRight = endMs ? xScale(endMs) : xLeft + 80
  const width = Math.max(40, xRight - xLeft)
  const top = index * 26 + 4

  return (
    <>
      <div
        onClick={e => { e.stopPropagation(); setOpen(o => !o) }}
        title={`${a.alert_type} · click for detail`}
        style={{
          position: 'absolute',
          left: xLeft,
          top,
          width,
          height: 20,
          background: 'var(--color-info-tint)',
          border: '1px solid rgba(0,76,151,0.35)',
          borderRadius: 4,
          cursor: 'pointer',
          display: 'flex', alignItems: 'center', paddingLeft: 6,
          overflow: 'hidden',
        }}
      >
        <span style={{ fontSize: 9, color: 'var(--color-info)', fontWeight: 700, whiteSpace: 'nowrap' }}>
          {a.alert_type?.slice(0, 18)}
          {a.confidence != null ? ` · ${(a.confidence * 100).toFixed(0)}%` : ''}
        </span>
      </div>
      {open && <AlertBracketPopover alert={a} onClose={() => setOpen(false)} />}
    </>
  )
}
