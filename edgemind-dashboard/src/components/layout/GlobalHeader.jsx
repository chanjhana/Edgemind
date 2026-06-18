import { useState, useEffect } from 'react'
import { NavLink } from 'react-router-dom'
import { useAppState } from '../../core/store/AppContext.jsx'

const NAV = [
  { to: '/',            label: 'Command Center', icon: '⬡' },
  { to: '/radar',       label: 'Resource Radar',  icon: '◈' },
  { to: '/graph',       label: 'Dependency Graph', icon: '⬡' },
  { to: '/timeline',    label: 'Anomaly Timeline', icon: '▬' },
  { to: '/investigate', label: 'AI Investigation', icon: '◎' },
  { to: '/demo',        label: 'Demo Lab',         icon: '⚡' },
]

function UtcClock() {
  const [time, setTime] = useState(() => new Date().toUTCString().slice(17, 25))
  useEffect(() => {
    const id = setInterval(() => setTime(new Date().toUTCString().slice(17, 25)), 1000)
    return () => clearInterval(id)
  }, [])
  return <span style={{ color: 'var(--color-text-tertiary)', fontVariantNumeric: 'tabular-nums', fontSize: 12 }}>{time} UTC</span>
}

function WsDot({ status }) {
  const color = status === 'connected' ? 'var(--color-success)' :
                status === 'reconnecting' ? 'var(--color-warning)' : 'var(--color-danger)'
  return (
    <span
      title={`WebSocket: ${status}`}
      className={status !== 'connected' ? 'animate-blink' : ''}
      style={{ width: 8, height: 8, borderRadius: '50%', background: color, display: 'inline-block', flexShrink: 0 }}
    />
  )
}

export default function GlobalHeader() {
  const { ws } = useAppState()

  return (
    <header style={{
      height: 'var(--header-height)',
      flexShrink: 0,
      display: 'flex',
      alignItems: 'center',
      padding: '0 16px',
      borderBottom: '3px solid var(--color-danger)',
      background: 'var(--color-bg-card)',
      gap: 0,
    }}>
      {/* Brand */}
      <span style={{ color: 'var(--color-danger)', fontSize: 18, fontWeight: 700, marginRight: 6 }}>◈</span>
      <span style={{ color: 'var(--color-text-primary)', fontWeight: 700, fontSize: 14, marginRight: 4 }}>EdgeMind</span>
      <span style={{ color: 'var(--color-border-primary)', margin: '0 6px', fontSize: 12 }}></span>
      <span style={{ color: 'var(--color-text-tertiary)', fontSize: 11, marginRight: 20 }}> </span>

      {/* Nav items */}
      <nav style={{ display: 'flex', alignItems: 'stretch', height: '100%', gap: 2 }}>
        {NAV.map(({ to, label, icon }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            style={({ isActive }) => ({
              display: 'flex',
              alignItems: 'center',
              gap: 5,
              padding: '0 12px',
              color: isActive ? 'var(--color-danger)' : 'var(--color-text-secondary)',
              textDecoration: 'none',
              fontSize: 12,
              fontWeight: isActive ? 700 : 400,
              borderBottom: `3px solid ${isActive ? 'var(--color-danger)' : 'transparent'}`,
              marginBottom: -3,
              whiteSpace: 'nowrap',
              transition: 'color 0.1s',
            })}
          >
            <span style={{ opacity: 0.6, fontSize: 10 }}>{icon}</span>
            {label}
          </NavLink>
        ))}
      </nav>

      <div style={{ flex: 1 }} />
      <UtcClock />
      <span style={{ margin: '0 10px' }} />
      <WsDot status={ws.status} />
    </header>
  )
}
