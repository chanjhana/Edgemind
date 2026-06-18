export default function NamespaceHeader({ ns, podCount, collapsed, onToggle }) {
  return (
    <div
      onClick={onToggle}
      style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '4px 8px',
        background: 'var(--color-bg-surface)',
        borderBottom: '1px solid var(--color-border-card)',
        cursor: 'pointer', userSelect: 'none',
      }}
    >
      <span style={{ fontSize: 10, color: 'var(--color-text-tertiary)' }}>{collapsed ? 'â–¶' : 'â–¼'}</span>
      <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--color-text-secondary)' }}>{ns}</span>
      <span style={{ fontSize: 10, color: 'var(--color-text-tertiary)' }}>{podCount} pod{podCount !== 1 ? 's' : ''}</span>
    </div>
  )
}
