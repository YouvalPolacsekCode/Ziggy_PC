// The page-transition switch — a second, narrower switch beside flag.js.
//
// Two earlier page transitions black-screened the app (AppShell.jsx has the
// record). The iOS push built in PageTransition.jsx avoids both failure modes
// by construction, and it passed every gate — but the operator held it on a
// phone on 2026-10-11 and did not want pages arriving from the side. So the
// slide is OFF by default: the quiet keyed CSS rise/back in motion.css is what
// every home gets, and the push stays available for review behind `?pages=on`.
//
//   ?pages=on|1 / ?pages=off|0  →  localStorage ziggy_motion_pages  →  default OFF
//
// An explicit query choice sticks, for the same reason flag.js's does: a
// rollback that forgets itself on the next tap is not a rollback. Mirrored to
// <html data-motion-pages> so CSS can read it too.

const KEY = 'ziggy_motion_pages'
const subs = new Set()

function readInitial() {
  try {
    const q = new URLSearchParams(window.location.search).get('pages')
    if (q === 'on' || q === '1') return true
    if (q === 'off' || q === '0') return false
    const stored = localStorage.getItem(KEY)
    if (stored === 'on') return true
    if (stored === 'off') return false
  } catch { /* private mode */ }
  return false
}

function persistExplicitChoice() {
  try {
    const q = new URLSearchParams(window.location.search).get('pages')
    if (q === 'on' || q === '1') localStorage.setItem(KEY, 'on')
    else if (q === 'off' || q === '0') localStorage.setItem(KEY, 'off')
  } catch { /* private mode */ }
}

let on = typeof window === 'undefined' ? false : readInitial()

function apply() {
  document.documentElement.setAttribute('data-motion-pages', on ? 'on' : 'off')
}

if (typeof window !== 'undefined') { persistExplicitChoice(); apply() }

export const isPagesOn = () => on

export function setPages(next) {
  on = !!next
  try { localStorage.setItem(KEY, on ? 'on' : 'off') } catch { /* ignore */ }
  apply()
  subs.forEach((fn) => fn(on))
}

export function onPagesChange(fn) {
  subs.add(fn)
  return () => subs.delete(fn)
}

import { useEffect, useState } from 'react'
export function usePagesOn() {
  const [v, setV] = useState(on)
  useEffect(() => onPagesChange(setV), [])
  return v
}
