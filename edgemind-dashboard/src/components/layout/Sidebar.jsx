import { NavLink } from 'react-router-dom'
import { useAppState } from '../../core/store/AppContext.jsx'

const NAV = [
  { to: '/',            label: 'Command Center', icon: '⬡' },
  { to: '/radar',       label: 'Resource Radar', icon: '◈' },
  { to: '/graph',       label: 'Dependency Graph', icon: '⬡' },
  { to: '/timeline',    label: 'Anomaly Timeline', icon: '▬' },
  { to: '/investigate', label: 'AI Investigation', icon: 'â—Ž' },
  { to: '/demo',        label: 'Demo Lab', icon: 'âš¡' },
]

export default function Sidebar() {
  const { correlatedAlerts, findings } = useAppState()
  const criticalCount = findings.filter(f => f.severity === 'critical').length

  return (
    <nav style={{
      width: 'var(--sidebar-width)',
      flexShrink: 0,
      background: 'var(--color-bg-card)',
      borderRight: '1px solid var(--color-border-primary)',
      display: 'flex',
      flexDirection: 'column',
      height: '100vh',
    }}>
      {/* Logo */}
      <div style={{
        height: 'var(--header-height)',
        display: 'flex',
        alignItems: 'center',
        padding: '0 16px',
        borderBottom: '3px solid var(--color-danger)',
        gap: 10,
        flexShrink: 0,
      }}>
        <span style={{ color: 'var(--color-danger)', fontSize: 20, fontWeight: 700 }}>◈</span>
        <span style={{ color: 'var(--color-text-primary)', fontWeight: 700, fontSize: 14, letterSpacing: '0.05em' }}>
          EdgeMind
        </span>
      </div>

      {/* Nav items */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '8px 0' }}>
        {NAV.map(({ to, label, icon }) => (
          <NavLink key={to} to={to} end={to === '/'} style={({ isActive }) => ({
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '9px 16px',
            color: isActive ? 'var(--color-text-primary)' : 'var(--color-text-secondary)',
            textDecoration: 'none',
            borderLeft: `3px solid ${isActive ? 'var(--color-danger)' : 'transparent'}`,
            background: isActive ? 'rgba(255,0,15,0.06)' : 'transparent',
            fontSize: 13,
            transition: 'all 0.1s',
          })}>
            <span style={{ width: 16, textAlign: 'center', opacity: 0.7 }}>{icon}</span>
            {label}
          </NavLink>
        ))}
      </div>

      {/* Footer badge */}
      <div style={{
        padding: '10px 16px',
        borderTop: '1px solid var(--color-border-card)',
        color: 'var(--color-text-tertiary)',
        fontSize: 11,
      }}>
        <div>ABB Edgenius</div>
        <div>pump-station</div>
        {criticalCount > 0 && (
          <div style={{ color: 'var(--color-danger)', marginTop: 4 }}>
            {criticalCount} critical finding{criticalCount !== 1 ? 's' : ''}
          </div>
        )}
      </div>
    </nav>
  )
}
