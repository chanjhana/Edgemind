export default function WarmingUpBanner() {
  return (
    <div style={{
      background: 'var(--color-warning-tint)',
      border: '1px solid var(--color-warning-border)',
      borderRadius: 6,
      padding: '8px 12px',
      fontSize: 12,
      color: 'var(--color-warning)',
      display: 'flex',
      alignItems: 'center',
      gap: 8,
    }}>
      <span className="animate-blink">◌</span>
      <span>EdgeMind agents are warming up — waiting for first findings (~5 min after deploy)</span>
    </div>
  )
}
