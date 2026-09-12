import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import { useLocation, useNavigate, Outlet } from 'react-router-dom'
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

// ── Nav ↔ chat-bubble coupling (motion only) ──────────────────────────────
// The floating chat bubble is not inside the nav — it is a viewport-fixed FAB
// whose own CSS pins it to the nav's band (`calc(var(--nav-h) + …)`), and
// chatBubble.css already notes that where there is no bottom nav the bubble
// must not be left hovering over "60px of empty air". So when the bar tucks,
// the bubble goes with it: they are one piece of chrome, they recede together
// and return together on the first upward scroll.
//
// The alternative — sliding the bubble down to the safe-area floor — would
// mean driving `.z-chat-bubble`'s transform from out here, and that channel
// already has two owners (its `:active` press and its `[data-open]` swap). A
// third writer is how a FAB ends up stranded mid-air. Opacity is the
// vocabulary the bubble already uses to step aside, on its own token, so the
// coupling borrows it rather than inventing one.
//
// Written as a sibling rule because <BottomNav> and <ChatBubble> are siblings
// in the shell, and it is rendered only while the flag is on, so with
// data-motion="off" neither the rule nor the <style> node exists.
//
// Stated positively under `no-preference` rather than as a reduced-motion
// revert: under reduced motion the bar does not tuck at all (motion.css pins
// it), so a revert would have to out-specify the bubble's own [data-open]
// rule and would then drag the bubble back out from under an open chat sheet.
const CHAT_BUBBLE_TUCK_CSS = `
@media (prefers-reduced-motion: no-preference) {
  [data-motion="on"] [data-motion-nav][data-tucked="true"] ~ .z-chat-bubble {
    opacity: 0;
    pointer-events: none;
  }
}`

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

  // Swipe back: the <main> scroller follows the finger from the leading edge
  // and commits past 30% of the width or on a 500px/s flick. The hook
  // direction-locks, refuses to start on top of a control, and springs back
  // below the threshold, so the gesture is always cancellable.
  const onBack = useCallback(() => {
    haptic('medium')
    navigate(-1)
  }, [navigate])
  useSwipeBack(mainRef, onBack, { enabled: motionOn && isDetail && !isChatRoute, rtl })

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

  // Motion: land every route with the bar shown and <main> untransformed.
  // A committed swipe-back leaves main translated off-screen (that IS the
  // exit), and the gesture hook only clears it when it unbinds — which does
  // not happen when one detail route replaces another. Clearing here, before
  // paint, means the new page can never arrive off-screen.
  useLayoutEffect(() => {
    setNavTucked(false)
    const el = mainRef.current
    if (!el) return
    el.style.transition = ''
    el.style.transform = ''
    el.style.willChange = ''
  }, [location.pathname])

  const routed = (
    <ErrorBoundary label={`route:${location.pathname}`} key={location.pathname} fullHeight={false}>
      <Outlet />
    </ErrorBoundary>
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
        }}
      >
        {/* Connection banner — owns its own debounce + offline/connecting
            split. Used to be an inline debounced 'Offline — reconnecting…'
            banner; ConnectionStatus is the unified component now, fed by
            useNetworkStatus (navigator.onLine + WS). */}
        <ConnectionStatus />

        {/* No page-transition wrapper.
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
            Pages just snap in — 0.15s of animation isn't worth a recurring
            black-screen failure mode. ErrorBoundary keyed on pathname still
            resets per-route.

            The motion layer does NOT reintroduce one. The enter below is a
            keyed CSS animation on a wrapper that mounts with the new route —
            no AnimatePresence, no exit, no handshake that can be dropped, and
            nothing that can leave a page stuck at opacity: 0. With the flag
            off the wrapper is not rendered at all.

            The attribute carries the direction. It stays `data-motion-enter`
            with a VALUE rather than becoming a second attribute because
            morph.js does `el.closest('[data-motion-enter]')` to cancel the
            page enter when a shared-element morph runs — that lookup has to
            keep finding the wrapper in both directions. Forward renders the
            literal `true` a bare JSX data attribute has always produced, so
            a PUSH is byte-for-byte the DOM it was. */}
        {motionOn ? (
          <div data-motion-enter={enterBack ? 'back' : true} key={location.pathname}>{routed}</div>
        ) : routed}
      </main>

      {/* Wide-screen chat dock: DOM order after <main> puts it at the
          inline-end side in both LTR and RTL (flex row follows direction). */}
      {showDock && <ChatDock />}

      <BottomNav connected={connected} tucked={motionOn && navTucked} />
      {/* Phone chat surface. Fixed-position, so DOM order only matters for
          stacking ties: after the nav (z-30), before toasts (z-60) — and, with
          motion on, for the sibling rule that tucks the bubble with the bar. */}
      {motionOn && <style>{CHAT_BUBBLE_TUCK_CSS}</style>}
      <ChatBubble />
      <ChatSheet />
      <ToastContainer />
    </div>
  )
}
