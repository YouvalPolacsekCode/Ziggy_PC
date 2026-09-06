import { useLayoutEffect, useRef } from 'react'
import { useLocation, useNavigate, Outlet } from 'react-router-dom'
import { X, Maximize2 } from 'lucide-react'
import { Sidebar } from './Sidebar'
import { BottomNav } from './BottomNav'
import { ToastContainer } from '../ui/Toast'
import { ErrorBoundary } from '../ui/ErrorBoundary'
import { ConnectionStatus } from '../ui/ConnectionStatus'
import { useChatStore, CHAT_DOCK_QUERY } from '../../stores/chatStore'
import { useMediaQuery } from '../../wall/useMediaQuery'
import { useT } from '../../lib/i18n'
import AIChat from '../../pages/AIChat'

// Width of the wide-screen chat dock. Beside the 196px sidebar this leaves a
// comfortable page column from the 1024px breakpoint (CHAT_DOCK_MIN_WIDTH) up.
const CHAT_DOCK_W = 400

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
        padding: '10px 12px 8px', flexShrink: 0,
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
              display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 8px', borderRadius: 8,
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
              width: 28, height: 28, borderRadius: 8, background: 'transparent', border: 'none',
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

// ── Back-to-chat pill (phones) ────────────────────────────────────────────────
// A page opened from a chat card carries `state.fromChat`; on narrow screens
// (no room for the dock) a slim pill offers the way back. It vanishes on the
// next navigation that isn't fromChat because that location has no such state.
function BackToChatPill() {
  const t = useT()
  const navigate = useNavigate()
  return (
    <div className="lg:hidden" style={{ display: 'flex', justifyContent: 'center', padding: '8px 12px 0' }}>
      <button
        type="button"
        onClick={() => navigate('/chat')}
        data-testid="back-to-chat"
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          padding: '6px 14px', borderRadius: 999,
          background: 'var(--surface)', border: '0.5px solid var(--line)',
          boxShadow: 'var(--shadow-md)', color: 'var(--ink)',
          fontSize: 12, fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer',
        }}
      >
        <span aria-hidden>↩</span>
        <span>{t('chat.backToChat')}</span>
      </button>
    </div>
  )
}

export function AppShell({ connected }) {
  const location = useLocation()
  const isChatRoute = location.pathname.startsWith('/chat')
  const mainRef = useRef(null)
  const chatDock = useChatStore((s) => s.chatDock)
  const wide = useMediaQuery(CHAT_DOCK_QUERY)
  const showDock = chatDock && wide && !isChatRoute
  const fromChat = !!location.state?.fromChat && !isChatRoute

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

        {fromChat && <BackToChatPill />}

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
            resets per-route. */}
        <ErrorBoundary label={`route:${location.pathname}`} key={location.pathname} fullHeight={false}>
          <Outlet />
        </ErrorBoundary>
      </main>

      {/* Wide-screen chat dock: DOM order after <main> puts it at the
          inline-end side in both LTR and RTL (flex row follows direction). */}
      {showDock && <ChatDock />}

      <BottomNav connected={connected} />
      <ToastContainer />
    </div>
  )
}
