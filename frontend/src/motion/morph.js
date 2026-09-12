// Shared-element morph across a route change.
//
// Tapping a room tile should feel like that tile BECAME the room, not like a
// new page replaced it. React Router unmounts the source before the
// destination mounts, so this is a FLIP measured across the navigation: the
// source records its rectangle on the way out, the destination starts from
// that rectangle and animates to its own.
//
// Deliberately NOT framer-motion's `layoutId`. AppShell carries a long comment
// about two previous AnimatePresence attempts that black-screened the app when
// an exit handshake was dropped mid-transition. A FLIP has no handshake: if the
// origin is missing or stale the destination simply renders normally, which is
// exactly today's behaviour.
//
// The transition is three animations, in this order and no other:
//   1. the hero travels from the pressed rectangle to its own          (leads)
//   2. the hero's own text fades in behind that motion            (35% in)
//   3. everything below the hero rises and fades in                (45% in)
// Without (3) the destination page was fully in place before the hero had
// finished moving, which is what made the whole thing read as "a page
// appeared" — especially on desktop, where the tile and the hero are close
// enough in size that the hero's own travel is small.
//
// Coming back is the same thing mirrored: the hero records its rectangle as it
// is removed, and the tile it came from starts there and shrinks home. See
// `useMorphOrigin` / `useMorphReturn` below.

import { useCallback, useEffect, useLayoutEffect, useRef } from 'react'
import { isMotionOn } from './flag'
import { CSS_EASE, isReduced } from './motion'

const origins = new Map()

// A morph can only start once the destination is mounted, and routes are lazy
// (`Suspense fallback={null}`), so a cold visit spends an unknown amount of
// that budget fetching a chunk. At 420ms the transition silently didn't happen
// on exactly the visit where the page took longest to arrive. 700ms is still
// short enough that the rectangle is the one the person actually pressed, and
// anything slower than that has stopped being one continuous gesture.
const FRESH_MS = 700

export function captureOrigin(key, el) {
  if (!isMotionOn() || isReduced() || !el) return
  const r = el.getBoundingClientRect()
  if (!r.width || !r.height) return
  const cs = getComputedStyle(el)
  const now = performance.now()
  // Drop anything nobody ever came back for, so the map cannot grow.
  for (const [k, v] of origins) if (now - v.at > FRESH_MS) origins.delete(k)
  origins.set(key, {
    at: now,
    rect: { x: r.left, y: r.top, w: r.width, h: r.height },
    radius: cs.borderRadius,
  })
}

// Capture from an event: finds the element the person actually pressed.
export function captureOriginFromEvent(key, e, selector) {
  const el = selector ? e?.currentTarget?.closest?.(selector) || e?.currentTarget : e?.currentTarget
  captureOrigin(key, el)
}

// ── Coming back ──────────────────────────────────────────────────────────────
//
// Leaving a room is the same gesture run backwards: the hero shrinks into the
// tile it grew out of. The mechanism is identical — one rectangle handed
// across a route change — but the two halves are recorded under DIFFERENT key
// namespaces (`room:` on the way in, `room-back:` on the way out), and that is
// not tidiness. Freshness cannot tell the two apart: "that room, a moment ago"
// describes both pressing a tile and landing back on the list. Sharing one key
// would let a tile read the rectangle it had just written itself and fly from
// its own position to its own position, or let the hero read the tile's
// return rectangle on a fast there-and-back.
//
// Records the element's rectangle as its component is being REMOVED. A layout
// effect's cleanup is the last moment the node is still measurable: React runs
// it in the mutation phase, before it detaches the ref and before it removes
// the host node from the document. `node` mirrors the ref every render for the
// one case that would otherwise be a silent no-morph — a ref detached before
// the cleanup runs. If the node really is gone by then its rect is all zeros,
// captureOrigin declines it, and the next page renders exactly as it does
// today. There is no handshake here either.
export function useMorphOrigin(key, ref) {
  const node = useRef(null)
  useLayoutEffect(() => { if (ref?.current) node.current = ref.current })
  useLayoutEffect(() => () => { captureOrigin(key, node.current) }, [key])
}

// A returning tile is one of many. The one you left may be scrolled below the
// fold of a long grid, swiped past in the carousel, or filtered out of the
// list entirely — and the carousel in particular always starts back at its
// first tile, so "off screen" is the ordinary case, not the edge case. Flying
// a photograph to a rectangle nobody can see is worse than not flying it: it
// reads as something flickering off the edge of the screen. Below this much of
// the tile actually on screen the page just renders the way it does today.
const VISIBLE_MIN = 0.55
function mostlyOnScreen(r) {
  const vw = window.innerWidth || document.documentElement.clientWidth
  const vh = window.innerHeight || document.documentElement.clientHeight
  const w = Math.min(r.right, vw) - Math.max(r.left, 0)
  const h = Math.min(r.bottom, vh) - Math.max(r.top, 0)
  if (w <= 0 || h <= 0) return false
  return (w * h) / (r.width * r.height) >= VISIBLE_MIN
}

// Deliberately NOT destructive.
//
// React's StrictMode mounts, tears down and remounts every component once in
// development. A read that deleted the origin meant the first mount consumed
// it, the teardown cancelled the animation it had started, and the remount
// found nothing — so in dev the morph played for zero frames and the whole
// transition looked like it was barely there. Freshness is what prevents a
// stale replay; a key cannot legitimately be pressed twice inside 700ms.
function peekOrigin(key) {
  const o = origins.get(key)
  if (!o) return null
  if (performance.now() - o.at > FRESH_MS) { origins.delete(key); return null }
  return o
}

// Put this on the destination element (the room hero, the device header).
//   contentRef — text inside it, which fades in behind the motion rather than
//                stretching with the box.
//   followRef  — the rest of the page below it, which rises in after the hero
//                so the hero is legibly leading even when its own travel is
//                short (every desktop layout, and any tall tile).
//   returning  — this is the BACK half of the gesture and the destination is
//                one tile inside a list, not a page-wide hero. See
//                useMorphReturn below for what that changes and why.
export function useMorphTarget(key, { contentRef, followRef, duration = 560, returning = false } = {}) {
  const ref = useRef(null)
  const anims = useRef([])
  const ran = useRef(null)
  // Which run owns the inline styles right now. StrictMode's mount → teardown
  // → remount cancels the first run's animations, and a cancelled WAAPI
  // animation REJECTS its `finished` promise — asynchronously, by which time
  // the remount has already set up the real run. Without this counter that
  // stale rejection handler tore down the live run's `transform-origin`, so
  // in development the FLIP silently scaled about the element's centre
  // instead of its top-left corner: a different flight path from the one that
  // ships, on the one build anybody ever looks at.
  const runId = useRef(0)

  const stop = useCallback(() => {
    // Anything already scheduled to clean up belongs to a run that is over.
    runId.current += 1
    anims.current.forEach((a) => { try { a.cancel() } catch { /* already gone */ } })
    anims.current = []
    const el = ref.current
    if (el) { el.style.willChange = ''; el.style.transformOrigin = ''; el.style.zIndex = '' }
  }, [])

  // Runs after EVERY render and guards itself, rather than keying off a
  // dependency list. The hero is often not in the DOM on the first render —
  // the room resolves a tick later and the page renders a skeleton until it
  // does — and a dependency-keyed effect would never look again, so the
  // transition would be dropped on exactly the slow loads it is there for.
  //
  // A layout effect, not an effect: it runs before paint, so the first frame
  // the person sees is already the one at the origin rectangle. With useEffect
  // the destination flashed at its final position for a frame first.
  useLayoutEffect(() => {
    if (!isMotionOn() || isReduced() || !key) return
    if (ran.current === key) return
    const el = ref.current
    if (!el) return
    const origin = peekOrigin(key)
    if (!origin) return

    const r = el.getBoundingClientRect()
    if (!r.width || !r.height) return
    // Both dashboard surfaces — the phone carousel and the desktop grid — are
    // in the DOM at every width; the one that is not in use is display:none,
    // so its rect is 0×0 and the guard above already dropped it. What is left
    // to rule out is a tile that is laid out but nowhere the eye can follow.
    if (returning && !mostlyOnScreen(r)) return

    const sx = origin.rect.w / r.width
    const sy = origin.rect.h / r.height
    const dx = origin.rect.x - r.left
    const dy = origin.rect.y - r.top
    // A morph that barely moves is noise, not information.
    if (Math.abs(dx) < 4 && Math.abs(dy) < 4 && Math.abs(sx - 1) < 0.04 && Math.abs(sy - 1) < 0.04) return

    ran.current = key
    const run = ++runId.current

    // The destination page as a whole fades and rises on arrival (AppShell's
    // [data-motion-enter] wrapper). While a morph runs that is the wrong
    // story told over the top of the right one: it says "a page appeared",
    // and because it fades the hero too, on desktop the fade is most of what
    // you see. So when — and ONLY when — a morph actually runs, the page
    // enter is cancelled on that one wrapper instance and the sequencing is
    // handed to the animations below. A navigation that declines the morph is
    // never touched and keeps its enter animation exactly as before.
    const pageEnter = el.closest?.('[data-motion-enter]')
    if (pageEnter) pageEnter.style.animation = 'none'

    if (returning) {
      // The same argument, one level down. Every room list this lands in is a
      // [data-motion-stagger] container, so the tile the hero is flying into
      // is ALSO being faded up and lifted 10px by zm-item-in. Two entrances on
      // one element read as neither: the photo arrives translucent and then
      // nudges, instead of shrinking home. Its neighbours keep their stagger
      // untouched — they really are arriving, and they are what the returning
      // tile is legibly landing among.
      //
      // Never cleared. A CSS entrance animation runs once per element, so
      // restoring the property after the flight could only re-trigger it — a
      // 240ms fade up from nothing on a tile that had already landed.
      el.style.animation = 'none'
      // The tile scales UP to the hero's width for the length of the flight,
      // so it overlaps its neighbours; without this it flies underneath them.
      // Cleared on landing — no tile on any of the three surfaces carries a
      // z-index of its own at rest.
      el.style.zIndex = '3'
    }

    const list = []
    // `backwards`, never `both`: a both-fill keeps contributing its final
    // frame forever, and an animation origin outranks a plain declaration —
    // which is how a finished transition silently disables the press scale on
    // everything it touched. The last keyframe here IS the element's resting
    // style, so there is nothing to hold.
    // TRANSFORM ONLY. Animating border-radius alongside it forces a paint on
    // every single frame — the one property here that cannot run on the
    // compositor — and it makes the corners visibly wobble mid-flight. The
    // radius difference between a tile and a hero is a few pixels; paying a
    // per-frame repaint of a full-bleed photograph for it is a bad trade.
    //
    // The returning tile additionally pins its own opacity for the flight.
    // Two of the three room lists fade their tiles in on mount with a
    // component-level animation this layer does not own (the Rooms page tile
    // is a framer `motion.div` with `initial={{ opacity: 0 }}`), and an
    // inline opacity written by that is outranked by an animation effect —
    // which is the only reason this can be fixed from here at all. Opacity is
    // the one other property that runs on the compositor, so it costs nothing,
    // and 1 IS the tile's resting opacity, so a `backwards` fill holds nothing
    // after it lands.
    const hold = returning ? { opacity: 1 } : null
    list.push(el.animate(
      [
        { ...hold, transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})` },
        { ...hold, transform: 'translate(0, 0) scale(1, 1)' },
      ],
      { duration, easing: CSS_EASE.glide, fill: 'backwards', composite: 'replace' },
    ))
    el.style.transformOrigin = '0 0'
    el.style.willChange = 'transform'

    // The content inside would stretch with the box, so it arrives after the
    // motion has done most of its work. This is what hides the distortion.
    const content = contentRef?.current
    if (content) {
      list.push(content.animate(
        [
          { opacity: 0, transform: 'translate3d(0, 8px, 0)' },
          { opacity: 0, transform: 'translate3d(0, 8px, 0)', offset: 0.26 },
          { opacity: 1, transform: 'none' },
        ],
        { duration, easing: CSS_EASE.glide, fill: 'backwards' },
      ))
    }

    // The rest of the page follows the hero in. This is the half that makes
    // the transition legible on a desktop grid, where the tile and the hero
    // are close in size and the FLIP alone barely travels: the hero is
    // unmistakably leading because everything else is visibly behind it.
    const follow = followRef?.current
    if (follow) {
      list.push(follow.animate(
        [
          { opacity: 0, transform: 'translate3d(0, 14px, 0)' },
          { opacity: 1, transform: 'none' },
        ],
        {
          // Starts at 42% of the hero's travel and lands with it: the whole
          // transition still finishes inside one 440ms beat, so the page is
          // never waiting on a tail.
          // One movement, not three. The follow overlaps the hero heavily and
          // lands with it; starting it late (42%) made the page read as a
          // second, separate animation queued behind the first, which is the
          // other half of what "not smooth" means.
          duration: Math.round(duration * 0.62),
          delay: Math.round(duration * 0.26),
          easing: CSS_EASE.glide,
          fill: 'backwards',
        },
      ))
    }

    anims.current = list
    const done = () => {
      if (runId.current !== run) return   // a newer run owns these styles now
      el.style.willChange = ''; el.style.transformOrigin = ''; el.style.zIndex = ''
    }
    Promise.all(list.map((a) => a.finished)).then(done).catch(done)
  })

  // Unmount only — NOT a per-render cleanup, which would cancel the animation
  // on the very next render. Resetting `ran` is what lets StrictMode's
  // mount → unmount → mount replay the morph instead of swallowing it.
  useEffect(() => () => { stop(); ran.current = null }, [stop])

  return ref
}

// The back half. Put this on the room TILE, with the key the room hero wrote
// on its way out; every other tile in the list asks for its own key, finds
// nothing, and renders exactly as it does today. There is no list to keep in
// sync and nothing to reset — which tile morphs is decided entirely by which
// room was just left.
//
// No `followRef`: on the way in the rest of the page is a sibling below the
// hero, but on the way back the rest of the page is the tile's own ancestors,
// and animating an ancestor of the flying element would add its transform to
// the flight. The grid you are landing in is simply already there — which is
// what returning to somewhere is supposed to feel like.
//
// Shorter than the 560ms outward trip on purpose. Going in, the hero is new
// and worth the beat it takes to arrive; coming back there is nothing to read,
// and a slow return is the part of a transition that starts to feel like a
// wait.
export function useMorphReturn(key, { contentRef, duration = 460 } = {}) {
  return useMorphTarget(key, { contentRef, duration, returning: true })
}

// Page enter: a quiet rise for the rest of the destination, so the morphing
// element leads and the page follows. CSS-only, no exit animation, so there
// is no handshake that can fail and strand a blank screen.
export function pageEnterProps(delay = 40) {
  if (!isMotionOn() || isReduced()) return {}
  return { 'data-motion-enter': 'true', style: { animationDelay: `${delay}ms` } }
}
