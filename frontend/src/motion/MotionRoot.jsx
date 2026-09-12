// Mounts the motion layer, and gives you two things to judge it with.
//
// 1. A switch. Comparing two ports tells you whether you like the motion.
//    Comparing the same screen a keypress apart tells you whether the motion
//    is doing any work. Press "m".
//
// 2. A tuner. "Smooth" is not a measurable property — the frame rate here is
//    already locked, with no main-thread blocking — it is a judgement about
//    speed and curve. Rather than guess at it in rounds, this exposes the two
//    dials that actually decide it, live, on the real app. Set it to what
//    feels right and the readout tells you the numbers to bake in.

import { useEffect, useState } from 'react'
import { installPressLayer, installHapticLayer } from './pressLayer'
import { isMotionOn, toggleMotion, useMotionOn } from './flag'
import './motion.css'

// Each option is the whole personality of the movement, not a tweak.
const CURVES = [
  { id: 'glide', label: 'Glide', css: 'cubic-bezier(0.33, 0.68, 0.15, 1)',
    note: 'keeps speed through the middle — reads as one continuous movement' },
  { id: 'snap', label: 'Snap', css: 'cubic-bezier(0.23, 1, 0.32, 1)',
    note: 'covers most of the distance immediately, then settles' },
  { id: 'drawer', label: 'Drawer', css: 'cubic-bezier(0.32, 0.72, 0, 1)',
    note: "iOS sheet curve — soft start, long confident glide" },
  { id: 'even', label: 'Even', css: 'cubic-bezier(0.4, 0, 0.2, 1)',
    note: 'symmetric; the most neutral, least characterful option' },
]

const KEY = 'ziggy_motion_tune'

function load() {
  try { return JSON.parse(localStorage.getItem(KEY)) || {} } catch { return {} }
}
function save(v) {
  try { localStorage.setItem(KEY, JSON.stringify(v)) } catch { /* private mode */ }
}

function apply({ scale, curve }) {
  const root = document.documentElement
  root.style.setProperty('--m-scale', String(scale))
  const c = CURVES.find((x) => x.id === curve) || CURVES[0]
  root.style.setProperty('--m-glide', c.css)
}

function Panel() {
  const on = useMotionOn()
  const saved = load()
  const [open, setOpen] = useState(false)
  const [scale, setScale] = useState(saved.scale ?? 1)
  const [curve, setCurve] = useState(saved.curve ?? 'glide')
  // Dev chrome, not product. A real home must never see a MOTION pill or a
  // tuner, so it shows only where it is being evaluated: on a dev server, or
  // when explicitly asked for with ?tune=1. Canary is a real home.
  const [hidden, setHidden] = useState(() => {
    try {
      const q = new URLSearchParams(window.location.search)
      if (q.get('tune') === '1') return false
      if (q.get('ui') === 'clean') return true
      const dev = import.meta.env?.DEV
        || /^(localhost|127\.0\.0\.1|\[::1\])$/.test(window.location.hostname)
      return !dev
    } catch { return true }
  })

  useEffect(() => { apply({ scale, curve }); save({ scale, curve }) }, [scale, curve])

  if (hidden) return null
  const chip = {
    display: 'flex', alignItems: 'center', gap: 6,
    padding: '5px 9px', borderRadius: 999,
    border: '0.5px solid var(--line)',
    background: 'color-mix(in srgb, var(--surface) 88%, transparent)',
    backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)',
    color: 'var(--ink-mute)', font: '500 10px/1 ui-monospace, monospace',
    letterSpacing: '0.04em', cursor: 'pointer',
  }

  return (
    <div
      data-no-press
      style={{
        position: 'fixed', top: 'calc(var(--safe-top, 0px) + 8px)', insetInlineEnd: 8,
        zIndex: 9999, display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6,
      }}
    >
      <div style={{ display: 'flex', gap: 6 }}>
        <button
          type="button" data-no-press style={chip}
          onClick={(e) => { if (e.altKey) { setHidden(true); return } toggleMotion() }}
          title='Toggle the motion layer (m). Alt-click to hide.'
        >
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: on ? 'var(--ok)' : 'var(--ink-ghost)' }} />
          MOTION {on ? 'ON' : 'OFF'}
        </button>
        <button type="button" data-no-press style={chip} onClick={() => setOpen((v) => !v)} title="Tune speed and curve">
          {open ? 'CLOSE' : 'TUNE'}
        </button>
      </div>

      {open && (
        <div
          data-no-press
          style={{
            width: 250, padding: 12, borderRadius: 14,
            border: '0.5px solid var(--line)', background: 'var(--surface)',
            boxShadow: 'var(--shadow-lg)', color: 'var(--ink)',
            font: '500 11px/1.45 ui-monospace, monospace', textAlign: 'start',
          }}
        >
          <div style={{ color: 'var(--ink-mute)', marginBottom: 8 }}>
            Speed <span style={{ color: 'var(--ink)' }}>{scale.toFixed(2)}×</span>
            <span style={{ color: 'var(--ink-faint)' }}> · page {Math.round(340 * scale)}ms · hero {Math.round(560 * scale)}ms</span>
          </div>
          <input
            type="range" min={0.6} max={2} step={0.05} value={scale}
            onChange={(e) => setScale(Number(e.target.value))}
            style={{ width: '100%', marginBottom: 12 }}
            aria-label="Motion speed"
          />

          <div style={{ color: 'var(--ink-mute)', marginBottom: 6 }}>Curve for large movement</div>
          <div style={{ display: 'grid', gap: 4 }}>
            {CURVES.map((c) => (
              <button
                key={c.id} type="button" data-no-press
                onClick={() => setCurve(c.id)}
                style={{
                  textAlign: 'start', padding: '6px 8px', borderRadius: 8, cursor: 'pointer',
                  border: '0.5px solid ' + (curve === c.id ? 'var(--line-3)' : 'transparent'),
                  background: curve === c.id ? 'var(--surface-2)' : 'transparent',
                  color: 'var(--ink)', font: 'inherit',
                }}
              >
                <div>{c.label}</div>
                <div style={{ color: 'var(--ink-faint)', fontSize: 10 }}>{c.note}</div>
              </button>
            ))}
          </div>

          <div style={{ marginTop: 10, color: 'var(--ink-faint)', fontSize: 10 }}>
            Try it on: a room tile, "How Ziggy knows", opening a device.
            Tell me the speed and curve and I will bake them in.
          </div>
        </div>
      )}
    </div>
  )
}

export default function MotionRoot() {
  useEffect(() => {
    apply(load().scale ? load() : { scale: 1, curve: 'glide' })
    const un1 = installPressLayer()
    const un2 = installHapticLayer()
    const onKey = (e) => {
      if (e.key !== 'm' || e.metaKey || e.ctrlKey || e.altKey) return
      const t = e.target
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
      toggleMotion()
    }
    window.addEventListener('keydown', onKey)
    // eslint-disable-next-line no-console
    console.info(`[ziggy] motion layer ${isMotionOn() ? 'ON' : 'OFF'} — "m" toggles, TUNE adjusts speed and curve`)
    return () => { un1(); un2(); window.removeEventListener('keydown', onKey) }
  }, [])

  return <Panel />
}
