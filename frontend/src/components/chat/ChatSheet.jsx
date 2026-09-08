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
// AnimatePresence, so when the route becomes /chat or the window widens the
// sheet vanishes synchronously (no exit animation carrying a second AIChat
// while the page mounts its own). The exit animation only plays for a user
// close on a page that stays put.
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

import { useCallback, useEffect, useRef } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { motion, AnimatePresence, useDragControls, useReducedMotion } from 'framer-motion'
import { X, Maximize2 } from 'lucide-react'
import { useChatStore } from '../../stores/chatStore'
import { useT } from '../../lib/i18n'
import { ErrorBoundary } from '../ui/ErrorBoundary'
import AIChat from '../../pages/AIChat'
import { useChatSurfaceEligible } from './ChatBubble'

const CLOSE_DISTANCE_PX = 120
const CLOSE_VELOCITY = 600          // px/s — a flick closes regardless of distance
const EASE_DRAWER = [0.32, 0.72, 0, 1]

// Pre-JS height (CSS); the measure effect replaces it with pixels.
const PANEL_H_CSS = 'min(calc(72 * var(--vh) / 100), calc(var(--vh) - var(--safe-top) - 48px))'

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
  const reduce = useReducedMotion()
  const dragControls = useDragControls()
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

  // Escape closes. Keyboard-initiated, so no animation would be ideal — but
  // the exit is 200ms and the store flip is instant, which is close enough
  // without a second code path.
  useEffect(() => {
    if (!show) return
    const onKey = (e) => { if (e.key === 'Escape') close() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [show, close])

  // Page scroll lock. Both scrollers: <html> (browsers that scroll the page)
  // and <body>; AppShell's <main> is inside the locked page either way.
  useEffect(() => {
    if (!show) return
    const html = document.documentElement
    const body = document.body
    const prev = [html.style.overflow, body.style.overflow, body.style.overscrollBehavior]
    html.style.overflow = 'hidden'
    body.style.overflow = 'hidden'
    body.style.overscrollBehavior = 'contain'
    return () => {
      html.style.overflow = prev[0]
      body.style.overflow = prev[1]
      body.style.overscrollBehavior = prev[2]
    }
  }, [show])

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

  const onDragEnd = (_e, info) => {
    if (info.offset.y > CLOSE_DISTANCE_PX || info.velocity.y > CLOSE_VELOCITY) close()
  }

  const openFull = () => {
    // Order matters: navigating to /chat flips `eligible` false, which
    // unmounts this body synchronously; the store flip is for the bubble.
    setChatSheet(false)
    navigate('/chat')
  }

  const panelTransition = reduce ? { duration: 0 } : { duration: 0.26, ease: EASE_DRAWER }
  const exitTransition = reduce ? { duration: 0 } : { duration: 0.2, ease: EASE_DRAWER }
  const scrimTransition = reduce ? { duration: 0 } : { duration: 0.2, ease: 'easeOut' }

  // Eligibility gate OUTSIDE AnimatePresence — see the header comment.
  if (!eligible) return null

  return (
    <AnimatePresence>
      {open && (
        <div
          ref={layerRef}
          data-testid="chat-sheet-layer"
          style={{
            position: 'fixed', left: 0, right: 0, top: 0, height: 'var(--vh)',
            zIndex: 40,
            display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', alignItems: 'stretch',
            pointerEvents: 'none',
          }}
        >
          <motion.div
            data-testid="chat-sheet-scrim"
            onClick={close}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, transition: scrimTransition }}
            transition={scrimTransition}
            style={{
              position: 'absolute', inset: 0,
              background: 'var(--backdrop)',
              pointerEvents: 'auto', touchAction: 'none',
            }}
          />
          <motion.div
            ref={panelRef}
            data-testid="chat-sheet"
            role="dialog"
            aria-modal="true"
            aria-label={title}
            drag="y"
            dragListener={false}
            dragControls={dragControls}
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0.05, bottom: 1 }}
            dragMomentum={false}
            onDragEnd={onDragEnd}
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%', transition: exitTransition }}
            transition={panelTransition}
            style={{
              position: 'relative',
              width: '100%', maxWidth: 560, marginInline: 'auto',
              height: PANEL_H_CSS,
              display: 'flex', flexDirection: 'column',
              background: 'var(--bg)',
              borderStartStartRadius: 22, borderStartEndRadius: 22,
              border: '0.5px solid var(--line)', borderBottom: 'none',
              boxShadow: '0 -8px 40px -12px rgba(0,0,0,0.28), var(--shadow-lg)',
              paddingBottom: 'var(--safe-bottom)',
              pointerEvents: 'auto',
              overflow: 'hidden',
            }}
          >
            {/* Header = drag surface: grab handle + title row. The buttons
                stop the pointer so a tap on them never starts a drag. */}
            <div
              data-testid="chat-sheet-handle"
              onPointerDown={(e) => dragControls.start(e)}
              style={{
                flexShrink: 0, touchAction: 'none', cursor: 'grab',
                userSelect: 'none', WebkitUserSelect: 'none',
                borderBlockEnd: '0.5px solid var(--line)',
              }}
            >
              <div aria-hidden="true" style={{ display: 'flex', justifyContent: 'center', padding: '8px 0 4px' }}>
                <span style={{ width: 36, height: 4, borderRadius: 999, background: 'var(--line)' }} />
              </div>
              <div style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
                padding: '2px 8px 8px 14px',
              }}>
                <span
                  dir="auto"
                  style={{
                    fontSize: 14, fontWeight: 600, color: 'var(--ink)',
                    minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}
                >
                  {title}
                </span>
                <div
                  onPointerDown={(e) => e.stopPropagation()}
                  style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}
                >
                  <button
                    type="button"
                    onClick={openFull}
                    data-testid="chat-sheet-open-full"
                    title={t('chat.bubble.openFull')}
                    aria-label={t('chat.bubble.openFull')}
                    style={{
                      display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 10px', borderRadius: 8,
                      background: 'transparent', border: '0.5px solid var(--line)', color: 'var(--ink-mute)',
                      fontSize: 11, fontFamily: 'inherit', cursor: 'pointer',
                    }}
                  >
                    <Maximize2 size={12} />
                    <span>{t('chat.bubble.openFull')}</span>
                  </button>
                  <button
                    type="button"
                    onClick={close}
                    data-testid="chat-sheet-close"
                    title={t('chat.bubble.close')}
                    aria-label={t('chat.bubble.close')}
                    style={{
                      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                      width: 32, height: 32, borderRadius: 8, background: 'transparent', border: 'none',
                      color: 'var(--ink-mute)', cursor: 'pointer',
                    }}
                  >
                    <X size={16} />
                  </button>
                </div>
              </div>
            </div>

            <div style={{ flex: 1, minHeight: 0 }}>
              <ErrorBoundary label="chat-sheet" fullHeight={false}>
                <AIChat docked />
              </ErrorBoundary>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  )
}

export default ChatSheet
