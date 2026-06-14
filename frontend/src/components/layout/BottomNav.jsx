import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { Bell, CheckSquare, MoreHorizontal, Settings, ShieldAlert, WifiOff, Zap } from 'lucide-react'
import { useAuthStore } from '../../stores/authStore'
import { useFeature } from '../../stores/featuresStore'
import { useT } from '../../lib/i18n'

const ROLE_ORDER = ['user', 'admin', 'super_admin']
function hasRole(userRole, minRole) {
  return ROLE_ORDER.indexOf(userRole) >= ROLE_ORDER.indexOf(minRole)
}

function ZIcon({ name, size = 24, stroke = 1.6, color = 'currentColor' }) {
  const p = { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: color, strokeWidth: stroke, strokeLinecap: 'round', strokeLinejoin: 'round' }
  switch (name) {
    case 'home':    return <svg {...p}><path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z"/></svg>
    case 'rooms':   return <svg {...p}><rect x="3" y="3" width="8" height="8" rx="1"/><rect x="13" y="3" width="8" height="8" rx="1"/><rect x="3" y="13" width="8" height="8" rx="1"/><rect x="13" y="13" width="8" height="8" rx="1"/></svg>
    case 'auto':    return <svg {...p}><path d="M13 2L4 14h7l-1 8 9-12h-7l1-8z"/></svg>
    case 'devices': return <svg {...p}><rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6"/><path d="M9 2v2M15 2v2M9 20v2M15 20v2M2 9h2M2 15h2M20 9h2M20 15h2"/></svg>
    case 'sparkle': return <svg {...p}><path d="M12 3v18M3 12h18M5.6 5.6l12.8 12.8M5.6 18.4L18.4 5.6"/></svg>
    default: return null
  }
}

// `labelKey` resolves inside BottomNav() so labels track the active language
// live without rebuilding the array on each render.
const PRIMARY_TABS = [
  { to: '/',        name: 'home',    labelKey: 'nav.home' },
  { to: '/rooms',   name: 'rooms',   labelKey: 'nav.rooms' },
  { to: '/chat',    name: 'sparkle', labelKey: 'nav.ziggy' },
  { to: '/devices', name: 'devices', labelKey: 'nav.devices' },
]
const MORE_BASE = [
  { to: '/actions',     Icon: Zap,         labelKey: 'nav.automations' },
  { to: '/alerts',      Icon: Bell,        labelKey: 'nav.alerts' },
  { to: '/tasks',       Icon: CheckSquare, labelKey: 'nav.tasks',    feature: 'task_tracking' },
  { to: '/settings',    Icon: Settings,    labelKey: 'nav.settings' },
]

// Bar geometry — flat row, no notch / FAB. Bar height matches the CSS
// --nav-h variable so pb-nav math stays in sync.
const ROW_H  = 60
const BAR_BG = 'color-mix(in srgb, var(--bg) 92%, transparent)'

// `minWidth: 0` + ellipsis keeps long labels from pushing neighbouring cells
// narrower (under flex this drifted the cell centers off the grid track).
const TAB_LABEL = {
  fontSize: 12,
  lineHeight: 1, letterSpacing: '0.01em',
  minWidth: 0, maxWidth: '100%',
  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
}
const TAB_CELL = {
  minWidth: 0,
  display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
  padding: '8px 4px 6px',
  WebkitTapHighlightColor: 'transparent',
}

function Tab({ to, name, label }) {
  const location = useLocation()
  const active = to === '/' ? location.pathname === '/' : location.pathname.startsWith(to)
  return (
    <NavLink to={to} style={{ ...TAB_CELL, textDecoration: 'none' }}>
      <ZIcon name={name} size={26} stroke={active ? 2 : 1.6} color={active ? 'var(--ink)' : 'var(--ink-faint)'} />
      <span style={{
        ...TAB_LABEL,
        fontWeight: active ? 600 : 500,
        color: active ? 'var(--ink)' : 'var(--ink-faint)',
      }}>
        {label}
      </span>
    </NavLink>
  )
}

function MoreTab({ active, onClick, expanded, label }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-expanded={expanded}
      style={{ ...TAB_CELL, background: 'transparent', border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}
    >
      <MoreHorizontal size={26} strokeWidth={active ? 2 : 1.6} color={active ? 'var(--ink)' : 'var(--ink-faint)'} />
      <span style={{
        ...TAB_LABEL,
        fontWeight: active ? 600 : 500,
        color: active ? 'var(--ink)' : 'var(--ink-faint)',
      }}>
        {label}
      </span>
    </button>
  )
}

export function BottomNav({ connected }) {
  const location = useLocation()
  const navigate = useNavigate()
  const { role } = useAuthStore()
  const t = useT()
  const [showMore, setShowMore] = useState(false)

  // Force-close the More menu on any route change. Defensive against
  // framer-motion's AnimatePresence stalling its exit cycle when a heavy
  // lazy route (e.g. /devices) mounts mid-animation — without this, the
  // backdrop can get stuck over the whole viewport, blocking taps.
  useEffect(() => { setShowMore(false) }, [location.pathname])

  const taskTrackingEnabled = useFeature('task_tracking')
  const moreItems = [
    ...MORE_BASE.filter(item =>
      !item.feature || (item.feature === 'task_tracking' && taskTrackingEnabled),
    ).map(item => ({ ...item, label: t(item.labelKey) })),
    ...(hasRole(role, 'super_admin') ? [{ to: '/ops', Icon: ShieldAlert, label: t('nav.opsConsole') }] : []),
  ]
  const isMoreActive = moreItems.some(n => location.pathname.startsWith(n.to))

  return (
    <>
      {/* Plain conditional, NO AnimatePresence. The previous version used
          framer-motion's exit cycle, which stalled on cold-start when the
          /devices lazy chunk blocked the JS thread mid-animation, leaving
          the backdrop visibly stuck (blurred screen, all bottom-nav taps
          blocked). Plain conditional unmounts both elements synchronously
          the moment showMore flips to false — no animation state machine
          that can fail to complete. */}
      {showMore && (
        <>
          <div
            className="fixed inset-0 z-40 md:hidden"
            style={{ background: 'var(--scrim)', backdropFilter: 'blur(4px)', WebkitBackdropFilter: 'blur(4px)' }}
            onClick={() => setShowMore(false)}
          />
          <div
            className="fixed left-0 right-0 z-50 md:hidden"
            style={{
              // Mirror the bottom-nav's gesture-bar floor so the popover
              // sits the same distance above the bar on both 3-button and
              // gesture-nav Android (and on iOS).
              bottom: `calc(${ROW_H}px + max(env(safe-area-inset-bottom, 0px), 8px) + 12px)`,
              paddingLeft: 'max(12px, env(safe-area-inset-left, 0px))',
              paddingRight: 'max(12px, env(safe-area-inset-right, 0px))',
            }}
          >
            <div style={{
              background: 'var(--surface)', border: '0.5px solid var(--line)',
              borderRadius: 20, boxShadow: 'var(--shadow-lg)',
              padding: 10, display: 'grid',
              gridTemplateColumns: `repeat(${moreItems.length}, 1fr)`, gap: 6,
            }}>
              {moreItems.map(({ to, Icon, label }) => {
                const active = location.pathname.startsWith(to)
                return (
                  <button
                    key={to}
                    onClick={() => { setShowMore(false); navigate(to) }}
                    style={{
                      background: active ? 'var(--surface-2)' : 'transparent',
                      border: active ? '0.5px solid var(--line)' : 'none',
                      cursor: 'pointer', borderRadius: 14,
                      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5,
                      padding: '14px 8px', fontFamily: 'inherit',
                    }}
                  >
                    <Icon size={22} strokeWidth={active ? 2 : 1.6} color={active ? 'var(--ink)' : 'var(--ink-mute)'} />
                    <span style={{ fontSize: 11, fontWeight: 500, color: active ? 'var(--ink)' : 'var(--ink-mute)', letterSpacing: '0.01em' }}>
                      {label}
                    </span>
                  </button>
                )
              })}
            </div>
          </div>
        </>
      )}

      <nav
        className="fixed bottom-0 left-0 right-0 z-30 md:hidden"
        style={{
          // NO paddingBottom — we render an explicit safe-area floor sibling
          // below the bar (see below) so the bar's background extends all
          // the way to the bottom edge of the device. The previous approach
          // used a transparent padding zone, which let page content scroll
          // through the visible band between the bar and the system gesture
          // / button area.
          paddingLeft: 'env(safe-area-inset-left, 0px)',
          paddingRight: 'env(safe-area-inset-right, 0px)',
        }}
      >
        {connected === false && (
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: '3px 0', background: 'var(--err)', gap: 5,
          }}>
            <WifiOff size={10} color="var(--on-accent)" />
            <span style={{ fontSize: 10, color: 'var(--on-accent)', fontWeight: 500 }}>{t('common.offline')}</span>
          </div>
        )}

        {/* Flat 5-tab bar — Home · Rooms · Ask · Devices · More.
            Replaces the previous notched FAB pattern; the Ask tab is now
            a regular tab with the sparkle icon. Glass background uses
            color-mix on var(--bg) so it tints with the active palette. */}
        <div style={{
          position: 'relative',
          background: BAR_BG,
          backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',
          borderTop: '0.5px solid var(--line)',
        }}>
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(5, minmax(0, 1fr))',
            alignItems: 'end',
            height: ROW_H, maxWidth: 480, margin: '0 auto', padding: '0 4px',
          }}>
            {PRIMARY_TABS.map(p => <Tab key={p.to} to={p.to} name={p.name} label={t(p.labelKey)} />)}
            <MoreTab active={isMoreActive} onClick={() => setShowMore(true)} expanded={showMore} label={t('nav.more')} />
          </div>
        </div>

        {/* Safe-area floor — solid bar background extending through the gesture
            handle / system button strip. Without this, the bar would float
            above the OS bottom strip and page content would be visible
            behind it. Height = max(env, 8px) keeps the floor present on
            3-button Android (env == 0) while matching the gesture-bar
            height on iOS / gesture Android. */}
        <div
          aria-hidden="true"
          style={{
            height: 'max(env(safe-area-inset-bottom, 0px), 8px)',
            background: BAR_BG,
            backdropFilter: 'blur(20px)',
            WebkitBackdropFilter: 'blur(20px)',
          }}
        />
      </nav>
    </>
  )
}
