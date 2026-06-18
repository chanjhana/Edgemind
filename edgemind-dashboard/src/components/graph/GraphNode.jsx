import { SEVERITY_COLORS } from '../../core/constants/colors.js'
import { ROLE_COLORS } from '../../core/constants/topology.js'

const BASE_W = 90
const BASE_H = 52

export default function GraphNode({
  id, label, sublabel,
  health = 'unknown',
  cpuRate = 0,
  cpuLimit = null,
  hasActiveFinding = false,
  isRootCause = false,
  isInCausalPath = false,
  isPvc = false,
  fillPct = null,
  x, y,
  onClick,
}) {
  const w = Math.round(Math.min(1.6, Math.max(1.0, cpuRate / 0.5)) * BASE_W)
  const h = BASE_H
  const cx = x - w / 2
  const cy = y - h / 2

  // All nodes use ABB red — intensity encodes health severity
  const borderColor = isRootCause              ? '#ff000f' :
                      isInCausalPath           ? 'rgba(255,0,15,0.80)' :
                      health === 'critical'    ? '#ff000f' :
                      health === 'warning'     ? 'rgba(255,0,15,0.62)' :
                      health === 'healthy'     ? 'rgba(255,0,15,0.32)' :
                      'rgba(255,0,15,0.20)'   // unknown

  const strokeW = (isRootCause || health === 'critical') ? 2.5 :
                  (isInCausalPath || health === 'warning') ? 2.0 : 1.5

  const bg = health === 'critical' ? 'rgba(255,0,15,0.05)' :
             health === 'warning'  ? 'rgba(184,148,0,0.06)' :
             '#ffffff'

  const roleColor = ROLE_COLORS[id] || 'var(--color-text-tertiary)'

  const cpuPct = cpuLimit && cpuRate ? Math.min(100, Math.round((cpuRate / cpuLimit) * 100)) : null
  const cpuBarColor = cpuPct >= 80 ? 'var(--color-danger)' :
                      cpuPct >= 50 ? 'var(--color-warning)' :
                      'var(--color-success)'

  const findingDotColor = health === 'critical' ? 'var(--color-danger)' :
                          health === 'warning'   ? 'var(--color-warning)' :
                          'var(--color-success)'

  const pvcFillColor = fillPct >= 85 ? 'var(--color-danger)' :
                       fillPct >= 70 ? 'var(--color-warning)' :
                       'var(--color-success)'

  const truncLabel = label.length > 18 ? label.slice(0, 17) + '…' : label

  if (isPvc) {
    const rx = w / 2
    const ry = 7
    const bodyTop = cy + ry
    const bodyBot = cy + h - ry
    const fillH = fillPct != null ? Math.round(((h - ry * 2) * fillPct) / 100) : 0

    return (
      <g style={{ cursor: onClick ? 'pointer' : 'default' }} onClick={onClick ? () => onClick(id) : undefined}>
        {/* Cylinder body */}
        <rect x={cx} y={bodyTop} width={w} height={h - ry * 2} fill={bg} stroke="none" />
        {/* Fill bar inside cylinder (clipped to body) */}
        {fillPct != null && fillH > 0 && (
          <rect x={cx + 2} y={bodyBot - fillH} width={w - 4} height={fillH}
            fill={pvcFillColor} opacity={0.3} />
        )}
        {/* Bottom ellipse */}
        <ellipse cx={x} cy={bodyBot} rx={rx} ry={ry} fill={bg} stroke={borderColor} strokeWidth={strokeW}/>
        {/* Side lines */}
        <line x1={cx} y1={bodyTop} x2={cx} y2={bodyBot} stroke={borderColor} strokeWidth={strokeW}/>
        <line x1={cx + w} y1={bodyTop} x2={cx + w} y2={bodyBot} stroke={borderColor} strokeWidth={strokeW}/>
        {/* Top ellipse (rendered last so it's on top) */}
        <ellipse cx={x} cy={bodyTop} rx={rx} ry={ry} fill={bg} stroke={borderColor} strokeWidth={strokeW}/>
        {/* Label */}
        <text x={x} y={y - 2} textAnchor="middle" fontSize={9} fill="var(--color-text-primary)" fontWeight={600}>
          {label}
        </text>
        {sublabel && (
          <text x={x} y={y + 9} textAnchor="middle" fontSize={8} fill="var(--color-text-tertiary)">
            {sublabel}
          </text>
        )}
        {/* Fill % label */}
        {fillPct != null && (
          <text x={x} y={cy + h + 12} textAnchor="middle" fontSize={8} fill={pvcFillColor}>
            {fillPct}%
          </text>
        )}
      </g>
    )
  }

  return (
    <g
      style={{ cursor: onClick ? 'pointer' : 'default' }}
      onClick={onClick ? () => onClick(id) : undefined}
    >
      {/* Node background */}
      <rect x={cx} y={cy} width={w} height={h} rx={5}
        fill={bg} stroke={borderColor}
        strokeWidth={strokeW}
      />

      {/* Role accent left bar */}
      <rect x={cx} y={cy + 1} width={3} height={h - 2} rx={1} fill={roleColor} opacity={0.9} />

      {/* Root cause crown badge */}
      {isRootCause && (
        <text x={x} y={cy - 4} textAnchor="middle" fontSize={10} fill="var(--color-danger)">⚑</text>
      )}

      {/* Active finding dot (top-right) */}
      {hasActiveFinding && (
        <circle cx={cx + w - 5} cy={cy + 5} r={4} fill={findingDotColor} opacity={0.9}
          className="animate-pulse-dot" />
      )}

      {/* Pod label */}
      <text x={x + 4} y={y - (cpuPct != null ? 7 : 4)} textAnchor="middle"
        fontSize={9} fill="var(--color-text-primary)" fontWeight={600}>
        {truncLabel}
      </text>

      {/* Sublabel (used for monitoring pods etc) */}
      {sublabel && (
        <text x={x + 4} y={y + 4} textAnchor="middle" fontSize={8} fill="var(--color-text-tertiary)">
          {sublabel}
        </text>
      )}

      {/* CPU utilisation bar */}
      {cpuPct != null && (
        <>
          {/* Track */}
          <rect x={cx + 8} y={cy + h - 10} width={w - 16} height={4} rx={2}
            fill="rgba(0,0,0,0.08)" />
          {/* Fill */}
          <rect x={cx + 8} y={cy + h - 10} width={Math.round((w - 16) * cpuPct / 100)} height={4} rx={2}
            fill={cpuBarColor} opacity={0.85} />
          {/* % label */}
          <text x={cx + w - 4} y={cy + h - 7} textAnchor="end" fontSize={7}
            fill="var(--color-text-tertiary)">
            {cpuPct}%
          </text>
        </>
      )}
    </g>
  )
}
