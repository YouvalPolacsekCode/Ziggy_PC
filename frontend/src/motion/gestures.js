// The gesture engines: swipe-back, sheet detents, value scrubbing, long-press
// and scroll chrome. All pointer-based (one code path for mouse and touch),
// all pointer-captured, all interruptible, all no-ops when the flag is off.
//
// None of these change how anything LOOKS. They change what your finger can
// do and how the result arrives.

import { useCallback, useEffect, useRef, useState } from 'react'
import { isMotionOn } from './flag'
import { CSS_EASE, clamp, haptic, isReduced, makeVelocityTracker, nearest, project } from './motion'

// ── Long-press vs tap ───────────────────────────────────────────────────
// A press that travels more than 8px is neither: it is a scroll or a scrub.

export function useLongPress({ onLongPress, onTap, ms = 480, enabled = true } = {}) {
  const timer = useRef(null)
  const fired = useRef(false)
  const start = useRef(null)

  const cancel = useCallback(() => {
    clearTimeout(timer.current)
    start.current = null
  }, [])

  const onPointerDown = useCallback((e) => {
    if (!enabled || !isMotionOn()) return
    if (e.pointerType === 'mouse' && e.button !== 0) return
    fired.current = false
    start.current = { x: e.clientX, y: e.clientY }
    clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      fired.current = true
      start.current = null
      haptic('medium')
      onLongPress?.(e)
    }, ms)
  }, [enabled, onLongPress, ms])

  const onPointerMove = useCallback((e) => {
    if (!start.current) return
    if (Math.hypot(e.clientX - start.current.x, e.clientY - start.current.y) > 8) cancel()
  }, [cancel])

  const onClick = useCallback((e) => {
    if (fired.current) { fired.current = false; e.preventDefault(); e.stopPropagation(); return }
    onTap?.(e)
  }, [onTap])

  useEffect(() => () => clearTimeout(timer.current), [])

  if (!enabled || !isMotionOn()) return { onClick: onTap }
  return {
    onPointerDown, onPointerMove,
    onPointerUp: cancel, onPointerCancel: cancel, onPointerLeave: cancel,
    onClick,
  }
}

// ── Swipe back ──────────────────────────────────────────────────────────
// Drag from the leading edge to go back. The page follows the finger 1:1 and
// commits past 30% of the width OR on a flick over 500px/s, which is what
// makes a short, fast gesture feel the same as a long, slow one. Below the
// threshold it springs home, so the gesture is always cancellable.
//
// `ref` is the element that should move. `onBack` runs on commit.

const COMMIT_FRACTION = 0.3
const COMMIT_VELOCITY = 500
const EDGE = 32

export function useSwipeBack(ref, onBack, { enabled = true, rtl = false } = {}) {
  const state = useRef(null)
  const vel = useRef(makeVelocityTracker())

  useEffect(() => {
    const el = ref.current
    if (!el || !enabled || !isMotionOn()) return
    const sign = rtl ? -1 : 1

    const paint = (dx) => {
      el.style.transition = 'none'
      el.style.transform = dx ? `translate3d(${dx}px,0,0)` : ''
      el.style.willChange = dx ? 'transform' : ''
    }
    const settle = (dx, ms, then) => {
      el.style.transition = `transform ${ms}ms ${CSS_EASE.out}`
      el.style.transform = dx ? `translate3d(${dx}px,0,0)` : 'translate3d(0,0,0)'
      // `transitionend` can fire more than once (one event per property) and
      // the timeout is a fallback for when it does not fire at all, so the
      // completion MUST be idempotent. Without this guard a committed swipe
      // called navigate(-1) twice and went back two entries — off the end of
      // the app's history and onto a blank page.
      let finished = false
      let timer = null
      const finish = () => {
        if (finished) return
        finished = true
        clearTimeout(timer)
        el.removeEventListener('transitionend', finish)
        el.style.transition = ''
        el.style.willChange = ''
        if (!then) el.style.transform = ''
        then?.()
      }
      el.addEventListener('transitionend', finish)
      timer = setTimeout(finish, ms + 80)
    }

    const down = (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return
      const r = el.getBoundingClientRect()
      const fromEdge = rtl ? r.right - e.clientX : e.clientX - r.left
      if (fromEdge > EDGE) return
      // Never start over something the person is actually using.
      if (e.target.closest?.('button, a, input, select, textarea, [role="slider"], [role="button"], [data-no-swipe]')) return
      state.current = { x0: e.clientX, y0: e.clientY, locked: null, w: r.width }
      vel.current.start(e.clientX)
    }

    const move = (e) => {
      const s = state.current
      if (!s) return
      const dx = (e.clientX - s.x0) * sign
      const dy = e.clientY - s.y0
      if (s.locked === null) {
        if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return
        // Direction lock: a mostly-vertical start belongs to the scroller.
        s.locked = Math.abs(dx) > Math.abs(dy)
        if (!s.locked) { state.current = null; return }
        el.setPointerCapture?.(e.pointerId)
      }
      vel.current.move(e.clientX)
      // Resist the wrong direction rather than refusing it outright.
      const travel = dx < 0 ? dx * 0.18 : dx
      paint(travel * sign)
      e.preventDefault()
    }

    const up = () => {
      const s = state.current
      if (!s) return
      state.current = null
      if (s.locked !== true) return
      const dx = (parseFloat(el.style.transform.replace(/[^-\d.]/g, '')) || 0) * sign
      const v = vel.current.get() * sign
      if (dx > s.w * COMMIT_FRACTION || v > COMMIT_VELOCITY) {
        settle(s.w * sign, 240, () => onBack?.())
      } else {
        settle(0, 200)
      }
    }

    el.addEventListener('pointerdown', down, { passive: true })
    el.addEventListener('pointermove', move, { passive: false })
    el.addEventListener('pointerup', up, { passive: true })
    el.addEventListener('pointercancel', up, { passive: true })
    return () => {
      el.removeEventListener('pointerdown', down)
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
      el.removeEventListener('pointercancel', up)
      el.style.transform = ''
      el.style.transition = ''
    }
  }, [ref, onBack, enabled, rtl])
}

// ── Sheet detents ───────────────────────────────────────────────────────
// Drag a sheet by its header. Two detents plus dismiss, velocity-projected
// snapping, rubber-band resistance past the top, and a flick rule so a fast
// short flick dismisses like a slow long drag. Body drags only count when the
// body is already scrolled to the top, otherwise the scroller owns the
// gesture.

const FLICK = 900

export function useSheetDetents({ sheetRef, bodyRef, onClose, detents = [0.5, 1], enabled = true }) {
  const [detent, setDetent] = useState(detents.length - 1)
  const drag = useRef(null)
  const vel = useRef(makeVelocityTracker())
  const geom = useRef({ H: 0, stops: [], dismiss: 0 })

  const measure = useCallback(() => {
    const el = sheetRef.current
    if (!el) return
    const H = el.offsetHeight
    const parentH = el.offsetParent?.offsetHeight || window.innerHeight
    geom.current = {
      H,
      // y offset for each detent, largest detent first (y grows downward)
      stops: detents.map((f) => Math.max(0, H - Math.round(parentH * f))).sort((a, b) => a - b),
      dismiss: H,
    }
  }, [sheetRef, detents])

  useEffect(() => { measure() })

  const place = useCallback((y, animated = true) => {
    const el = sheetRef.current
    if (!el) return
    el.style.transition = animated && !isReduced() ? `transform 360ms ${CSS_EASE.drawer}` : 'none'
    el.style.transform = `translate3d(0,${y}px,0)`
  }, [sheetRef])

  const goTo = useCallback((y) => {
    const { stops, dismiss } = geom.current
    if (y >= dismiss) { place(dismiss); setTimeout(() => onClose?.(), 240); return }
    const idx = stops.indexOf(y)
    if (idx !== -1 && idx !== detent) { haptic('medium'); setDetent(idx) }
    place(y)
  }, [place, onClose, detent])

  const onPointerDown = useCallback((e, fromBody = false) => {
    if (!enabled || !isMotionOn()) return
    if (e.pointerType === 'mouse' && e.button !== 0) return
    if (fromBody) {
      if ((bodyRef?.current?.scrollTop || 0) > 0) return
      if (e.target.closest('button, input, a, select, textarea, [role="slider"], [data-no-swipe]')) return
    }
    measure()
    const el = sheetRef.current
    const cur = parseFloat((el.style.transform || '').replace(/[^-\d.]/g, '')) || 0
    drag.current = { y0: e.clientY, base: cur, fromBody }
    vel.current.start(e.clientY)
    el.style.transition = 'none'
    e.currentTarget.setPointerCapture?.(e.pointerId)
  }, [enabled, bodyRef, measure, sheetRef])

  const onPointerMove = useCallback((e) => {
    const d = drag.current
    if (!d) return
    vel.current.move(e.clientY)
    const dy = e.clientY - d.y0
    if (d.fromBody && dy < 0) return
    let y = d.base + dy
    if (y < 0) y *= 0.12 // rubber band above the largest detent
    sheetRef.current.style.transform = `translate3d(0,${y}px,0)`
  }, [sheetRef])

  const onPointerUp = useCallback(() => {
    const d = drag.current
    if (!d) return
    drag.current = null
    const el = sheetRef.current
    const y = parseFloat((el.style.transform || '').replace(/[^-\d.]/g, '')) || 0
    const v = vel.current.get()
    const { stops, dismiss } = geom.current
    if (v > FLICK) return goTo(dismiss)
    if (v < -FLICK) return goTo(stops[0])
    goTo(nearest(project(y, v), [...stops, dismiss]))
  }, [goTo, sheetRef])

  const headerHandlers = enabled && isMotionOn() ? {
    onPointerDown: (e) => onPointerDown(e, false), onPointerMove, onPointerUp, onPointerCancel: onPointerUp,
  } : {}
  const bodyHandlers = enabled && isMotionOn() ? {
    onPointerDown: (e) => onPointerDown(e, true), onPointerMove, onPointerUp, onPointerCancel: onPointerUp,
  } : {}

  return { detent, detentCount: detents.length, headerHandlers, bodyHandlers, goTo, measure, place }
}

// ── Value scrubbing ─────────────────────────────────────────────────────
// Drag horizontally across a tile to set a value (brightness, volume,
// position) without opening anything. The hard part is the three-way
// disambiguation between a tap, a vertical scroll and a horizontal scrub, all
// starting from the same pointerdown on the same element.

export function useScrub({ value, min = 0, max = 100, onChange, onCommit, onTap, step = 5, enabled = true }) {
  const ref = useRef(null)

  const onPointerDown = useCallback((e) => {
    if (!enabled || !isMotionOn()) return onTap?.(e)
    if (e.pointerType === 'mouse' && e.button !== 0) return
    const el = e.currentTarget
    const rect = el.getBoundingClientRect()
    const x0 = e.clientX
    const y0 = e.clientY
    const base = value
    let moved = false
    let drifted = false
    let last = Math.floor(base / step)
    let current = base
    el.setPointerCapture?.(e.pointerId)

    const move = (ev) => {
      const dx = ev.clientX - x0
      const dy = ev.clientY - y0
      if (!moved) {
        if (Math.abs(dy) > 10 && Math.abs(dx) < 10) { drifted = true; return } // it's a scroll
        if (Math.abs(dx) < 6) return                                            // not yet a drag
        moved = true
        el.setAttribute('data-scrubbing', 'true')
      }
      current = clamp(Math.round(base + (dx / rect.width) * (max - min)), min, max)
      const tick = Math.floor(current / step)
      if (tick !== last) { last = tick; haptic('selection') }
      onChange?.(current)
    }
    const finish = (ev) => {
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', finish)
      el.removeEventListener('pointercancel', abort)
      el.removeAttribute('data-scrubbing')
      if (moved) onCommit?.(current)
      else if (!drifted) onTap?.(ev)
    }
    const abort = () => {
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', finish)
      el.removeEventListener('pointercancel', abort)
      el.removeAttribute('data-scrubbing')
    }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', finish)
    el.addEventListener('pointercancel', abort)
  }, [enabled, value, min, max, step, onChange, onCommit, onTap])

  return { ref, handlers: { onPointerDown } }
}

// ── Scroll chrome ───────────────────────────────────────────────────────
// Reports whether a scroller has passed an edge (so a bar can condense) and
// whether the person is scrolling down (tuck the tab bar away) or up (bring
// it back). Always returns at the top of the page.

export function useScrollChrome(ref, { edge = 72, onDirection } = {}) {
  const [scrolled, setScrolled] = useState(false)
  const last = useRef(0)

  const onScroll = useCallback(() => {
    const el = ref?.current
    if (!el) return
    const top = el.scrollTop
    setScrolled(top > edge)
    const delta = top - last.current
    if (Math.abs(delta) > 6) {
      if (delta > 0 && top > 60) onDirection?.('down')
      else if (delta < 0) onDirection?.('up')
      last.current = top
    }
    if (top <= 0) onDirection?.('up')
  }, [ref, edge, onDirection])

  return { scrolled, onScroll }
}
