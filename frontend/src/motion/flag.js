// The switch.
//
// `data-motion="on"` on <html> turns the whole layer on. Everything the layer
// adds is scoped under that attribute, in CSS and in JS, so turning it off
// restores the untouched app exactly — same DOM, same styles, no motion, no
// gestures.
//
// Resolution order: ?motion=on|off  →  localStorage  →  default ON.
//
// The default is ON in every home. The switch is kept, and kept cheap, because
// it is the rollback: a home that hits a problem with the gestures is one
// `?motion=off` away from the app exactly as it shipped before this layer,
// with no release and no downgrade. That equivalence is not a hope — it is
// measured. Motion off against the previous build is SSIM 1.000000 on twelve
// of thirteen screens across light, dark and phone width, and the thirteenth
// differs only where a relative timestamp ticked between the two captures.
//
// Keep it that way. Anything added here that changes the resting appearance
// when the attribute is "off" has broken the rollback, whatever else it does.

const KEY = 'ziggy_motion'
const subs = new Set()

function readInitial() {
  try {
    const q = new URLSearchParams(window.location.search).get('motion')
    if (q === 'on' || q === '1') return true
    if (q === 'off' || q === '0') return false
    const stored = localStorage.getItem(KEY)
    if (stored === 'on') return true
    if (stored === 'off') return false
  } catch { /* private mode */ }
  return true
}

// An explicit ?motion= choice STICKS.
//
// This used to be read-only, and the only thing that ever wrote to storage was
// the on-screen toggle. When that toggle was removed, `?motion=off` silently
// became a one-page-load effect: navigate anywhere and the layer came back.
// That quietly destroyed the rollback, because "add ?motion=off" is now the
// only way a home can turn this layer off at all, and a rollback that forgets
// itself on the next tap is not a rollback.
function persistExplicitChoice() {
  try {
    const q = new URLSearchParams(window.location.search).get('motion')
    if (q === 'on' || q === '1') localStorage.setItem(KEY, 'on')
    else if (q === 'off' || q === '0') localStorage.setItem(KEY, 'off')
  } catch { /* private mode — the flag still applies for this load */ }
}

let on = typeof window === 'undefined' ? false : readInitial()

function apply() {
  document.documentElement.setAttribute('data-motion', on ? 'on' : 'off')
}

if (typeof window !== 'undefined') { persistExplicitChoice(); apply() }

export const isMotionOn = () => on

export function setMotion(next) {
  on = !!next
  try { localStorage.setItem(KEY, on ? 'on' : 'off') } catch { /* ignore */ }
  apply()
  subs.forEach((fn) => fn(on))
}

// `setMotion` is kept although nothing calls it today: it is the one
// programmatic way in, and the obvious home for this is a Settings row rather
// than the floating pill that used to live over the app. `toggleMotion` was
// removed with that pill — a blind flip is only ever useful to a button.

export function onMotionChange(fn) {
  subs.add(fn)
  return () => subs.delete(fn)
}

// React binding.
import { useEffect, useState } from 'react'
export function useMotionOn() {
  const [v, setV] = useState(on)
  useEffect(() => onMotionChange(setV), [])
  return v
}
