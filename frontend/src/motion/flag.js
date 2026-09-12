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

let on = typeof window === 'undefined' ? false : readInitial()

function apply() {
  document.documentElement.setAttribute('data-motion', on ? 'on' : 'off')
}

if (typeof window !== 'undefined') apply()

export const isMotionOn = () => on

export function setMotion(next) {
  on = !!next
  try { localStorage.setItem(KEY, on ? 'on' : 'off') } catch { /* ignore */ }
  apply()
  subs.forEach((fn) => fn(on))
}

export function toggleMotion() { setMotion(!on) }

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
