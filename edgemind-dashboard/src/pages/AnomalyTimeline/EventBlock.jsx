import { useState } from 'react'
import { EVENT_BLOCK_COLORS, SEVERITY_COLORS } from '../../core/constants/colors.js'
import EventPopover from './EventPopover.jsx'

const ICONS = {
  oomkill_detected:    '✗',
  crash_loop:          '↻',
  pump_health_critical:'♥',
  pre_oom:             '⚠',
}

const ABBREV = {
  cpu_spike:            'CPU↑',
  cpu_throttle:         'THRT',
  memory_leak:          'LEAK',
  pre_oom:              '⚠OOM',
  oomkill_detected:     '✗OOM',
  io_saturation:        'IO-SAT',
  write_burst:          'WRT',
  pvc_fill:             'PVC',
  network_flood:        'FLOOD',
  crash_loop:           '↻CRH',
  log_error_surge:      'LOG↑',
  data_stale:           'STALE',
  pump_health_critical: '♥PUMP',
  correlated_alert:     'CORR',
}

function getLabel(anomaly_type, windowMs) {
  // > 3h: icon only
  if (windowMs > 3 * 60 * 60 * 1000) {
    return ICONS[anomaly_type] || anomaly_type?.slice(0, 3)
  }
  // > 30 min: abbreviated
  if (windowMs > 30 * 60 * 1000) {
    return ABBREV[anomaly_type] || anomaly_type?.slice(0, 8)
  }
  // ≤ 30 min: full text with icon prefix
  const icon = ICONS[anomaly_type]
  return icon ? `${icon} ${anomaly_type}` : anomaly_type
}

export default function EventBlock({ finding, xLeft, width, windowMs = 30 * 60 * 1000 }) {
  const [open, setOpen] = useState(false)
  const color = EVENT_BLOCK_COLORS[finding.anomaly_type] || SEVERITY_COLORS[finding.severity] || 'var(--color-info)'
  const w = Math.max(8, width)
  const outlined = ['cpu_throttle', 'pvc_fill', 'data_stale'].includes(finding.anomaly_type)
  const isPulse = finding.anomaly_type === 'pre_oom'
  const label = getLabel(finding.anomaly_type, windowMs)

  return (
    <>
      <div
        onClick={e => { e.stopPropagation(); setOpen(o => !o) }}
        className={isPulse ? 'animate-oom-pulse' : ''}
        title={`${finding.pod} · ${finding.anomaly_type} · ${finding.severity}`}
        style={{
          position: 'absolute',
          left: xLeft,
          top: 4,
          width: w,
          height: 20,
          background: outlined ? 'transparent' : color,
          border: `1px ${finding.anomaly_type === 'data_stale' ? 'dashed' : 'solid'} ${color}`,
          borderRadius: 3,
          opacity: isPulse ? 1 : 0.85,
          cursor: 'pointer',
          overflow: 'hidden',
          display: 'flex', alignItems: 'center', paddingLeft: 3,
        }}
      >
        {w > 20 && label && (
          <span style={{ fontSize: 9, color: outlined ? color : '#fff', fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden' }}>
            {label}
          </span>
        )}
      </div>
      {open && (
        <EventPopover finding={finding} onClose={() => setOpen(false)} xLeft={xLeft} />
      )}
    </>
  )
}
