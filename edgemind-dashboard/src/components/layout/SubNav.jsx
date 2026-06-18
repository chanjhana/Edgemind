export default function SubNav({ tabs, active, onSelect, actions }) {
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: 4,
      padding: '0 0 12px 0',
      borderBottom: '1px solid var(--color-border-card)',
      marginBottom: 12,
    }}>
      {tabs.map(tab => (
        <button
          key={tab.id}
          onClick={() => onSelect(tab.id)}
          style={{
            padding: '4px 12px',
            borderRadius: 20,
            border: `1px solid ${active === tab.id ? 'var(--color-info)' : 'var(--color-border-primary)'}`,
            background: active === tab.id ? 'var(--color-info-tint)' : 'transparent',
            color: active === tab.id ? 'var(--color-info)' : 'var(--color-text-secondary)',
            cursor: 'pointer',
            fontSize: 12,
            transition: 'all 0.1s',
          }}
        >
          {tab.label}
        </button>
      ))}
      {actions && <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>{actions}</div>}
    </div>
  )
}
