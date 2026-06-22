/**
 * DMDForecastChart.jsx
 *
 * Renders a compact SVG chart showing:
 *   - Solid line: actual rolling metric history (up to 30 pts)
 *   - Dashed line: DMD forecasted values (up to 8 pts ahead)
 *   - Shaded red zone: area above threshold
 *   - Vertical "now" marker separating history from forecast
 *
 * Props
 * -----
 *   history    : number[]  — actual observed values (0.0–1.0 ratios)
 *   forecast   : number[]  — predicted values (0.0–1.0 ratios)
 *   threshold  : number    — breach threshold ratio (e.g. 0.85)
 *   label      : string    — metric label shown in top-left
 *   color      : string    — CSS colour for the line
 *   width      : number    — SVG width  (default 260)
 *   height     : number    — SVG height (default 80)
 */

const PAD = { top: 8, right: 8, bottom: 20, left: 32 }

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)) }

export default function DMDForecastChart({
  history = [],
  forecast = [],
  threshold = 0.85,
  label = '',
  color = 'var(--color-warning)',
  width = 260,
  height = 80,
}) {
  const W = width  - PAD.left - PAD.right
  const H = height - PAD.top  - PAD.bottom

  const allVals = [...history, ...forecast]
  if (allVals.length === 0) return null

  const domainMax = Math.max(1.05, ...allVals)     // at least 0–1
  const domainMin = Math.min(0, ...allVals)
  const domainRange = domainMax - domainMin || 1

  const nHist = history.length
  const nFore = forecast.length
  const nTotal = nHist + nFore

  function xScale(i) { return (i / (nTotal - 1 || 1)) * W }
  function yScale(v) { return H - ((clamp(v, domainMin, domainMax) - domainMin) / domainRange) * H }

  // Build SVG polyline points
  function pts(vals, offset = 0) {
    return vals
      .map((v, i) => `${xScale(i + offset).toFixed(1)},${yScale(v).toFixed(1)}`)
      .join(' ')
  }

  const histPts    = pts(history, 0)
  const forePts    = pts(forecast, nHist)
  // Connect history end to forecast start for a continuous line
  const joinPts    = nHist > 0 && nFore > 0
    ? `${xScale(nHist - 1).toFixed(1)},${yScale(history[nHist - 1]).toFixed(1)} ${pts(forecast, nHist)}`
    : forePts

  const threshY    = yScale(threshold)
  const nowX       = nHist > 0 ? xScale(nHist - 1) : 0

  // Danger zone polygon (above threshold line, right portion of chart)
  const dangerPoly = [
    `${xScale(nHist - 1).toFixed(1)},${threshY.toFixed(1)}`,
    `${W.toFixed(1)},${threshY.toFixed(1)}`,
    `${W.toFixed(1)},0`,
    `${xScale(nHist - 1).toFixed(1)},0`,
  ].join(' ')

  // Y-axis tick marks
  const yTicks = [0, 0.5, 1.0].map(v => ({ v, y: yScale(v) }))

  return (
    <svg
      width={width}
      height={height}
      style={{ overflow: 'visible', display: 'block' }}
    >
      <g transform={`translate(${PAD.left},${PAD.top})`}>
        {/* Danger zone (above threshold in forecast area) */}
        <polygon
          points={dangerPoly}
          fill="rgba(255,0,15,0.07)"
          stroke="none"
        />

        {/* Threshold line */}
        <line
          x1={0} y1={threshY} x2={W} y2={threshY}
          stroke="var(--color-danger)"
          strokeWidth={1}
          strokeDasharray="3,3"
          opacity={0.6}
        />
        <text
          x={W + 2} y={threshY + 3}
          fontSize={8}
          fill="var(--color-danger)"
          opacity={0.8}
        >
          {Math.round(threshold * 100)}%
        </text>

        {/* Y-axis ticks */}
        {yTicks.map(({ v, y }) => (
          <g key={v}>
            <line x1={-4} y1={y} x2={0} y2={y} stroke="var(--color-border-secondary)" />
            <text x={-6} y={y + 3} fontSize={7} fill="var(--color-text-tertiary)" textAnchor="end">
              {Math.round(v * 100)}
            </text>
          </g>
        ))}

        {/* Y-axis line */}
        <line x1={0} y1={0} x2={0} y2={H} stroke="var(--color-border-secondary)" />

        {/* "NOW" divider */}
        <line
          x1={nowX} y1={0} x2={nowX} y2={H}
          stroke="var(--color-text-tertiary)"
          strokeWidth={1}
          strokeDasharray="2,2"
          opacity={0.5}
        />
        <text x={nowX + 2} y={H + 13} fontSize={7} fill="var(--color-text-tertiary)">now</text>

        {/* History line (solid) */}
        {nHist > 1 && (
          <polyline
            points={histPts}
            fill="none"
            stroke={color}
            strokeWidth={1.5}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        )}

        {/* Forecast line (dashed) */}
        {nFore > 0 && (
          <polyline
            points={joinPts}
            fill="none"
            stroke={color}
            strokeWidth={1.5}
            strokeDasharray="4,3"
            strokeLinecap="round"
            strokeLinejoin="round"
            opacity={0.8}
          />
        )}

        {/* Endpoint dot on forecast */}
        {nFore > 0 && (() => {
          const last = forecast[nFore - 1]
          const x = xScale(nTotal - 1)
          const y = yScale(last)
          const isBreach = last >= threshold
          return (
            <circle
              cx={x} cy={y} r={3}
              fill={isBreach ? 'var(--color-danger)' : color}
              stroke="var(--color-bg-card)"
              strokeWidth={1}
            />
          )
        })()}

        {/* Label */}
        <text x={4} y={10} fontSize={9} fontWeight="700" fill="var(--color-text-secondary)">
          {label}
        </text>

        {/* X-axis baseline */}
        <line x1={0} y1={H} x2={W} y2={H} stroke="var(--color-border-secondary)" />
      </g>
    </svg>
  )
}
