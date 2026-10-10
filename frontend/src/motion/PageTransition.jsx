// Page transitions: the iOS push, without the two failure modes that
// black-screened the app before (AppShell.jsx keeps the record).
//
//   1. There is NO AnimatePresence and NO exit→enter handshake. The entering
//      page is a plain mount with initial→animate. The outgoing page is a
//      frozen React element (the previous render's outlet) painted in an
//      inert overlay, and the overlay is removed by onAnimationComplete OR
//      a watchdog timer — whichever fires first. A dropped callback cannot
//      strand anything.
//   2. The two pages never share normal flow. The entering page is in flow
//      (so the scroller's height is the new page's); the outgoing page is
//      position:absolute inside a relative stage with overflow-x clipped,
//      its content translated up by the scroll position it was at, so the
//      slice the person was looking at stays put while it recedes.
//
// Forward: new page slides in from inline-end over the old one, which moves
// 30% the other way and dims to 35%; a 12px shadow rides the incoming edge.
// Back: the reverse, 15% faster, on the strong ease-out.
//
// Skipped (the page layer renders with no travel, so today's keyed CSS enter
// in motion.css plays instead): first mount, `enabled` false (the ?pages=off
// switch, reduced motion, the room FLIP's routes — AppShell decides), and any
// key change while a previous overlay is still running (the new page replaces
// the entering layer and the stale overlay goes with it — one overlay, ever).
//
// ── Two invariants this file is built around ────────────────────────────────
//
// ONE ELEMENT PER PATH. The page layer is a single `motion.div` keyed on
// `pathKey` for the whole life of that route — it is NOT swapped for a plain
// div when the slide finishes. If it were, dropping the overlay would unmount
// and remount the entire routed page (losing its state and refetching its
// data) 420ms after every navigation. `initial` is therefore read once, at
// mount, and `animate` never changes: travel or no travel is decided when the
// route arrives and cannot be re-decided by a later re-render.
//
// `data-motion-page` NAMES THE LAYER, NOT A LIVE ANIMATION. It is "enter"
// whenever the slide is enabled (that is the layer a push enters on, the one
// gestures and CSS target) and "current" when it is not. It does not flip
// back when the animation settles, precisely because the element must not be
// replaced. `[data-motion-page="exit"]` is the overlay, and only exists while
// one is running.

import { useEffect, useLayoutEffect, useReducer, useRef } from 'react'
import { motion } from 'framer-motion'
import { EASE } from '../lib/motion'

export const PUSH_MS = 420
export const POP_MS = Math.round(PUSH_MS * 0.85)
export const PARALLAX = 0.3
export const DIM = 0.35
const WATCHDOG_MS = PUSH_MS + 300
const LAST_EXITED_TTL_MS = 30_000

const push = { duration: PUSH_MS / 1000, ease: EASE.drawer }
const pop = { duration: POP_MS / 1000, ease: EASE.out }

// The most recently dropped overlay, kept briefly so a swipe-back can show
// the page beneath (gestures.js). Module-level on purpose: there is one
// shell. Cleared after LAST_EXITED_TTL_MS so a stale page never resurfaces.
let _lastExited = null
let _lastExitedTimer = null
export function getLastExited() { return _lastExited }
// The name Task 9 consumes. Deliberately NOT reactive: it is read once, at
// the start of a gesture, and a component that re-rendered on it would be
// re-rendering on a 30s timer for nothing.
export const useLastExited = getLastExited
function rememberExited(entry) {
  _lastExited = entry
  clearTimeout(_lastExitedTimer)
  _lastExitedTimer = setTimeout(() => { _lastExited = null }, LAST_EXITED_TTL_MS)
}

export function PageTransition({ pathKey, back, rtl, enabled, scrollerRef, renderPage, children }) {
  const sign = rtl ? -1 : 1
  const [, bump] = useReducer((x) => x + 1, 0)

  // Frozen during render, like AppShell's enterDir: a fact about the moment
  // of navigation. `lastChildren` is the previous render's outlet element.
  //
  // `back` and `slide` are frozen with it. Reading the live props instead
  // would let a re-render mid-flight change the story being told (that is the
  // bug the enterDir pin in AppShell exists for), and would also make the
  // entering layer's children change shape when the overlay drops.
  const stage = useRef({
    key: pathKey,
    prev: null,
    lastChildren: children,
    seq: 0,
    back: !!back,
    slide: false,
  })
  if (stage.current.key !== pathKey) {
    const scrollTop = scrollerRef?.current?.scrollTop || 0
    const prev = enabled && stage.current.lastChildren
      ? { key: stage.current.key, el: stage.current.lastChildren, scrollTop, back: !!back }
      : null
    stage.current = {
      key: pathKey,
      seq: stage.current.seq + 1,
      lastChildren: children,
      prev,
      back: !!back,
      slide: prev !== null,
    }
  } else {
    stage.current.lastChildren = children
  }
  const { prev, seq, back: isBack, slide } = stage.current
  // `slide` is this route's entrance; `active` is "an overlay is on screen".
  const active = slide && prev !== null

  const drop = () => {
    if (!stage.current.prev) return
    rememberExited(stage.current.prev)
    stage.current.prev = null
    bump()
  }

  // Watchdog: whatever framer did or did not call, the overlay goes and the
  // entering layer is left untransformed.
  const enterRef = useRef(null)
  useEffect(() => {
    if (!active) return undefined
    const t = setTimeout(() => {
      drop()
      const el = enterRef.current
      if (el) { el.style.transform = ''; el.style.opacity = '' }
    }, WATCHDOG_MS)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seq, active])

  // Never let a transformed entering layer survive: not when the overlay has
  // gone (framer may have been interrupted mid-flight), and not when a key
  // change skips the transition altogether (e.g. the room FLIP route). Before
  // paint, so a page can never be seen off-screen.
  useLayoutEffect(() => {
    if (active) return
    const el = enterRef.current
    if (el) { el.style.transform = ''; el.style.opacity = '' }
  }, [pathKey, active])

  // The outgoing page is inert as well as aria-hidden: aria-hidden hides it
  // from the a11y tree but leaves its controls tabbable, and for ~420ms the
  // keyboard could reach a button on a page that is on its way out. React 18
  // does not know `inert`, so it is set on the node.
  const exitRef = useRef(null)
  useLayoutEffect(() => {
    const el = exitRef.current
    if (el) el.inert = true
  }, [seq, active])

  const t = isBack ? pop : push
  const enterFrom = isBack ? `${-PARALLAX * 100 * sign}%` : `${100 * sign}%`
  const exitTo = isBack ? `${100 * sign}%` : `${-PARALLAX * 100 * sign}%`
  const edgeShadow = `${-12 * sign}px 0 24px rgba(0,0,0,.18)`

  return (
    // `overflow-x: clip`, not `hidden`: hidden would force the other axis to
    // a scroll container and swallow <main>'s scrolling and sticky headers.
    // Only while a slide runs — at rest nothing in here overflows sideways,
    // and a standing clip is one more thing that can cut a page's own
    // fixed-position menu off at the edge of the content column.
    <div data-motion-stage="" style={{ position: 'relative', overflowX: active ? 'clip' : undefined }}>
      {active && (
        <motion.div
          key={`exit-${prev.key}-${seq}`}
          ref={exitRef}
          data-motion-page="exit"
          aria-hidden="true"
          initial={{ x: 0 }}
          animate={{ x: exitTo }}
          transition={t}
          onAnimationComplete={drop}
          style={{
            position: 'absolute', top: 0, insetInlineStart: 0, width: '100%', height: 'var(--vh)',
            overflow: 'hidden', pointerEvents: 'none', background: 'var(--bg)',
            zIndex: isBack ? 2 : 0, boxShadow: isBack ? edgeShadow : 'none', willChange: 'transform',
          }}
        >
          <div style={{ transform: prev.scrollTop ? `translateY(-${prev.scrollTop}px)` : undefined }}>
            {renderPage(prev.el, prev.key)}
          </div>
          {!isBack && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: DIM }} transition={t}
              style={{ position: 'absolute', inset: 0, background: '#000', pointerEvents: 'none' }} />
          )}
        </motion.div>
      )}

      <motion.div
        key={pathKey}
        ref={enterRef}
        data-motion-page={enabled ? 'enter' : 'current'}
        data-motion-enter={isBack ? 'back' : 'true'}
        // Says "this page's entrance IS the push", and is the hook motion.css
        // uses to switch off the keyed CSS enter on this one element.
        //
        // Both have to be here, and they are not the same statement. A CSS
        // animation outranks an inline style in the cascade, so without this
        // the `zm-page-in` rise on [data-motion-enter] would own `transform`
        // for its whole duration and the slide would simply not be visible —
        // the page would rise 8px instead. And the attribute cannot just be
        // dropped while sliding, because morph.js finds the page wrapper by
        // `closest('[data-motion-enter]')`. So one names the layer and its
        // direction, the other says which of the two entrances is playing.
        // Absent on the skipped paths (first load, ?pages=off, reduced
        // motion, the room FLIP's routes), where the CSS enter is the whole
        // animation and must run exactly as it did before.
        data-motion-push={slide ? '' : undefined}
        data-motion-dir={sign}
        initial={slide ? { x: enterFrom } : false}
        animate={{ x: 0 }}
        transition={t}
        style={{
          position: 'relative',
          // Everything below is lifted ONLY while an overlay is on screen.
          //
          // The z-index is the one that matters: `position: relative` alone
          // changes nothing about how a page's own `position: fixed` menu
          // paints, but relative + z-index is a stacking context, and this
          // app's pages really do render fixed menus at z-index 9999 inside
          // the routed tree (Devices' row menus, Cameras' full-screen view).
          // Left standing, that context would re-stack them under the bottom
          // nav and the toasts. It is needed for ~420ms and then dropped.
          zIndex: active ? (isBack ? 1 : 2) : undefined,
          background: active ? 'var(--bg)' : undefined,
          boxShadow: active && !isBack ? edgeShadow : undefined,
          willChange: active ? 'transform' : undefined,
        }}
      >
        {/* Mounted for the life of a back entrance, never conditionally
            removed: unmounting it would shift `children` up a slot and
            remount the whole page. Forward entrances don't render it. */}
        {slide && isBack && (
          <motion.div aria-hidden="true" initial={{ opacity: DIM }} animate={{ opacity: 0 }} transition={t}
            style={{ position: 'absolute', inset: 0, background: '#000', pointerEvents: 'none', zIndex: 1 }} />
        )}
        {children}
      </motion.div>
    </div>
  )
}
