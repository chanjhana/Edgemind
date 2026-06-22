export default function NamespaceHeader({ ns, collapsed, onToggle }) {
  return (
    <div
      onClick={onToggle}
      style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '8px 12px',
        background: 'var(--color-bg-surface)',
        borderBottom: '1px solid var(--color-border-card)',
        cursor: 'pointer', userSelect: 'none',
        transition: 'background 0.2s',
      }}
      onMouseEnter={e => e.currentTarget.style.background = 'var(--color-bg-card-hover)'}
      onMouseLeave={e => e.currentTarget.style.background = 'var(--color-bg-surface)'}
    >
      <span style={{ fontSize: 10, color: 'var(--color-text-tertiary)', transition: 'transform 0.2s', transform: collapsed ? 'rotate(-90deg)' : 'rotate(0deg)' }}>▼</span>
      <span style={{ fontSize: 11, fontWeight: 800, color: 'var(--color-text-primary)', textTransform: 'uppercase', letterSpacing: '0.04em', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ns}</span>
    </div>
  )
}
