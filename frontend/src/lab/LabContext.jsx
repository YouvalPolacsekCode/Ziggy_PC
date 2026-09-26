// Motion Lab — global lab state (speed, theme, direction, reduced motion,
// stage frame). Every demo reads this through useLab() / useTx().
import { createContext, useContext, useMemo, useState, useEffect, useCallback } from 'react'
import { MotionConfig } from 'framer-motion'
import gsap from 'gsap'
import { scaleTransition } from './time'

const LabCtx = createContext(null)

const SPEEDS = [1, 0.5, 0.25, 0.1]
const FRAMES = [
  { key: 'phone', label: 'Phone', width: 390 },
  { key: 'tablet', label: 'Tablet', width: 768 },
  { key: 'desktop', label: 'Desktop', width: null },
]

function readPref(key, fallback) {
  try { const v = localStorage.getItem('ziggy_lab_' + key); return v == null ? fallback : JSON.parse(v) } catch { return fallback }
}
function writePref(key, v) {
  try { localStorage.setItem('ziggy_lab_' + key, JSON.stringify(v)) } catch { /* private mode */ }
}

export function LabProvider({ children }) {
  const [speed, setSpeedRaw] = useState(() => readPref('speed', 1))
  const [theme, setThemeRaw] = useState(() => readPref('theme', 'light'))
  const [dir, setDirRaw] = useState(() => readPref('dir', 'ltr'))
  const [reduced, setReducedRaw] = useState(() => readPref('reduced', false))
  const [frame, setFrameRaw] = useState(() => readPref('frame', 'phone'))
  const [haptics, setHaptics] = useState(true)

  const setSpeed = useCallback((v) => { setSpeedRaw(v); writePref('speed', v) }, [])
  const setTheme = useCallback((v) => { setThemeRaw(v); writePref('theme', v) }, [])
  const setDir = useCallback((v) => { setDirRaw(v); writePref('dir', v) }, [])
  const setReduced = useCallback((v) => { setReducedRaw(v); writePref('reduced', v) }, [])
  const setFrame = useCallback((v) => { setFrameRaw(v); writePref('frame', v) }, [])

  // GSAP: one global time scale
  useEffect(() => { gsap.globalTimeline.timeScale(speed) }, [speed])

  const value = useMemo(() => ({
    speed, setSpeed, SPEEDS,
    theme, setTheme,
    dir, setDir, rtl: dir === 'rtl',
    reduced, setReduced,
    frame, setFrame, FRAMES, frameWidth: FRAMES.find(f => f.key === frame)?.width ?? null,
    haptics, setHaptics,
    // scale a framer-motion transition by the lab speed
    tx: (t) => scaleTransition(t, speed),
    // ms → ms scaled (for setTimeout choreography)
    ms: (n) => n / speed,
  }), [speed, theme, dir, reduced, frame, haptics, setSpeed, setTheme, setDir, setReduced, setFrame])

  return (
    <LabCtx.Provider value={value}>
      <MotionConfig reducedMotion={reduced ? 'always' : 'never'}>
        {children}
      </MotionConfig>
    </LabCtx.Provider>
  )
}

export function useLab() {
  const v = useContext(LabCtx)
  if (!v) throw new Error('useLab outside LabProvider')
  return v
}

// Shorthand: returns a function that scales any transition by the lab speed.
export function useTx() {
  return useLab().tx
}

// Haptic stand-in for the lab: vibrates where available and flashes a small
// indicator so the pattern is visible on desktop too.
export function useHaptic() {
  const { haptics } = useLab()
  return useCallback((kind = 'selection') => {
    if (!haptics) return
    const PATTERNS = { selection: [6], light: [10], medium: [18], heavy: [28], success: [10, 40, 12], warning: [18, 60, 18], error: [24, 50, 24, 50, 24] }
    try { navigator.vibrate?.(PATTERNS[kind] || PATTERNS.selection) } catch { /* unsupported */ }
    try { window.dispatchEvent(new CustomEvent('lab:haptic', { detail: kind })) } catch { /* noop */ }
  }, [haptics])
}
