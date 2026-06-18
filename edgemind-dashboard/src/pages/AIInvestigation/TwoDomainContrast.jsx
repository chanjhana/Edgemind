export default function TwoDomainContrast({ alert }) {
  if (!alert) return null

  const pumpSide = alert.pump_domain || alert.physical_domain || null
  const infraSide = alert.infra_domain || alert.k8s_domain || null

  if (!pumpSide && !infraSide) return null

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 8 }}>
      <div style={{ background: 'var(--color-info-tint)', border: '1px solid rgba(0,76,151,0.20)', borderRadius: 6, padding: '10px 12px' }}>
        <div style={{ fontSize: 10, color: 'var(--color-info)', fontWeight: 700, marginBottom: 6 }}>PUMP / PHYSICAL</div>
        {pumpSide ? (
          <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', lineHeight: 1.5 }}>{pumpSide}</div>
        ) : (
          <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>No pump-domain data</div>
        )}
      </div>
      <div style={{ background: 'var(--color-info-tint)', border: '1px solid rgba(0,76,151,0.20)', borderRadius: 6, padding: '10px 12px' }}>
        <div style={{ fontSize: 10, color: 'var(--color-info)', fontWeight: 700, marginBottom: 6 }}>EDGE INFRA / K8S</div>
        {infraSide ? (
          <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', lineHeight: 1.5 }}>{infraSide}</div>
        ) : (
          <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>No infra-domain data</div>
        )}
      </div>
    </div>
  )
}
