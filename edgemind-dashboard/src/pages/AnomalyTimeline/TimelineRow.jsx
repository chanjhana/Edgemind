import { memo } from 'react'
import EventBlock from './EventBlock.jsx'

function TimelineRow({ podName, findings, xScale, rowHeight, windowMs }) {
  const podFindings = findings.filter(f => f.pod === podName)

  return (
    <div style={{ height: rowHeight, position: 'relative', borderBottom: '1px solid var(--color-border-card)' }}>
      {podFindings.map((f, i) => {
        const ms = f.timestamp ? new Date(f.timestamp).getTime() : null
        if (ms == null) return null
        const x = xScale(ms)
        return (
          <EventBlock
            key={i} finding={f} xLeft={x}
            width={Math.max(8, f.duration_s ? xScale(ms + f.duration_s * 1000) - x : 8)}
            windowMs={windowMs}
          />
        )
      })}
    </div>
  )
}

export default memo(TimelineRow)
