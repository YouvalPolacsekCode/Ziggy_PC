import { useLayoutEffect, useRef, useState } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { Sun, Moon, Wifi, WifiOff, Home, Grid2x2, Cpu, Zap, MessageCircle, Bell, CheckSquare, Settings, ShieldAlert } from 'lucide-react'
import { useUIStore } from '../../stores/uiStore'
import { useAuthStore } from '../../stores/authStore'
import { useFeature } from '../../stores/featuresStore'
import { useLang, useT } from '../../lib/i18n'
import { useMotionOn } from '../../motion/flag'

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

function NavItem({ to, Icon, label, inMotionGroup }) {
  const location = useLocation()
  const active = to === '/' ? location.pathname === '/' : location.pathname.startsWith(to)
  return (
    <NavLink
      to={to}
      className={`z-nav-item ${active ? 'active' : ''}`}
      // position: relative only lifts the item into the same paint layer as
      // the highlight travelling behind it. Nothing moves.
      style={{ textDecoration: 'none', ...(inMotionGroup ? { position: 'relative' } : null) }}
      data-motion-nav-cell={inMotionGroup ? 'true' : undefined}
    >
      <Icon size={18} strokeWidth={active ? 2 : 1.75} color={active ? 'var(--ink)' : 'var(--ink-mute)'} style={{ flexShrink: 0 }} />
      <span style={{ flex: 1 }}>{label}</span>
    </NavLink>
  )
}

// A nav group whose active surface slides between its items instead of
// teleporting. The highlight draws EXACTLY what `.z-nav-item.active` draws —
// var(--surface-2) on a 0.5px var(--line) border at var(--r-ctl) — and
// motion.css suppresses the item's own background while the highlight is
// present (data-motion-hl), so this is a hand-over, not a second surface, and
// the resting sidebar is pixel-identical either way.
function NavGroup({ items, t, motionOn, ...navProps }) {
  const location = useLocation()
  const navRef = useRef(null)
  const [hl, setHl] = useState(null)
  const lang = useLang()

  const activeIndex = items.findIndex(p => (
    p.to === '/' ? location.pathname === '/' : location.pathname.startsWith(p.to)
  ))

  useLayoutEffect(() => {
    if (!motionOn) { setHl(null); return }
    const measure = () => {
      const nav = navRef.current
      if (!nav) return
      const cell = nav.querySelectorAll('[data-motion-nav-cell]')[activeIndex]
      if (activeIndex < 0 || !cell) { setHl(null); return }
      setHl({ y: cell.offsetTop, h: cell.offsetHeight })
    }
    measure()
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null
    if (ro && navRef.current) ro.observe(navRef.current)
    window.addEventListener('resize', measure)
    return () => { ro?.disconnect(); window.removeEventListener('resize', measure) }
    // lang is in here because a longer label can wrap an item to a second line.
  }, [motionOn, activeIndex, items.length, lang])

  return (
    <nav
      ref={navRef}
      data-motion-nav-group={motionOn ? 'true' : undefined}
      // Only hand the active surface over once the highlight actually exists,
      // so a failed measurement can never leave the active item looking
      // inactive.
      data-motion-hl={motionOn && hl ? 'true' : undefined}
      style={{
        display: 'flex', flexDirection: 'column', gap: 4,
        ...(motionOn ? { position: 'relative' } : null),
      }}
      {...navProps}
    >
      {motionOn && hl && (
        <div
          data-motion-nav-hl
          aria-hidden="true"
          style={{
            position: 'absolute', left: 0, right: 0, top: 0,
            height: hl.h,
            transform: `translate3d(0, ${hl.y}px, 0)`,
            background: 'var(--surface-2)',
            border: '0.5px solid var(--line)',
            borderRadius: 'var(--r-ctl)',
            boxSizing: 'border-box',
            pointerEvents: 'none',
          }}
        />
      )}
      {items.map(p => (
        <NavItem key={p.to} to={p.to} Icon={p.Icon} label={t(p.labelKey)} inMotionGroup={motionOn} />
      ))}
    </nav>
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
  const motionOn = useMotionOn()
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
      <NavGroup items={PRIMARY} t={t} motionOn={motionOn} />

      {/* Divider */}
      <div style={{ height: 1, background: 'var(--line)', margin: '12px 0' }} />

      {/* Secondary nav */}
      <NavGroup items={SECONDARY} t={t} motionOn={motionOn} />

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
