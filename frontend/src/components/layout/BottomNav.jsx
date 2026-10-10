import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Bell, CheckSquare, MoreHorizontal, Settings, WifiOff } from 'lucide-react'
import { motion, useReducedMotion } from 'framer-motion'
import { useAuthStore } from '../../stores/authStore'
import { useFeature } from '../../stores/featuresStore'
import { useIsRTL, useLang, useT } from '../../lib/i18n'
import { useMotionOn } from '../../motion/flag'
import { haptic } from '../../motion/motion'
import { EASE } from '../../lib/motion'
// Shell line icons live in ZIcon.jsx so the floating chat bubble can reuse
// the same "Ziggy" sparkle without importing this file's stores.
import { ZIcon } from './ZIcon'

const ROLE_ORDER = ['user', 'admin', 'super_admin']
function hasRole(userRole, minRole) {
  return ROLE_ORDER.indexOf(userRole) >= ROLE_ORDER.indexOf(minRole)
}

// `labelKey` resolves inside BottomNav() so labels track the active language
// live without rebuilding the array on each render.
// No Ziggy tab: the floating chat button is the single way to reach him on a
// phone, and it opens the sheet over the page you are on instead of navigating
// away. Two controls drawn with the same glyph, one a destination and one an
// overlay, read as one thing duplicated — ChatBubble already concedes this by
// hiding itself on /chat. The freed slot promotes Actions out of More, where
// an overflow tab was hiding it.
const PRIMARY_TABS = [
  { to: '/',        name: 'home',    labelKey: 'nav.home' },
  { to: '/rooms',   name: 'rooms',   labelKey: 'nav.rooms' },
  { to: '/devices', name: 'devices', labelKey: 'nav.devices' },
  { to: '/actions', name: 'auto',    labelKey: 'nav.automations' },
]
const MORE_BASE = [
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

// Depth: the active tab comes forward, the others recede. There is no
// travelling object — hierarchy is stated in z, not x — so the bar keeps its
// resting design exactly (no pill, see the note that used to live here about
// NAV_HL_SURFACE). The shadow is a tween: a bouncy spring would push the blur
// radius below zero, which the browser rejects.
const DEPTH_SPRING = { type: 'spring', duration: 0.45, bounce: 0.18 }
const DEPTH_SHADOW = { duration: 0.24, ease: EASE.out }
// Reduced motion keeps the information and drops the movement: which tab you
// are on is still said in opacity, and the scale, the 2px lift and the drop
// shadow go. It has to be decided HERE and not in motion.css — these are
// framer inline styles, and an inline transform outranks any stylesheet rule.
const DEPTH_FADE = { duration: 0.16, ease: EASE.out }
function DepthCell({ active, motionOn, icon, label, labelStyle }) {
  const reduced = useReducedMotion()
  if (!motionOn) {
    return (
      <>
        {icon}
        <span data-nav-label={motionOn ? 'true' : undefined} style={labelStyle}>{label}</span>
      </>
    )
  }
  return (
    <motion.span
      data-nav-depth={active ? 'active' : 'idle'}
      initial={false}
      animate={reduced
        ? { opacity: active ? 1 : 0.65 }
        : { scale: active ? 1 : 0.94, opacity: active ? 1 : 0.65 }}
      transition={reduced ? DEPTH_FADE : DEPTH_SPRING}
      style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, minWidth: 0, maxWidth: '100%' }}
    >
      <motion.span
        initial={false}
        animate={reduced ? { opacity: 1 } : {
          scale: active ? 1.16 : 1,
          y: active ? -2 : 0,
          filter: active ? 'drop-shadow(0 4px 5px rgba(0,0,0,.22))' : 'drop-shadow(0 0px 0px rgba(0,0,0,0))',
        }}
        transition={reduced ? DEPTH_FADE : { ...DEPTH_SPRING, filter: DEPTH_SHADOW }}
        style={{ display: 'grid' }}
      >
        {icon}
      </motion.span>
      <span data-nav-label={motionOn ? 'true' : undefined} style={labelStyle}>{label}</span>
    </motion.span>
  )
}

function Tab({ to, name, label, motionOn }) {
  const location = useLocation()
  const active = to === '/' ? location.pathname === '/' : location.pathname.startsWith(to)
  const labelStyle = { ...TAB_LABEL, fontWeight: active ? 600 : 500, color: active ? 'var(--ink)' : 'var(--ink-mute)' }
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
      <DepthCell
        active={active}
        motionOn={motionOn}
        icon={<ZIcon name={name} size={26} stroke={active ? 2 : 1.6} color={active ? 'var(--ink)' : 'var(--ink-mute)'} />}
        label={label}
        labelStyle={labelStyle}
      />
    </NavLink>
  )
}

function MoreTab({ active, onClick, expanded, label, motionOn, cellRef }) {
  const labelStyle = { ...TAB_LABEL, fontWeight: active ? 600 : 500, color: active ? 'var(--ink)' : 'var(--ink-mute)' }
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
      <DepthCell
        active={active}
        motionOn={motionOn}
        icon={<MoreHorizontal size={26} strokeWidth={active ? 2 : 1.6} color={active ? 'var(--ink)' : 'var(--ink-mute)'} />}
        label={label}
        labelStyle={labelStyle}
      />
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

const FAN_SPRING = { type: 'spring', duration: 0.32, bounce: 0.12 }
const FAN_STAGGER = 0.04
const MORE_ITEM = (active) => ({
  background: active ? 'var(--surface-2)' : 'transparent',
  border: active ? '0.5px solid var(--line)' : '0.5px solid transparent',
  cursor: 'pointer', borderRadius: 'var(--r-card)', minHeight: 64,
  display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6,
  padding: '12px 8px', fontFamily: 'inherit',
})

export function BottomNav({ connected, tucked = false }) {
  const location = useLocation()
  const navigate = useNavigate()
  const { role } = useAuthStore()
  const t = useT()
  const lang = useLang()
  const rtl = useIsRTL()
  const motionOn = useMotionOn()
  // The fan-out is framer inline styles, so reduced motion is answered here
  // rather than in motion.css (see DEPTH_FADE above for the same reason).
  const reduced = useReducedMotion()
  const [showMore, setShowMore] = useState(false)

  const taskTrackingEnabled = useFeature('task_tracking')
  const moreItems = [
    ...MORE_BASE.filter(item =>
      !item.feature || (item.feature === 'task_tracking' && taskTrackingEnabled),
    ).map(item => ({ ...item, label: t(item.labelKey) })),
    // Ops console intentionally NOT surfaced in the More menu — it's an admin
    // tool reachable from Settings; keeping it out declutters the nav.
  ]
  const isMoreActive = moreItems.some(n => location.pathname.startsWith(n.to))

  // 'closing' keeps the popover mounted for its retract; the timeout below
  // is what unmounts it. NO AnimatePresence: framer's exit cycle stalled on
  // cold start once (the /devices chunk blocked the thread mid-animation and
  // left the backdrop stuck over the viewport). A state + a timer cannot fail
  // to complete.
  const [closing, setClosing] = useState(false)
  // `closing` itself is stale inside the closure requestClose was created
  // with (it never changes identity across the retract), so the idempotency
  // check below reads this ref instead — kept in sync everywhere closing is
  // set.
  const closingRef = useRef(false)
  const closeTimer = useRef(null)
  // Scales with the item count: last item's exit delay (30ms per item ahead
  // of it) + its own 120ms duration + slack.
  const FAN_OUT_MS = 120 + 30 * (moreItems.length - 1) + 40
  const requestClose = useCallback(() => {
    if (!motionOn) { setShowMore(false); return }
    if (closingRef.current) return // already retracting — don't restart the timer
    closingRef.current = true
    setClosing(true)
    clearTimeout(closeTimer.current)
    closeTimer.current = setTimeout(() => {
      closingRef.current = false
      setShowMore(false)
      setClosing(false)
    }, FAN_OUT_MS)
  }, [motionOn, FAN_OUT_MS])
  // Force-close on any route change — synchronously, skipping the retract.
  // Defensive, as before: whatever the animation state, a navigation must
  // never leave a backdrop over the new page.
  useEffect(() => {
    closingRef.current = false
    clearTimeout(closeTimer.current)
    setShowMore(false)
    setClosing(false)
  }, [location.pathname])
  useEffect(() => () => clearTimeout(closeTimer.current), [])

  // ── Measurement ──────────────────────────────────────────────────────
  // One consumer: the More menu's transform-origin, so it grows out of the
  // tab you pressed. Re-measured on resize, orientation change and language
  // change — RTL reverses which cell is where, and a longer label re-flows
  // the row.
  const gridRef = useRef(null)
  const moreCellRef = useRef(null)
  const [moreOriginX, setMoreOriginX] = useState(null)

  useLayoutEffect(() => {
    if (!motionOn) { setMoreOriginX(null); return }
    const measure = () => {
      const grid = gridRef.current
      if (!grid) return
      const more = moreCellRef.current
      if (more) setMoreOriginX(more.offsetLeft + more.offsetWidth / 2 + grid.getBoundingClientRect().left)
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
  }, [motionOn, rtl, lang, moreItems.length, connected])

  // ── Condense ─────────────────────────────────────────────────────────
  // Never while a modal or sheet is up, never while the More menu is open,
  // never while the offline strip is showing (it is the bar's own message and
  // must not walk off with it). Reduced motion is handled in motion.css,
  // which pins the bar at full height even when this says condensed — an OS
  // setting that can flip mid-session is better answered by the media query
  // than by a value captured at render.
  const overlayOpen = useOverlayOpen(motionOn)
  const isCondensed = motionOn && tucked && !overlayOpen && !showMore && connected !== false

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
          {motionOn ? (
            <motion.div
              className="fixed inset-0 z-40 md:hidden"
              data-motion-more-backdrop="true"
              initial={{ opacity: 0 }}
              animate={{ opacity: closing ? 0 : 1 }}
              transition={{ duration: closing ? 0.12 : 0.16 }}
              style={{
                background: 'var(--scrim)', backdropFilter: 'blur(4px)', WebkitBackdropFilter: 'blur(4px)',
                // While retracting, let taps fall through to whatever is under
                // the backdrop — the More tab included, so tapping it again
                // mid-retract reopens the menu instead of just re-triggering
                // the (already in-flight) close.
                pointerEvents: closing ? 'none' : undefined,
              }}
              onClick={closing ? undefined : requestClose}
            />
          ) : (
            <div
              className="fixed inset-0 z-40 md:hidden"
              style={{ background: 'var(--scrim)', backdropFilter: 'blur(4px)', WebkitBackdropFilter: 'blur(4px)' }}
              onClick={requestClose}
            />
          )}
          <div
            className="fixed left-0 right-0 z-50 md:hidden"
            data-motion-more={motionOn ? 'true' : undefined}
            data-closing={motionOn && closing ? 'true' : undefined}
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
            {!motionOn ? (
              <div style={{
                background: 'var(--surface)', border: '0.5px solid var(--line)',
                borderRadius: 'var(--r-sheet)', boxShadow: 'var(--shadow-lg)',
                padding: 8, display: 'grid',
                gridTemplateColumns: `repeat(${moreItems.length}, 1fr)`, gap: 8,
              }}>
                {moreItems.map(({ to, Icon, label }) => {
                  const active = location.pathname.startsWith(to)
                  return (
                    <button key={to} onClick={() => { requestClose(); navigate(to) }} style={MORE_ITEM(active)}>
                      <Icon size={24} strokeWidth={active ? 2 : 1.6} color={active ? 'var(--ink)' : 'var(--ink-mute)'} />
                      <span style={{ fontSize: 12, fontWeight: active ? 600 : 500, color: active ? 'var(--ink)' : 'var(--ink-mute)' }}>{label}</span>
                    </button>
                  )
                })}
              </div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: `repeat(${moreItems.length}, 1fr)`, gap: 8 }}>
                {moreItems.map(({ to, Icon, label }, i) => {
                  const active = location.pathname.startsWith(to)
                  const n = moreItems.length
                  const order = n - 1 - i             // 0 = nearest the More tab (last in DOM, both directions)
                  return (
                    <motion.button
                      key={to}
                      data-fan-item={order}
                      // Reduced motion: the items appear where they belong and
                      // only fade. No travel, no scale, and no stagger either —
                      // a stagger is a fan-out told in time, and there is no
                      // fan to tell. The retract stays faster than the arrival.
                      initial={reduced ? { opacity: 0 } : { opacity: 0, y: 16, scale: 0.9 }}
                      animate={closing
                        ? (reduced
                          ? { opacity: 0, transition: { duration: 0.12 } }
                          : { opacity: 0, y: 12, scale: 0.9, transition: { duration: 0.12, delay: i * 0.03 } })
                        : (reduced
                          ? { opacity: 1, transition: { duration: 0.16 } }
                          : { opacity: 1, y: 0, scale: 1, transition: { ...FAN_SPRING, delay: order * FAN_STAGGER } })}
                      onClick={() => { requestClose(); navigate(to) }}
                      style={{
                        ...MORE_ITEM(active),
                        background: active ? 'var(--surface-2)' : 'var(--surface)',
                        border: '0.5px solid var(--line)', boxShadow: 'var(--shadow-md)',
                        transformOrigin: '50% 100%',
                      }}
                    >
                      <Icon size={24} strokeWidth={active ? 2 : 1.6} color={active ? 'var(--ink)' : 'var(--ink-mute)'} />
                      <span style={{ fontSize: 12, fontWeight: active ? 600 : 500, color: active ? 'var(--ink)' : 'var(--ink-mute)' }}>{label}</span>
                    </motion.button>
                  )
                })}
              </div>
            )}
          </div>
        </>
      )}

      <nav
        className="fixed bottom-0 left-0 right-0 z-30 md:hidden"
        // Condense hooks. The height/opacity transitions live in motion.css;
        // with the flag off neither attribute is emitted and the row has no
        // transition at all.
        data-motion-nav={motionOn ? 'true' : undefined}
        data-condensed={motionOn ? (isCondensed ? 'true' : 'false') : undefined}
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
            data-nav-row={motionOn ? 'true' : undefined}
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(5, minmax(0, 1fr))',
              alignItems: 'stretch',
              maxWidth: 480, margin: '0 auto', padding: '0 4px',
              ...(motionOn ? null : { height: ROW_H }),
              ...(motionOn ? { overflow: 'hidden' } : null),
            }}
          >
            {PRIMARY_TABS.map(p => (
              <Tab key={p.to} to={p.to} name={p.name} label={t(p.labelKey)} motionOn={motionOn} />
            ))}
            <MoreTab
              active={isMoreActive}
              onClick={() => { if (motionOn) haptic('light'); closingRef.current = false; clearTimeout(closeTimer.current); setClosing(false); setShowMore(true) }}
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
