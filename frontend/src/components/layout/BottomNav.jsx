import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { useState } from 'react'
import { Bell, CheckSquare, Cpu, MoreHorizontal, Settings, ShieldAlert, WifiOff } from 'lucide-react'
import { useAuthStore } from '../../stores/authStore'

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
    case 'sparkle': return <svg {...p}><path d="M12 3v18M3 12h18M5.6 5.6l12.8 12.8M5.6 18.4L18.4 5.6"/></svg>
    default: return null
  }
}

const TABS_LEFT = [
  { to: '/',      name: 'home',  label: 'Home' },
  { to: '/rooms', name: 'rooms', label: 'Rooms' },
]
const TABS_RIGHT = [
  { to: '/automations', name: 'auto', label: 'Automations' },
]
const MORE_BASE = [
  { to: '/devices',  Icon: Cpu,         label: 'Devices' },
  { to: '/alerts',   Icon: Bell,        label: 'Alerts' },
  { to: '/tasks',    Icon: CheckSquare, label: 'Tasks' },
  { to: '/settings', Icon: Settings,    label: 'Settings' },
]

// Bar + cradle + FAB geometry.
// Bar's top edge HUMPS UP around the FAB — the curve sits OVER the FAB's
// upper portion, cradling it with a 4px gap. Curve radius = FAB_R + GAP.
const ROW_H        = 60
const FAB_SIZE     = 68
const FAB_R        = FAB_SIZE / 2      // 34
const FAB_GAP      = 4
const ARC_R        = FAB_R + FAB_GAP   // 38
// HUMP_H < ARC_R → arc is <180° (shallow cup, not necked-in). FAB center sits
// (ARC_R - HUMP_H) = 3px BELOW the bar's top edge → ~55% of FAB is inside the bar.
// half-chord = sqrt(ARC_R² - (ARC_R - HUMP_H)²) = sqrt(38² - 3²) ≈ 37.88
const HUMP_H       = 35
const ARC_HALF_W   = Math.sqrt(ARC_R * ARC_R - (ARC_R - HUMP_H) ** 2)
const NOTCH_W      = 112
const ARC_X1       = NOTCH_W / 2 - ARC_HALF_W
const ARC_X2       = NOTCH_W / 2 + ARC_HALF_W
// FAB center sits at arc center → uniform FAB_GAP all around the cradle.
// CSS bottom = ROW_H + HUMP_H - ARC_R - FAB_R = 23 (FAB bottom 23px above bar bottom)
const FAB_BOTTOM   = ROW_H + HUMP_H - ARC_R - FAB_R

const BAR_BG = 'color-mix(in srgb, var(--bg) 97%, transparent)'

// Shared label style — `minWidth: 0` + ellipsis ensures the cell never expands
// past its grid track even if the label is longer than the cell width. Without
// this the long "Automations" label would push neighbouring cells narrower
// (under flex), which is exactly what threw the FAB off-center on Galaxy S24.
const TAB_LABEL = {
  fontSize: 12,
  lineHeight: 1, letterSpacing: '0.01em',
  minWidth: 0, maxWidth: '100%',
  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
}
const TAB_CELL = {
  // No flex:1 — the parent uses grid with minmax(0, 1fr), so each cell is
  // *exactly* 1/5 of the row regardless of its content. That's the property
  // we need for the Ziggy cell's center to land on the bar's geometric center.
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
      <ZIcon name={name} size={28} stroke={active ? 2 : 1.6} color={active ? 'var(--ink)' : 'var(--ink-faint)'} />
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

function MoreTab({ active, onClick, expanded }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="More"
      aria-expanded={expanded}
      style={{ ...TAB_CELL, background: 'transparent', border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}
    >
      <MoreHorizontal size={28} strokeWidth={active ? 2 : 1.6} color={active ? 'var(--ink)' : 'var(--ink-faint)'} />
      <span style={{
        ...TAB_LABEL,
        fontWeight: active ? 600 : 500,
        color: active ? 'var(--ink)' : 'var(--ink-faint)',
      }}>
        More
      </span>
    </button>
  )
}

export function BottomNav({ connected }) {
  const location = useLocation()
  const navigate = useNavigate()
  const { role } = useAuthStore()
  const [showMore, setShowMore] = useState(false)

  const chatActive = location.pathname.startsWith('/chat')
  const moreItems = [
    ...MORE_BASE,
    ...(hasRole(role, 'super_admin') ? [{ to: '/ops', Icon: ShieldAlert, label: 'Ops' }] : []),
  ]
  const isMoreActive = moreItems.some(n => location.pathname.startsWith(n.to))

  return (
    <>
      <AnimatePresence>
        {showMore && (
          <>
            <motion.div
              className="fixed inset-0 z-40 md:hidden"
              style={{ background: 'rgba(0,0,0,0.25)', backdropFilter: 'blur(4px)' }}
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              onClick={() => setShowMore(false)}
            />
            <motion.div
              className="fixed left-0 right-0 z-50 md:hidden"
              style={{
                // Mirror the bottom-nav's gesture-bar floor so the popover
                // sits the same distance above the bar on both 3-button and
                // gesture-nav Android (and on iOS).
                bottom: `calc(${ROW_H}px + max(env(safe-area-inset-bottom, 0px), 8px) + 12px)`,
                paddingLeft: 'max(12px, env(safe-area-inset-left, 0px))',
                paddingRight: 'max(12px, env(safe-area-inset-right, 0px))',
              }}
              initial={{ opacity: 0, y: 12, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 12, scale: 0.97 }}
              transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
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
                      onClick={() => { navigate(to); setShowMore(false) }}
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
            </motion.div>
          </>
        )}
      </AnimatePresence>

      <nav
        className="fixed bottom-0 left-0 right-0 z-30 md:hidden"
        style={{
          // NO paddingBottom here. We render an explicit "safe-area floor" sibling
          // below the notched bar (see below) so the bar's background extends all
          // the way to the bottom edge of the device. The previous approach used
          // a transparent padding zone, which let page content scroll through the
          // visible band between the bar and the system gesture / button area.
          paddingLeft: 'env(safe-area-inset-left, 0px)',
          paddingRight: 'env(safe-area-inset-right, 0px)',
        }}
      >
        {connected === false && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '3px 0', background: 'var(--err)', gap: 5 }}>
            <WifiOff size={10} color="#fff" />
            <span style={{ fontSize: 10, color: '#fff', fontWeight: 500 }}>offline</span>
          </div>
        )}

        {/* Bar: single band, notch on top edge cradles the FAB */}
        <div style={{ position: 'relative', height: ROW_H }}>

          {/* Background — SVG notch pinned at exact 50% via translateX(-50%),
              with two flanking flat strips that meet at the SVG's exact edges.
              Previously this used a 3-piece flex row to center the SVG — but
              on widths where (bar_width - NOTCH_W) is odd (e.g. 411px CSS
              viewport on Galaxy S24 in some zoom modes), flex distribution
              splits the remainder into 149.5 / 149.5 which the browser then
              rounds asymmetrically (149/150 or 150/149). That ½–1px drift
              moves the notch off the FAB's center, since the FAB is positioned
              with `left: 50%` and ignores rounding entirely.
              Explicit `left: 50%; transform: translateX(-50%)` makes the
              notch use the *same* anchoring math as the FAB — guaranteed
              to align regardless of bar width.
              The shared drop-shadow filter stays on the wrapping div so the
              1px dark outline still traces flat→hump→flat as one continuous
              alpha (per-element strokes would expose a seam at each junction). */}
          <div
            style={{
              position: 'absolute', inset: 0,
              filter: 'drop-shadow(0 -1px 0 rgba(0,0,0,0.55)) drop-shadow(0 -10px 22px rgba(0,0,0,0.18))',
            }}
            aria-hidden="true"
          >
            {/* Left strip — meets the SVG's left edge exactly */}
            <div style={{
              position: 'absolute', top: 0, bottom: 0, left: 0,
              right: `calc(50% + ${NOTCH_W / 2}px)`,
              background: BAR_BG,
              backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)',
            }}/>
            {/* Notch SVG — pinned at viewport-center, same math as the FAB */}
            <svg
              width={NOTCH_W} height={ROW_H}
              style={{
                position: 'absolute', top: 0, left: '50%',
                transform: `translateX(-${NOTCH_W / 2}px)`,
                display: 'block', overflow: 'visible',
              }}
            >
              <path
                d={`M 0 0 L ${ARC_X1} 0 A ${ARC_R} ${ARC_R} 0 0 1 ${ARC_X2} 0 L ${NOTCH_W} 0 L ${NOTCH_W} ${ROW_H} L 0 ${ROW_H} Z`}
                fill={BAR_BG}
              />
            </svg>
            {/* Right strip — meets the SVG's right edge exactly */}
            <div style={{
              position: 'absolute', top: 0, bottom: 0, right: 0,
              left: `calc(50% + ${NOTCH_W / 2}px)`,
              background: BAR_BG,
              backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)',
            }}/>
          </div>

          {/* Foreground — tab row.
              GRID instead of flex: `minmax(0, 1fr)` forces every cell to be
              exactly 1/5 of the row width regardless of the label's intrinsic
              width. With flex:1 the long "Automations" label would steal
              space from neighbours (min-width: auto wins), pushing the
              centered Ziggy cell off the bar's geometric center → FAB no
              longer aligned to the SVG notch. iPhone happened to skate by
              because Heebo renders slightly narrower in Safari + larger
              CSS width; Android Chrome at ~384px revealed the bug. */}
          <div style={{
            position: 'relative', zIndex: 1,
            display: 'grid',
            gridTemplateColumns: 'repeat(5, minmax(0, 1fr))',
            alignItems: 'end',
            height: ROW_H, maxWidth: 480, margin: '0 auto', padding: '0 4px',
          }}>
            {TABS_LEFT.map(p => <Tab key={p.to} {...p} />)}

            {/* Ziggy cell — FAB visual is absolutely positioned above; label sits inline */}
            <NavLink
              to="/chat"
              onClick={() => setShowMore(false)}
              aria-label="Ziggy"
              style={{
                position: 'relative',
                minWidth: 0,
                display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end',
                padding: '8px 4px 6px',
                textDecoration: 'none', WebkitTapHighlightColor: 'transparent',
              }}
            >
              <div style={{
                position: 'absolute',
                left: '50%',
                bottom: FAB_BOTTOM,
                transform: 'translateX(-50%)',
                width: FAB_SIZE, height: FAB_SIZE, borderRadius: '50%',
                background: chatActive ? 'var(--accent)' : 'var(--ink)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                boxShadow: chatActive
                  ? '0 0 0 6px color-mix(in srgb, var(--accent) 18%, transparent), 0 8px 18px rgba(0,0,0,0.22)'
                  : '0 8px 18px rgba(0,0,0,0.22)',
                transition: 'background 0.2s, box-shadow 0.2s',
              }}>
                <ZIcon name="sparkle" size={28} stroke={1.8} color="var(--bg)" />
              </div>
              <span style={{
                fontSize: 12, fontWeight: 600,
                color: chatActive ? 'var(--accent)' : 'var(--ink-faint)',
                lineHeight: 1, letterSpacing: '0.01em',
              }}>
                Ziggy
              </span>
            </NavLink>

            {TABS_RIGHT.map(p => <Tab key={p.to} {...p} />)}
            <MoreTab active={isMoreActive} onClick={() => setShowMore(true)} expanded={showMore} />
          </div>
        </div>

        {/* Safe-area floor — solid bar background extending through the gesture
            handle / system button strip. Without this, the bar would float
            above the OS bottom strip and page content would be visible behind
            it (the original bug on Galaxy S24 and on desktop where env() == 0
            but the 8px floor still leaves a transparent band).
            Height = max(env, 8px) keeps the floor present on 3-button Android
            (env == 0) while matching the gesture-bar height on iOS / gesture
            Android. backdropFilter mirrors the bar so the blur stays continuous
            below the curved section. */}
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
