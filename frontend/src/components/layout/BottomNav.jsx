import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Bell, CheckSquare, MoreHorizontal, Settings, WifiOff, Zap } from 'lucide-react'
import { useAuthStore } from '../../stores/authStore'
import { useFeature } from '../../stores/featuresStore'
import { useIsRTL, useLang, useT } from '../../lib/i18n'
import { useMotionOn } from '../../motion/flag'
import { haptic } from '../../motion/motion'
// Shell line icons live in ZIcon.jsx so the floating chat bubble can reuse
// the same "Ziggy" sparkle without importing this file's stores.
import { ZIcon } from './ZIcon'

const ROLE_ORDER = ['user', 'admin', 'super_admin']
function hasRole(userRole, minRole) {
  return ROLE_ORDER.indexOf(userRole) >= ROLE_ORDER.indexOf(minRole)
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
// --nav-h variable so pb-nav math stays in sync. 56 = 8 top + 26 icon +
// 4 gap + 11 label + 7 bottom, on the 4px grid.
const ROW_H  = 56
const BAR_BG = 'color-mix(in srgb, var(--bg) 92%, transparent)'

// Tab labels sit at the Caption role (11/500): Apple's tab bar uses 10pt,
// ours is one step up because Heebo's x-height runs small.
// `minWidth: 0` + ellipsis keeps long labels from pushing neighbouring cells
// narrower (under flex this drifted the cell centers off the grid track).
const TAB_LABEL = {
  fontSize: 11,
  lineHeight: 1, letterSpacing: '0.01em',
  minWidth: 0, maxWidth: '100%',
  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
}
const TAB_CELL = {
  minWidth: 0, height: ROW_H,
  display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4,
  padding: '4px 4px 0',
  WebkitTapHighlightColor: 'transparent',
}

function Tab({ to, name, label, motionOn }) {
  const location = useLocation()
  const active = to === '/' ? location.pathname === '/' : location.pathname.startsWith(to)
  return (
    <NavLink
      to={to}
      style={{ ...TAB_CELL, textDecoration: 'none' }}
      aria-current={active ? 'page' : undefined}
      // The only signal that arrives before the route does. Nothing else about
      // the tap changes.
      onClick={motionOn ? () => haptic('light') : undefined}
      data-motion-nav-cell={motionOn ? 'true' : undefined}
    >
      <ZIcon name={name} size={26} stroke={active ? 2 : 1.6} color={active ? 'var(--ink)' : 'var(--ink-mute)'} />
      <span style={{
        ...TAB_LABEL,
        fontWeight: active ? 600 : 500,
        color: active ? 'var(--ink)' : 'var(--ink-mute)',
      }}>
        {label}
      </span>
    </NavLink>
  )
}

function MoreTab({ active, onClick, expanded, label, motionOn, cellRef }) {
  return (
    <button
      ref={cellRef}
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-expanded={expanded}
      data-motion-nav-cell={motionOn ? 'true' : undefined}
      style={{ ...TAB_CELL, background: 'transparent', border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}
    >
      <MoreHorizontal size={26} strokeWidth={active ? 2 : 1.6} color={active ? 'var(--ink)' : 'var(--ink-mute)'} />
      <span style={{
        ...TAB_LABEL,
        fontWeight: active ? 600 : 500,
        color: active ? 'var(--ink)' : 'var(--ink-mute)',
      }}>
        {label}
      </span>
    </button>
  )
}

// Is a modal / sheet currently up? The bar must not tuck underneath one —
// Radix portals its dialogs to <body>, so a childList observer on body is the
// cheapest honest answer without reaching into Modal.jsx.
function useOverlayOpen(enabled) {
  const [open, setOpen] = useState(false)
  useEffect(() => {
    if (!enabled) { setOpen(false); return }
    const read = () => setOpen(!!document.querySelector(
      '[role="dialog"], [role="alertdialog"], [data-motion-sheet]',
    ))
    read()
    const obs = new MutationObserver(read)
    obs.observe(document.body, { childList: true, subtree: true })
    return () => obs.disconnect()
  }, [enabled])
  return open
}

// ── On the sliding tab highlight ─────────────────────────────────────────
// The sidebar gets one (see Sidebar.jsx) because `.z-nav-item.active` already
// DRAWS a surface — var(--surface-2) on a 0.5px var(--line) border at
// var(--r-ctl) — so the highlight can take that exact surface over and
// travel with it, leaving the resting sidebar pixel-identical.
//
// This bar has no such surface. In this design an active tab is an ink-weight
// icon and an ink label on the bare glass; there is nothing behind it (see
// Tab above). A travelling pill here would therefore not be a hand-over, it
// would be a new resting surface — a design change, which this layer does not
// make. So the bar keeps its own active treatment and the highlight is not
// drawn. Set NAV_HL_SURFACE to 'var(--surface-2)' to opt the bar into the
// sidebar's treatment; the measurement below already has the geometry.
const NAV_HL_SURFACE = null

export function BottomNav({ connected, tucked = false }) {
  const location = useLocation()
  const navigate = useNavigate()
  const { role } = useAuthStore()
  const t = useT()
  const lang = useLang()
  const rtl = useIsRTL()
  const motionOn = useMotionOn()
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
    // Ops console intentionally NOT surfaced in the More menu — it's an admin
    // tool reachable from Settings; keeping it out declutters the nav.
  ]
  const isMoreActive = moreItems.some(n => location.pathname.startsWith(n.to))

  // ── Measurement ──────────────────────────────────────────────────────
  // Two consumers: the More menu's transform-origin (so it grows out of the
  // tab you pressed) and, if NAV_HL_SURFACE is ever given a value, the
  // travelling highlight's rectangle. Re-measured on resize, orientation
  // change and language change — RTL reverses which cell is where, and a
  // longer label re-flows the row.
  const gridRef = useRef(null)
  const moreCellRef = useRef(null)
  const [hl, setHl] = useState(null)          // { x, y, w, h } in grid coords
  const [moreOriginX, setMoreOriginX] = useState(null)

  const activeIndex = (() => {
    const i = PRIMARY_TABS.findIndex(p => (
      p.to === '/' ? location.pathname === '/' : location.pathname.startsWith(p.to)
    ))
    if (i !== -1) return i
    if (isMoreActive) return PRIMARY_TABS.length
    return -1                                  // a route with no tab — hide it
  })()

  useLayoutEffect(() => {
    if (!motionOn) { setHl(null); setMoreOriginX(null); return }
    const measure = () => {
      const grid = gridRef.current
      if (!grid) return
      const more = moreCellRef.current
      if (more) setMoreOriginX(more.offsetLeft + more.offsetWidth / 2 + grid.getBoundingClientRect().left)
      // Nothing draws the highlight in this design (see NAV_HL_SURFACE), so
      // measuring it would only cost a second render pass per navigation.
      if (!NAV_HL_SURFACE) return
      // Query by attribute rather than child index — the highlight itself is
      // a child of the grid, so positional indexing would be off by one.
      const cell = grid.querySelectorAll('[data-motion-nav-cell]')[activeIndex]
      if (activeIndex < 0 || !cell) { setHl(null); return }
      // offsetLeft is physical, so this is already correct in RTL, where the
      // grid reverses the cell order.
      setHl({
        x: cell.offsetLeft,
        y: cell.offsetTop,
        w: cell.offsetWidth,
        h: cell.offsetHeight,
      })
    }
    measure()
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null
    if (ro && gridRef.current) ro.observe(gridRef.current)
    window.addEventListener('resize', measure)
    window.addEventListener('orientationchange', measure)
    return () => {
      ro?.disconnect()
      window.removeEventListener('resize', measure)
      window.removeEventListener('orientationchange', measure)
    }
  }, [motionOn, activeIndex, rtl, lang, moreItems.length, connected])

  // ── Tuck ─────────────────────────────────────────────────────────────
  // Never while a modal or sheet is up, never while the More menu is open,
  // never while the offline strip is showing (it is the bar's own message and
  // must not walk off with it). Reduced motion is handled in motion.css,
  // which pins the bar in place even when this says tucked — an OS setting
  // that can flip mid-session is better answered by the media query than by a
  // value captured at render.
  const overlayOpen = useOverlayOpen(motionOn)
  const isTucked = motionOn && tucked && !overlayOpen && !showMore && connected !== false

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
            data-motion-more-backdrop={motionOn ? 'true' : undefined}
            style={{ background: 'var(--scrim)', backdropFilter: 'blur(4px)', WebkitBackdropFilter: 'blur(4px)' }}
            onClick={() => setShowMore(false)}
          />
          <div
            className="fixed left-0 right-0 z-50 md:hidden"
            data-motion-more={motionOn ? 'true' : undefined}
            style={{
              // Mirror the bottom-nav's gesture-bar floor so the popover
              // sits the same distance above the bar on both 3-button and
              // gesture-nav Android (and on iOS).
              bottom: `calc(${ROW_H}px + max(env(safe-area-inset-bottom, 0px), 8px) + 12px)`,
              paddingLeft: 'max(12px, env(safe-area-inset-left, 0px))',
              paddingRight: 'max(12px, env(safe-area-inset-right, 0px))',
              // With motion on the enter comes from motion.css instead, which
              // grows the menu out of the More tab rather than lifting it off
              // the bar. Both are enter-only; an inline `animation` would win
              // over the stylesheet, so it is dropped rather than layered.
              ...(motionOn ? null : { animation: 'ziggy-sheet-in var(--dur-enter) var(--ease-enter)' }),
              // The wrapper's left edge is the viewport's, so the measured
              // centre is already local to it. Inert until the CSS enter
              // animation applies a transform.
              ...(motionOn && moreOriginX != null
                ? { transformOrigin: `${Math.round(moreOriginX)}px 100%` }
                : null),
            }}
          >
            {!motionOn && <style>{`@keyframes ziggy-sheet-in { from { transform: translateY(12px); opacity: 0 } to { transform: none; opacity: 1 } }`}</style>}
            <div style={{
              background: 'var(--surface)', border: '0.5px solid var(--line)',
              borderRadius: 'var(--r-sheet)', boxShadow: 'var(--shadow-lg)',
              padding: 8, display: 'grid',
              gridTemplateColumns: `repeat(${moreItems.length}, 1fr)`, gap: 8,
            }}>
              {moreItems.map(({ to, Icon, label }) => {
                const active = location.pathname.startsWith(to)
                return (
                  <button
                    key={to}
                    onClick={() => { setShowMore(false); navigate(to) }}
                    style={{
                      background: active ? 'var(--surface-2)' : 'transparent',
                      border: active ? '0.5px solid var(--line)' : '0.5px solid transparent',
                      cursor: 'pointer', borderRadius: 'var(--r-card)', minHeight: 64,
                      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6,
                      padding: '12px 8px', fontFamily: 'inherit',
                    }}
                  >
                    <Icon size={24} strokeWidth={active ? 2 : 1.6} color={active ? 'var(--ink)' : 'var(--ink-mute)'} />
                    <span style={{ fontSize: 12, fontWeight: active ? 600 : 500, color: active ? 'var(--ink)' : 'var(--ink-mute)' }}>
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
        // Tuck hooks. The transform lives in motion.css; with the flag off
        // neither attribute is emitted and the bar has no transition at all.
        data-motion-nav={motionOn ? 'true' : undefined}
        data-tucked={motionOn ? (isTucked ? 'true' : 'false') : undefined}
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
            padding: '4px 0', background: 'var(--err)', gap: 6,
          }}>
            <WifiOff size={12} color="var(--on-accent)" />
            <span style={{ fontSize: 11, color: 'var(--on-accent)', fontWeight: 500 }}>{t('common.offline')}</span>
          </div>
        )}

        {/* Flat 5-tab bar — Home · Rooms · Ask · Devices · More.
            Glass background uses color-mix on var(--bg) so it tints with
            the active palette. */}
        <div style={{
          position: 'relative',
          background: BAR_BG,
          backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',
          borderTop: '0.5px solid var(--line)',
        }}>
          <div
            ref={gridRef}
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(5, minmax(0, 1fr))',
              alignItems: 'stretch',
              height: ROW_H, maxWidth: 480, margin: '0 auto', padding: '0 4px',
              // Containing block for the highlight only. Nothing moves.
              ...(motionOn && NAV_HL_SURFACE ? { position: 'relative' } : null),
            }}
          >
            {motionOn && NAV_HL_SURFACE && hl && (
              <div
                data-motion-nav-hl
                aria-hidden="true"
                style={{
                  position: 'absolute', left: 0, top: 0,
                  width: hl.w, height: hl.h,
                  transform: `translate3d(${hl.x}px, ${hl.y}px, 0)`,
                  background: NAV_HL_SURFACE,
                  border: '0.5px solid var(--line)',
                  borderRadius: 'var(--r-ctl)',
                  boxSizing: 'border-box',
                  pointerEvents: 'none',
                }}
              />
            )}
            {PRIMARY_TABS.map(p => (
              <Tab key={p.to} to={p.to} name={p.name} label={t(p.labelKey)} motionOn={motionOn} />
            ))}
            <MoreTab
              active={isMoreActive}
              onClick={() => { if (motionOn) haptic('light'); setShowMore(true) }}
              expanded={showMore}
              label={t('nav.more')}
              motionOn={motionOn}
              cellRef={moreCellRef}
            />
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
