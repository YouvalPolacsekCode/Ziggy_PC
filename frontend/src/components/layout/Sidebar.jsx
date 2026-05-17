import { useEffect } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { Sun, Moon, Wifi, WifiOff } from 'lucide-react'
import { useUIStore } from '../../stores/uiStore'
import { useSuggestionStore } from '../../stores/suggestionStore'
import { useAuthStore } from '../../stores/authStore'

// Icons as minimal SVG paths — matching the design's stroke-based icon set
function ZIcon({ name, size = 16 }) {
  const s = size
  const props = { width: s, height: s, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round' }
  switch (name) {
    case 'home':    return <svg {...props}><path d="M3 11l9-8 9 8M5 10v10h14V10"/></svg>
    case 'grid':    return <svg {...props}><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>
    case 'cpu':     return <svg {...props}><rect x="4" y="4" width="16" height="16" rx="2"/><path d="M9 9h6v6H9z"/><path d="M9 1v3M15 1v3M9 20v3M15 20v3M1 9h3M1 15h3M20 9h3M20 15h3"/></svg>
    case 'bolt':    return <svg {...props}><path d="M13 2L4 14h7l-1 8 9-12h-7l1-8z"/></svg>
    case 'route':   return <svg {...props}><circle cx="6" cy="6" r="3"/><circle cx="18" cy="18" r="3"/><path d="M6 9v6a3 3 0 0 0 3 3h6"/></svg>
    case 'sparkle': return <svg {...props}><path d="M12 2l2.4 7.4H22l-6.2 4.5 2.4 7.4L12 17l-6.2 4.3 2.4-7.4L2 9.4h7.6z"/></svg>
    case 'bulb':    return <svg {...props}><path d="M9 18h6M10 22h4"/><path d="M12 2a6 6 0 0 0-4 10.5c.7.7 1 1.6 1 2.5v1h6v-1c0-.9.3-1.8 1-2.5A6 6 0 0 0 12 2z"/></svg>
    case 'mic':     return <svg {...props}><rect x="9" y="3" width="6" height="12" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>
    case 'wave':    return <svg {...props}><path d="M3 12h2M7 8v8M11 5v14M15 8v8M19 12h2"/></svg>
    case 'tasks':   return <svg {...props}><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>
    case 'brain':   return <svg {...props}><path d="M9.5 2A2.5 2.5 0 0 1 12 4.5v15a2.5 2.5 0 0 1-4.96-.46 2.5 2.5 0 0 1-1.07-4.58A3 3 0 0 1 4.5 9.5a2.5 2.5 0 0 1 3-3.45A2.5 2.5 0 0 1 9.5 2M14.5 2A2.5 2.5 0 0 0 12 4.5v15a2.5 2.5 0 0 0 4.96-.46 2.5 2.5 0 0 0 1.07-4.58A3 3 0 0 0 19.5 9.5a2.5 2.5 0 0 0-3-3.45A2.5 2.5 0 0 0 14.5 2"/></svg>
    case 'cog':     return <svg {...props}><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 0 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 0 1-4 0v-.1A1.7 1.7 0 0 0 9 19.4a1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 0 1-2.8-2.8l.1-.1A1.7 1.7 0 0 0 4.7 15a1.7 1.7 0 0 0-1.5-1H3a2 2 0 0 1 0-4h.1A1.7 1.7 0 0 0 4.6 9a1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 0 1 2.8-2.8l.1.1c.5.5 1.3.6 1.8.3.6-.2 1-.8 1-1.5V3a2 2 0 0 1 4 0v.1c0 .7.4 1.3 1 1.5.5.3 1.3.2 1.8-.3l.1-.1a2 2 0 0 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8c.2.6.8 1 1.5 1H21a2 2 0 0 1 0 4h-.1c-.7 0-1.3.4-1.5 1z"/></svg>
    case 'shield':  return <svg {...props}><path d="M12 2l8 4v6c0 5-3.5 9-8 10-4.5-1-8-5-8-10V6l8-4z"/></svg>
    case 'boxes':   return <svg {...props}><path d="M2.97 12.92A2 2 0 0 0 2 14.63v3.24a2 2 0 0 0 .97 1.71l3 1.8a2 2 0 0 0 2.06 0L12 19v-5.5l-5-3-4.03 2.42zM7 16.5l-4.74-2.85M7 16.5l5-3M7 16.5v5.17M12 13.5l4.74-2.85M12 13.5l-5-3M12 13.5v5.17M16.97 12.92A2 2 0 0 1 18 14.63v3.24a2 2 0 0 1-.97 1.71l-3 1.8a2 2 0 0 1-2.06 0L8 19v-5.5l5-3 3.97 2.42zM21 6.5l-4.74-2.85M21 6.5l-5 3M21 6.5v5.17M12 7.5l4.74-2.85M12 7.5l-5 3M12 7.5V2.33M7.03 6.92A2 2 0 0 0 6 8.63v3.24a2 2 0 0 0 .97 1.71l3 1.8a2 2 0 0 0 2.06 0L16 13V7.5l-5-3-3.97 2.42z"/></svg>
    case 'debug':   return <svg {...props}><path d="M9 9H5a2 2 0 0 0-2 2v1M9 9V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v4M9 9h6m0 0h4a2 2 0 0 1 2 2v1M15 9V5M3 12v5a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-5M8 17v1M12 17v1M16 17v1"/></svg>
    case 'bell':    return <svg {...props}><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
    case 'camera':  return <svg {...props}><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
    default: return null
  }
}

const NAV_ITEMS = [
  { to: '/',                icon: 'home',    label: 'Home' },
  { to: '/rooms',           icon: 'grid',    label: 'Rooms' },
  { to: '/devices',         icon: 'cpu',     label: 'Devices' },
  { to: '/cameras',         icon: 'camera',  label: 'Security' },
  { to: '/virtual-devices', icon: 'boxes',   label: 'Capabilities' },
  null,
  { to: '/automations',     icon: 'bolt',    label: 'Automations' },
  { to: '/routines',        icon: 'route',   label: 'Routines' },
  { to: '/scenes',          icon: 'sparkle', label: 'Scenes' },
  { to: '/suggestions',     icon: 'bulb',    label: 'Suggestions', badgeKey: 'suggestions' },
  { to: '/anomalies',       icon: 'bell',    label: 'Alerts' },
  null,
  { to: '/chat',            icon: 'mic',     label: 'Ziggy AI' },
  { to: '/quick-asks',      icon: 'wave',    label: 'Quick Asks' },
  null,
  { to: '/tasks',           icon: 'tasks',   label: 'Tasks' },
  { to: '/memory',          icon: 'brain',   label: 'Memory' },
  { to: '/settings',        icon: 'cog',     label: 'Settings' },
  { to: '/debug',           icon: 'debug',   label: 'Debug', adminOnly: true },
]

function NavItem({ to, icon, label, badge }) {
  const location = useLocation()
  const active = to === '/' ? location.pathname === '/' : location.pathname.startsWith(to)

  return (
    <NavLink
      to={to}
      className={`z-nav-item ${active ? 'active' : ''}`}
    >
      <span style={{ color: active ? 'var(--ink)' : 'var(--ink-faint)', flexShrink: 0 }}>
        <ZIcon name={icon} size={16} />
      </span>
      <span style={{ flex: 1 }}>{label}</span>
      {badge > 0 && (
        <span style={{
          background: 'var(--accent)', color: '#fff',
          fontSize: 9, fontWeight: 700,
          padding: '2px 6px', borderRadius: 999,
          fontFamily: '"IBM Plex Mono", monospace',
        }}>
          {badge}
        </span>
      )}
    </NavLink>
  )
}

export function Sidebar({ connected, features }) {
  const { theme, toggleTheme } = useUIStore()
  const { fetch: fetchSuggestions, pendingCount } = useSuggestionStore()
  const { role } = useAuthStore()
  const isSuperAdmin = role === 'super_admin'

  useEffect(() => { fetchSuggestions() }, [])

  const badges = { suggestions: pendingCount() }
  const visibleNav = NAV_ITEMS.filter(item => {
    if (item?.to === '/scenes' && !features?.scenes) return false
    if (item?.adminOnly && !isSuperAdmin) return false
    return true
  })

  return (
    <aside
      className="hidden md:flex flex-col shrink-0 h-screen sticky top-0 scrollbar-thin"
      style={{
        width: 200,
        background: 'var(--bg-2)',
        borderRight: '0.5px solid var(--line)',
        padding: '18px 12px',
      }}
    >
      {/* Logo */}
      <div style={{ padding: '0 6px 18px', display: 'flex', alignItems: 'baseline', gap: 6 }}>
        <span style={{
          fontFamily: "'Heebo', sans-serif",
          fontWeight: 600, fontSize: 18,
          letterSpacing: '-0.01em',
          color: 'var(--ink)',
        }}>
          Ziggy
        </span>
        <span style={{ color: 'var(--accent)', fontSize: 18, fontWeight: 600 }}>.</span>
        <div style={{
          marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6,
          fontSize: 10, color: 'var(--ink-faint)',
          fontFamily: '"IBM Plex Mono", monospace',
        }}>
          <span style={{
            width: 5, height: 5, borderRadius: '50%',
            background: connected ? 'var(--ok)' : 'var(--accent)',
          }} />
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 flex flex-col gap-0.5 overflow-y-auto scrollbar-thin">
        {visibleNav.map((item, i) => {
          if (item === null) return (
            <div key={`div-${i}`} style={{ height: 1, background: 'var(--line)', margin: '6px 0' }} />
          )
          return (
            <NavItem
              key={item.to}
              {...item}
              badge={item.badgeKey ? badges[item.badgeKey] : 0}
            />
          )
        })}
      </nav>

      {/* Footer */}
      <div style={{ paddingTop: 12, borderTop: '0.5px solid var(--line)' }}>
        {isSuperAdmin && (
          <NavLink
            to="/cloud-admin"
            style={({ isActive }) => ({
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '6px 8px', borderRadius: 8, marginBottom: 6,
              fontSize: 11, fontWeight: 600,
              color: isActive ? 'var(--accent)' : 'var(--ink-faint)',
              background: isActive ? 'var(--accent)10' : 'transparent',
              textDecoration: 'none',
            })}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2l8 4v6c0 5-3.5 9-8 10-4.5-1-8-5-8-10V6l8-4z"/>
            </svg>
            Cloud Admin
          </NavLink>
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <button
            onClick={toggleTheme}
            style={{
              background: 'transparent', border: 'none', cursor: 'pointer',
              color: 'var(--ink-faint)', padding: '4px', borderRadius: 6,
              display: 'flex', alignItems: 'center',
            }}
            title="Toggle theme"
          >
            {theme === 'dark' ? <Sun size={14} /> : <Moon size={14} />}
          </button>
          <span style={{ marginLeft: 'auto', color: connected ? 'var(--ok)' : 'var(--accent)' }}>
            {connected ? <Wifi size={13} /> : <WifiOff size={13} />}
          </span>
        </div>
      </div>
    </aside>
  )
}
