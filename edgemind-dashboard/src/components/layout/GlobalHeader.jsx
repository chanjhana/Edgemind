import { useState, useEffect } from 'react'
import { NavLink } from 'react-router-dom'
import { useAppState } from '../../core/store/AppContext.jsx'

const NAV = [
  { to: '/',            label: 'Overview' },
  { to: '/radar',       label: 'Pod Stats'  },
  { to: '/graph',       label: 'Fault Lineage' },
  { to: '/timeline',    label: 'Anomaly Timeline' },
  { to: '/investigate', label: 'Diagnostics' },
  { to: '/demo',        label: 'Fault Demo'         },
]

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

function LocalClock() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(id)
  }, [])
  const d = now
  const h = d.getHours()
  const ampm = h >= 12 ? 'pm' : 'am'
  const h12 = h % 12 || 12
  const mm = String(d.getMinutes()).padStart(2, '0')
  const label = `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()} ${h12}:${mm} ${ampm}`
  return (
    <span style={{ color: 'var(--color-text-secondary)', fontVariantNumeric: 'tabular-nums', fontSize: 13 }}>
      {label}
    </span>
  )
}

function LogoMark() {
  return (
    <div style={{
      width: 34, height: 34, borderRadius: '50%', flexShrink: 0,
      background: 'linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%)',
      border: '2px solid #e53e3e',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      boxShadow: '0 1px 4px rgba(0,0,0,0.25)',
    }}>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
        <circle cx="12" cy="12" r="2" fill="#e53e3e" />
        <line x1="12" y1="10" x2="12" y2="4"  stroke="#90cdf4" strokeWidth="1.5" strokeLinecap="round" />
        <line x1="12" y1="14" x2="7"  y2="19" stroke="#90cdf4" strokeWidth="1.5" strokeLinecap="round" />
        <line x1="12" y1="14" x2="17" y2="19" stroke="#90cdf4" strokeWidth="1.5" strokeLinecap="round" />
        <circle cx="12" cy="4"  r="1.5" fill="#90cdf4" />
        <circle cx="7"  cy="19" r="1.5" fill="#90cdf4" />
        <circle cx="17" cy="19" r="1.5" fill="#90cdf4" />
      </svg>
    </div>
  )
}

export default function GlobalHeader() {
  const { ws } = useAppState()
  const wsColor = ws.status === 'connected' ? 'var(--color-success)'
    : ws.status === 'reconnecting' ? 'var(--color-warning)'
    : 'var(--color-danger)'

  return (
    <header style={{
      position: 'relative',
      height: 'var(--header-height)',
      flexShrink: 0,
      display: 'flex',
      alignItems: 'center',
      padding: '0 20px',
      borderBottom: '0px solid var(--color-danger)',
      background: 'var(--color-bg-card)',
      gap: 0,
    }}>
      {/* Brand */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginRight: 28 }}>
        <LogoMark />
        <span style={{
          color: 'var(--color-danger)', fontSize: 17, fontWeight: 800, letterSpacing: '-0.01em',
        }}>
          EdgeMind
        </span>
      </div>

      {/* Nav */}
      <nav style={{ 
        display: 'flex', alignItems: 'stretch', height: '100%', gap: 0,
        position: 'absolute', left: '50%', transform: 'translateX(-50%)'
      }}>
        {NAV.map(({ to, label }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            className={({ isActive }) => `nav-link-hover ${isActive ? 'active' : ''}`}
            style={({ isActive }) => ({
              display: 'flex',
              alignItems: 'center',
              padding: '0 24px',
              color: isActive ? 'var(--color-danger)' : 'var(--color-text-primary)',
              textDecoration: 'none',
              fontSize: 13,
              fontWeight: 700,
              whiteSpace: 'nowrap',
              transition: 'all 0.15s',
            })}
          >
            {label}
          </NavLink>
        ))}
      </nav>

      <div style={{ flex: 1 }} />

      {/* Right: clock · ws dot · gear · user */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        <LocalClock />
        <span
          title={`WebSocket: ${ws.status}`}
          className={ws.status !== 'connected' ? 'animate-blink' : ''}
          style={{
            width: 8, height: 8, borderRadius: '50%',
            background: wsColor, display: 'inline-block', flexShrink: 0,
          }}
        />
        {/* Gear icon */}
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--color-text-tertiary)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ cursor: 'pointer' }}>
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
        {/* User icon */}
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--color-text-tertiary)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ cursor: 'pointer' }}>
          <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
          <circle cx="12" cy="7" r="4" />
        </svg>
      </div>
    </header>
  )
}
