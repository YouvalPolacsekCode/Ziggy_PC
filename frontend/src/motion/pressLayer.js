// Press feedback for the whole app, without editing a single component.
//
// Ziggy's tappable things are a mix of real <button>s, role="button" divs and
// plain divs with cursor:pointer. Rather than touch hundreds of call sites,
// one delegated pointerdown finds the pressable ancestor and marks it; CSS
// does the rest. Mark only — no style is written from JS, so the untouched
// app is exactly what you get when the flag is off.
//
// Why a press state matters: it is the only signal that the interface heard
// you before the result arrives. On a smart-home app the result can be a
// second away over the radio, so the press is doing real work.

import { isMotionOn } from './flag'
import { isReduced, haptic } from './motion'

const PRESSABLE = 'button, [role="button"], a[href], summary, label[for], input[type="checkbox"], input[type="radio"], [tabindex="0"]'
const SKIP = 'html, body, #root, main, nav, form, [data-no-press]'
// Anything larger than this fraction of the viewport is a surface, not a
// control: scaling it reads as the page wobbling.
const MAX_AREA = 0.55

let current = null

function isPressable(el) {
  if (!el || el.nodeType !== 1) return false
  if (el.matches(SKIP)) return false
  if (el.hasAttribute('disabled') || el.getAttribute('aria-disabled') === 'true') return false
  if (el.matches(PRESSABLE)) return true
  // Divs that behave as controls: Ziggy styles many tiles that way.
  const cs = getComputedStyle(el)
  return cs.cursor === 'pointer'
}

function findPressable(start) {
  let el = start
  for (let i = 0; el && i < 6; i++, el = el.parentElement) {
    if (!isPressable(el)) continue
    // Never fight a transform the component already owns (the dashboard
    // carousel scales its tiles; the wall grid translates its modules).
    const cs = getComputedStyle(el)
    if (cs.transform && cs.transform !== 'none') return null
    if (el.style.transform) return null
    const r = el.getBoundingClientRect()
    if (!r.width || !r.height) return null
    const area = (r.width * r.height) / (window.innerWidth * window.innerHeight)
    if (area > MAX_AREA) return null
    return { el, size: area > 0.06 ? 'lg' : 'sm' }
  }
  return null
}

function release() {
  if (!current) return
  current.el.removeAttribute('data-pressing')
  current = null
}

function onDown(e) {
  if (!isMotionOn() || isReduced()) return
  if (e.pointerType === 'mouse' && e.button !== 0) return
  release()
  const hit = findPressable(e.target)
  if (!hit) return
  current = hit
  hit.el.setAttribute('data-pressing', hit.size)
}

export function installPressLayer() {
  if (typeof window === 'undefined') return () => {}
  const opts = { passive: true, capture: true }
  document.addEventListener('pointerdown', onDown, opts)
  document.addEventListener('pointerup', release, opts)
  document.addEventListener('pointercancel', release, opts)
  document.addEventListener('dragstart', release, opts)
  // A press that turns into a scroll is not a press.
  document.addEventListener('scroll', release, { capture: true, passive: true })
  window.addEventListener('blur', release)
  return () => {
    document.removeEventListener('pointerdown', onDown, opts)
    document.removeEventListener('pointerup', release, opts)
    document.removeEventListener('pointercancel', release, opts)
    document.removeEventListener('dragstart', release, opts)
    document.removeEventListener('scroll', release, { capture: true })
    window.removeEventListener('blur', release)
    release()
  }
}

// Toggles, power buttons and switches get an impact haptic on the way down —
// the physical metaphor is a switch closing, so it belongs on press, not on
// the state coming back from the hub.
const HAPTIC_ON_PRESS = '[role="switch"], input[type="checkbox"], [aria-pressed], [data-haptic]'

export function installHapticLayer() {
  if (typeof window === 'undefined') return () => {}
  const onPress = (e) => {
    if (!isMotionOn()) return
    const el = e.target?.closest?.(HAPTIC_ON_PRESS)
    if (!el || el.hasAttribute('disabled')) return
    haptic(el.getAttribute('data-haptic') || 'light')
  }
  document.addEventListener('pointerdown', onPress, { passive: true, capture: true })
  return () => document.removeEventListener('pointerdown', onPress, { capture: true })
}
