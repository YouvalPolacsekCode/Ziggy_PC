// The gesture engines: long-press, swipe-back, value scrubbing and scroll
// chrome — `useLongPress`, `useSwipeBack`, `useScrub`, `useScrollChrome`, in
// that order below. (Sheet detents are NOT here; they live in
// `SheetSurface.jsx` with the surface they move.) All pointer-based (one code
// path for mouse and touch), all pointer-captured, all interruptible, all
// no-ops when the flag is off.
//
// None of these change how anything LOOKS. They change what your finger can
// do and how the result arrives.

import { useCallback, useEffect, useRef, useState } from 'react'
import { isMotionOn } from './flag'
import { CSS_EASE, clamp, haptic, makeVelocityTracker } from './motion'

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
// Drag from the leading edge to go back. The first 32px stretch the page's
// leading edge (scaleX 1→1.04 from the trailing edge) — a physical peel that
// says the gesture was recognised — and only then does the page travel, 1:1
// with the finger, over the previous page (painted beneath at 30% parallax
// by PageTransition). Commits past 30% of the width OR on a 500px/s flick;
// below that it springs home, so the gesture is always cancellable.
//
// `ref` is the element that moves. `onBack` runs on commit. `onSwipe` gets
// 'start' when the page begins to move and `('end', { committed })` when it
// settles or cancels, so the host can mount the under-page only while it is
// needed — and keep it mounted past a COMMITTED settle, which ends with the
// page off-screen and the under-page the only thing left to look at, until
// the navigation it asked for lands.
//
// THE HOST MUST ONLY ENABLE THIS WHEN THERE IS AN ENTRY TO GO BACK TO. A
// committed swipe deliberately leaves the page off-screen — that IS the exit
// — and relies on the navigation replacing it. `onBack` that does nothing
// (navigate(-1) on the first entry of the session: a deep link, a shared
// URL, the PWA start URL) leaves a blank content area with no way back. The
// hook cannot tell; AppShell gates `enabled` on the history index.
//
// `bindKey` RE-BINDS the listeners. The element this hook moves is now
// PageTransition's page layer, which is keyed on the route — so the node is
// replaced on every navigation while the ref object, `onBack`, `enabled` and
// `rtl` all stay identical. Without a signal the effect would never re-run
// and the hook would stay bound to the detached old layer: swipe-back dead
// from the second detail page onwards (/devices/a → /devices/b).

const COMMIT_FRACTION = 0.3
const COMMIT_VELOCITY = 500
const EDGE = 32
const PEEL = 32
const PEEL_MAX = 0.04
const UNDER_PARALLAX = 0.3
const UNDER_DIM = 0.35

export function useSwipeBack(ref, onBack, { enabled = true, rtl = false, onSwipe, bindKey } = {}) {
  const state = useRef(null)
  const vel = useRef(makeVelocityTracker())
  // A settle in flight, so the unbind can take it with it. A committed settle
  // ends by calling navigate(-1), and the 240ms it waits is long enough for
  // the app to navigate for a reason of its own — a chat card, a push
  // notification, a redirect. That re-binds this hook, and without this the
  // orphaned timer still fired and sent the person a second step back from
  // wherever they had just landed.
  const settling = useRef(null)

  useEffect(() => {
    const el = ref.current
    if (!el || !enabled || !isMotionOn()) return undefined
    const sign = rtl ? -1 : 1
    const under = () => el.parentElement?.querySelector?.('[data-motion-under]') || null
    const origin = rtl ? '0% 50%' : '100% 50%'

    // dx is kept in state, never re-parsed from the transform string: with
    // scaleX in the same string a regex parse would swallow the scale.
    const paint = (dx, peel) => {
      el.style.transition = 'none'
      el.style.transformOrigin = origin
      el.style.transform = (dx || peel !== 1) ? `translate3d(${dx}px,0,0) scaleX(${peel})` : ''
      el.style.willChange = (dx || peel !== 1) ? 'transform' : ''
      const u = under()
      if (u && state.current) {
        const p = Math.min(1, Math.max(0, (dx * sign) / state.current.w))
        u.style.transition = 'none'
        u.style.transform = `translate3d(${(p - 1) * UNDER_PARALLAX * state.current.w * sign}px,0,0)`
        const scrim = u.querySelector('[data-motion-scrim]')
        if (scrim) scrim.style.opacity = String(UNDER_DIM * (1 - p))
      }
    }
    let width = 0 // the page width captured on pointerdown, for the under-page settle
    const settle = (dx, ms, then) => {
      el.style.transition = `transform ${ms}ms ${CSS_EASE.out}`
      el.style.transform = dx ? `translate3d(${dx}px,0,0) scaleX(1)` : 'translate3d(0,0,0) scaleX(1)'
      const u = under()
      if (u) {
        u.style.transition = `transform ${ms}ms ${CSS_EASE.out}`
        u.style.transform = dx ? 'translate3d(0,0,0)' : `translate3d(${-UNDER_PARALLAX * width * sign}px,0,0)`
        const scrim = u.querySelector('[data-motion-scrim]')
        if (scrim) { scrim.style.transition = `opacity ${ms}ms ${CSS_EASE.out}`; scrim.style.opacity = dx ? '0' : String(UNDER_DIM) }
      }
      // transitionend fires once per property and the timeout is a fallback
      // for when it does not fire at all, so completion MUST be idempotent:
      // a committed swipe once called navigate(-1) twice and went back two
      // entries — off the end of the app's history and onto a blank page.
      //
      // It must also be the RIGHT element's event. `transitionend` bubbles,
      // and the page is full of things with transitions of their own — a
      // toggle finishing its 200ms flip inside the page would otherwise end
      // the settle early and snap the page wherever it had got to. The
      // timeout path calls finish() with no event.
      let finished = false
      let timer = null
      const finish = (e) => {
        if (e && e.target !== el) return
        if (finished) return
        finished = true
        clearTimeout(timer)
        settling.current = null
        el.removeEventListener('transitionend', finish)
        el.style.transition = ''
        el.style.willChange = ''
        el.style.transformOrigin = ''
        if (!then) el.style.transform = ''
        then?.()
        // `committed` says whether the page is now off-screen waiting for a
        // navigation, or back where it started. The host needs the two apart:
        // dropping the under-page on a committed end would show a hole for
        // the frame between here and the route change.
        onSwipe?.('end', { committed: !!then })
      }
      el.addEventListener('transitionend', finish)
      timer = setTimeout(finish, ms + 80)
      // Handed to the cleanup below, which is the only other thing allowed to
      // end a settle — by abandoning it, never by completing it.
      settling.current = { el, finish, cancel: () => { finished = true; clearTimeout(timer) } }
    }

    const down = (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return
      // NOT WHILE A SETTLE IS RUNNING. A committed swipe leaves the page
      // off-screen for 240ms waiting for its navigation, and an off-screen
      // page makes `fromEdge` negative — which passes the edge guard below, so
      // a second gesture could start inside that window. The first settle's
      // finish() then nulled the second's registration and the two fought over
      // the same inline transform. One gesture per settle; the route change is
      // what re-opens the element to a finger.
      if (settling.current) return
      const r = el.getBoundingClientRect()
      const fromEdge = rtl ? r.right - e.clientX : e.clientX - r.left
      if (fromEdge > EDGE) return
      // Never start over something the person is actually using.
      if (e.target.closest?.('button, a, input, select, textarea, [role="slider"], [role="button"], [data-no-swipe]')) return
      state.current = { x0: e.clientX, y0: e.clientY, locked: null, w: r.width, dx: 0, started: false }
      width = r.width
      vel.current.start(e.clientX)
    }

    const move = (e) => {
      const s = state.current
      if (!s) return
      const dxRaw = (e.clientX - s.x0) * sign
      const dy = e.clientY - s.y0
      if (s.locked === null) {
        if (Math.abs(dxRaw) < 6 && Math.abs(dy) < 6) return
        // Direction lock: a mostly-vertical start belongs to the scroller.
        s.locked = Math.abs(dxRaw) > Math.abs(dy)
        if (!s.locked) { state.current = null; return }
        el.setPointerCapture?.(e.pointerId)
      }
      if (!s.started) { s.started = true; onSwipe?.('start') }
      vel.current.move(e.clientX)
      let travel, peel
      if (dxRaw <= 0) {
        // Resist the wrong direction rather than refusing it outright.
        travel = dxRaw * 0.18; peel = 1
      } else if (dxRaw <= PEEL) {
        travel = 0; peel = 1 + PEEL_MAX * (dxRaw / PEEL)
      } else {
        travel = dxRaw - PEEL
        peel = 1 + PEEL_MAX * Math.max(0, 1 - travel / 48)
      }
      s.dx = travel * sign
      paint(s.dx, Number(peel.toFixed(4)))
      e.preventDefault()
    }

    const up = () => {
      const s = state.current
      if (!s) return
      state.current = null
      if (s.locked !== true) return
      const dx = s.dx * sign
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
      // A settle that is still running belongs to the binding that started it.
      // Unbinding means the element it was moving is going away, so the settle
      // is abandoned: its timer is cleared and its listener detached BEFORE
      // `then` can run. A committed one has already navigated (finish() clears
      // this ref first), so the only thing this can cancel is a settle whose
      // navigation nobody asked for any more.
      const pending = settling.current
      if (pending) {
        pending.cancel()
        pending.el.removeEventListener('transitionend', pending.finish)
        settling.current = null
      }
      state.current = null
      el.style.transform = ''
      el.style.transition = ''
      el.style.transformOrigin = ''
      el.style.willChange = ''
    }
  }, [ref, onBack, enabled, rtl, onSwipe, bindKey])
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

// WHICH ELEMENT ACTUALLY SCROLLS — and it is usually not the one you were
// handed. AppShell's outer wrapper is a ROW flex container with
// `min-height: var(--vh)`, so <main> (`flex-1 … overflow-y-auto`) grows to its
// own content and `main.scrollTop` is permanently 0: the DOCUMENT scrolls.
// Everything that read the element directly therefore read 0 for ever — the
// bottom nav never condensed, and PageTransition's exit overlay froze the page
// at its top instead of at the slice the person was looking at.
//
// Ask the element first so a layout where <main> really is the scroller
// (a desktop column, a future shell) keeps working, and the document second.
export function effectiveScrollTop(el) {
  return el && el.scrollHeight > el.clientHeight + 1
    ? el.scrollTop
    : (window.scrollY || document.scrollingElement?.scrollTop || 0)
}

export function useScrollChrome(ref, { edge = 72, onDirection } = {}) {
  const [scrolled, setScrolled] = useState(false)
  const last = useRef(0)

  const onScroll = useCallback(() => {
    // Like every other hook in this file: a no-op with the layer off. It
    // matters more here than it looks, because this one now listens on
    // `window` — without the guard, `?motion=off` would still re-render the
    // shell on every scroll to answer a question nothing is asking.
    if (!isMotionOn()) return
    const top = effectiveScrollTop(ref?.current)
    setScrolled(top > edge)
    const delta = top - last.current
    if (Math.abs(delta) > 6) {
      if (delta > 0 && top > 60) onDirection?.('down')
      else if (delta < 0) onDirection?.('up')
      last.current = top
    }
    if (top <= 0) onDirection?.('up')
  }, [ref, edge, onDirection])

  // The document is the scroller in the real shell, and a document scroll
  // never reaches an element's `onScroll`. The returned handler stays, for the
  // case where the element genuinely scrolls — both paths go through
  // effectiveScrollTop, so whichever fires reads the same number.
  //
  // COALESCED TO ONE READ PER FRAME. A window scroll listener fires far more
  // often than the screen refreshes (a flick can deliver dozens of events in
  // a frame on iOS), and each call reads layout and can set React state. One
  // rAF per frame is the whole throttle: the pending frame is the lock, and it
  // is cancelled on unmount so a queued callback cannot land on a dead hook.
  // The LOCK is the boolean, not the frame id: a callback that runs before
  // `requestAnimationFrame` has returned (a synchronous polyfill, a test stub)
  // would otherwise have its release overwritten by the id assignment and the
  // hook would go deaf after one frame. The id is kept only to cancel with.
  const pending = useRef(false)
  const frameId = useRef(0)
  useEffect(() => {
    const onWindowScroll = () => {
      if (pending.current) return
      pending.current = true
      frameId.current = requestAnimationFrame(() => {
        pending.current = false
        frameId.current = 0
        onScroll()
      })
    }
    window.addEventListener('scroll', onWindowScroll, { passive: true })
    return () => {
      window.removeEventListener('scroll', onWindowScroll)
      if (frameId.current) cancelAnimationFrame(frameId.current)
      frameId.current = 0
      pending.current = false
    }
  }, [onScroll])

  return { scrolled, onScroll }
}
