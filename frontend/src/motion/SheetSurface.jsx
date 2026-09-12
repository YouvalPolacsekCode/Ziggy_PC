// The app's ONE sheet.
//
// Ziggy already had a bottom sheet — components/chat/ChatSheet.jsx — and it was
// good: a grab handle, a header that is the drag surface, drag-to-dismiss on
// distance or velocity, reduced-motion, and an eligibility gate kept outside
// AnimatePresence so it vanishes synchronously on a route change. This file is
// that sheet's mechanics lifted out so a second thing (a device) can be
// presented the same way. It is NOT a second sheet system: after this change the
// chat sheet and the device sheet are two skins on this one component.
//
// Two frames:
//
//   narrow — a bottom sheet. Enters from the bottom on the shared sheet spring,
//     is dragged by its header (and, when the caller opts in, by its body while
//     that body is scrolled to its top), snaps to detents using where a flick
//     would LAND rather than where the finger let go, rubber-bands past the top
//     stop, and leaves by swipe, flick, Escape, the backdrop or a close button.
//     The backdrop's opacity follows the drag, so letting go halfway reads as
//     one continuous movement instead of a snap.
//
//   wide (>= 768px, opt-in per caller via `dock`) — a docked panel on the
//     trailing edge, at the dashboard rail's own 320px. No grabber and no drag,
//     so a caller that can promote to a full page gets a labelled expand button
//     in the header instead.
//
// ── Two deliberate choices, both about not breaking what exists ──────────────
//
// 1. framer owns `y`, not `el.style.transform`.
//    motion/gestures.js has `useSheetDetents`, a pointer-based engine that
//    drives the transform imperatively. It encodes exactly the right rules —
//    velocity-projected snapping, a flick threshold, rubber band past the top,
//    body-drag only at scrollTop 0 — and this file reuses those rules and their
//    numbers. It does not reuse the engine, because the engine would have to
//    take `transform` away from framer, and the chat sheet's entrance is a
//    framer spring (SPRING_SHEET) on `y`. Swapping that for a CSS curve is a
//    change to the chat sheet nobody asked for. So the rules live here on top of
//    framer's own drag, which is the system the chat sheet already used.
//
// 2. Everything the layer ADDS is gated on isMotionOn().
//    With `data-motion="off"` a sheet here behaves exactly as ChatSheet did on
//    main: header drag, dismiss at 120px or 600px/s, a backdrop that fades in
//    and out on its own. Detents, projection, the flick rule, the tracked
//    backdrop and body drag are all motion-on additions.
//
// The skin is the caller's. The two sheets genuinely rest differently — the chat
// sheet is a 560px-max column of `--bg` holding a whole AIChat, the device sheet
// is a full-width `--surface` card holding one control — so `styles`,
// `classNames` and `attrs` are passed in and this file imposes no resting
// appearance of its own beyond the defaults in sheet.css.

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { motion, AnimatePresence, useDragControls, useReducedMotion } from 'framer-motion'
import { Maximize2, X } from 'lucide-react'
import { useIsRTL, useT } from '../lib/i18n'
import { SPRING_SHEET, T_STATE, T_ENTER } from '../lib/motion'
import { isMotionOn } from './flag'
import { clamp, haptic, nearest, project } from './motion'
import './sheet.css'

const WIDE_QUERY = '(min-width: 768px)'

// Same numbers as motion/gestures.js — see the note above.
const FLICK = 900          // px/s: a flick commits regardless of distance
const PROJECT = 0.12       // motion.js project() decay factor
// Raw over-drag above the top detent that counts as "dragged to the top".
// Raw, not damped: framer's elastic shrinks what you SEE, info.offset.y is what
// the finger actually did.
const PAST_TOP_PX = 60

// Defaults hoisted so a re-render never hands a new object to a dependency list.
const ONE_DETENT = [1]
const DEFAULT_ELASTIC = { top: 0.05, bottom: 1 }
const EMPTY = {}

const DEFAULT_LAYER_STYLE = {
  position: 'fixed', left: 0, right: 0, top: 0, height: 'var(--vh)',
  zIndex: 50,
  display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', alignItems: 'stretch',
  pointerEvents: 'none',
}
const DEFAULT_SCRIM_STYLE = {
  position: 'absolute', inset: 0,
  background: 'var(--backdrop)', backdropFilter: 'blur(8px)',
  pointerEvents: 'auto', touchAction: 'none',
}

// Live, because a window gets resized and a tablet gets rotated.
export function useWideFrame() {
  const [wide, setWide] = useState(() => {
    try { return !!window.matchMedia?.(WIDE_QUERY).matches } catch { return false }
  })
  useEffect(() => {
    let mq
    try { mq = window.matchMedia?.(WIDE_QUERY) } catch { return undefined }
    if (!mq) return undefined
    const onChange = (e) => setWide(e.matches)
    setWide(mq.matches)
    mq.addEventListener?.('change', onChange)
    return () => mq.removeEventListener?.('change', onChange)
  }, [])
  return wide
}

/**
 * @param {boolean}   open
 * @param {Function}  onClose        dismissed — gesture, Escape, backdrop or the close button
 * @param {string}    title          the accessible name, and the docked frame's visible title
 * @param {string}    [label]        overrides the accessible name when the title is not enough
 * @param {boolean}   [dock]         allow the wide (docked panel) frame at >= 768px
 * @param {number[]}  [detents]      fractions of the layer height. The default [1] is a single
 *                                   detent — "rest exactly where the panel already rests".
 * @param {boolean}   [bodyDrag]     let the body start a drag while it is scrolled to its top
 * @param {Function}  [onPromote]    dragging to the top (narrow) / the expand button (wide)
 * @param {object}    [styles]       {layer, scrim, panel, head, body} inline style overrides
 * @param {object}    [classNames]   {panel, head, body}
 * @param {object}    [attrs]        {layer, scrim, panel, head, body} extra DOM props
 */
export function SheetSurface({
  open,
  onClose,
  title,
  label,
  children,
  header = null,

  dock = false,
  detents = ONE_DETENT,
  bodyDrag = false,
  dragElastic = DEFAULT_ELASTIC,
  closeDistance = 120,
  closeVelocity = 600,
  onPromote = null,
  promoteLabel,
  closeButton = false,
  restoreFocus = false,

  styles = EMPTY,
  classNames = EMPTY,
  attrs = EMPTY,
  layerRef: extLayerRef = null,
  panelRef: extPanelRef = null,
}) {
  const t = useT()
  const rtl = useIsRTL()
  const wide = useWideFrame()
  const reduce = useReducedMotion()
  const motionOn = isMotionOn()

  const ownLayerRef = useRef(null)
  const ownPanelRef = useRef(null)
  const layerRef = extLayerRef || ownLayerRef
  const panelRef = extPanelRef || ownPanelRef
  const scrimRef = useRef(null)
  const bodyRef = useRef(null)
  const dragControls = useDragControls()
  const closing = useRef(false)
  const restoreTo = useRef(null)

  const docked = dock && wide
  const draggable = open && !docked

  // ── Detent geometry ───────────────────────────────────────────────────
  // stops are y-offsets, ascending: stops[0] is the top (tallest) rest,
  // stops[last] is the peek. A single-detent sheet has exactly one of each and
  // they are the same number — which is how the chat sheet keeps resting where
  // it always did.
  const [stops, setStops] = useState([0])
  const [idx, setIdx] = useState(Math.max(0, detents.length - 1))
  // framer animates when the TARGET changes. A drag moves the panel without
  // changing it, so "snap back to the stop you were already at" would be a
  // no-op and a sheet released between two detents would just stay there.
  // Alternating a hundredth of a pixel makes every settle a real target change.
  // (A single-detent sheet never needs it: its drag constraints are one point,
  // so framer springs it home on release by itself — which is exactly what the
  // chat sheet has always done.)
  const [settle, setSettle] = useState(0)
  const detentsRef = useRef(detents)
  detentsRef.current = detents
  const idxRef = useRef(idx)
  idxRef.current = idx
  const stopsRef = useRef(stops)
  stopsRef.current = stops

  const measure = useCallback(() => {
    const el = panelRef.current
    if (!el) return
    const H = el.offsetHeight
    const L = layerRef.current?.offsetHeight || (typeof window !== 'undefined' ? window.innerHeight : 0)
    // A single detent means "rest exactly where you are laid out" — no measured
    // fraction, no chance of arithmetic moving a sheet that already knows its
    // own height (the chat sheet measures itself against the visual viewport).
    const next = detentsRef.current.length < 2
      ? [0]
      : detentsRef.current
        .map((f) => Math.max(0, H - Math.round(L * f)))
        .sort((a, b) => a - b)
    setStops((prev) => (
      prev.length === next.length && prev.every((v, i) => v === next[i]) ? prev : next
    ))
  }, [panelRef, layerRef])

  // Before paint, so the sheet's first animated frame already targets the right
  // stop rather than sliding to one place and then correcting to another.
  useLayoutEffect(() => {
    if (!open) return undefined
    closing.current = false
    setIdx(Math.max(0, detentsRef.current.length - 1))
    measure()
    return undefined
  }, [open, measure])

  // Content that resolves its own height a tick late (a remote waiting on entity
  // state, an image) must not leave the sheet parked at a stop computed for a
  // height it no longer has.
  useEffect(() => {
    if (!open || !motionOn) return undefined
    const el = panelRef.current
    if (!el || typeof ResizeObserver === 'undefined') return undefined
    const ro = new ResizeObserver(() => measure())
    ro.observe(el)
    const onResize = () => measure()
    window.addEventListener('resize', onResize)
    return () => { ro.disconnect(); window.removeEventListener('resize', onResize) }
  }, [open, motionOn, measure, panelRef])

  // True only when the detents are actually different heights. With short
  // content every stop collapses to 0, and settling there must NOT read as a
  // drag to the top.
  const twoStops = stops.length > 1 && stops[0] !== stops[stops.length - 1]

  // ── Dismissal ─────────────────────────────────────────────────────────
  const dismiss = useCallback(() => {
    if (closing.current) return
    closing.current = true
    // Hand the backdrop back to framer cleanly: its exit tween writes opacity
    // per frame, and a CSS transition left over from a settle would lag it.
    // Only reachable with the flag on — nothing writes that transition without it.
    if (motionOn && scrimRef.current) scrimRef.current.style.transition = 'none'
    onClose?.()
  }, [onClose, motionOn])

  const promote = useCallback(() => {
    if (closing.current || !onPromote) return
    closing.current = true
    onPromote()
  }, [onPromote])

  // ── Backdrop follows the drag ─────────────────────────────────────────
  // Opacity only; the colour token is untouched. framer's own enter/exit fade
  // on the scrim has settled by the time a finger is on the sheet, so writing
  // the inline value here never fights it — and on exit framer writes the same
  // property again and takes it back.
  const paintScrim = useCallback((y) => {
    const scrim = scrimRef.current
    const el = panelRef.current
    if (!scrim || !el) return
    const H = el.offsetHeight || 1
    const peek = stopsRef.current[stopsRef.current.length - 1]
    scrim.style.transition = 'none'
    scrim.style.opacity = String(clamp((H - y) / Math.max(1, H - peek), 0, 1))
  }, [panelRef])

  // Only ever called on the motion-on path: with the flag off nothing has
  // touched the backdrop's inline opacity, and it must stay that way.
  const settleScrim = useCallback(() => {
    const scrim = scrimRef.current
    if (!scrim) return
    scrim.style.transition = reduce ? 'none' : 'opacity var(--dur-state) var(--ease-standard)'
    scrim.style.opacity = '1'
  }, [reduce])

  const onDrag = useCallback((_e, info) => {
    // `onDrag` is also a real DOM prop. If framer is ever standing aside (a test
    // that stubs it out), a native drag event would arrive here with no info.
    if (!motionOn || !info?.offset) return
    paintScrim(stopsRef.current[idxRef.current] + info.offset.y)
  }, [motionOn, paintScrim])

  const goToDetent = useCallback((next) => {
    if (next !== idxRef.current) haptic('medium')
    setIdx(next)
    setSettle((s) => s + 1)
    settleScrim()
  }, [settleScrim])

  const onDragEnd = useCallback((_e, info) => {
    if (!info?.offset) return
    const dy = info.offset.y
    const v = info.velocity?.y ?? 0

    // The rule the chat sheet has always had, preserved verbatim and checked
    // first so nothing that dismisses today stops dismissing.
    if (dy > closeDistance || v > closeVelocity) { if (motionOn) haptic('light'); dismiss(); return }

    // Flag off: framer springs the panel home on its own and the backdrop was
    // never touched. Exactly what ChatSheet did on main.
    if (!motionOn) return

    const cur = stopsRef.current[idxRef.current] + dy
    const top = stopsRef.current[0]

    // Released rubber-banded above the top: that is a drag to the top even when
    // the content was too short for the detents to differ.
    if (onPromote && cur < top - PAST_TOP_PX) { haptic('medium'); promote(); return }

    const H = panelRef.current?.offsetHeight || 0
    if (v > FLICK) { haptic('light'); dismiss(); return }
    if (v < -FLICK) { goToDetent(0); return }

    // Velocity projection: snap to where the flick would LAND, so a fast short
    // gesture commits like a slow long one.
    const landing = project(cur, v, PROJECT)
    const dismissAt = Math.max(H, stopsRef.current[stopsRef.current.length - 1] + 1)
    const target = nearest(landing, [...stopsRef.current, dismissAt])
    if (target === dismissAt) { haptic('light'); dismiss(); return }
    goToDetent(stopsRef.current.indexOf(target))
  }, [closeDistance, closeVelocity, dismiss, goToDetent, motionOn, onPromote, panelRef, promote, settleScrim])

  // Settling on the top detent IS the drag to the top.
  useEffect(() => {
    if (!draggable || !motionOn || !onPromote) return
    if (idx === 0 && twoStops) promote()
  }, [idx, draggable, motionOn, onPromote, promote, twoStops])

  // ── Drag surfaces ─────────────────────────────────────────────────────
  const startDrag = useCallback((e) => {
    if (!draggable) return
    // Never take the pointer out from under something the person is using.
    if (e.target?.closest?.('button, a, input, select, textarea, [role="slider"], [data-no-swipe]')) return
    dragControls.start(e)
  }, [draggable, dragControls])

  // Body drag is opt-in. A body that is itself a scroller we do not own (the
  // chat sheet's AIChat) must keep every pointer it gets.
  const startBodyDrag = useCallback((e) => {
    if (!draggable || !motionOn || !bodyDrag) return
    if ((bodyRef.current?.scrollTop || 0) > 0) return
    startDrag(e)
  }, [draggable, motionOn, bodyDrag, startDrag])

  // Tapping the grabber cycles detents — and on a sheet with nothing to cycle
  // to, promoting is the honest answer to "show me more".
  const onGrabberTap = useCallback(() => {
    if (!draggable || !motionOn) return
    if (!twoStops) { if (onPromote) promote(); return }
    goToDetent((idxRef.current + stopsRef.current.length - 1) % stopsRef.current.length)
  }, [draggable, motionOn, twoStops, onPromote, promote, goToDetent])

  // ── Escape ────────────────────────────────────────────────────────────
  // Keyboard-initiated, so no animation would be ideal — but the exit is 240ms
  // and the store flip is instant, which is close enough without a second path.
  useEffect(() => {
    if (!open) return undefined
    const onKey = (e) => { if (e.key === 'Escape') dismiss() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, dismiss])

  // ── Page scroll lock ──────────────────────────────────────────────────
  // Both scrollers: <html> (browsers that scroll the page) and <body>.
  useEffect(() => {
    if (!open) return undefined
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
  }, [open])

  // ── Focus ─────────────────────────────────────────────────────────────
  // Opt-in: the chat sheet never did this, and "byte-identical with the flag
  // off" means it still does not.
  useEffect(() => {
    if (!open || !restoreFocus) return undefined
    restoreTo.current = document.activeElement
    return () => {
      const el = restoreTo.current
      restoreTo.current = null
      if (el && typeof el.focus === 'function' && document.contains(el)) {
        try { el.focus({ preventScroll: true }) } catch { /* detached */ }
      }
    }
  }, [open, restoreFocus])

  const panelTransition = reduce ? { duration: 0 } : SPRING_SHEET
  const exitTransition = reduce ? { duration: 0 } : T_ENTER
  const scrimTransition = reduce ? { duration: 0 } : T_STATE
  const restY = (stops[Math.min(idx, stops.length - 1)] ?? 0) + (settle % 2 ? 0.01 : 0)

  const expandButton = onPromote ? (
    <button
      type="button"
      onClick={promote}
      className="z-icon-btn"
      style={{ width: 30, height: 30, borderRadius: 8, flexShrink: 0 }}
      aria-label={promoteLabel || t('common.expand')}
      title={promoteLabel || t('common.expand')}
    >
      <Maximize2 size={14} aria-hidden="true" />
    </button>
  ) : null

  const closeBtn = (
    <button
      type="button"
      onClick={dismiss}
      className="z-icon-btn"
      style={{ width: 30, height: 30, borderRadius: 8, flexShrink: 0 }}
      aria-label={t('common.close')}
      title={t('common.close')}
    >
      <X size={14} aria-hidden="true" />
    </button>
  )

  // The default header — a grabber, the name on one line, an optional close.
  // A caller that already has a header (the chat sheet) passes its own.
  const defaultHeader = (
    <>
      <span
        data-motion-grabber
        aria-hidden="true"
        className="z-msheet-grabber"
        onPointerUp={onGrabberTap}
      />
      <span className="z-msheet-title" dir="auto">{title}</span>
      {closeButton && closeBtn}
    </>
  )

  return (
    <AnimatePresence>
      {open && (docked ? (
        <>
          {/* No dim: the panel sits beside the page, not over it. The overlay is
              only there to catch an outside press. */}
          <motion.div
            onClick={dismiss}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, transition: scrimTransition }}
            transition={scrimTransition}
            style={{ position: 'fixed', inset: 0, zIndex: 49, background: 'transparent' }}
            {...(attrs.scrim || EMPTY)}
          />
          <motion.section
            ref={panelRef}
            className="z-mdock"
            role="dialog"
            aria-modal="true"
            aria-label={label || title}
            initial={reduce ? { opacity: 0 } : { opacity: 0, x: rtl ? -18 : 18 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, transition: exitTransition }}
            transition={reduce ? { duration: 0 } : T_ENTER}
            {...(attrs.panel || EMPTY)}
          >
            <div className="z-mdock-head">
              <span className="z-msheet-title" dir="auto">{title}</span>
              {expandButton}
              {closeBtn}
            </div>
            <div ref={bodyRef} className="z-mdock-body scrollbar-thin">
              {children}
            </div>
          </motion.section>
        </>
      ) : (
        <div
          ref={layerRef}
          style={styles.layer || DEFAULT_LAYER_STYLE}
          {...(attrs.layer || EMPTY)}
        >
          <motion.div
            ref={scrimRef}
            onClick={dismiss}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, transition: scrimTransition }}
            transition={scrimTransition}
            style={styles.scrim || DEFAULT_SCRIM_STYLE}
            {...(attrs.scrim || EMPTY)}
          />
          <motion.div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-label={label || title}
            className={classNames.panel}
            drag="y"
            dragListener={false}
            dragControls={dragControls}
            dragConstraints={{ top: stops[0], bottom: stops[stops.length - 1] }}
            dragElastic={dragElastic}
            dragMomentum={false}
            onDrag={onDrag}
            onDragEnd={onDragEnd}
            initial={{ y: '100%' }}
            animate={{ y: restY }}
            exit={{ y: '100%', transition: exitTransition }}
            transition={panelTransition}
            style={styles.panel}
            {...(attrs.panel || EMPTY)}
          >
            <div
              className={classNames.head}
              style={styles.head}
              onPointerDown={startDrag}
              {...(attrs.head || EMPTY)}
            >
              {header || defaultHeader}
            </div>
            <div
              ref={bodyRef}
              className={classNames.body}
              style={styles.body}
              onPointerDown={startBodyDrag}
              {...(attrs.body || EMPTY)}
            >
              {children}
            </div>
          </motion.div>
        </div>
      ))}
    </AnimatePresence>
  )
}

export default SheetSurface
