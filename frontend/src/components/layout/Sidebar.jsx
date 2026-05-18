import { NavLink, useLocation } from 'react-router-dom'
import { Sun, Moon, Wifi, WifiOff, Home, Grid2x2, Cpu, Zap, MessageCircle, Bell, CheckSquare, Settings, ShieldAlert, RefreshCw } from 'lucide-react'
import { useUIStore } from '../../stores/uiStore'
import { useAuthStore } from '../../stores/authStore'

const ROLE_ORDER = ['user', 'admin', 'super_admin']
function hasRole(userRole, minRole) {
  return ROLE_ORDER.indexOf(userRole) >= ROLE_ORDER.indexOf(minRole)
}

const PRIMARY = [
  { to: '/',            Icon: Home,           label: 'Home' },
  { to: '/rooms',       Icon: Grid2x2,        label: 'Rooms' },
  { to: '/chat',        Icon: MessageCircle,  label: 'Ask Ziggy' },
  { to: '/devices',     Icon: Cpu,            label: 'Devices' },
  { to: '/automations', Icon: Zap,            label: 'Automations' },
]

const SECONDARY = [
  { to: '/alerts',    Icon: Bell,        label: 'Alerts' },
  { to: '/tasks',     Icon: CheckSquare, label: 'Tasks' },
  { to: '/ha-update', Icon: RefreshCw,   label: 'HA Update' },
  { to: '/settings',  Icon: Settings,    label: 'Settings' },
]

function NavItem({ to, Icon, label }) {
  const location = useLocation()
  const active = to === '/' ? location.pathname === '/' : location.pathname.startsWith(to)
  return (
    <NavLink
      to={to}
      className={`z-nav-item ${active ? 'active' : ''}`}
      style={{ textDecoration: 'none' }}
    >
      <Icon size={15} strokeWidth={active ? 2.1 : 1.7} color={active ? 'var(--ink)' : 'var(--ink-faint)'} style={{ flexShrink: 0 }} />
      <span style={{ flex: 1, fontSize: 13 }}>{label}</span>
    </NavLink>
  )
}

export function Sidebar({ connected }) {
  const { theme, toggleTheme } = useUIStore()
  const { role } = useAuthStore()
  const isSuperAdmin = hasRole(role, 'super_admin')

  return (
    <aside
      className="hidden md:flex flex-col shrink-0 h-screen sticky top-0 scrollbar-thin"
      style={{
        width: 196,
        background: 'var(--surface)',
        borderRight: '0.5px solid var(--line)',
        padding: '18px 10px',
      }}
    >
      {/* Logo */}
      <div style={{ padding: '0 8px 20px', display: 'flex', alignItems: 'center', gap: 4 }}>
        <span style={{ fontWeight: 700, fontSize: 17, letterSpacing: '-0.025em', color: 'var(--ink)' }}>
          Ziggy
        </span>
        <span style={{ color: 'var(--accent)', fontSize: 18, fontWeight: 700, lineHeight: 1 }}>.</span>
        <span
          style={{
            marginLeft: 'auto', width: 6, height: 6, borderRadius: '50%', flexShrink: 0,
            background: connected ? 'var(--ok)' : 'var(--err)',
            boxShadow: `0 0 0 3px color-mix(in srgb, ${connected ? 'var(--ok)' : 'var(--err)'} 22%, transparent)`,
          }}
        />
      </div>

      {/* Primary nav */}
      <nav style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {PRIMARY.map(p => <NavItem key={p.to} {...p} />)}
      </nav>

      {/* Divider */}
      <div style={{ height: 1, background: 'var(--line)', margin: '10px 0' }} />

      {/* Secondary nav */}
      <nav style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {SECONDARY.map(p => <NavItem key={p.to} {...p} />)}
      </nav>

      {/* Spacer */}
      <div style={{ flex: 1 }} />

      {/* Footer */}
      <div style={{ paddingTop: 12, borderTop: '0.5px solid var(--line)', display: 'flex', flexDirection: 'column', gap: 4 }}>
        {isSuperAdmin && (
          <NavItem to="/ops" Icon={ShieldAlert} label="Ops Console" />
        )}
        <div style={{ display: 'flex', alignItems: 'center', padding: '4px 8px' }}>
          <button
            onClick={toggleTheme}
            style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--ink-faint)', padding: 0, display: 'flex', alignItems: 'center', borderRadius: 6 }}
            title="Toggle theme"
          >
            {theme === 'dark' ? <Sun size={14} /> : <Moon size={14} />}
          </button>
          <span style={{ marginLeft: 'auto', color: connected ? 'var(--ok)' : 'var(--err)', display: 'flex', alignItems: 'center' }}>
            {connected ? <Wifi size={13} /> : <WifiOff size={13} />}
          </span>
        </div>
      </div>
    </aside>
  )
}
