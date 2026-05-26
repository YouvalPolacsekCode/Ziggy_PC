import { NavLink, useLocation } from 'react-router-dom'
import { Sun, Moon, Wifi, WifiOff, Home, Grid2x2, Cpu, Zap, MessageCircle, Bell, CheckSquare, Settings, ShieldAlert } from 'lucide-react'
import { useUIStore } from '../../stores/uiStore'
import { useAuthStore } from '../../stores/authStore'
import { useFeature } from '../../stores/featuresStore'
import { useT } from '../../lib/i18n'

const ROLE_ORDER = ['user', 'admin', 'super_admin']
function hasRole(userRole, minRole) {
  return ROLE_ORDER.indexOf(userRole) >= ROLE_ORDER.indexOf(minRole)
}

// `labelKey` instead of literal — resolved inside Sidebar() so label switches
// when the user flips language without us needing to memo/rebuild.
const PRIMARY = [
  { to: '/',            Icon: Home,           labelKey: 'nav.home' },
  { to: '/rooms',       Icon: Grid2x2,        labelKey: 'nav.rooms' },
  { to: '/chat',        Icon: MessageCircle,  labelKey: 'nav.askZiggy' },
  { to: '/devices',     Icon: Cpu,            labelKey: 'nav.devices' },
  { to: '/automations', Icon: Zap,            labelKey: 'nav.automations' },
]

const SECONDARY_BASE = [
  { to: '/alerts',   Icon: Bell,        labelKey: 'nav.alerts' },
  { to: '/tasks',    Icon: CheckSquare, labelKey: 'nav.tasks',    feature: 'task_tracking' },
  { to: '/settings', Icon: Settings,    labelKey: 'nav.settings' },
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
  const t = useT()
  const isSuperAdmin = hasRole(role, 'super_admin')
  const taskTrackingEnabled = useFeature('task_tracking')
  const SECONDARY = SECONDARY_BASE.filter(item =>
    !item.feature || (item.feature === 'task_tracking' && taskTrackingEnabled),
  )

  return (
    <aside
      className="hidden md:flex flex-col shrink-0 sticky top-0 scrollbar-thin"
      style={{
        // dvh keeps the sidebar exactly viewport-tall as URL bars animate,
        // and avoids the iOS "100vh = layout viewport > visible viewport"
        // gap that leaves an empty band at the bottom of fixed/sticky cols.
        height: 'var(--vh)',
        width: 'var(--sidebar-w)',
        background: 'var(--surface)',
        borderRight: '0.5px solid var(--line)',
        padding: '18px 10px',
        // Sidebar is desktop-only; safe-area-top is for tablets/laptops with
        // notch (e.g. MacBook Pro in fullscreen, iPad PWA).
        paddingTop: 'calc(18px + var(--safe-top))',
        paddingBottom: 'calc(18px + var(--safe-bottom))',
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
        {PRIMARY.map(p => <NavItem key={p.to} to={p.to} Icon={p.Icon} label={t(p.labelKey)} />)}
      </nav>

      {/* Divider */}
      <div style={{ height: 1, background: 'var(--line)', margin: '10px 0' }} />

      {/* Secondary nav */}
      <nav style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {SECONDARY.map(p => <NavItem key={p.to} to={p.to} Icon={p.Icon} label={t(p.labelKey)} />)}
      </nav>

      {/* Spacer */}
      <div style={{ flex: 1 }} />

      {/* Footer */}
      <div style={{ paddingTop: 12, borderTop: '0.5px solid var(--line)', display: 'flex', flexDirection: 'column', gap: 4 }}>
        {isSuperAdmin && (
          <NavItem to="/ops" Icon={ShieldAlert} label={t('nav.opsConsole')} />
        )}
        <div style={{ display: 'flex', alignItems: 'center', padding: '4px 8px' }}>
          <button
            onClick={toggleTheme}
            style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--ink-faint)', padding: 0, display: 'flex', alignItems: 'center', borderRadius: 6 }}
            title={t('common.toggleTheme')}
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
