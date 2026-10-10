// Page transitions: the iOS push, without the two failure modes that
// black-screened the app before (AppShell.jsx keeps the record).
//
//   1. There is NO AnimatePresence and NO exit→enter handshake. The entering
//      page is a plain mount with initial→animate. The outgoing page is a
//      DOM SNAPSHOT — `cloneNode(true)` of the page layer, taken during the
//      render that commits the navigation, while the old tree is still on
//      screen — painted in an inert overlay, and the overlay is removed by
//      onAnimationComplete OR a watchdog timer, whichever fires first. A
//      dropped callback cannot strand anything.
//   2. The two pages never share normal flow. The entering page is in flow
//      (so the scroller's height is the new page's); the snapshot is
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
// ── The under-page (swipe-back) ─────────────────────────────────────────────
//
// `swiping` says a swipe-back is in progress. While it is, the most recently
// exited page — the same snapshot, from getLastExited() — is painted in a
// `[data-motion-under]` layer BENEATH the current one, so the gesture reveals
// where it is going instead of dragging the page over a void. The gesture hook
// (gestures.js) owns the pixels: it paints this layer's parallax and its
// `[data-motion-scrim]` on every pointermove and settles both on release.
// One DOM node cannot be in two places, so when the exit overlay is still
// holding the snapshot this layer stands aside for that gesture.
//
// A gesture that COMMITS has already told the whole story: the finger carried
// the page off and brought the previous one in behind it. Playing the push
// again on the navigation that follows would tell it twice — the page the
// finger just placed would jump back to -30% and slide in, and a clone of the
// page it just threw off-screen would slide off a second time. So AppShell
// hands over a `settled` ref, true for exactly that one navigation, and the
// arriving page mounts AT REST: no overlay, no travel, and
// `data-motion-settled` so motion.css holds the CSS entrance back too.
//
// ── Why a snapshot and not the React element ────────────────────────────────
//
// The obvious implementation keeps the previous render's outlet element and
// renders it again inside the overlay. That is not a copy of the old page, it
// is a SECOND INSTANCE of it, mounted fresh, and it misbehaves in ways that
// reach the page the person is actually looking at:
//
//   - duplicate `id`s, with the dying copy first in DOM order, so
//     `getElementById`, `label[for]` and every `aria-*` idref in the live
//     page resolve into the overlay;
//   - focus theft, from mount effects and `autoFocus` running before the
//     overlay can be made inert;
//   - mount side effects firing twice: POSTs, camera/MJPEG streams, and a
//     redirect guard that calls `navigate()` from a mount effect would
//     navigate the whole app on its way out.
//
// A clone has no lifecycle: it cannot run effects, focus or navigate. It CAN
// still fetch — a cloned `<img>` or `<iframe>` is a new request, and a camera's
// MJPEG `<img>` is a connection that stays open — so streaming media and
// iframes are neutralised explicitly in snapshot() (a cached still is left
// alone: it re-paints from cache, and showing it is the point). The ids and
// `autofocus` attributes are stripped from it anyway, and the motion layer's
// own attributes come off its root so it is not mistaken for a live layer
// (motion.css also silences animations inside the overlay — inserting a
// cloned node would otherwise replay every CSS entrance it carries).
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
// NOTHING OF THE SLIDE STANDS AT REST. `position`, `z-index`, `background`,
// the edge shadow, `will-change` and the stage's `overflow-x: clip` exist
// only while an overlay is on screen. A standing `position: relative` would
// change the containing block of every absolutely positioned descendant of
// every page (<main> is not positioned), and a standing stacking context
// would re-stack a page's own `position: fixed` menu under the bottom nav.
//
// `data-motion-page` NAMES THE LAYER, NOT A LIVE ANIMATION. It is "enter"
// whenever the slide is enabled (that is the layer a push enters on, the one
// gestures and CSS target) and "current" when it is not. It does not flip
// back when the animation settles, precisely because the element must not be
// replaced. `[data-motion-page="exit"]` is the overlay, and only exists while
// one is running.

import { useCallback, useEffect, useLayoutEffect, useReducer, useRef } from 'react'
import { motion } from 'framer-motion'
import { EASE } from '../lib/motion'
import { effectiveScrollTop } from './gestures'

export const PUSH_MS = 420
export const POP_MS = Math.round(PUSH_MS * 0.85)
export const PARALLAX = 0.3
export const DIM = 0.35
const WATCHDOG_MS = PUSH_MS + 300
const LAST_EXITED_TTL_MS = 30_000

const push = { duration: PUSH_MS / 1000, ease: EASE.drawer }
const pop = { duration: POP_MS / 1000, ease: EASE.out }

// The most recently exited page, as a detached DOM node, kept briefly so a
// swipe-back can show the page beneath (gestures.js). Module-level on
// purpose: there is one shell. Cleared after LAST_EXITED_TTL_MS so a stale
// page never resurfaces.
//
// Handed over exactly once per navigation, and only when nothing else is
// using the node: at the moment the overlay drops it, or immediately if there
// was no overlay to show it in (the FLIP routes, ?pages=off). Two owners of
// one DOM node would mean the second mount MOVES it out of the first.
let _lastExited = null
let _lastExitedTimer = null
export function getLastExited() { return _lastExited }
function rememberExited(entry) {
  _lastExited = entry
  clearTimeout(_lastExitedTimer)
  _lastExitedTimer = setTimeout(() => { _lastExited = null }, LAST_EXITED_TTL_MS)
}

// A 1×1 transparent GIF: what a neutralised stream paints instead of opening
// a second connection to the hub.
const BLANK_PIXEL = 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw=='
// `/api/cameras/<id>/stream` is Ziggy's own MJPEG endpoint; the other two
// catch any other long-lived image URL (an HA proxy, a vendor snapshot feed).
const STREAM_SRC_RE = /\/api\/cameras|mjpeg|stream/i

// A copy of the page layer with everything that could act on the live page
// taken out of it. Pure DOM work: no React, no lifecycle, nothing to run.
function snapshot(layer) {
  if (!layer || typeof layer.cloneNode !== 'function') return null
  let node
  try { node = layer.cloneNode(true) } catch { return null }
  try {
    // The root is no longer a page layer, and must not be read as one — by a
    // querySelector, by motion.css, or by morph.js's closest() lookup. Its
    // inline style is the slide it was in the middle of, which is over.
    for (const a of ['id', 'style', 'data-motion-page', 'data-motion-enter', 'data-motion-push', 'data-motion-dir']) {
      node.removeAttribute(a)
    }
    // Duplicate ids are the dangerous half: the overlay comes FIRST in DOM
    // order, so every idref in the live page would resolve into the copy.
    node.querySelectorAll('[id]').forEach((el) => el.removeAttribute('id'))
    node.querySelectorAll('[autofocus]').forEach((el) => el.removeAttribute('autofocus'))
    // A page on its way out does not make noise or start a second stream.
    node.querySelectorAll('video, audio').forEach((el) => {
      el.removeAttribute('autoplay')
      el.muted = true
      el.pause?.()
    })
    // An <img> in a clone is a fresh request, and for a camera that request is
    // a CONNECTION THAT STAYS OPEN: Cameras renders a live MJPEG `<img>`, so
    // cloning the page opened a second stream to the hub for the length of the
    // slide (and the under-page holds the clone for the length of a gesture).
    // Only the stream-shaped ones are blanked — a cached still re-paints from
    // the memory cache without a network round trip, and showing it is the
    // entire point of the overlay.
    node.querySelectorAll('img').forEach((el) => {
      const src = el.getAttribute('src') || ''
      if (!STREAM_SRC_RE.test(src)) return
      el.removeAttribute('srcset')
      el.setAttribute('src', BLANK_PIXEL)
    })
    // An iframe is a whole second document: scripts, timers, its own network.
    node.querySelectorAll('iframe').forEach((el) => el.setAttribute('src', 'about:blank'))
  } catch { /* a snapshot is a nicety; never fail a navigation over it */ }
  return node
}

export function PageTransition({ pathKey, back, rtl, enabled, scrollerRef, swiping, pageRef, settled, children }) {
  const sign = rtl ? -1 : 1
  const [, bump] = useReducer((x) => x + 1, 0)

  // Two refs for one element. `enterRef` is the live node and is nulled when
  // React detaches it; `layerNodeRef` is only ever written with a node, so
  // during the render that commits a navigation it still points at the
  // outgoing layer — which is exactly what we need to clone. The DOM of the
  // old tree is intact during that render; React tears it down afterwards.
  const enterRef = useRef(null)
  const layerNodeRef = useRef(null)
  // `pageRef` is the third reader of the same element: the swipe-back gesture
  // moves the page LAYER (so the under-page beside it is revealed), not
  // <main>. Written from this one callback rather than a second ref so the
  // three never disagree about which node is current.
  const setEnterRef = useCallback((el) => {
    enterRef.current = el
    if (el) layerNodeRef.current = el
    if (pageRef) pageRef.current = el
  }, [pageRef])

  // Frozen during render, like AppShell's enterDir: a fact about the moment
  // of navigation. `back` and `slide` are frozen with it — reading the live
  // props instead would let a re-render mid-flight change the story being
  // told (that is the bug the enterDir pin in AppShell exists for).
  const stage = useRef({ key: pathKey, prev: null, seq: 0, back: !!back, slide: false, settledKey: null })
  if (stage.current.key !== pathKey) {
    // NOT `scrollerRef.current.scrollTop`. <main> is a column in a row flex
    // container, so it grows to its content and its scrollTop is always 0 —
    // the document is what scrolls (see effectiveScrollTop in gestures.js).
    // Reading the element directly froze every snapshot at the page's top, so
    // the overlay showed a slice the person had never been looking at.
    const scrollTop = effectiveScrollTop(scrollerRef?.current)
    const node = snapshot(layerNodeRef.current)
    const snap = node ? { key: stage.current.key, node, scrollTop, back: !!back } : null
    // Consumed here, in the render that commits the navigation it belongs to,
    // and only once: the next navigation is somebody else's.
    const settledNav = !!settled?.current
    if (settledNav && settled) settled.current = false
    // No snapshot is ever silently discarded. One that is still mid-slide
    // when the next navigation lands is handed over here; the one taken now
    // is handed over when its overlay drops, or at once if it will not get
    // an overlay at all (the room FLIP's routes, ?pages=off) — a swipe-back
    // needs an under-page either way.
    if (stage.current.prev) rememberExited(stage.current.prev)
    // A settled navigation gets no overlay — the gesture WAS the exit — but
    // the snapshot is still handed over, because the next swipe-back needs an
    // under-page as much as any other route does.
    const slide = !!(enabled && snap) && !settledNav
    if (!slide && snap) rememberExited(snap)
    stage.current = {
      key: pathKey,
      seq: stage.current.seq + 1,
      prev: slide ? snap : null,
      back: !!back,
      slide,
      settledKey: settledNav ? pathKey : null,
    }
  }
  const { prev, seq, back: isBack, slide, settledKey } = stage.current
  // `slide` is this route's entrance; `active` is "an overlay is on screen".
  const active = slide && prev !== null
  // This page was placed by a finger, not animated in. Frozen with the rest
  // of the stage, so a later re-render cannot re-decide it.
  const isSettled = settledKey === pathKey

  const drop = () => {
    if (!stage.current.prev) return
    rememberExited(stage.current.prev)
    stage.current.prev = null
    bump()
  }

  // Watchdog: whatever framer did or did not call, the overlay goes and the
  // entering layer is left untransformed.
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

  // The snapshot goes in before paint, into an empty host React owns but
  // never fills, so React and the DOM never disagree about its children.
  // Cleared on the way out, which also releases the node for whoever asked
  // getLastExited() for it.
  const exitRef = useRef(null)
  const mountRef = useRef(null)
  useLayoutEffect(() => {
    const host = mountRef.current
    const node = stage.current.prev?.node
    if (!host || !node) return undefined
    // Inert first, so nothing in the snapshot is tab-reachable even for the
    // frame it takes to paint. aria-hidden alone leaves controls tabbable,
    // and for ~420ms the keyboard could reach a button on a page that is on
    // its way out. React 18 does not know the attribute, so it is set as a
    // property. Older Android WebViews ignore `inert` entirely — there the
    // snapshot stays tabbable for the length of the slide; it is a clone, so
    // the worst case is a keystroke into something that is about to vanish.
    const el = exitRef.current
    if (el) el.inert = true
    host.replaceChildren(node)
    return () => { try { host.replaceChildren() } catch { /* already gone */ } }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seq, active])

  // ── The page beneath, while a swipe-back is in progress ──────────────
  //
  // Same snapshot, same reasons as the exit overlay (a clone has no
  // lifecycle), and the same single-owner rule: a DOM node can only be in one
  // place, so when an overlay is still holding it — `prev !== null`, i.e.
  // `active` — this layer does not exist for that gesture and the hook simply
  // moves the page over whatever is already there. It is also the only honest
  // answer: the page under the finger is the one the overlay is showing.
  //
  // `entry.back` is the second half of the question. The remembered page is
  // only BEHIND this one if a forward navigation put it away; if we arrived
  // here by going back — including the committed swipe that just landed —
  // then the remembered page is the one AHEAD, and painting it under a
  // back-gesture would show the wrong room entirely. (It is also what keeps
  // the settled landing clean: for that one frame `swiping` is still true,
  // and the freshly remembered page is the one the finger just threw off.)
  const remembered = swiping && !active ? getLastExited() : null
  const last = remembered && !remembered.back ? remembered : null
  const underRef = useRef(null)
  const underMountRef = useRef(null)
  useLayoutEffect(() => {
    const host = underMountRef.current
    const node = last?.node
    if (!host || !node) return undefined
    // Inert before paint, like the overlay: nothing in a page that is only
    // being previewed under a gesture is tab-reachable. React 18 does not
    // know the attribute, so it is set as a property.
    const el = underRef.current
    if (el) el.inert = true
    host.replaceChildren(node)
    // Cleared on the way out, which releases the node again — the overlay
    // takes it back on the very next navigation.
    return () => { try { host.replaceChildren() } catch { /* already gone */ } }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [swiping, last?.key])

  const t = isBack ? pop : push
  const enterFrom = isBack ? `${-PARALLAX * 100 * sign}%` : `${100 * sign}%`
  const exitTo = isBack ? `${100 * sign}%` : `${-PARALLAX * 100 * sign}%`
  const edgeShadow = `${-12 * sign}px 0 24px rgba(0,0,0,.18)`

  return (
    // `overflow-x: clip`, not `hidden`: hidden would force the other axis to
    // a scroll container and swallow <main>'s scrolling and sticky headers.
    // Positioned and clipped only while a slide runs (see the header note on
    // what must not stand at rest). Task 9 extends that condition to a
    // swipe in progress.
    <div
      data-motion-stage=""
      style={{
        position: (active || swiping) ? 'relative' : undefined,
        overflowX: (active || swiping) ? 'clip' : undefined,
      }}
    >
      {last && (
        <div
          ref={underRef}
          data-motion-under=""
          aria-hidden="true"
          style={{
            position: 'absolute', top: 0, insetInlineStart: 0, width: '100%', height: 'var(--vh)',
            overflow: 'hidden', pointerEvents: 'none', background: 'var(--bg)', zIndex: 0,
            // Where the hook's own first paint puts it, so the layer cannot be
            // seen un-parallaxed for the frame between mount and pointermove.
            transform: `translate3d(${-PARALLAX * 100 * sign}%,0,0)`,
            willChange: 'transform',
          }}
        >
          <div style={{ transform: last.scrollTop ? `translateY(-${last.scrollTop}px)` : undefined }}>
            <div ref={underMountRef} />
          </div>
          <div data-motion-scrim="" style={{ position: 'absolute', inset: 0, background: '#000', opacity: DIM, pointerEvents: 'none' }} />
        </div>
      )}

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
            <div ref={mountRef} />
          </div>
          {!isBack && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: DIM }} transition={t}
              style={{ position: 'absolute', inset: 0, background: '#000', pointerEvents: 'none' }} />
          )}
        </motion.div>
      )}

      <motion.div
        key={pathKey}
        ref={setEnterRef}
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
        // Placed by a finger: this page is already where it belongs, so it
        // must not travel AND must not rise. `data-motion-push` is the wrong
        // marker for it (there is no push to prefer over the CSS enter), so
        // motion.css keys the suppression on this one instead.
        data-motion-settled={isSettled ? '' : undefined}
        data-motion-dir={sign}
        initial={(slide && !isSettled) ? { x: enterFrom } : false}
        animate={{ x: 0 }}
        transition={t}
        style={{
          // Nothing here outlives the overlay. The z-index is the one that
          // matters most: `position: relative` alone changes nothing about
          // how a page's own `position: fixed` menu paints, but relative +
          // z-index is a stacking context, and this app's pages really do
          // render fixed menus at z-index 9999 inside the routed tree
          // (Devices' row menus, Cameras' full-screen view). Left standing,
          // that context would re-stack them under the bottom nav and the
          // toasts. Needed for ~420ms, then dropped.
          // `swiping` is the same bargain for the length of a gesture: the
          // under-page is absolutely positioned against the stage, and this
          // layer needs an opaque background so the page beneath does not
          // show through the one the finger is holding.
          position: (active || swiping) ? 'relative' : undefined,
          zIndex: active ? (isBack ? 1 : 2) : undefined,
          background: (active || swiping) ? 'var(--bg)' : undefined,
          boxShadow: active && !isBack ? edgeShadow : undefined,
          willChange: active ? 'transform' : undefined,
        }}
      >
        {/* The incoming page dims back up on the way to the front. In its own
            child slot, so dropping it leaves `children` exactly where it was
            — moving that slot would remount the whole page. */}
        {active && isBack && (
          <motion.div aria-hidden="true" initial={{ opacity: DIM }} animate={{ opacity: 0 }} transition={t}
            style={{ position: 'absolute', inset: 0, background: '#000', pointerEvents: 'none', zIndex: 1 }} />
        )}
        {children}
      </motion.div>
    </div>
  )
}
