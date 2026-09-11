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
  { to: '/actions',     Icon: Zap,            labelKey: 'nav.automations' },
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
      <Icon size={18} strokeWidth={active ? 2 : 1.75} color={active ? 'var(--ink)' : 'var(--ink-mute)'} style={{ flexShrink: 0 }} />
      <span style={{ flex: 1 }}>{label}</span>
    </NavLink>
  )
}

// Footer icon buttons keep a 44px target (desktop minimum is 28, but these
// sit at the very bottom of the window where the pointer arrives fast).
const footBtn = {
  background: 'transparent', border: 'none', cursor: 'pointer',
  width: 40, height: 40, borderRadius: 'var(--r-ctl)', padding: 0,
  display: 'flex', alignItems: 'center', justifyContent: 'center',
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
        // Sidebar bg matches the tile/card surface (var(--surface) =
        // #14191D in dark, #FFFFFF in light). Stays one step ABOVE the
        // page bg so the boundary between sidebar and main is a clean
        // surface-on-bg step, not a flat hairline. Nav-item hover/active
        // states use --surface-2 so they're visible against this bg.
        background: 'var(--surface)',
        borderRight: '0.5px solid var(--line)',
        padding: '16px 12px',
        // Sidebar is desktop-only; safe-area-top is for tablets/laptops with
        // notch (e.g. MacBook Pro in fullscreen, iPad PWA).
        paddingTop: 'calc(16px + var(--safe-top))',
        paddingBottom: 'calc(16px + var(--safe-bottom))',
      }}
    >
      {/* Wordmark — the one place the brand accent appears in the chrome. */}
      <div style={{ padding: '4px 12px 24px', display: 'flex', alignItems: 'center', gap: 2, minHeight: 40 }}>
        <span style={{ fontWeight: 700, fontSize: 18, letterSpacing: '-0.02em', color: 'var(--ink)', lineHeight: 1 }}>
          Ziggy
        </span>
        <span style={{ color: 'var(--accent)', fontSize: 18, fontWeight: 700, lineHeight: 1 }}>.</span>
        <span
          aria-label={connected ? t('common.connected') : t('common.offline')}
          style={{
            marginInlineStart: 'auto', width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
            background: connected ? 'var(--ok)' : 'var(--err)',
            boxShadow: `0 0 0 3px color-mix(in srgb, ${connected ? 'var(--ok)' : 'var(--err)'} 22%, transparent)`,
          }}
        />
      </div>

      {/* Primary nav */}
      <nav style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {PRIMARY.map(p => <NavItem key={p.to} to={p.to} Icon={p.Icon} label={t(p.labelKey)} />)}
      </nav>

      {/* Divider */}
      <div style={{ height: 1, background: 'var(--line)', margin: '12px 0' }} />

      {/* Secondary nav */}
      <nav style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {SECONDARY.map(p => <NavItem key={p.to} to={p.to} Icon={p.Icon} label={t(p.labelKey)} />)}
      </nav>

      {/* Spacer */}
      <div style={{ flex: 1 }} />

      {/* Footer */}
      <div style={{ paddingTop: 12, borderTop: '0.5px solid var(--line)', display: 'flex', flexDirection: 'column', gap: 4 }}>
        {isSuperAdmin && (
          <NavItem to="/ops" Icon={ShieldAlert} label={t('nav.opsConsole')} />
        )}
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <button onClick={toggleTheme} style={{ ...footBtn, color: 'var(--ink-mute)' }} title={t('common.toggleTheme')} aria-label={t('common.toggleTheme')}>
            {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
          </button>
          <span style={{ ...footBtn, cursor: 'default', marginInlineStart: 'auto', color: connected ? 'var(--ok-text)' : 'var(--err-text)' }} title={connected ? t('common.connected') : t('common.offline')}>
            {connected ? <Wifi size={18} /> : <WifiOff size={18} />}
          </span>
        </div>
      </div>
    </aside>
  )
}
