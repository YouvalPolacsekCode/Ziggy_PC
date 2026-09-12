// Chat bottom sheet — phones only. The bubble's other half.
//
// Raises the same AIChat the /chat tab renders (docked prop: fills its box,
// no page-title block) over the current page, from the bottom, so the user
// can read or type without leaving what they were looking at.
//
// ONE AIChat at a time. AIChat owns a mic, a viewport effect and a thread
// bootstrap; two copies would run all of that twice. The guarantee here is
// structural, not timed: the sheet body renders only while
//   open && narrow (CHAT_DOCK_QUERY false) && route is not /chat (& co).
// The dock (AppShell) needs `wide`, the page needs `/chat` — the three
// conditions are mutually exclusive, and the eligibility gate sits OUTSIDE
// the sheet (and therefore outside its AnimatePresence), so when the route
// becomes /chat or the window widens the sheet vanishes synchronously (no exit
// animation carrying a second AIChat while the page mounts its own). The exit
// animation only plays for a user close on a page that stays put.
//
// Keyboard: `--vh` is 100dvh and index.html asks for
// interactive-widget=resizes-content, so on Android the layout viewport (and
// this bottom-anchored sheet) already shrinks with the keyboard. iOS ignores
// that and only shrinks the *visual* viewport — the exact thing AIChat's own
// page-mode effect measures. AIChat's effect steps aside when `docked`
// (height: 100%), so this sheet is the single owner of that measurement: it
// pins its fixed layer to visualViewport's offsetTop/height and, while the
// keyboard is up, lets the sheet take the whole visible remainder (72% of
// half a screen is not a chat). Applied imperatively via refs so a
// visualViewport scroll tick never re-renders AIChat.
//
// ── The sheet itself is motion/SheetSurface ─────────────────────────────────
// Presentation — the layer, the backdrop, the panel, the drag, the dismissal
// rules, Escape and the page scroll lock — moved to src/motion/SheetSurface.jsx
// so the device sheet is the same object rather than a second one. Everything
// this file passes down is the chat sheet's own skin and its own chat-specific
// behaviour; none of the resting values changed. What the surface ADDS here,
// and only while `data-motion="on"`:
//   - a backdrop whose opacity follows the finger instead of sitting at 1
//   - velocity projection and the flick rule layered ON TOP of the old
//     distance/velocity dismissal, never replacing it
//   - one detent, equal to today's height. The chat sheet is a fixed-height
//     panel measured against the visual viewport; a second stop would change
//     where it rests, so it has exactly one and rests exactly where it did.
// Deliberately NOT taken: body drag (the body is AIChat, a scroller this file
// does not own — the sheet is dragged by its header, as before) and focus
// restore (new behaviour the chat sheet never had).

import { useCallback, useEffect, useRef } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { X, Maximize2 } from 'lucide-react'
import { useChatStore } from '../../stores/chatStore'
import { useT } from '../../lib/i18n'
import { ErrorBoundary } from '../ui/ErrorBoundary'
import { SheetSurface } from '../../motion/SheetSurface'
import AIChat from '../../pages/AIChat'
import { useChatSurfaceEligible } from './ChatBubble'

const CLOSE_DISTANCE_PX = 120
const CLOSE_VELOCITY = 600          // px/s — a flick closes regardless of distance

// Pre-JS height (CSS); the measure effect replaces it with pixels.
const PANEL_H_CSS = 'min(calc(72 * var(--vh) / 100), calc(var(--vh) - var(--safe-top) - 48px))'

// The skin. Every value here is the one this sheet already had.
const LAYER_STYLE = {
  position: 'fixed', left: 0, right: 0, top: 0, height: 'var(--vh)',
  zIndex: 40,
  display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', alignItems: 'stretch',
  pointerEvents: 'none',
}
const SCRIM_STYLE = {
  position: 'absolute', inset: 0,
  background: 'var(--backdrop)',
  pointerEvents: 'auto', touchAction: 'none',
}
const PANEL_STYLE = {
  position: 'relative',
  width: '100%', maxWidth: 560, marginInline: 'auto',
  height: PANEL_H_CSS,
  display: 'flex', flexDirection: 'column',
  background: 'var(--bg)',
  borderStartStartRadius: 'var(--r-sheet)', borderStartEndRadius: 'var(--r-sheet)',
  border: '0.5px solid var(--line)', borderBottom: 'none',
  boxShadow: 'var(--shadow-lg)',
  paddingBottom: 'var(--safe-bottom)',
  pointerEvents: 'auto',
  overflow: 'hidden',
}
// Header = drag surface: grab handle + title row.
const HEAD_STYLE = {
  flexShrink: 0, touchAction: 'none', cursor: 'grab',
  userSelect: 'none', WebkitUserSelect: 'none',
  borderBlockEnd: '0.5px solid var(--line)',
}
const BODY_STYLE = { flex: 1, minHeight: 0 }

const SHEET_STYLES = { layer: LAYER_STYLE, scrim: SCRIM_STYLE, panel: PANEL_STYLE, head: HEAD_STYLE, body: BODY_STYLE }
const SHEET_ATTRS = {
  layer: { 'data-testid': 'chat-sheet-layer' },
  scrim: { 'data-testid': 'chat-sheet-scrim' },
  panel: { 'data-testid': 'chat-sheet' },
  head: { 'data-testid': 'chat-sheet-handle' },
}

function cssPx(name) {
  try {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
    return v ? (parseFloat(v) || 0) : 0
  } catch { return 0 }
}

export function ChatSheet() {
  const t = useT()
  const navigate = useNavigate()
  const location = useLocation()
  const eligible = useChatSurfaceEligible()
  const open = useChatStore((s) => s.chatSheet)
  const setChatSheet = useChatStore((s) => s.setChatSheet)
  const rawTitle = useChatStore((s) => s.threads.find((th) => th.thread_id === s.threadId)?.title || '')
  const layerRef = useRef(null)
  const panelRef = useRef(null)

  const show = open && eligible
  const close = useCallback(() => setChatSheet(false), [setChatSheet])

  // The server names a fresh thread "New chat" in English; the UI has its
  // own word for that. Anything else is the thread's real title.
  const title = !rawTitle || rawTitle === 'New chat' ? t('nav.ziggy') : rawTitle

  // A sheet that can no longer legitimately exist (window widened → the dock
  // owns the chat; route became /chat → the page does) is closed in the
  // store too, so the bubble does not come back "open" when it can.
  useEffect(() => {
    if (open && !eligible) setChatSheet(false)
  }, [open, eligible, setChatSheet])

  // Any route change underneath (browser back, a card link) collapses the
  // sheet: the user asked to see a page. useChatNav does this explicitly for
  // card links; this covers the paths it does not own.
  const pathRef = useRef(location.pathname)
  useEffect(() => {
    if (pathRef.current === location.pathname) return
    pathRef.current = location.pathname
    if (useChatStore.getState().chatSheet) setChatSheet(false)
  }, [location.pathname, setChatSheet])

  // Viewport / keyboard geometry — see the header comment.
  useEffect(() => {
    if (!show) return
    // Tallest layout height seen at the current width. A drop of >20% from
    // it is the keyboard (URL-bar animation is <15%); a width change is a
    // rotation, which resets the baseline. Works on both keyboard models:
    // iOS shrinks visualViewport only, Android (resizes-content) shrinks
    // innerHeight too — both fall under the baseline.
    const base = { w: 0, h: 0 }
    const measure = () => {
      const layer = layerRef.current
      const panel = panelRef.current
      if (!layer || !panel) return
      const vv = window.visualViewport
      const innerW = window.innerWidth
      const innerH = window.innerHeight
      if (base.w !== innerW) { base.w = innerW; base.h = innerH }
      else base.h = Math.max(base.h, innerH)
      const height = vv ? vv.height : innerH
      const top = vv ? vv.offsetTop : 0
      const keyboard = height < base.h * 0.8
      const safeTop = cssPx('--safe-top')
      layer.style.top = `${top}px`
      layer.style.height = `${height}px`
      const panelH = keyboard
        ? Math.max(160, height - safeTop - 12)
        : Math.max(160, Math.min(height * 0.72, height - safeTop - 48))
      panel.style.height = `${panelH}px`
    }
    measure()
    window.addEventListener('resize', measure)
    const vv = window.visualViewport
    if (vv) {
      vv.addEventListener('resize', measure)
      vv.addEventListener('scroll', measure)
    }
    return () => {
      window.removeEventListener('resize', measure)
      if (vv) {
        vv.removeEventListener('resize', measure)
        vv.removeEventListener('scroll', measure)
      }
    }
  }, [show])

  const openFull = () => {
    // Order matters: navigating to /chat flips `eligible` false, which
    // unmounts this body synchronously; the store flip is for the bubble.
    setChatSheet(false)
    navigate('/chat')
  }

  // Eligibility gate OUTSIDE the sheet — see the header comment.
  if (!eligible) return null

  return (
    <SheetSurface
      open={open}
      onClose={close}
      title={title}
      closeDistance={CLOSE_DISTANCE_PX}
      closeVelocity={CLOSE_VELOCITY}
      styles={SHEET_STYLES}
      attrs={SHEET_ATTRS}
      layerRef={layerRef}
      panelRef={panelRef}
      header={(
        <>
          <div aria-hidden="true" style={{ display: 'flex', justifyContent: 'center', padding: '8px 0 4px' }}>
            <span style={{ width: 36, height: 5, borderRadius: 999, background: 'var(--line-2)' }} />
          </div>
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
            padding: '0 12px 8px 20px',
          }}>
            <span
              dir="auto"
              className="z-title3"
              style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
            >
              {title}
            </span>
            {/* Two 44px icon buttons: the way to the full page, and out. */}
            <div
              onPointerDown={(e) => e.stopPropagation()}
              style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}
            >
              <button
                type="button"
                className="z-icon-btn"
                onClick={openFull}
                data-testid="chat-sheet-open-full"
                title={t('chat.bubble.openFull')}
                aria-label={t('chat.bubble.openFull')}
              >
                <Maximize2 size={20} strokeWidth={1.75} aria-hidden="true" />
              </button>
              <button
                type="button"
                className="z-icon-btn"
                onClick={close}
                data-testid="chat-sheet-close"
                title={t('chat.bubble.close')}
                aria-label={t('chat.bubble.close')}
              >
                <X size={20} strokeWidth={1.75} aria-hidden="true" />
              </button>
            </div>
          </div>
        </>
      )}
    >
      <ErrorBoundary label="chat-sheet" fullHeight={false}>
        <AIChat docked />
      </ErrorBoundary>
    </SheetSurface>
  )
}

export default ChatSheet
