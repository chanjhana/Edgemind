import { useAppState } from '../../core/store/AppContext.jsx'
import StatusDot from '../../components/ui/StatusDot.jsx'
import MiniProgressBar from '../../components/ui/MiniProgressBar.jsx'
import { INFO_ONLY_PODS, POD_NAMESPACES, POD_TO_PUMP } from '../../core/constants/pods.js'

function fmtTx(b) {
  if (b == null) return null
  if (b >= 1e6) return `${(b / 1e6).toFixed(1)} MB/s`
  return `${(b / 1e3).toFixed(0)} KB/s`
}

const NS_STYLE = {
  'pump-station': { bg: 'var(--color-info-tint)', color: 'var(--color-info)' },
  'monitoring':   { bg: 'var(--color-info-tint)', color: 'var(--color-info)' },
  'kube-system':  { bg: 'var(--color-overlay)', color: 'var(--color-text-tertiary)' },
}

function findMetrics(metrics, podName) {
  if (metrics[podName]) return metrics[podName]
  const key = Object.keys(metrics).find(k => k.startsWith(podName + '-'))
  return key ? metrics[key] : {}
}

export default function PodCard({ podName, onClick }) {
  const { metrics, findings, sensorReadings } = useAppState()
  const m = findMetrics(metrics, podName)

  const cpuArr = m.cpu_usage || []
  const cpu = cpuArr.length ? cpuArr[cpuArr.length - 1] : null
  const cpuLimit = m.cpu_limit || null
  const cpuPct = cpu != null && cpuLimit ? (cpu / cpuLimit) * 100 : null

  const memArr = m.mem_working_set || []
  const mem = memArr.length ? memArr[memArr.length - 1] : null
  const memLimit = m.mem_limit || null
  const memPct = mem != null && memLimit ? (mem / memLimit) * 100 : null

  const txArr = m.net_tx || []
  const tx = txArr.length ? txArr[txArr.length - 1] : null
  const restarts = m.restarts ?? 0

  const ns = POD_NAMESPACES[podName] || 'kube-system'
  const nsStyle = NS_STYLE[ns] || NS_STYLE['kube-system']
  const infoOnly = INFO_ONLY_PODS.has(podName)

  const podFindings = findings.filter(f => f.pod === podName)
  const worst = podFindings.find(f => f.severity === 'critical') || podFindings.find(f => f.severity === 'warning') || null
  const health = worst?.severity === 'critical' ? 'critical' : worst?.severity === 'warning' ? 'warning' : 'healthy'
  const borderColor = worst
    ? (health === 'critical' ? 'var(--color-danger)' : 'var(--color-warning)')
    : 'var(--color-border-secondary)'

  // Special state badges
  const pumpId = POD_TO_PUMP[podName]
  const sensorData = pumpId ? (sensorReadings[pumpId] || {}) : {}
  const isFaultTarget = !!sensorData.active_fault
  const emissionHz = sensorData.emission_hz ?? sensorData.readings?.emission_hz
  const isFlood = !!pumpId && emissionHz != null && emissionHz > 2

  return (
    <div
      onClick={() => onClick(podName)}
      style={{
        background: 'var(--color-bg-card)',
        border: `1px solid ${borderColor}`,
        borderRadius: 6, padding: '0.8vh 0.8vw', cursor: 'pointer',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* Name row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5vw', marginBottom: '0.5vh' }}>
        <StatusDot health={worst ? health : 'healthy'} />
        <span style={{
          fontSize: 11, fontWeight: 600, flex: 1,
          color: 'var(--color-text-primary)',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {podName}
        </span>
      </div>

      {/* Badge row */}
      <div style={{ display: 'flex', gap: '0.4vw', flexWrap: 'nowrap', marginBottom: '0.6vh', overflow: 'hidden' }}>
        <span style={{ fontSize: 7, padding: '1px 3px', borderRadius: 8, background: nsStyle.bg, color: nsStyle.color, whiteSpace: 'nowrap' }}>
          {ns}
        </span>
        {isFaultTarget && (
          <span style={{ fontSize: 7, padding: '1px 3px', borderRadius: 8, background: 'var(--color-danger-tint)', color: 'var(--color-danger)', border: '1px solid var(--color-danger-border)', whiteSpace: 'nowrap' }}>
            Fault Target
          </span>
        )}
        {isFlood && (
          <span style={{ fontSize: 9, padding: '1px 5px', borderRadius: 8, background: 'var(--color-danger-tint)', color: 'var(--color-danger)' }}>
            ⚡ FLOOD
          </span>
        )}
      </div>

      {/* Metrics */}
      {!infoOnly && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4vh' }}>
          {cpuPct != null
            ? <MiniProgressBar label="CPU" value={cpuPct} max={100} />
            : <div style={{ fontSize: 10, color: 'var(--color-text-tertiary)' }}>CPU —</div>
          }
          {memPct != null
            ? <MiniProgressBar label="MEM" value={memPct} max={100} />
            : <div style={{ fontSize: 10, color: 'var(--color-text-tertiary)' }}>MEM —</div>
          }
          {fmtTx(tx) && (
            <div style={{ fontSize: 10, color: 'var(--color-text-tertiary)' }}>
              NET TX ↑ {fmtTx(tx)}
            </div>
          )}
          <div style={{ fontSize: 10, color: restarts > 0 ? 'var(--color-warning)' : 'var(--color-text-tertiary)' }}>
            Restarts: {restarts}
          </div>
        </div>
      )}
      {infoOnly && (
        <div style={{ fontSize: 10, color: 'var(--color-text-tertiary)' }}>Status-only · no charts</div>
      )}

      {/* Anomaly footer */}
      {worst && (
        <div style={{
          fontSize: 10, marginTop: '0.6vh',
          color: health === 'critical' ? 'var(--color-danger)' : 'var(--color-warning)',
          borderTop: '1px solid var(--color-border-card)', paddingTop: '0.5vh',
        }}>
          {worst.anomaly_type}
        </div>
      )}
    </div>
  )
}
