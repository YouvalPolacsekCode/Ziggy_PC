import { Suspense, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useLocation, useNavigate, Outlet } from 'react-router-dom'
import { useReducedMotion } from 'framer-motion'
import { X, Maximize2 } from 'lucide-react'
import { Sidebar } from './Sidebar'
import { BottomNav } from './BottomNav'
import { ToastContainer } from '../ui/Toast'
import { ErrorBoundary } from '../ui/ErrorBoundary'
import { ConnectionStatus } from '../ui/ConnectionStatus'
import { useChatStore, CHAT_DOCK_QUERY } from '../../stores/chatStore'
import { useMediaQuery } from '../../wall/useMediaQuery'
import { useIsRTL, useT } from '../../lib/i18n'
import { useMotionOn } from '../../motion/flag'
import { usePagesOn } from '../../motion/pages'
import { PageTransition } from '../../motion/PageTransition'
import { useScrollChrome, useSwipeBack } from '../../motion/gestures'
import { haptic } from '../../motion/motion'
import AIChat from '../../pages/AIChat'
import { ChatBubble } from '../chat/ChatBubble'
import { ChatSheet } from '../chat/ChatSheet'

// Width of the wide-screen chat dock. Beside the 196px sidebar this leaves a
// comfortable page column from the 1024px breakpoint (CHAT_DOCK_MIN_WIDTH) up.
const CHAT_DOCK_W = 400

// Routes that are "one level in" — the ones where a back gesture has an
// obvious meaning. Everything else keeps the plain behaviour.
const DETAIL_RE = /^\/(?:rooms|devices|remote|ir-walk|settings)\/[^/]+/

// A room's own page. The shared-element morph in morph.js owns every
// navigation into and out of it, in both directions, so the page slide stands
// aside for that one route pair (see `slide` below).
const ROOM_DETAIL_RE = /^\/rooms\/[^/]+$/

// Which way through history a navigation went.
//
// BrowserRouter stamps a monotonic `idx` into history.state for every entry it
// creates, and restores it when you move between them, so comparing the idx
// either side of a location change says forwards or backwards outright — a
// back is the only thing that lowers it. `null` when there is nothing to read
// (a foreign history entry, a browser that dropped the state, SSR), which the
// caller treats as "not backwards" rather than guessing.
function historyIdx() {
  try {
    const i = window.history.state?.idx
    return typeof i === 'number' ? i : null
  } catch { return null }
}

// ── Chat dock (wide screens) ──────────────────────────────────────────────────
// When a chat card navigates to an object's page on a wide screen, the chat
// keeps living here, beside the page, so the user can keep talking about what
// they are looking at. It's the same AIChat component the /chat route renders
// (docked prop) — the store holds the conversation, so nothing is duplicated.
// Mounted only while wide (JS media query): hiding it with CSS would leave a
// second live AIChat running its mic/viewport effects on a phone.
function ChatDock() {
  const t = useT()
  const navigate = useNavigate()
  const setChatDock = useChatStore((s) => s.setChatDock)
  return (
    <aside
      data-testid="chat-dock"
      className="shrink-0 sticky top-0 flex flex-col"
      style={{
        width: CHAT_DOCK_W,
        height: 'var(--vh)',
        background: 'var(--bg)',
        borderInlineStart: '0.5px solid var(--line)',
        paddingTop: 'var(--safe-top)',
      }}
    >
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
        padding: '12px 12px 8px', flexShrink: 0,
        borderBlockEnd: '0.5px solid var(--line)',
      }}>
        <span className="z-eyebrow" style={{ margin: 0 }}>{t('chat.headerTitle')}</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <button
            type="button"
            onClick={() => navigate('/chat')}
            title={t('chat.dock.expand')}
            aria-label={t('chat.dock.expand')}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 8, padding: '4px 8px', borderRadius: 10,
              background: 'transparent', border: '0.5px solid var(--line)', color: 'var(--ink-mute)',
              fontSize: 11, fontFamily: 'inherit', cursor: 'pointer',
            }}
          >
            <Maximize2 size={12} />
            <span>{t('chat.dock.expand')}</span>
          </button>
          <button
            type="button"
            onClick={() => setChatDock(false)}
            title={t('chat.dock.close')}
            aria-label={t('chat.dock.close')}
            style={{
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              width: 28, height: 28, borderRadius: 10, background: 'transparent', border: 'none',
              color: 'var(--ink-mute)', cursor: 'pointer',
            }}
          >
            <X size={15} />
          </button>
        </div>
      </div>
      <div style={{ flex: 1, minHeight: 0 }}>
        <ErrorBoundary label="chat-dock" fullHeight={false}>
          <AIChat docked />
        </ErrorBoundary>
      </div>
    </aside>
  )
}

// ── Phones ────────────────────────────────────────────────────────────────────
// No room for a dock below the breakpoint, so the chat folds into a floating
// bubble (ChatBubble) that raises a bottom sheet (ChatSheet) over the page.
// Both are mounted here, once, outside every page: they decide for themselves
// (route + width) whether to exist, and the sheet is the only place besides
// the /chat route and the dock that ever mounts AIChat — never two at once.

export function AppShell({ connected }) {
  const location = useLocation()
  const navigate = useNavigate()
  const isChatRoute = location.pathname.startsWith('/chat')
  const mainRef = useRef(null)
  const chatDock = useChatStore((s) => s.chatDock)
  const wide = useMediaQuery(CHAT_DOCK_QUERY)
  const showDock = chatDock && wide && !isChatRoute

  // ── Motion layer ─────────────────────────────────────────────────────
  // Everything below is additive and gated: with data-motion="off" the hooks
  // bail out, the enter wrapper is not rendered, and this component produces
  // exactly the DOM and the behaviour it did before.
  const motionOn = useMotionOn()
  const rtl = useIsRTL()
  const isDetail = DETAIL_RE.test(location.pathname)
  const [navTucked, setNavTucked] = useState(false)

  // ── Which way did you go? ────────────────────────────────────────────
  // Forward and back used to play the identical entrance, so returning to a
  // page you had just left announced itself as "here is something new" —
  // which is what reads as "not smooth" on the way back. The wrapper now
  // states the direction and motion.css picks the curve. That is the whole
  // of the change on this side: no exit, no handshake, still one keyed
  // element that mounts with the route (see the long note below).
  //
  // Decided ONCE per history entry and pinned, the same way useDeviceSheet in
  // App.jsx decides a sheet — because this is a fact about the moment of
  // navigation, not about this render. Unpinned it also re-attributed itself
  // mid-flight: a later re-render (a WS message, the media query, the nav
  // tuck) recomputed the direction and restarted the animation.
  //
  // THE DIRECTION DOES NOT COME FROM useNavigationType() HERE, AND CANNOT.
  // AppShell renders under App.jsx's `<Routes location={...}>` — the
  // background-location pattern the device sheet needs — and react-router
  // wraps a location-prop Routes in a LocationContext whose navigationType is
  // the literal Action.Pop (react-router/dist, `if (locationArg &&
  // renderedMatches)`). So down here the hook answers POP for every
  // navigation including plain forward ones, which was measured on the dev
  // server before this was written: forward to /rooms reported POP. The
  // history idx is the signal that survives that, and it is strictly better
  // anyway — it tells the browser's FORWARD button (idx rises) apart from its
  // back button, which navigationType calls POP either way.
  //
  // The first load of the app is the entry the shell started on: its key never
  // changes, so the branch below never runs and a cold start can only ever be
  // an arrival. That is the "POP on first load" trap, closed by construction
  // rather than by a flag that has to be set at the right moment.
  const enterDir = useRef({ key: location.key, idx: historyIdx(), back: false })
  if (enterDir.current.key !== location.key) {
    const idx = historyIdx()
    const prev = enterDir.current.idx
    enterDir.current = {
      key: location.key,
      idx,
      back: idx !== null && prev !== null && idx < prev,
    }
  }
  const enterBack = enterDir.current.back

  // ── Does this navigation slide? ──────────────────────────────────────
  // The page push (PageTransition) is the richer answer to the same question
  // the enter wrapper answers, so exactly one of them plays:
  //
  //   - `?pages=off` drops the slide and keeps the rest of the layer. It is
  //     a separate switch from `?motion=off` on purpose: two earlier page
  //     transitions black-screened this app, and the one piece of the layer
  //     that has done that before gets its own rollback.
  //   - Reduced motion means no travel, which is all a push is.
  //   - The room FLIP (morph.js) owns navigations into and out of
  //     /rooms/:id; a slide over the top of it would be two stories about
  //     one movement. `prevPathRef` is updated in an effect, so during the
  //     render that commits a navigation it still holds where we came from —
  //     which is what makes BOTH directions of that pair detectable here.
  const pagesOn = usePagesOn()
  const reduced = useReducedMotion()
  const prevPathRef = useRef(location.pathname)
  const roomPair = ROOM_DETAIL_RE.test(location.pathname) || ROOM_DETAIL_RE.test(prevPathRef.current)
  useEffect(() => { prevPathRef.current = location.pathname }, [location.pathname])
  const slide = motionOn && pagesOn && !reduced && !roomPair

  // Swipe back: the page LAYER follows the finger from the leading edge —
  // first peeling at the edge, then travelling — and commits past 30% of the
  // width or on a 500px/s flick. The hook direction-locks, refuses to start
  // on top of a control, and springs back below the threshold, so the gesture
  // is always cancellable.
  //
  // It moves the page layer rather than the <main> scroller because the page
  // beneath is painted as a SIBLING of that layer inside PageTransition's
  // stage: moving the scroller would carry the under-page along with it and
  // reveal nothing. `swiping` is what mounts that under-page, so it is state
  // and not a ref — and `location.pathname` is the hook's rebind signal,
  // because the layer is keyed on the route and so the node it must listen on
  // is replaced on every navigation.
  //
  // THE GESTURE NEEDS AN ENTRY TO GO BACK TO. A committed swipe leaves the
  // page off-screen on purpose — that IS the exit — and relies on the
  // navigation to replace it. On the FIRST entry of the session there is no
  // navigation: a deep link, a shared URL or the PWA start URL can land
  // directly on /devices/abc, where `isDetail` is true, `navigate(-1)` does
  // nothing, the route never changes and so nothing ever clears the
  // transform. The page is gone and there is no way back to it. The history
  // index is the same signal the direction pin uses; `null` (a foreign entry,
  // a browser that dropped the state) counts as "cannot", because a gesture
  // that might not come back is worse than one that is not offered.
  const canGoBack = historyIdx() > 0
  const pageRef = useRef(null)
  const [swiping, setSwiping] = useState(false)
  // A committed swipe keeps the under-page mounted until the route change
  // lands (the page it moved is off-screen by then, so dropping it would show
  // a hole); the per-route layout effect below is what clears `swiping` in
  // that case. A cancelled one is over the moment it settles.
  const onSwipe = useCallback((state, info) => {
    if (state === 'start') setSwiping(true)
    else if (!info?.committed) setSwiping(false)
  }, [])
  // ...and it tells PageTransition not to animate the arrival it is about to
  // ask for. A ref, not state: it must be readable during the render that
  // commits the navigation, which is the same render that consumes it.
  const gestureBackRef = useRef(false)
  const onBack = useCallback(() => {
    haptic('medium')
    gestureBackRef.current = true
    navigate(-1)
  }, [navigate])
  useSwipeBack(pageRef, onBack, {
    enabled: motionOn && isDetail && !isChatRoute && canGoBack,
    rtl,
    onSwipe,
    bindKey: location.pathname,
  })

  // Bottom-nav tuck. onDirection fires 'up' whenever the scroller is back at
  // the top, so the bar always returns there.
  const { onScroll } = useScrollChrome(mainRef, {
    onDirection: useCallback((dir) => setNavTucked(dir === 'down'), []),
  })

  // Reset the scroll container to the top on every route change. React Router
  // doesn't do this, so navigating from a scrolled list (e.g. the Devices
  // grid) into a detail page used to land mid-page. Chat manages its own
  // scroll, so leave it alone. useLayoutEffect runs before paint → no flash of
  // the wrong scroll position.
  useLayoutEffect(() => {
    if (isChatRoute) return
    // Reset every plausible scroller: the <main> container (desktop / when it
    // scrolls internally) AND the window/document (some mobile WebViews scroll
    // the page itself, where main.scrollTop is a no-op). Belt and suspenders so
    // a device page reliably opens at the top on any platform.
    if (mainRef.current) mainRef.current.scrollTop = 0
    try {
      window.scrollTo(0, 0)
      if (document.scrollingElement) document.scrollingElement.scrollTop = 0
    } catch { /* SSR / non-DOM */ }
  }, [location.pathname])

  // Motion: land every route with the bar shown, the gesture forgotten and
  // nothing of it left on the page.
  //
  // A committed swipe-back leaves the page it moved translated off-screen
  // (that IS the exit) and the hook only clears it when it unbinds, so this
  // is the belt to that braces: clearing before paint means a page can never
  // arrive off-screen. `swiping` is dropped the same way — a gesture belongs
  // to the page it started on, and leaving it true would strand the
  // under-page over the new route.
  //
  // `transform` and `will-change` are cleared on <main> — where this hook
  // used to write, and nothing else does — but deliberately NOT on the page
  // layer, where they have owners:
  //
  //   - framer-motion renders the slide's STARTING OFFSET into `transform`,
  //     and by the time a parent layout effect runs `pageRef` already points
  //     at the ARRIVING page. Clearing it here would paint that page at rest
  //     for one frame and then jump it off-screen to slide in. PageTransition
  //     owns the property and clears it itself whenever no slide is running
  //     (its own effect guards on exactly that).
  //   - `will-change: transform` on that layer is React-rendered for the
  //     length of the slide; removing it imperatively would lose the hint on
  //     every navigation, because React only writes it again when it changes.
  //
  // Nothing of the gesture can strand there anyway: the layer is keyed on the
  // route, so a committed swipe's off-screen transform is unmounted with the
  // element, and the hook re-binds on `bindKey` — clearing what it wrote on
  // the node it wrote it to. The two properties below are nobody else's, so
  // they are cleared as the belt to that brace.
  useLayoutEffect(() => {
    setNavTucked(false)
    setSwiping(false)
    const main = mainRef.current
    if (main) {
      main.style.transition = ''
      main.style.transform = ''
      main.style.transformOrigin = ''
      main.style.willChange = ''
    }
    const page = pageRef.current
    if (page) {
      page.style.transition = ''
      page.style.transformOrigin = ''
    }
  }, [location.pathname])

  // Route-level Suspense boundary.
  //
  // Every page but Dashboard is React.lazy. App.jsx has a Suspense around the
  // whole <Routes> tree, but that boundary sits ABOVE this shell — so a page
  // suspending on first visit used to blank the ENTIRE app (sidebar, nav,
  // content) to that `null` fallback and remount the lot once the chunk
  // landed. That was the flicker. React resolves to the nearest boundary, so
  // this one keeps the shell painted and swaps only the content area. The
  // fallback holds height rather than collapsing so nothing reflows on land.
  //
  // One boundary, one instance: the outgoing page in PageTransition is a DOM
  // snapshot, not a second mount of this tree, so there is nothing else here
  // that could suspend or throw.
  const routed = (
    <Suspense fallback={<div aria-hidden style={{ minHeight: '60vh' }} />}>
      <ErrorBoundary label={`route:${location.pathname}`} key={location.pathname} fullHeight={false}>
        <Outlet />
      </ErrorBoundary>
    </Suspense>
  )

  return (
    // Use dvh (via --vh) so the shell tracks the *visible* viewport as
    // mobile browser chrome and the on-screen keyboard show/hide. Safe-area
    // padding is moved inside each column (sidebar + main) rather than on
    // the outer flex — the outer one would also offset the sidebar's
    // sticky top, breaking flush-to-top alignment on desktop.
    <div style={{ display: 'flex', minHeight: 'var(--vh)', background: 'var(--bg)' }}>
      <Sidebar connected={connected} />

      <main
        ref={mainRef}
        onScroll={motionOn ? onScroll : undefined}
        className={`flex-1 min-w-0 ${isChatRoute ? 'overflow-hidden' : 'overflow-y-auto scrollbar-thin pb-nav'}`}
        style={{
          background: 'var(--bg)',
          // Safe-area top here, NOT on the outer wrapper, so sidebar can stay
          // flush at viewport top on desktop while mobile main content clears
          // the status bar on iOS PWA (black-translucent) and Android cutouts.
          paddingTop: 'var(--safe-top)',
          // Reserve the scrollbar track even on pages that don't scroll.
          // Without this, going from a long page to a short one removes the
          // scrollbar and every child shifts sideways by its width (4px
          // Chrome / ~11px Firefox) — reads as the page "jumping". A no-op
          // where scrollbars overlay the content (iOS / Android).
          scrollbarGutter: 'stable',
        }}
      >
        {/* Connection banner — owns its own debounce + offline/connecting
            split. Used to be an inline debounced 'Offline — reconnecting…'
            banner; ConnectionStatus is the unified component now, fed by
            useNetworkStatus (navigator.onLine + WS). */}
        <ConnectionStatus />

        {/* Page transition — the record of how this went wrong twice.
            Two prior attempts at a transition both failed:
              - mode="wait" + motion.div: AnimatePresence's exit→enter
                handshake can be dropped if the parent re-renders mid-
                transition (WS connect/disconnect, store updates fanning out,
                sibling ToastContainer animating). Result: new motion.div
                mounts stuck at `opacity: 0`, page goes black.
              - No mode="wait" + motion.div: both old and new motion.divs
                render simultaneously as siblings in normal flow, stacking
                vertically. The new page lands below the viewport, the old
                fades out, and the visible area goes blank.
            For a long time pages just snapped in — 0.15s of animation isn't
            worth a recurring black-screen failure mode.

            The motion layer's page slide lives in
            `src/motion/PageTransition.jsx`, which avoids both failures by
            construction (no AnimatePresence; the outgoing page is a DOM
            snapshot in an absolute, inert overlay dropped by a timer).
            `?pages=off` turns only the slide off. The `data-motion-enter`
            attribute still carries the direction on the entering layer
            because `morph.js` looks it up — it does
            `el.closest('[data-motion-enter]')` to cancel the page enter when
            a shared-element morph runs, and that lookup has to keep finding
            the wrapper in both directions. When the slide is skipped (first
            load, `?pages=off`, reduced motion, the room FLIP's routes) that
            attribute is all there is, and motion.css's keyed CSS enter plays
            exactly as it did before. ErrorBoundary keyed on pathname still
            resets per-route. */}
        {motionOn ? (
          <PageTransition
            pathKey={location.pathname}
            back={enterBack}
            rtl={rtl}
            enabled={slide}
            scrollerRef={mainRef}
            pageRef={pageRef}
            swiping={swiping}
            settled={gestureBackRef}
          >
            {routed}
          </PageTransition>
        ) : routed}
      </main>

      {/* Wide-screen chat dock: DOM order after <main> puts it at the
          inline-end side in both LTR and RTL (flex row follows direction). */}
      {showDock && <ChatDock />}

      <BottomNav connected={connected} tucked={motionOn && navTucked} />
      {/* Phone chat surface. Fixed-position, so DOM order only matters for
          stacking ties: after the nav (z-30), before toasts (z-60) — and, with
          motion on, for the sibling rule in motion.css that rides the bubble
          down with the bar as it condenses. */}
      <ChatBubble />
      <ChatSheet />
      <ToastContainer />
    </div>
  )
}
