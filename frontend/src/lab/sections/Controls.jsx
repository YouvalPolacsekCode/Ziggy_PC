// Motion Lab — CONTROLS
// Toggles, power buttons, brightness, temperature, mode segments, hold-to-confirm.
// The question each prototype answers: when a value changes under the finger,
// how does the control show it heard, how does it show the value moving, and
// how does it show the hub confirming?
import { useState, useRef, useEffect } from 'react'
import { motion, useMotionValue, useSpring, useTransform, animate, AnimatePresence, LayoutGroup } from 'framer-motion'
import { Demo } from '../ui/Demo'
import { SectionIntro } from '../ui/Section'
import { Icon, Button, useT } from '../ziggy/primitives'
import { useHaptic } from '../LabContext'
import { EASE, SPRING, cssEase } from '../time'
import { COPY } from '../mock/home'

const clamp = (n, a = 0, b = 100) => Math.min(b, Math.max(a, n))
// Track colours for the draggable toggles (continuous colour needs literal values, not var()).
const TRACK_OFF = '#b7a992', TRACK_ON = '#3D8A5F'

/* ───────────────────────── 1. TOGGLE ───────────────────────── */

function ToggleFrame({ label, sub, children, on, hint }) {
  return (
    <div className="zl" style={{ padding: 16 }}>
      <div className="zl-card zl-card--pad" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <span className="zl-row__icon" style={{ background: on ? 'var(--accent-2)' : undefined, color: on ? 'var(--accent-text)' : undefined }}><Icon name="lightbulb" /></span>
        <div style={{ flex: 1 }}>
          <div className="zl-row__title">{label}</div>
          <div className="zl-row__sub">{sub}</div>
        </div>
        {children}
      </div>
      <p className="zl-footnote zl-mute" style={{ marginTop: 12 }}>{hint || 'Tap the switch. Watch the thumb, then the track.'}</p>
    </div>
  )
}

function ToggleA({ knobs, tx }) {
  const [on, setOn] = useState(false)
  const t = useT(); const h = useHaptic()
  return (
    <ToggleFrame label={t({ en: 'Floor Lamp', he: 'מנורת רצפה' })} sub={on ? t(COPY.on) : t(COPY.off)} on={on}>
      <button className="zl-switch" data-state={on ? 'checked' : 'unchecked'} onClick={() => { setOn(v => !v); h('light') }}
        style={{ transition: `background ${knobs.duration * 1000 / (1 / 1)}ms ${cssEase(knobs.ease)}`, transitionDuration: `calc(${knobs.duration}s * var(--lab-speed, 1))` }}>
        <motion.span className="zl-switch__thumb" animate={{ x: on ? 16 : 0 }} transition={tx({ duration: knobs.duration, ease: EASE[knobs.ease] })} />
      </button>
    </ToggleFrame>
  )
}

function ToggleB({ knobs, tx }) {
  const [on, setOn] = useState(false)
  const t = useT(); const h = useHaptic()
  const spring = tx({ type: 'spring', duration: knobs.duration, bounce: knobs.bounce })
  return (
    <ToggleFrame label={t({ en: 'Floor Lamp', he: 'מנורת רצפה' })} sub={on ? t(COPY.on) : t(COPY.off)} on={on}>
      <motion.button className="zl-switch" data-state={on ? 'checked' : 'unchecked'} onClick={() => { setOn(v => !v); h('light') }}
        animate={{ backgroundColor: on ? 'var(--ok)' : 'var(--line-2)' }} transition={tx({ duration: 0.2 })}>
        <motion.span className="zl-switch__thumb"
          animate={{ x: on ? 16 : 0, scaleX: [1, 1.25, 1], scaleY: [1, 0.85, 1] }}
          transition={{ x: spring, scaleX: tx({ duration: knobs.duration * 0.8, times: [0, 0.4, 1] }), scaleY: tx({ duration: knobs.duration * 0.8, times: [0, 0.4, 1] }) }}
          style={{ originX: on ? 0 : 1 }} />
      </motion.button>
    </ToggleFrame>
  )
}

function ToggleC({ knobs, tx }) {
  // causality: the thumb travels first; the track colour only "catches" once
  // the thumb arrives — the way a real switch closes a circuit.
  const [on, setOn] = useState(false)
  const t = useT(); const h = useHaptic()
  const spring = tx({ type: 'spring', duration: knobs.duration, bounce: knobs.bounce })
  return (
    <ToggleFrame label={t({ en: 'Floor Lamp', he: 'מנורת רצפה' })} sub={on ? t(COPY.on) : t(COPY.off)} on={on}>
      <motion.button className="zl-switch" data-state={on ? 'checked' : 'unchecked'} onClick={() => { setOn(v => !v); h('light') }}
        style={{ overflow: 'hidden', background: 'var(--line-2)' }}>
        <motion.span style={{ position: 'absolute', inset: 0, background: 'var(--ok)', originX: 0 }}
          animate={{ scaleX: on ? 1 : 0 }}
          transition={on ? tx({ duration: 0.16, delay: knobs.duration * 0.55, ease: EASE.out }) : tx({ duration: 0.12, ease: EASE.out })} />
        <motion.span className="zl-switch__thumb" animate={{ x: on ? 16 : 0 }} transition={spring} />
      </motion.button>
    </ToggleFrame>
  )
}

function ToggleD({ knobs, tx, rtl }) {
  // draggable: the thumb follows the finger; release commits by position OR velocity.
  // A 'selection' tick fires the moment the thumb crosses the midpoint under the finger.
  const [on, setOn] = useState(false)
  const t = useT(); const h = useHaptic()
  const sign = rtl ? -1 : 1
  const x = useMotionValue(0)
  const bg = useTransform(x, rtl ? [-16, 0] : [0, 16], rtl ? [TRACK_ON, TRACK_OFF] : [TRACK_OFF, TRACK_ON])
  const dragging = useRef(false)
  const side = useRef(false)
  useEffect(() => { animate(x, on ? 16 * sign : 0, tx({ type: 'spring', duration: knobs.duration, bounce: knobs.bounce })) }, [on]) // eslint-disable-line
  useEffect(() => x.on('change', (v) => {
    if (!dragging.current) return
    const s = v * sign > 8
    if (s !== side.current) { side.current = s; h('selection') }
  }), [x, sign, h])
  return (
    <ToggleFrame label={t({ en: 'Floor Lamp', he: 'מנורת רצפה' })} sub={on ? t(COPY.on) : t(COPY.off)} on={on}
      hint="Drag the thumb. A tick as it crosses the middle; release commits by position or a flick.">
      <motion.button className="zl-switch" data-state={on ? 'checked' : 'unchecked'} style={{ backgroundColor: bg }}
        onClick={() => { setOn(v => !v); h('light') }}>
        <motion.span className="zl-switch__thumb" style={{ x, touchAction: 'pan-y' }} drag="x" dragConstraints={{ left: rtl ? -16 : 0, right: rtl ? 0 : 16 }} dragElastic={0.08} dragMomentum={false}
          onDragStart={() => { dragging.current = true; side.current = x.get() * sign > 8 }}
          onDragEnd={(_, info) => {
            dragging.current = false
            const vx = info.velocity.x * sign
            const next = vx > 200 ? true : vx < -200 ? false : x.get() * sign > 8
            if (next !== on) h('light')
            setOn(next)
            animate(x, next ? 16 * sign : 0, tx({ type: 'spring', duration: knobs.duration, bounce: knobs.bounce }))
          }}
          onClick={(e) => e.stopPropagation()} />
      </motion.button>
    </ToggleFrame>
  )
}

function ToggleE({ knobs, tx, rtl }) {
  // the on-colour is poured by the thumb: a circle clip centred on the thumb's
  // live position grows to cover the track as it travels; off drains it back in.
  const [on, setOn] = useState(false)
  const t = useT(); const h = useHaptic()
  const sign = rtl ? -1 : 1
  const x = useMotionValue(0)
  const r = useMotionValue(0)
  // thumb centre in track px: 12 (LTR rest) or 28 (RTL rest) plus its translate
  const clip = useTransform([x, r], ([xv, rv]) => `circle(${rv}px at ${(rtl ? 28 : 12) + xv}px 12px)`)
  useEffect(() => {
    const d = on ? 0.32 : 0.24
    animate(x, on ? 16 * sign : 0, tx({ duration: d, ease: EASE.out }))
    animate(r, on ? 36 : 0, tx({ duration: d, ease: EASE.out }))
  }, [on]) // eslint-disable-line
  return (
    <ToggleFrame label={t({ en: 'Floor Lamp', he: 'מנורת רצפה' })} sub={on ? t(COPY.on) : t(COPY.off)} on={on}
      hint="Tap. The green is poured out of the thumb as it travels; off, the thumb drinks it back.">
      <button className="zl-switch" data-state={on ? 'checked' : 'unchecked'} onClick={() => { setOn(v => !v); h('light') }} style={{ overflow: 'hidden', background: 'var(--line-2)' }}>
        <motion.span style={{ position: 'absolute', inset: 0, background: 'var(--ok)', clipPath: clip }} />
        <motion.span className="zl-switch__thumb" style={{ x, zIndex: 1 }} />
      </button>
    </ToggleFrame>
  )
}

// Magnetic detent geometry: the middle 30% of travel (5.6 → 10.4 px) is a hump.
// The finger moves the thumb at 0.4× there, so the hump costs 12 finger-px.
const Z0 = 5.6, Z1 = 10.4, ZK = 0.4, ZF = (Z1 - Z0) / ZK
const toThumb = (f) => f <= Z0 ? f : f < Z0 + ZF ? Z0 + (f - Z0) * ZK : f - ZF + (Z1 - Z0)
const toFinger = (p) => p <= Z0 ? p : p < Z1 ? Z0 + (p - Z0) / ZK : p + ZF - (Z1 - Z0)

function ToggleF({ knobs, tx, rtl }) {
  const [on, setOn] = useState(false)
  const t = useT(); const h = useHaptic()
  const sign = rtl ? -1 : 1
  const x = useMotionValue(0)
  const bg = useTransform(x, rtl ? [-16, 0] : [0, 16], rtl ? [TRACK_ON, TRACK_OFF] : [TRACK_OFF, TRACK_ON])
  const d = useRef(null)
  const region = (p) => p < Z0 ? 'off' : p > Z1 ? 'on' : 'zone'
  const settle = (next, spring) => animate(x, next ? 16 * sign : 0, spring || tx({ type: 'spring', duration: knobs.duration, bounce: knobs.bounce }))
  const down = (e) => {
    e.currentTarget.setPointerCapture(e.pointerId)
    x.stop()
    const p = x.get() * sign
    d.current = { fx0: e.clientX, f0: toFinger(p), moved: false, region: region(p), snapped: false }
  }
  const move = (e) => {
    const s = d.current; if (!s) return
    const dx = (e.clientX - s.fx0) * sign
    if (!s.moved && Math.abs(dx) < 3) return
    s.moved = true
    const p = clamp(toThumb(s.f0 + dx), 0, 16)
    const reg = region(p)
    if (reg === 'zone') {
      if (s.snapped) { s.snapped = false; animate(x, p * sign, tx({ type: 'spring', duration: 0.2, bounce: 0 })) }
      else { x.stop(); x.set(p * sign) }
    } else if (s.region === 'zone') {
      // crossed the hump: the seat pulls the thumb home
      s.snapped = true; h('medium'); setOn(reg === 'on'); settle(reg === 'on', tx(SPRING.detent))
    } else if (!s.snapped) { x.stop(); x.set(p * sign) }
    s.region = reg
  }
  const up = () => {
    const s = d.current; if (!s) return
    d.current = null
    if (!s.moved) { const next = !on; setOn(next); h('light'); settle(next); return }
    const next = x.get() * sign > 8 // inside the hump: spring back to the nearer side
    if (next !== on && !s.snapped) h('light')
    setOn(next); settle(next)
  }
  return (
    <ToggleFrame label={t({ en: 'Floor Lamp', he: 'מנורת רצפה' })} sub={on ? t(COPY.on) : t(COPY.off)} on={on}
      hint="Drag slowly. The middle has a hump: the thumb drags at 0.4× there, then snaps over it with a click.">
      <motion.button className="zl-switch" data-state={on ? 'checked' : 'unchecked'} style={{ backgroundColor: bg, touchAction: 'none' }}
        onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
        <motion.span className="zl-switch__thumb" style={{ x }} />
      </motion.button>
    </ToggleFrame>
  )
}

/* ───────────────────────── 2. POWER BUTTON ───────────────────────── */

function PowerFrame({ children, on, hint }) {
  const t = useT()
  return (
    <div className="zl" style={{ padding: 16, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 20, paddingTop: 40 }}>
      <div style={{ textAlign: 'center' }}>
        <div className="zl-title3">{t({ en: 'Living Room AC', he: 'מזגן סלון' })}</div>
        <div className="zl-footnote zl-mute">{on ? t({ en: 'Cooling · 24°', he: 'מקרר · 24°' }) : t(COPY.off)}</div>
      </div>
      {children}
      <p className="zl-footnote zl-mute" style={{ textAlign: 'center', maxWidth: 280 }}>{hint}</p>
    </div>
  )
}

function PowerA({ knobs, tx }) {
  const [on, setOn] = useState(false); const h = useHaptic()
  return (
    <PowerFrame on={on} hint="Press: scale on pointer-down, fill on release.">
      <motion.button whileTap={{ scale: 0.94 }} transition={tx({ type: 'spring', duration: 0.18, bounce: 0 })}
        onClick={() => { setOn(v => !v); h(on ? 'light' : 'medium') }}
        animate={{ backgroundColor: on ? 'var(--accent)' : 'var(--surface)', color: on ? 'var(--on-accent)' : 'var(--ink-mute)', borderColor: on ? 'var(--accent)' : 'var(--line)' }}
        style={{ width: 88, height: 88, borderRadius: 999, border: '1px solid', display: 'grid', placeItems: 'center', cursor: 'pointer' }}>
        <Icon name="power" size={32} strokeWidth={2.2} />
      </motion.button>
    </PowerFrame>
  )
}

function PowerB({ knobs, tx }) {
  // "Ignition" — the app's current grammar: arrives in 220ms with a 6% icon overshoot, leaves in 160ms with none.
  // The ring leaves from the button's EDGE (scale 1 → 1.5), not from its centre: it is the button radiating, not a second object.
  const [on, setOn] = useState(false); const h = useHaptic()
  return (
    <PowerFrame on={on} hint="Ignition: on arrives with a ring off the button's edge and a small overshoot; off leaves faster with none.">
      <motion.button whileTap={{ scale: 0.96 }}
        onClick={() => { setOn(v => !v); h(on ? 'light' : 'medium') }}
        animate={{ backgroundColor: on ? 'var(--accent)' : 'var(--surface)', color: on ? 'var(--on-accent)' : 'var(--ink-mute)', borderColor: on ? 'var(--accent)' : 'var(--line)' }}
        transition={tx({ duration: on ? 0.22 : 0.16, ease: EASE.out })}
        style={{ position: 'relative', width: 88, height: 88, borderRadius: 999, border: '1px solid', display: 'grid', placeItems: 'center', cursor: 'pointer' }}>
        <AnimatePresence>
          {on && (
            <motion.span key="ring" initial={{ scale: 1, opacity: 0.6 }} animate={{ scale: 1.5, opacity: 0 }} exit={{ opacity: 0 }}
              transition={tx({ duration: 0.5, ease: EASE.out })}
              style={{ position: 'absolute', inset: 0, borderRadius: 999, border: '2px solid var(--accent)', pointerEvents: 'none' }} />
          )}
        </AnimatePresence>
        <motion.span animate={{ scale: on ? [1, 1.06 + knobs.overshoot, 1] : 1 }} transition={tx({ duration: 0.22, times: [0, 0.6, 1], ease: EASE.out })} style={{ display: 'grid' }}>
          <Icon name="power" size={32} strokeWidth={2.2} />
        </motion.span>
      </motion.button>
    </PowerFrame>
  )
}

function PowerC({ knobs, tx }) {
  // ripple from the touch point — the fill starts where the finger is.
  const [on, setOn] = useState(false); const h = useHaptic()
  const [origin, setOrigin] = useState({ x: 50, y: 50 })
  return (
    <PowerFrame on={on} hint="Tap near an edge: the state spreads from where you touched.">
      <motion.button whileTap={{ scale: 0.96 }}
        onPointerDown={(e) => { const r = e.currentTarget.getBoundingClientRect(); setOrigin({ x: ((e.clientX - r.left) / r.width) * 100, y: ((e.clientY - r.top) / r.height) * 100 }) }}
        onClick={() => { setOn(v => !v); h(on ? 'light' : 'medium') }}
        style={{ position: 'relative', overflow: 'hidden', width: 88, height: 88, borderRadius: 999, border: '1px solid var(--line)', background: 'var(--surface)', display: 'grid', placeItems: 'center', cursor: 'pointer', color: on ? 'var(--on-accent)' : 'var(--ink-mute)', transition: `color calc(200ms * var(--lab-speed,1))` }}>
        <motion.span
          animate={{ clipPath: on ? `circle(150% at ${origin.x}% ${origin.y}%)` : `circle(0% at ${origin.x}% ${origin.y}%)` }}
          transition={tx({ duration: on ? knobs.duration : knobs.duration * 0.7, ease: EASE.out })}
          style={{ position: 'absolute', inset: 0, background: 'var(--accent)' }} />
        <span style={{ position: 'relative' }}><Icon name="power" size={32} strokeWidth={2.2} /></span>
      </motion.button>
    </PowerFrame>
  )
}

function PowerD({ knobs, tx, ms }) {
  // hold-to-commit for a consequential action (turn the whole home off)
  const t = useT(); const h = useHaptic()
  const [held, setHeld] = useState(false)
  const [done, setDone] = useState(false)
  const progress = useMotionValue(0)
  const dash = useTransform(progress, [0, 1], [283, 0])
  const ctrl = useRef(null)
  const start = () => {
    if (done) return
    setHeld(true)
    ctrl.current = animate(progress, 1, { duration: knobs.hold / 1 * (1), ease: 'linear', onComplete: () => { setDone(true); setHeld(false); h('success') } })
  }
  const stop = () => {
    if (done) return
    setHeld(false); ctrl.current?.stop()
    animate(progress, 0, tx({ duration: 0.2, ease: EASE.out }))
  }
  return (
    <PowerFrame on={false} hint={done ? t({ en: 'Everything is off.', he: 'הכל כבוי.' }) : t({ en: 'Press and hold to turn everything off.', he: 'לחץ והחזק כדי לכבות הכל.' })}>
      <motion.button onPointerDown={start} onPointerUp={stop} onPointerLeave={stop} onPointerCancel={stop}
        animate={{ scale: held ? 0.96 : 1, backgroundColor: done ? 'var(--ink)' : 'var(--surface)', color: done ? 'var(--bg)' : 'var(--ink-mute)' }}
        transition={tx({ duration: 0.16, ease: EASE.out })}
        style={{ position: 'relative', width: 96, height: 96, borderRadius: 999, border: '1px solid var(--line)', display: 'grid', placeItems: 'center', cursor: 'pointer', touchAction: 'none' }}>
        <svg width="96" height="96" viewBox="0 0 96 96" style={{ position: 'absolute', inset: 0, transform: 'rotate(-90deg)' }}>
          <motion.circle cx="48" cy="48" r="45" fill="none" stroke="var(--accent)" strokeWidth="3" strokeDasharray="283" style={{ strokeDashoffset: dash }} strokeLinecap="round" />
        </svg>
        <Icon name={done ? 'moon' : 'power'} size={32} strokeWidth={2.2} />
      </motion.button>
      {done && <Button variant="ghost" onClick={() => { setDone(false); progress.set(0) }}>{t(COPY.undo)}</Button>}
    </PowerFrame>
  )
}

function PowerE({ knobs, tx }) {
  // Breathe in, glow out: the hold is felt (a slow 6% inhale), the release is
  // the moment (one glow pulse off the edge, the glyph's stroke thickens).
  const [on, setOn] = useState(false); const h = useHaptic()
  const [pressed, setPressed] = useState(false)
  const [pulse, setPulse] = useState(0)
  const commit = () => { if (!pressed) return; setPressed(false); setOn(v => !v); setPulse(p => p + 1); h('medium') }
  const cancel = () => setPressed(false)
  return (
    <PowerFrame on={on} hint="Press and hold a moment, then let go. The button breathes in while held; the release is one glow pulse.">
      <div style={{ position: 'relative' }}>
        {pulse > 0 && (
          <motion.span key={pulse} initial={{ boxShadow: '0 0 0 0px rgba(201,100,66,0.55)' }} animate={{ boxShadow: '0 0 0 14px rgba(201,100,66,0)' }}
            transition={tx({ duration: 0.5, ease: EASE.out })} style={{ position: 'absolute', inset: 0, borderRadius: 999, pointerEvents: 'none' }} />
        )}
        <motion.button onPointerDown={() => setPressed(true)} onPointerUp={commit} onPointerLeave={cancel} onPointerCancel={cancel}
          animate={{ scale: pressed ? 1.06 : 1, backgroundColor: on ? 'var(--accent)' : 'var(--surface)', color: on ? 'var(--on-accent)' : 'var(--ink-mute)', borderColor: on ? 'var(--accent)' : 'var(--line)' }}
          transition={{ scale: pressed ? tx({ duration: 0.5, ease: EASE.out }) : tx({ type: 'spring', duration: 0.34, bounce: 0.22 }), backgroundColor: tx({ duration: 0.2 }), color: tx({ duration: 0.2 }), borderColor: tx({ duration: 0.2 }) }}
          style={{ position: 'relative', width: 88, height: 88, borderRadius: 999, border: '1px solid', background: 'var(--surface)', display: 'grid', placeItems: 'center', cursor: 'pointer', touchAction: 'none' }}>
          <Icon name="power" size={32} strokeWidth={on ? 3 : 2.2} style={{ transition: 'stroke-width calc(220ms * var(--lab-speed,1))' }} />
        </motion.button>
      </div>
    </PowerFrame>
  )
}

function PowerF({ knobs, tx, rtl }) {
  // Knob click: the glyph turns a quarter with a bouncy spring like a detent,
  // while the fill slides in from the leading edge in 220ms (out: 160ms).
  const [on, setOn] = useState(false); const h = useHaptic()
  const hidden = rtl ? 'inset(0 0 0 100%)' : 'inset(0 100% 0 0)'
  return (
    <PowerFrame on={on} hint="Tap. The glyph clicks a quarter turn like a knob detent; the fill slides in from the leading edge.">
      <motion.button whileTap={{ scale: 0.96 }} onClick={() => { setOn(v => !v); h('medium') }}
        style={{ position: 'relative', overflow: 'hidden', width: 88, height: 88, borderRadius: 999, border: '1px solid var(--line)', background: 'var(--surface)', display: 'grid', placeItems: 'center', cursor: 'pointer', color: on ? 'var(--on-accent)' : 'var(--ink-mute)', transition: `color calc(200ms * var(--lab-speed,1))` }}>
        <motion.span animate={{ clipPath: on ? 'inset(0 0 0 0)' : hidden }} transition={tx({ duration: on ? 0.22 : 0.16, ease: EASE.out })}
          style={{ position: 'absolute', inset: 0, background: 'var(--accent)' }} />
        <motion.span animate={{ rotate: on ? 90 : 0 }} transition={tx({ type: 'spring', duration: 0.5, bounce: 0.35 })} style={{ position: 'relative', display: 'grid' }}>
          <Icon name="power" size={32} strokeWidth={2.2} />
        </motion.span>
      </motion.button>
    </PowerFrame>
  )
}

/* ───────────────────────── 3. BRIGHTNESS ───────────────────────── */

function BrightnessA({ knobs, tx }) {
  // horizontal fill that grows under the finger while held (the app's current feel)
  const t = useT(); const h = useHaptic()
  const [pct, setPct] = useState(45)
  const [held, setHeld] = useState(false)
  const lastTick = useRef(45)
  const ref = useRef(null)
  const set = (clientX) => {
    const r = ref.current.getBoundingClientRect()
    const raw = Math.round(Math.min(100, Math.max(0, ((clientX - r.left) / r.width) * 100)))
    const p = document.dir === 'rtl' || ref.current.closest('[dir=rtl]') ? 100 - raw : raw
    setPct(p)
    if (Math.abs(p - lastTick.current) >= 5) { lastTick.current = p; h('selection') }
  }
  return (
    <div className="zl" style={{ padding: 16 }}>
      <div className="zl-hstack" style={{ marginBottom: 10 }}>
        <span className="zl-row__icon" style={{ background: 'var(--accent-2)', color: 'var(--accent-text)' }}><Icon name="lightbulb" /></span>
        <div><div className="zl-row__title">{t({ en: 'Ceiling Light', he: 'תאורת תקרה' })}</div><div className="zl-row__sub zl-mono">{pct}%</div></div>
      </div>
      <motion.div ref={ref} animate={{ height: held ? 56 + knobs.grow : 56 }} transition={tx({ type: 'spring', duration: 0.3, bounce: 0.1 })}
        onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); setHeld(true); set(e.clientX) }}
        onPointerMove={(e) => held && set(e.clientX)}
        onPointerUp={() => setHeld(false)} onPointerCancel={() => setHeld(false)}
        style={{ position: 'relative', borderRadius: 16, background: 'var(--surface-3)', overflow: 'hidden', touchAction: 'none', cursor: 'ew-resize' }}>
        <div style={{ position: 'absolute', insetBlock: 0, insetInlineStart: 0, width: `${pct}%`, background: 'var(--accent)', transition: held ? 'none' : `width calc(0.2s * var(--lab-speed,1)) ${cssEase('out')}` }} />
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', paddingInline: 16, color: pct > 30 ? 'var(--on-accent)' : 'var(--ink)', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{pct}%</div>
      </motion.div>
      <p className="zl-footnote zl-mute" style={{ marginTop: 10 }}>Drag. A tick every 5%. The bar grows while held so the finger never hides the value.</p>
    </div>
  )
}

function BrightnessB({ knobs, tx }) {
  // vertical light well + ambient glow; the room "receives" the brightness
  const t = useT(); const h = useHaptic()
  const [pct, setPct] = useState(45)
  const [held, setHeld] = useState(false)
  const ref = useRef(null)
  const lastTick = useRef(45)
  const set = (clientY) => {
    const r = ref.current.getBoundingClientRect()
    const p = Math.round(Math.min(100, Math.max(0, (1 - (clientY - r.top) / r.height) * 100)))
    setPct(p)
    if (Math.abs(p - lastTick.current) >= 5) { lastTick.current = p; h('selection') }
  }
  const glow = useSpring(pct, tx({ stiffness: 120, damping: 20 }))
  useEffect(() => { glow.set(pct) }, [pct, glow])
  const bg = useTransform(glow, [0, 100], ['rgba(201,100,66,0)', 'rgba(201,100,66,0.35)'])
  return (
    <motion.div className="zl" style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16, background: bg }}>
      <div style={{ textAlign: 'center' }}>
        <div className="zl-title3">{t({ en: 'Ceiling Light', he: 'תאורת תקרה' })}</div>
        <div className="zl-large zl-mono" style={{ fontSize: 44 }}>{pct}<span className="zl-title3 zl-mute">%</span></div>
      </div>
      <motion.div ref={ref} animate={{ width: held ? 108 : 96 }} transition={tx({ type: 'spring', duration: 0.3, bounce: 0.1 })}
        onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); setHeld(true); set(e.clientY) }}
        onPointerMove={(e) => held && set(e.clientY)}
        onPointerUp={() => setHeld(false)} onPointerCancel={() => setHeld(false)}
        style={{ position: 'relative', height: 300, borderRadius: 32, background: 'var(--surface-3)', overflow: 'hidden', touchAction: 'none', cursor: 'ns-resize', boxShadow: 'var(--shadow-md)' }}>
        <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: `${pct}%`, background: 'linear-gradient(to top, var(--accent), var(--accent-3))', transition: held ? 'none' : `height calc(0.2s * var(--lab-speed,1)) ${cssEase('out')}` }} />
        <div style={{ position: 'absolute', left: 0, right: 0, bottom: 20, display: 'grid', placeItems: 'center', color: pct > 12 ? 'var(--on-accent)' : 'var(--ink-mute)' }}><Icon name="lightbulb" size={28} /></div>
      </motion.div>
      <p className="zl-footnote zl-mute">Drag up and down. The page glows with the bulb: the room shows the effect, not just the number.</p>
    </motion.div>
  )
}

function BrightnessC({ knobs, tx }) {
  // rotary dial with detents. Angle → value; a haptic tick every detent.
  const t = useT(); const h = useHaptic()
  const [pct, setPct] = useState(45)
  const ref = useRef(null)
  const dragging = useRef(false)
  const lastAngle = useRef(null)
  const tickAt = useRef(45)
  const angle = useSpring(pct * 2.7 - 135, tx({ stiffness: 300, damping: 30 }))
  useEffect(() => { angle.set(pct * 2.7 - 135) }, [pct, angle])
  const onMove = (e) => {
    if (!dragging.current) return
    const r = ref.current.getBoundingClientRect()
    const a = Math.atan2(e.clientY - (r.top + r.height / 2), e.clientX - (r.left + r.width / 2)) * 180 / Math.PI
    if (lastAngle.current != null) {
      let d = a - lastAngle.current
      if (d > 180) d -= 360; if (d < -180) d += 360
      setPct(p => {
        const n = Math.round(Math.min(100, Math.max(0, p + d / 2.7)))
        if (Math.abs(n - tickAt.current) >= 5) { tickAt.current = n; h('selection') }
        return n
      })
    }
    lastAngle.current = a
  }
  return (
    <div className="zl" style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 18 }}>
      <div className="zl-title3">{t({ en: 'Ceiling Light', he: 'תאורת תקרה' })}</div>
      <div ref={ref} onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); dragging.current = true; lastAngle.current = null }}
        onPointerMove={onMove} onPointerUp={() => { dragging.current = false }} onPointerCancel={() => { dragging.current = false }}
        style={{ position: 'relative', width: 220, height: 220, borderRadius: 999, background: 'var(--surface)', boxShadow: 'var(--shadow-lg)', border: '1px solid var(--line)', touchAction: 'none', cursor: 'grab', display: 'grid', placeItems: 'center' }}>
        <svg width="220" height="220" viewBox="0 0 220 220" style={{ position: 'absolute', inset: 0 }}>
          {Array.from({ length: 21 }).map((_, i) => {
            const a = (-135 + i * 13.5) * Math.PI / 180
            const lit = i * 5 <= pct
            return <line key={i} x1={110 + Math.cos(a) * 96} y1={110 + Math.sin(a) * 96} x2={110 + Math.cos(a) * (i % 5 === 0 ? 84 : 88)} y2={110 + Math.sin(a) * (i % 5 === 0 ? 84 : 88)} stroke={lit ? 'var(--accent)' : 'var(--line-2)'} strokeWidth={i % 5 === 0 ? 3 : 2} strokeLinecap="round" style={{ transition: 'stroke 120ms' }} />
          })}
        </svg>
        <motion.div style={{ rotate: angle, width: 150, height: 150, borderRadius: 999, background: 'var(--surface-2)', border: '1px solid var(--line)', position: 'relative' }}>
          <span style={{ position: 'absolute', top: 10, left: '50%', width: 6, height: 22, marginLeft: -3, borderRadius: 3, background: 'var(--accent)' }} />
        </motion.div>
        <div style={{ position: 'absolute', display: 'grid', placeItems: 'center' }}>
          <span className="zl-title2 zl-mono">{pct}%</span>
        </div>
      </div>
      <p className="zl-footnote zl-mute">Turn it. A tick every 5%. Physical, one-handed, and it survives a shaky thumb.</p>
    </div>
  )
}

function BrightnessD({ knobs, tx }) {
  // scrub the tile itself: horizontal drag across a dimmable light sets brightness without opening it
  const t = useT(); const h = useHaptic()
  const [pct, setPct] = useState(60)
  const [on, setOn] = useState(true)
  const [scrub, setScrub] = useState(false)
  const startX = useRef(0); const startPct = useRef(60); const moved = useRef(false); const tickAt = useRef(60)
  const ref = useRef(null)
  return (
    <div className="zl" style={{ padding: 16 }}>
      <div className="zl-grid2">
        <button ref={ref} className="zl-tile" data-on={on ? 'true' : 'false'} style={{ minHeight: 110, position: 'relative', touchAction: 'pan-y', ['--sp']: 1 }}
          onPointerDown={(e) => { startX.current = e.clientX; startPct.current = pct; moved.current = false; e.currentTarget.setPointerCapture(e.pointerId) }}
          onPointerMove={(e) => {
            const dx = e.clientX - startX.current
            if (!moved.current && Math.abs(dx) < 8) return
            if (!moved.current) { moved.current = true; setScrub(true) }
            const w = ref.current.getBoundingClientRect().width
            const sign = ref.current.closest('[dir=rtl]') ? -1 : 1
            const n = Math.round(Math.min(100, Math.max(0, startPct.current + (dx * sign / w) * 100)))
            setPct(n); if (n > 0 && !on) setOn(true)
            if (Math.abs(n - tickAt.current) >= 5) { tickAt.current = n; h('selection') }
          }}
          onPointerUp={() => { if (!moved.current) { setOn(v => !v); h('light') } setScrub(false) }}
          onPointerCancel={() => setScrub(false)}>
          <motion.div animate={{ width: on ? `${pct}%` : '0%' }} transition={scrub ? { duration: 0 } : tx({ duration: 0.22, ease: EASE.out })}
            style={{ position: 'absolute', insetBlock: 0, insetInlineStart: 0, background: 'var(--accent-2)', pointerEvents: 'none' }} />
          <div className="zl-tile__row" style={{ position: 'relative' }}>
            <span className="zl-tile__icon"><Icon name="lightbulb" /></span>
            <motion.span className="zl-footnote zl-mono" animate={{ opacity: scrub ? 1 : 0.7, scale: scrub ? 1.25 : 1 }} transition={tx({ duration: 0.16 })} style={{ fontWeight: 600, transformOrigin: 'right center' }}>{on ? `${pct}%` : t(COPY.off)}</motion.span>
          </div>
          <div style={{ position: 'relative' }}>
            <div className="zl-tile__name">{t({ en: 'Ceiling Light', he: 'תאורת תקרה' })}</div>
            <div className="zl-tile__meta">{t({ en: 'Living Room', he: 'סלון' })}</div>
          </div>
        </button>
        <div className="zl-tile" style={{ minHeight: 110, opacity: 0.5 }}>
          <div className="zl-tile__row"><span className="zl-tile__icon"><Icon name="tv" /></span></div>
          <div><div className="zl-tile__name">{t({ en: 'Living Room TV', he: 'טלוויזיה' })}</div><div className="zl-tile__meta">{t(COPY.off)}</div></div>
        </div>
      </div>
      <p className="zl-footnote zl-mute" style={{ marginTop: 12 }}>Tap = toggle. Drag sideways across the tile = brightness. A vertical drag still scrolls.</p>
    </div>
  )
}

function BrightnessE({ knobs, tx, rtl }) {
  // Arc on the tile: a ring around the icon; drag anywhere on the tile and the
  // angle to the ring's centre sets brightness. The arc fills clockwise (CCW in
  // RTL), the percent rides at the arc's end, the tile fill follows on a spring.
  const t = useT(); const h = useHaptic()
  const [pct, setPct] = useState(45)
  const ringRef = useRef(null)
  const dragging = useRef(false); const tickAt = useRef(45); const last = useRef(45)
  const B = 104, R = 40, C = 2 * Math.PI * R, sgn = rtl ? -1 : 1
  const p = useMotionValue(45)
  const fill = useSpring(p, tx({ stiffness: 260, damping: 28 }))
  const dashOffset = useTransform(p, v => C * (1 - v / 100))
  const lx = useTransform(p, v => Math.sin((v / 100) * 2 * Math.PI) * (R + 22) * sgn)
  const ly = useTransform(p, v => -Math.cos((v / 100) * 2 * Math.PI) * (R + 22))
  const fillW = useTransform(fill, v => `${v}%`)
  const set = (e) => {
    const r = ringRef.current.getBoundingClientRect()
    const a = Math.atan2(e.clientY - (r.top + r.height / 2), e.clientX - (r.left + r.width / 2)) * 180 / Math.PI
    let deg = (a + 90 + 360) % 360
    if (rtl) deg = (360 - deg) % 360
    let n = Math.round((deg / 360) * 100)
    if (last.current > 75 && n < 25) n = 100 // sticky ends: no wrap-around
    if (last.current < 25 && n > 75) n = 0
    last.current = n; setPct(n); p.set(n)
    if (Math.abs(n - tickAt.current) >= 5) { tickAt.current = n; h('selection') }
  }
  return (
    <div className="zl" style={{ padding: 16 }}>
      <div className="zl-grid2">
        <div className="zl-tile" data-on={pct > 0 ? 'true' : 'false'} style={{ minHeight: 196, position: 'relative', touchAction: 'none', cursor: 'grab', overflow: 'hidden' }}
          onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); dragging.current = true; set(e) }}
          onPointerMove={(e) => dragging.current && set(e)}
          onPointerUp={() => { dragging.current = false }} onPointerCancel={() => { dragging.current = false }}>
          <motion.div style={{ position: 'absolute', insetBlock: 0, insetInlineStart: 0, width: fillW, background: 'var(--accent-2)', pointerEvents: 'none' }} />
          <div ref={ringRef} style={{ position: 'relative', width: B, height: B, marginInlineStart: -4, marginTop: -4 }}>
            <svg width={B} height={B} viewBox={`0 0 ${B} ${B}`} style={{ position: 'absolute', inset: 0, transform: rtl ? 'scaleX(-1) rotate(-90deg)' : 'rotate(-90deg)' }}>
              <circle cx={B / 2} cy={B / 2} r={R} fill="none" stroke="var(--line-2)" strokeWidth="4" />
              {Array.from({ length: 20 }).map((_, i) => {
                const a = (i * 18) * Math.PI / 180
                const lit = i * 5 < pct
                return <line key={i} x1={B / 2 + Math.cos(a) * (R + 7)} y1={B / 2 + Math.sin(a) * (R + 7)} x2={B / 2 + Math.cos(a) * (R + (i % 5 === 0 ? 12 : 10))} y2={B / 2 + Math.sin(a) * (R + (i % 5 === 0 ? 12 : 10))} stroke={lit ? 'var(--accent)' : 'var(--line-2)'} strokeWidth={i % 5 === 0 ? 2 : 1.5} strokeLinecap="round" style={{ transition: 'stroke calc(120ms * var(--lab-speed,1))' }} />
              })}
              <motion.circle cx={B / 2} cy={B / 2} r={R} fill="none" stroke="var(--accent)" strokeWidth="4" strokeLinecap="round" strokeDasharray={C} style={{ strokeDashoffset: dashOffset }} />
            </svg>
            <span className="zl-tile__icon" style={{ position: 'absolute', left: B / 2 - 17, top: B / 2 - 17 }}><Icon name="lightbulb" /></span>
            <motion.span style={{ position: 'absolute', left: B / 2, top: B / 2, x: lx, y: ly, pointerEvents: 'none' }}>
              <span className="zl-caption zl-mono" style={{ display: 'inline-block', transform: 'translate(-50%, -50%)', padding: '2px 6px', borderRadius: 999, background: 'var(--ink)', color: 'var(--bg)', whiteSpace: 'nowrap' }}>{pct}%</span>
            </motion.span>
          </div>
          <div style={{ position: 'relative' }}>
            <div className="zl-tile__name">{t({ en: 'Ceiling Light', he: 'תאורת תקרה' })}</div>
            <div className="zl-tile__meta">{t({ en: 'Living Room', he: 'סלון' })}</div>
          </div>
        </div>
        <div className="zl-tile" style={{ minHeight: 196, opacity: 0.5 }}>
          <div className="zl-tile__row"><span className="zl-tile__icon"><Icon name="tv" /></span></div>
          <div><div className="zl-tile__name">{t({ en: 'Living Room TV', he: 'טלוויזיה' })}</div><div className="zl-tile__meta">{t(COPY.off)}</div></div>
        </div>
      </div>
      <p className="zl-footnote zl-mute" style={{ marginTop: 12 }}>Drag around the ring (anywhere on the tile counts). The percent rides the arc's end; a tick every 5%; the tile fills behind it.</p>
    </div>
  )
}

function BrightnessF({ knobs, tx }) {
  // Two-stage: drag sideways for coarse (the whole bar = 100%); while still
  // holding, drag DOWN past 28px to enter fine mode, where 6px = 1%. Release commits.
  const t = useT(); const h = useHaptic()
  const [pct, setPct] = useState(45)
  const [mode, setMode] = useState('idle') // idle | coarse | fine
  const ref = useRef(null)
  const d = useRef(null)
  const tickAt = useRef(45)
  const down = (e) => {
    e.currentTarget.setPointerCapture(e.pointerId)
    d.current = { x0: e.clientX, y0: e.clientY, p0: pct, fine: false, fx: 0, fp: pct }
    setMode('coarse')
  }
  const move = (e) => {
    const s = d.current; if (!s) return
    const w = ref.current.getBoundingClientRect().width
    const sign = ref.current.closest('[dir=rtl]') ? -1 : 1
    const dx = (e.clientX - s.x0) * sign, dy = e.clientY - s.y0
    if (!s.fine && Math.abs(dy) > 28) {
      s.fine = true; s.fx = e.clientX; s.fp = clamp(Math.round(s.p0 + (dx / w) * 100))
      setMode('fine'); h('medium')
    }
    const n = s.fine ? clamp(Math.round(s.fp + ((e.clientX - s.fx) * sign) / 6)) : clamp(Math.round(s.p0 + (dx / w) * 100))
    setPct(n)
    if (Math.abs(n - tickAt.current) >= (s.fine ? 1 : 5)) { tickAt.current = n; h('selection') }
  }
  const up = () => { if (d.current) { d.current = null; setMode('idle'); h('light') } }
  const fine = mode === 'fine'
  return (
    <div className="zl" style={{ padding: 16, paddingTop: 40 }}>
      <div className="zl-hstack" style={{ marginBottom: 14, minHeight: 36 }}>
        <span className="zl-row__icon" style={{ background: 'var(--accent-2)', color: 'var(--accent-text)' }}><Icon name="lightbulb" /></span>
        <div style={{ flex: 1 }}><div className="zl-row__title">{t({ en: 'Ceiling Light', he: 'תאורת תקרה' })}</div><div className="zl-row__sub zl-mono">{pct}%</div></div>
        <AnimatePresence>
          {fine && (
            <motion.span key="fine" className="zl-chip" data-on="true" initial={{ opacity: 0, y: 4, scale: 0.9 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 4, scale: 0.9, transition: tx({ duration: 0.12 }) }} transition={tx({ type: 'spring', duration: 0.3, bounce: 0.2 })}>
              <Icon name="settings" size={13} /> {t({ en: 'Fine · 1% per 6px', he: 'עדין · 1% לכל 6px' })}
            </motion.span>
          )}
        </AnimatePresence>
      </div>
      <motion.div ref={ref} animate={{ scale: fine ? 1.06 : 1, boxShadow: fine ? '0 8px 24px -8px rgba(0,0,0,0.35)' : '0 0 0 0 rgba(0,0,0,0)' }} transition={tx({ type: 'spring', duration: 0.32, bounce: 0.15 })}
        onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}
        style={{ position: 'relative', height: 56, borderRadius: 16, background: 'var(--surface-3)', overflow: 'hidden', touchAction: 'none', cursor: 'ew-resize', userSelect: 'none', WebkitUserSelect: 'none' }}>
        <div style={{ position: 'absolute', insetBlock: 0, insetInlineStart: 0, width: `${pct}%`, background: 'var(--accent)', transition: mode === 'idle' ? `width calc(0.2s * var(--lab-speed,1)) ${cssEase('out')}` : 'none' }} />
        {fine && Array.from({ length: 101 }).map((_, i) => i % 5 === 0 && (
          <span key={i} style={{ position: 'absolute', insetInlineStart: `${i}%`, bottom: 0, width: 1, height: i % 10 === 0 ? 8 : 5, background: i <= pct ? 'rgba(255,255,255,0.55)' : 'var(--line-3)' }} />
        ))}
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', paddingInline: 16, color: pct > 30 ? 'var(--on-accent)' : 'var(--ink)', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{pct}%</div>
      </motion.div>
      <div style={{ height: 40, display: 'grid', placeItems: 'center' }}>
        <motion.span className="zl-caption zl-mute" animate={{ opacity: mode === 'coarse' ? 1 : 0, y: mode === 'coarse' ? 0 : -4 }} transition={tx({ duration: 0.2 })}>↓ {t({ en: 'drag down for fine control', he: 'גרור למטה לכוונון עדין' })}</motion.span>
      </div>
      <p className="zl-footnote zl-mute">Drag sideways to get near. Still holding, drag down: the bar zooms and every 6px is 1%. Let go to commit.</p>
    </div>
  )
}

/* ───────────────────────── 4. TEMPERATURE ───────────────────────── */

function RollingDigit({ value, tx, dur }) {
  // each digit rolls vertically to its new value (odometer)
  return (
    <span style={{ display: 'inline-block', position: 'relative', height: '1em', width: '0.62em', overflow: 'hidden', verticalAlign: 'top' }}>
      <motion.span animate={{ y: `-${value}em` }} transition={tx({ type: 'spring', duration: dur, bounce: 0.1 })} style={{ display: 'block' }}>
        {Array.from({ length: 10 }).map((_, i) => <span key={i} style={{ display: 'block', height: '1em', lineHeight: '1em', textAlign: 'center' }}>{i}</span>)}
      </motion.span>
    </span>
  )
}

function TempFrame({ value, children, hint }) {
  const t = useT()
  return (
    <div className="zl" style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 14 }}>
      <div className="zl-footnote zl-mute">{t({ en: 'Living Room AC · Cooling', he: 'מזגן סלון · קירור' })}</div>
      {children}
      <p className="zl-footnote zl-mute" style={{ textAlign: 'center', maxWidth: 260 }}>{hint}</p>
    </div>
  )
}

function Stepper({ value, onChange, min = 16, max = 30 }) {
  const h = useHaptic()
  return (
    <div className="zl-hstack" style={{ gap: 16 }}>
      <motion.button whileTap={{ scale: 0.92 }} className="zl-btn zl-btn--icon" style={{ borderRadius: 999, width: 52, height: 52 }} onClick={() => { if (value > min) { onChange(value - 1); h('selection') } }}>−</motion.button>
      <motion.button whileTap={{ scale: 0.92 }} className="zl-btn zl-btn--icon" style={{ borderRadius: 999, width: 52, height: 52 }} onClick={() => { if (value < max) { onChange(value + 1); h('selection') } }}>+</motion.button>
    </div>
  )
}

function TempA({ knobs, tx }) {
  const [v, setV] = useState(24)
  const d = String(v).split('')
  return (
    <TempFrame hint="Digits roll like an odometer. Direction tells you up or down.">
      <div className="zl-large zl-mono" style={{ fontSize: 72, lineHeight: 1, display: 'flex', alignItems: 'flex-start' }}>
        {d.map((c, i) => <RollingDigit key={i} value={Number(c)} tx={tx} dur={knobs.duration} />)}
        <span className="zl-title2 zl-mute" style={{ marginTop: 6 }}>°</span>
      </div>
      <Stepper value={v} onChange={setV} />
    </TempFrame>
  )
}

function TempB({ knobs, tx }) {
  // interpolate the number with a spring; show the .5 steps flow through
  const [v, setV] = useState(24)
  const mv = useSpring(24, tx({ stiffness: 170, damping: 22 }))
  useEffect(() => { mv.set(v) }, [v, mv])
  const text = useTransform(mv, (x) => x.toFixed(1))
  return (
    <TempFrame hint="The value glides through the in-between numbers. It reads as a dial turning, not a label swapping.">
      <div className="zl-large zl-mono" style={{ fontSize: 72, lineHeight: 1 }}><motion.span>{text}</motion.span><span className="zl-title2 zl-mute">°</span></div>
      <Stepper value={v} onChange={setV} />
    </TempFrame>
  )
}

function TempC({ knobs, tx }) {
  // arc gauge: target arc animates; current temperature needle drifts toward it
  const [target, setTarget] = useState(24)
  const current = 26.4
  const toAngle = (t) => -120 + ((t - 16) / 14) * 240
  const targetAngle = useSpring(toAngle(24), tx({ stiffness: 120, damping: 18 }))
  useEffect(() => { targetAngle.set(toAngle(target)) }, [target, targetAngle])
  const arcLen = useTransform(targetAngle, (a) => ((a + 120) / 240) * 502)
  const dash = useTransform(arcLen, (l) => `${l} 502`)
  const needle = toAngle(current)
  return (
    <TempFrame hint="The orange arc is the target you set; the tick is the room now. The gap between them is the work the AC has left.">
      <div style={{ position: 'relative', width: 240, height: 200 }}>
        <svg width="240" height="200" viewBox="0 0 240 200">
          <path d="M 40 170 A 96 96 0 1 1 200 170" fill="none" stroke="var(--surface-3)" strokeWidth="14" strokeLinecap="round" pathLength="502" />
          <motion.path d="M 40 170 A 96 96 0 1 1 200 170" fill="none" stroke="var(--accent)" strokeWidth="14" strokeLinecap="round" pathLength="502" style={{ strokeDasharray: dash }} />
          <g transform={`rotate(${needle} 120 120)`}><rect x="117" y="18" width="6" height="18" rx="3" fill="var(--ink)" /></g>
        </svg>
        <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', paddingTop: 30 }}>
          <div style={{ textAlign: 'center' }}>
            <div className="zl-large zl-mono" style={{ fontSize: 56, lineHeight: 1 }}>{target}°</div>
            <div className="zl-footnote zl-mute zl-mono">now {current}°</div>
          </div>
        </div>
      </div>
      <Stepper value={target} onChange={setTarget} />
    </TempFrame>
  )
}

function TempD({ knobs, tx }) {
  // drag a rail with ticks; snaps to integers, a haptic per degree
  const h = useHaptic()
  const [v, setV] = useState(24)
  const x = useMotionValue(0)
  const STEP = 36
  const ref = useRef(null)
  const lastV = useRef(24)
  return (
    <TempFrame hint="Drag the rail. It snaps to whole degrees with a tick; a flick carries it further.">
      <div className="zl-large zl-mono" style={{ fontSize: 72, lineHeight: 1 }}>{v}<span className="zl-title2 zl-mute">°</span></div>
      <div ref={ref} style={{ position: 'relative', width: 300, height: 80, overflow: 'hidden', maskImage: 'linear-gradient(to right, transparent, black 20%, black 80%, transparent)', WebkitMaskImage: 'linear-gradient(to right, transparent, black 20%, black 80%, transparent)' }}>
        <div style={{ position: 'absolute', left: '50%', top: 8, width: 3, height: 40, marginLeft: -1.5, background: 'var(--accent)', borderRadius: 2, zIndex: 2 }} />
        <motion.div drag="x" dragMomentum dragTransition={{ power: 0.2, timeConstant: 120, modifyTarget: (t) => Math.round(t / STEP) * STEP }}
          dragConstraints={{ left: -(30 - 24) * STEP, right: (24 - 16) * STEP }}
          style={{ x, position: 'absolute', left: '50%', top: 0, display: 'flex', touchAction: 'pan-y', cursor: 'grab' }}
          onUpdate={(l) => { const n = Math.round(24 - l.x / STEP); if (n !== lastV.current && n >= 16 && n <= 30) { lastV.current = n; setV(n); h('selection') } }}>
          {Array.from({ length: 15 }).map((_, i) => (
            <div key={i} style={{ width: STEP, marginLeft: i === 0 ? -(24 - 16) * STEP - STEP / 2 : 0, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, paddingTop: 12 }}>
              <span style={{ width: 2, height: 24, background: 'var(--line-3)', borderRadius: 1 }} />
              <span className="zl-caption zl-mono zl-mute">{16 + i}</span>
            </div>
          ))}
        </motion.div>
      </div>
    </TempFrame>
  )
}

function TempE({ knobs, tx }) {
  // Thermometer column: the target is a fluid level. Each step springs the
  // level (bounce .3) and the meniscus wobbles; the fluid tints blue below 21°,
  // orange above 25°, green in the comfort band. The number rolls.
  const t = useT()
  const [v, setV] = useState(24)
  const level = ((v - 16) / 14) * 100
  const colour = v < 21 ? 'var(--info)' : v > 25 ? 'var(--accent)' : 'var(--ok)'
  const d = String(v).split('')
  return (
    <TempFrame hint="Step the target. The column springs to the new level with a wobble at the top; the fluid's colour says what the number means.">
      <div style={{ display: 'flex', alignItems: 'center', gap: 28 }}>
        <div style={{ position: 'relative', height: 220, display: 'flex', gap: 8 }}>
          <div style={{ position: 'relative', width: 56, height: 220, borderRadius: 28, background: 'var(--surface-3)', overflow: 'hidden', border: '1px solid var(--line)' }}>
            <motion.div animate={{ height: `${level}%`, backgroundColor: colour }}
              transition={{ height: tx({ type: 'spring', duration: knobs.duration + 0.2, bounce: 0.3 }), backgroundColor: tx({ duration: 0.3, ease: EASE.out }) }}
              style={{ position: 'absolute', left: 0, right: 0, bottom: 0 }}>
              <motion.div key={v} animate={{ scaleY: [1, 1.3, 1] }} transition={tx({ duration: 0.38, times: [0, 0.4, 1], ease: EASE.out })}
                style={{ position: 'absolute', top: -7, left: 0, right: 0, height: 14, borderRadius: '50%', background: 'inherit', transformOrigin: 'center bottom', filter: 'brightness(1.15)' }} />
              <span style={{ position: 'absolute', top: 8, left: 10, width: 6, height: 'calc(100% - 16px)', borderRadius: 3, background: 'rgba(255,255,255,0.28)' }} />
            </motion.div>
          </div>
          <div style={{ position: 'relative', width: 26, height: 220 }}>
            {Array.from({ length: 15 }).map((_, i) => {
              const deg = 30 - i
              const major = deg % 7 === 2 || deg === 16 || deg === 30
              return (
                <div key={deg} style={{ position: 'absolute', top: `${(i / 14) * 100}%`, left: 0, transform: 'translateY(-50%)', display: 'flex', alignItems: 'center', gap: 4 }}>
                  <span style={{ width: major ? 8 : 4, height: 1.5, background: deg <= v ? 'var(--ink-2)' : 'var(--line-2)', display: 'block', transition: 'background calc(200ms * var(--lab-speed,1))' }} />
                  {major && <span className="zl-caption zl-mono zl-mute">{deg}</span>}
                </div>
              )
            })}
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 18 }}>
          <div className="zl-large zl-mono" style={{ fontSize: 64, lineHeight: 1, display: 'flex', alignItems: 'flex-start' }}>
            {d.map((c, i) => <RollingDigit key={i} value={Number(c)} tx={tx} dur={knobs.duration} />)}
            <span className="zl-title2 zl-mute" style={{ marginTop: 6 }}>°</span>
          </div>
          <motion.span className="zl-caption" animate={{ color: colour }} transition={tx({ duration: 0.3 })}>
            {v < 21 ? t({ en: 'Cold', he: 'קר' }) : v > 25 ? t({ en: 'Warm', he: 'חם' }) : t({ en: 'Comfort', he: 'נוח' })}
          </motion.span>
          <Stepper value={v} onChange={setV} />
        </div>
      </div>
    </TempFrame>
  )
}

function TempF({ knobs, tx }) {
  // Flick the digits: the big number IS the control. A vertical drag surface
  // with momentum that settles on a whole degree; a tick per degree passed.
  const h = useHaptic(); const t = useT()
  const [v, setV] = useState(24)
  const [used, setUsed] = useState(false)
  const STEP = 84
  const y = useMotionValue(-(24 - 16) * STEP)
  const lastV = useRef(24)
  const vals = Array.from({ length: 15 }, (_, i) => 16 + i)
  return (
    <TempFrame hint="Flick the number up or down. It carries with momentum and settles on a whole degree; a tick per degree. The hint fades once you have used it.">
      <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
        <div style={{ position: 'relative', height: STEP * 3, width: 200, overflow: 'hidden', maskImage: 'linear-gradient(to bottom, transparent, black 32%, black 68%, transparent)', WebkitMaskImage: 'linear-gradient(to bottom, transparent, black 32%, black 68%, transparent)' }}>
          <motion.div drag="y" dragMomentum dragTransition={{ power: 0.3, timeConstant: 150, modifyTarget: (target) => Math.round(target / STEP) * STEP }}
            dragConstraints={{ top: -(30 - 16) * STEP, bottom: 0 }} dragElastic={0.06}
            onDragStart={() => setUsed(true)}
            onUpdate={(l) => { const n = Math.round(16 - l.y / STEP); if (n !== lastV.current && n >= 16 && n <= 30) { lastV.current = n; setV(n); h('selection') } }}
            style={{ y, position: 'absolute', left: 0, right: 0, top: STEP, touchAction: 'pan-x', cursor: 'grab' }}>
            {vals.map(n => (
              <div key={n} className="zl-large zl-mono" style={{ height: STEP, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <span style={{ fontSize: 72, lineHeight: 1, opacity: n === v ? 1 : 0.22, transform: n === v ? 'scale(1)' : 'scale(0.78)', transition: 'opacity calc(160ms * var(--lab-speed,1)), transform calc(160ms * var(--lab-speed,1))' }}>{n}<span className="zl-title2 zl-mute">°</span></span>
              </div>
            ))}
          </motion.div>
        </div>
        <motion.div animate={{ opacity: used ? 0 : 1, x: used ? 6 : 0 }} transition={tx({ duration: 0.4, ease: EASE.out })} style={{ display: 'flex', flexDirection: 'column', gap: 26, color: 'var(--ink-mute)', pointerEvents: 'none' }}>
          <span className="zl-caption" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}><span>▲</span>{t({ en: 'warmer', he: 'חם יותר' })}</span>
          <span className="zl-caption" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>{t({ en: 'cooler', he: 'קר יותר' })}<span>▼</span></span>
        </motion.div>
      </div>
    </TempFrame>
  )
}

/* ───────────────────────── 5. MODE SEGMENT ───────────────────────── */

const MODES = [
  { key: 'cool', icon: 'snowflake', label: { en: 'Cool', he: 'קירור' } },
  { key: 'heat', icon: 'flame', label: { en: 'Heat', he: 'חימום' } },
  { key: 'fan', icon: 'fan', label: { en: 'Fan', he: 'מאוורר' } },
  { key: 'dry', icon: 'droplets', label: { en: 'Dry', he: 'ייבוש' } },
]
const MODE_COLOR = { cool: 'var(--info)', heat: 'var(--accent)', fan: 'var(--ink)', dry: 'var(--ink)' }

function SegFrame({ children, hint }) {
  const t = useT()
  return (
    <div className="zl" style={{ padding: 16, paddingTop: 48, display: 'flex', flexDirection: 'column', gap: 16, alignItems: 'center' }}>
      <div className="zl-title3">{t({ en: 'Living Room AC', he: 'מזגן סלון' })}</div>
      {children}
      <p className="zl-footnote zl-mute" style={{ textAlign: 'center', maxWidth: 280 }}>{hint}</p>
    </div>
  )
}

function SegA({ knobs, tx }) {
  const t = useT(); const h = useHaptic()
  const [mode, setMode] = useState('cool')
  return (
    <SegFrame hint="One pill slides between options (layoutId). The pill is the same object throughout, so the eye tracks it.">
      <LayoutGroup id="seg-a">
        <div style={{ display: 'flex', background: 'var(--surface-2)', border: '1px solid var(--line)', borderRadius: 999, padding: 4, width: 320 }}>
          {MODES.map(m => (
            <button key={m.key} onClick={() => { setMode(m.key); h('selection') }} style={{ position: 'relative', flex: 1, height: 40, border: 0, background: 'transparent', borderRadius: 999, cursor: 'pointer', color: mode === m.key ? 'var(--on-accent)' : 'var(--ink-mute)', fontWeight: 600, fontSize: 14, transition: 'color 160ms' }}>
              {mode === m.key && <motion.span layoutId="seg-pill" transition={tx({ type: 'spring', duration: knobs.duration, bounce: knobs.bounce })} style={{ position: 'absolute', inset: 0, borderRadius: 999, background: 'var(--accent)' }} />}
              <span style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', gap: 6 }}><Icon name={m.icon} size={16} />{t(m.label)}</span>
            </button>
          ))}
        </div>
      </LayoutGroup>
    </SegFrame>
  )
}

function SegB({ knobs, tx }) {
  // Emil's clip-path tabs: a duplicate "active" layer clipped to the selected item, so text colour crossfades perfectly with the pill.
  const t = useT(); const h = useHaptic()
  const [idx, setIdx] = useState(0)
  const n = MODES.length
  const clip = `inset(0 ${((n - 1 - idx) / n) * 100}% 0 ${(idx / n) * 100}% round 999px)`
  const row = (active) => (
    <div style={{ display: 'flex', width: '100%', height: '100%' }}>
      {MODES.map((m, i) => (
        <button key={m.key} onClick={() => { setIdx(i); h('selection') }} tabIndex={active ? -1 : 0} style={{ flex: 1, height: 40, border: 0, background: 'transparent', cursor: 'pointer', color: active ? 'var(--on-accent)' : 'var(--ink-mute)', fontWeight: 600, fontSize: 14, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
          <Icon name={m.icon} size={16} />{t(m.label)}
        </button>
      ))}
    </div>
  )
  return (
    <SegFrame hint="Two identical rows; the orange one is clipped to the active item and the clip slides. Colour transitions are exact because nothing is interpolating colour.">
      <div style={{ position: 'relative', width: 320, height: 48, background: 'var(--surface-2)', border: '1px solid var(--line)', borderRadius: 999, padding: 4 }}>
        {row(false)}
        <div style={{ position: 'absolute', inset: 4, background: 'var(--accent)', borderRadius: 999, clipPath: clip, transition: `clip-path calc(${knobs.duration}s * var(--lab-speed,1)) ${cssEase(knobs.ease)}` }}>
          {row(true)}
        </div>
      </div>
    </SegFrame>
  )
}

function SegC({ knobs, tx }) {
  // the mode ICON morphs: one big glyph crossfades with a rotate/scale so it reads as the same object changing role
  const t = useT(); const h = useHaptic()
  const [mode, setMode] = useState('cool')
  const m = MODES.find(x => x.key === mode)
  return (
    <SegFrame hint="The hero icon turns into the next mode's icon (scale + rotate + 2px blur crossfade), while the chips below just re-colour.">
      <div style={{ position: 'relative', width: 96, height: 96, display: 'grid', placeItems: 'center' }}>
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.div key={mode} initial={{ opacity: 0, scale: 0.6, rotate: -40, filter: 'blur(3px)' }} animate={{ opacity: 1, scale: 1, rotate: 0, filter: 'blur(0px)' }} exit={{ opacity: 0, scale: 0.6, rotate: 40, filter: 'blur(3px)' }}
            transition={tx({ type: 'spring', duration: knobs.duration, bounce: knobs.bounce })}
            style={{ position: 'absolute', color: mode === 'cool' ? 'var(--info)' : mode === 'heat' ? 'var(--accent)' : 'var(--ink-2)' }}>
            <Icon name={m.icon} size={64} strokeWidth={1.6} />
          </motion.div>
        </AnimatePresence>
      </div>
      <div className="zl-hstack">
        {MODES.map(x => <button key={x.key} className="zl-chip" data-on={mode === x.key ? 'true' : 'false'} onClick={() => { setMode(x.key); h('selection') }} style={{ cursor: 'pointer', transition: 'background 160ms, color 160ms' }}>{t(x.label)}</button>)}
      </div>
    </SegFrame>
  )
}

function SegD({ knobs, tx, rtl }) {
  // Restraint: nothing moves except a 2px underline that WRITES itself from the
  // side nearest the old chip, while the old one retracts toward the new. The
  // new chip's icon tints to its mode colour. No pill, no scale, no blur.
  const t = useT(); const h = useHaptic()
  const [idx, setIdx] = useState(0)
  const prev = useRef(0)
  const W = 320, cw = W / MODES.length, PAD = 12
  const left = (i) => (rtl ? W - (i + 1) * cw : i * cw)
  const pick = (i) => { if (i === idx) return; prev.current = idx; setIdx(i); h('selection') }
  const from = prev.current
  // draw from the edge nearest the previous chip toward the far edge
  const nearOld = left(from) < left(idx)
  const x1 = nearOld ? left(idx) + PAD : left(idx) + cw - PAD
  const x2 = nearOld ? left(idx) + cw - PAD : left(idx) + PAD
  return (
    <SegFrame hint="Tap a mode. Only the underline moves: it writes itself toward the new chip while the old one retracts. The icon tints. Everything else stays still.">
      <div style={{ width: W }}>
        <div style={{ display: 'flex', width: W }}>
          {MODES.map((m, i) => {
            const active = i === idx
            return (
              <button key={m.key} onClick={() => pick(i)} style={{ flex: 1, height: 44, border: 0, background: 'transparent', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6, fontWeight: 600, fontSize: 14, color: active ? 'var(--ink)' : 'var(--ink-mute)', transition: 'color calc(200ms * var(--lab-speed,1))' }}>
                <span style={{ display: 'grid', color: active ? MODE_COLOR[m.key] : 'var(--ink-mute)', transition: 'color calc(240ms * var(--lab-speed,1))' }}><Icon name={m.icon} size={16} /></span>
                {t(m.label)}
              </button>
            )
          })}
        </div>
        <svg width={W} height={4} style={{ display: 'block' }}>
          <line x1={0} x2={W} y1={3} y2={3} stroke="var(--line)" strokeWidth={1} />
          <AnimatePresence initial={false} custom={idx}>
            <motion.line key={idx} x1={x1} x2={x2} y1={2} y2={2} stroke={MODE_COLOR[MODES[idx].key]} strokeWidth={2} strokeLinecap="round"
              initial={{ pathLength: 0, pathOffset: 0 }} animate={{ pathLength: 1, pathOffset: 0 }}
              variants={{ out: (next) => {
                // retract toward the NEW chip: keep the end that faces it
                const towardX2 = Math.abs(left(next) - x2) < Math.abs(left(next) - x1)
                return { pathLength: 0, pathOffset: towardX2 ? 1 : 0, transition: tx({ duration: knobs.duration * 0.6, ease: EASE.out }) }
              } }}
              exit="out"
              transition={tx({ duration: knobs.duration, ease: EASE.out })} />
          </AnimatePresence>
        </svg>
      </div>
    </SegFrame>
  )
}

/* ───────────────────────── 6. HOLD TO DELETE ───────────────────────── */

function HoldCard({ style, children }) {
  const t = useT()
  return (
    <motion.div className="zl-card zl-card--pad" style={{ width: '100%', ...style }}>
      <div className="zl-row__title">{t({ en: 'Balcony light at sunset', he: 'אור מרפסת בשקיעה' })}</div>
      <div className="zl-row__sub">{t({ en: 'Automation · ran yesterday', he: 'אוטומציה · רץ אתמול' })}</div>
      {children}
    </motion.div>
  )
}

function HoldDeleteA({ knobs, tx }) {
  const t = useT(); const h = useHaptic()
  const [state, setState] = useState('idle') // idle | holding | deleted
  const timer = useRef(null)
  const start = () => { if (state === 'deleted') return; setState('holding'); timer.current = setTimeout(() => { setState('deleted'); h('success') }, knobs.hold * 1000 / 1) }
  const stop = () => { if (state === 'holding') { clearTimeout(timer.current); setState('idle') } }
  return (
    <div className="zl" style={{ padding: 16, paddingTop: 40, display: 'flex', flexDirection: 'column', gap: 16, alignItems: 'center' }}>
      <HoldCard />
      <AnimatePresence mode="wait">
        {state !== 'deleted' ? (
          <motion.button key="btn" exit={{ opacity: 0, scale: 0.96 }} transition={tx({ duration: 0.16 })}
            onPointerDown={start} onPointerUp={stop} onPointerLeave={stop} onPointerCancel={stop}
            style={{ position: 'relative', overflow: 'hidden', height: 48, padding: '0 22px', borderRadius: 12, border: '1px solid var(--err)', background: 'var(--surface)', color: 'var(--err-text)', fontWeight: 600, fontSize: 15, cursor: 'pointer', touchAction: 'none', transform: state === 'holding' ? 'scale(0.97)' : 'scale(1)', transition: 'transform 160ms cubic-bezier(0.23,1,0.32,1)' }}>
            <span style={{ position: 'absolute', inset: 0, background: 'var(--err)', clipPath: state === 'holding' ? 'inset(0 0 0 0)' : 'inset(0 100% 0 0)', transition: state === 'holding' ? `clip-path calc(${knobs.hold}s * var(--lab-speed,1)) linear` : `clip-path calc(0.2s * var(--lab-speed,1)) ${cssEase('out')}` }} />
            <span style={{ position: 'relative', mixBlendMode: state === 'holding' ? 'normal' : undefined }}>{t({ en: 'Hold to delete', he: 'החזק למחיקה' })}</span>
          </motion.button>
        ) : (
          <motion.div key="done" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={tx({ duration: 0.2, ease: EASE.out })} className="zl-hstack" style={{ color: 'var(--ink-mute)' }}>
            <Icon name="check" size={18} /> {t({ en: 'Deleted', he: 'נמחק' })} · <button className="zl-btn zl-btn--ghost" style={{ height: 32 }} onClick={() => setState('idle')}>{t(COPY.undo)}</button>
          </motion.div>
        )}
      </AnimatePresence>
      <p className="zl-footnote zl-mute" style={{ textAlign: 'center', maxWidth: 280 }}>Slow where the user is deciding (linear fill), fast where the system responds (200ms snap-back).</p>
    </div>
  )
}

function HoldDeleteB({ knobs, tx }) {
  // Shrink into the button: the card is the thing at stake, so it reacts to the
  // hold — shrinking and sinking toward the button as it fills. Release early and
  // it springs back; complete and it collapses into the button, which becomes Undo.
  const t = useT(); const h = useHaptic()
  const [state, setState] = useState('idle') // idle | holding | deleted
  const progress = useMotionValue(0)
  const done = useMotionValue(0)
  const scale = useTransform([progress, done], ([p, d]) => 1 - 0.1 * p - 0.3 * d)
  const opacity = useTransform([progress, done], ([p, d]) => (1 - 0.4 * p) * (1 - d))
  const y = useTransform([progress, done], ([p, d]) => 28 * p + 64 * d)
  const fillW = useTransform(progress, p => `${p * 100}%`)
  const ctrl = useRef(null)
  const start = () => {
    if (state !== 'idle') return
    setState('holding')
    ctrl.current = animate(progress, 1, { duration: knobs.hold, ease: 'linear', onComplete: () => { setState('deleted'); h('success'); animate(done, 1, tx({ duration: 0.26, ease: EASE.out })) } })
  }
  const stop = () => {
    if (state !== 'holding') return
    ctrl.current?.stop(); setState('idle')
    animate(progress, 0, tx({ type: 'spring', duration: 0.45, bounce: 0.28 }))
  }
  const undo = () => { setState('idle'); progress.set(0); animate(done, 0, tx({ type: 'spring', duration: 0.5, bounce: 0.2 })) }
  return (
    <div className="zl" style={{ padding: 16, paddingTop: 40, display: 'flex', flexDirection: 'column', gap: 16, alignItems: 'center' }}>
      <HoldCard style={{ scale, opacity, y, transformOrigin: 'center bottom' }} />
      <motion.button onPointerDown={start} onPointerUp={stop} onPointerLeave={stop} onPointerCancel={stop} onClick={state === 'deleted' ? undo : undefined}
        animate={{ scale: state === 'holding' ? 0.97 : 1, backgroundColor: state === 'deleted' ? 'var(--ink)' : 'var(--surface)', color: state === 'deleted' ? 'var(--bg)' : 'var(--err-text)', borderColor: state === 'deleted' ? 'var(--ink)' : 'var(--err)' }}
        transition={tx({ duration: 0.16, ease: EASE.out })}
        style={{ position: 'relative', overflow: 'hidden', height: 48, width: 220, padding: 0, borderRadius: 12, border: '1px solid', fontWeight: 600, fontSize: 15, cursor: 'pointer', touchAction: 'none', zIndex: 1, userSelect: 'none', WebkitUserSelect: 'none' }}>
        <span style={{ position: 'relative', display: 'grid', placeItems: 'center', height: '100%' }}>
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.span key={state === 'deleted' ? 'done' : 'hold'} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={tx({ duration: 0.16, ease: EASE.out })} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' }}>
              {state === 'deleted' ? <><Icon name="check" size={16} /> {t({ en: 'Deleted · Undo', he: 'נמחק · ביטול' })}</> : t({ en: 'Hold to delete', he: 'החזק למחיקה' })}
            </motion.span>
          </AnimatePresence>
        </span>
        {/* the fill sits ABOVE the base label and carries a white copy of it, clipped to its own width:
            the text is revealed exactly as the red advances (SegB's clip-path twin, no blend modes) */}
        <motion.span animate={{ opacity: state === 'deleted' ? 0 : 1 }} transition={tx({ duration: 0.16 })}
          style={{ position: 'absolute', insetBlock: 0, insetInlineStart: 0, width: fillW, background: 'var(--err)', overflow: 'hidden', zIndex: 1, pointerEvents: 'none' }}>
          <span style={{ position: 'absolute', insetBlock: 0, insetInlineStart: 0, width: 218, display: 'grid', placeItems: 'center', color: '#fff', whiteSpace: 'nowrap' }}>{t({ en: 'Hold to delete', he: 'החזק למחיקה' })}</span>
        </motion.span>
      </motion.button>
      <p className="zl-footnote zl-mute" style={{ textAlign: 'center', maxWidth: 280 }}>Hold. The card sinks and shrinks toward the button as it fills; let go early and it springs back. Complete: it collapses into the button.</p>
    </div>
  )
}

function HoldDeleteC({ knobs, tx, rtl }) {
  // Slide to remove: the confirmation is a distance, not a duration. Drag the
  // red knob to the end (92%) to confirm; release early and it springs back.
  const t = useT(); const h = useHaptic()
  const [state, setState] = useState('idle') // idle | deleted
  const trackRef = useRef(null)
  const [max, setMax] = useState(240)
  useEffect(() => { if (trackRef.current) setMax(trackRef.current.getBoundingClientRect().width - 44 - 8) }, [])
  const sign = rtl ? -1 : 1
  const x = useMotionValue(0)
  const prog = useTransform(x, v => clamp((v * sign) / max, 0, 1))
  const labelOp = useTransform(prog, [0, 0.45], [1, 0])
  const trail = useTransform(prog, p => `${p * 100}%`)
  const settle = (to) => animate(x, to, tx({ type: 'spring', duration: to ? 0.25 : 0.42, bounce: to ? 0 : 0.2 }))
  return (
    <div className="zl" style={{ padding: 16, paddingTop: 40, display: 'flex', flexDirection: 'column', gap: 16, alignItems: 'center' }}>
      <AnimatePresence initial={false}>
        {state !== 'deleted' && (
          <motion.div key="card" style={{ width: '100%', overflow: 'hidden' }} exit={{ height: 0, opacity: 0, scale: 0.96, marginBottom: -16 }} transition={tx({ duration: 0.28, ease: EASE.out })}>
            <HoldCard />
          </motion.div>
        )}
      </AnimatePresence>
      <div ref={trackRef} style={{ position: 'relative', width: '100%', height: 52, borderRadius: 26, background: 'color-mix(in srgb, var(--err) 10%, var(--surface))', border: '1px solid color-mix(in srgb, var(--err) 40%, transparent)', overflow: 'hidden' }}>
        <motion.div style={{ position: 'absolute', insetBlock: 0, insetInlineStart: 0, width: trail, background: 'color-mix(in srgb, var(--err) 28%, transparent)' }} />
        <motion.span style={{ opacity: labelOp, position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, color: 'var(--err-text)', fontWeight: 600, fontSize: 15, pointerEvents: 'none' }}>
          {state === 'deleted' ? null : <>{t({ en: 'Slide to remove', he: 'החלק להסרה' })} <Icon name={rtl ? 'chevron-left' : 'chevron-right'} size={16} /></>}
        </motion.span>
        {state === 'deleted' && (
          <motion.span initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={tx({ duration: 0.2, delay: 0.1 })} style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, color: 'var(--err-text)', fontWeight: 600, fontSize: 15 }}>
            <Icon name="check" size={16} /> {t({ en: 'Removed', he: 'הוסר' })} · <button className="zl-btn zl-btn--ghost" style={{ height: 32, padding: '0 8px' }} onClick={() => { setState('idle'); settle(0) }}>{t(COPY.undo)}</button>
          </motion.span>
        )}
        <motion.div drag={state === 'idle' ? 'x' : false} dragConstraints={{ left: rtl ? -max : 0, right: rtl ? 0 : max }} dragElastic={0} dragMomentum={false}
          onDragEnd={() => {
            if (prog.get() >= 0.92) { h('heavy'); setState('deleted'); settle(max * sign) }
            else settle(0)
          }}
          animate={{ opacity: state === 'deleted' ? 0 : 1, scale: state === 'deleted' ? 0.6 : 1 }} transition={tx({ duration: 0.2, ease: EASE.out })}
          style={{ x, position: 'absolute', top: 3, insetInlineStart: 3, width: 44, height: 44, borderRadius: 999, background: 'var(--err)', color: '#fff', display: 'grid', placeItems: 'center', touchAction: 'pan-y', cursor: 'grab', boxShadow: 'var(--shadow-sm)' }}>
          <Icon name={rtl ? 'arrow-left' : 'arrow-right'} size={20} />
        </motion.div>
      </div>
      <p className="zl-footnote zl-mute" style={{ textAlign: 'center', maxWidth: 280 }}>Drag the knob to the end. Past 92% it commits and the card folds away; let go earlier and it springs back. The label fades as you commit.</p>
    </div>
  )
}

/* ───────────────────────── SECTION ───────────────────────── */

export default function Controls() {
  return (
    <>
      <SectionIntro
        title="Controls"
        lede="A control has three moments: it heard you, the value is moving, the hub confirmed. Most of Ziggy's controls only show the first (press scale) and the last (re-render). These prototypes give the middle moment a body."
        found={[
          'Toggle and slider are Radix; state arrives via a 200ms colour transition (controls.css). Nothing shows the thumb\'s travel as a physical object.',
          'Power buttons have the "ignition" grammar (220ms on / 160ms off, 6% icon overshoot) — kept here as variant B for comparison.',
          'Scrub-to-dim exists on tiles (gestures.js useScrub) with a 5% haptic tick; it has no visual of the value while scrubbing beyond the fill.',
          'The AC target temperature is a stepper; the number is swapped, never interpolated.',
          'No hold-to-confirm anywhere; destructive actions use a dialog.',
        ]}
      />

      <Demo id="toggle" title="Toggle switch" purpose="A switch is a physical object with travel. Show the travel, then let the circuit close." principles={['physical', 'causality', 'state']} inZiggy={['components/ui/Toggle.jsx', 'motion/controls.css', 'DeviceControls.jsx']}
        knobs={[
          { key: 'duration', label: 'Duration', min: 0.12, max: 0.8, step: 0.02, value: 0.3, unit: 'ms' },
          { key: 'bounce', label: 'Bounce', min: 0, max: 0.5, step: 0.02, value: 0.18 },
          { key: 'ease', label: 'Ease (A)', type: 'ease', value: 'out' },
        ]}
        recommend="E"
        variants={[
          { key: 'A', label: 'Linear slide (today)', note: 'Thumb and track change together with one ease-out. Correct, forgettable.', render: (p) => <ToggleA {...p} /> },
          { key: 'B', label: 'Spring + squash', note: 'The thumb stretches in its direction of travel and settles with a small bounce. Reads as mass.', tradeoff: 'Bounce above ~0.25 starts to feel like a toy.', render: (p) => <ToggleB {...p} /> },
          { key: 'C', label: 'Thumb first, then circuit', note: 'Track colour waits for the thumb to arrive, then sweeps in from the thumb\'s side. Off is immediate. Causality: the thumb closes the circuit.', tradeoff: 'The colour waits ~165ms; on the most frequent control in the app that pause is a cost.', render: (p) => <ToggleC {...p} /> },
          { key: 'D', label: 'Draggable', note: 'Follow the finger. Commit by position or a 200px/s flick. Tap still works. Colour tracks the thumb continuously, and a selection tick fires as it crosses the middle.', tradeoff: 'Needs pointer capture and a scroll-lock decision on lists.', spec: (k) => `drag · tick at 8px · release spring ${Math.round(k.duration * 1000)} ms bounce ${k.bounce.toFixed(2)}`, render: (p) => <ToggleD {...p} /> },
          { key: 'E', label: 'Fill from the thumb', note: 'Recommended. The green is a circle clipped to the thumb\'s live position, growing as it travels: the colour is visibly poured by the thumb, and drained back into it on off. Cause and effect in one object, with no wait (unlike C) and no bounce to tune (unlike B). 320 ms on, 240 ms off, one clip-path, off the main thread.', spec: () => 'clip-path circle(r at thumb) · on 320 ms r 0→36 · off 240 ms · ease-out', render: (p) => <ToggleE {...p} /> },
          { key: 'F', label: 'Magnetic detent', note: 'Draggable with a hump: in the middle 30% of travel the thumb moves at 0.4× the finger, then snaps over with a medium haptic. Release inside the hump and it springs back to the nearer side. A real switch has a hump; this one does too.', tradeoff: 'The resistance zone is invisible until felt; on a phone without haptics it reads as lag.', spec: (k) => `zone 5.6–10.4 px @0.4× · snap spring 520/34 · release ${Math.round(k.duration * 1000)} ms bounce ${k.bounce.toFixed(2)}`, render: (p) => <ToggleF {...p} /> },
        ]} />

      <Demo id="power" title="Power button" purpose="The most frequent action in the app. It must answer in under 100ms and then show the state arriving." principles={['state', 'causality', 'physical']} inZiggy={['DeviceControls.jsx (power)', 'DeviceSheet.jsx', 'motion.css [data-on]']}
        knobs={[
          { key: 'overshoot', label: 'Icon overshoot (B)', min: 0, max: 0.2, step: 0.01, value: 0.0 },
          { key: 'duration', label: 'Ripple duration (C)', min: 0.15, max: 0.8, step: 0.02, value: 0.36, unit: 'ms' },
          { key: 'hold', label: 'Hold time (D)', min: 0.5, max: 2, step: 0.1, value: 1.0, unit: 's', digits: 1 },
        ]}
        recommend="C"
        variants={[
          { key: 'A', label: 'Press + fill', note: 'Scale 0.94 on press, colour on release. The baseline.', render: (p) => <PowerA {...p} /> },
          { key: 'B', label: 'Ignition (today)', note: 'The shipped grammar: on arrives with a ring leaving from the button\'s edge (scale 1 → 1.5, not from the centre, so it reads as the button radiating) and a small icon pop; off is faster and flat.', spec: () => 'on 220 ms · off 160 ms · ring 1→1.5 500 ms · ease-out', render: (p) => <PowerB {...p} /> },
          { key: 'C', label: 'Ripple from touch', note: 'Recommended. The on-state spreads from the exact point you touched (clip-path circle). Off contracts back to it, faster. The finger is the cause; it costs one clip-path and works for every device kind. E and F are for the AC sheet, not the tile grid.', render: (p) => <PowerC {...p} /> },
          { key: 'D', label: 'Hold to commit', note: 'For consequential actions ("everything off"): a linear progress ring while held, snap-back on release, success haptic at the end.', render: (p) => <PowerD {...p} /> },
          { key: 'E', label: 'Breathe in, glow out', note: 'While pressed the button slowly grows to 106% over 500 ms; on release it commits with a single glow pulse off its edge and the glyph\'s stroke thickens. The hold is felt; the release is the moment. Right for the AC, where power is a bigger decision than a bulb.', tradeoff: 'A 500 ms inhale on a quick tap is barely visible; the variant pays off only when people hold.', spec: () => 'press scale 1→1.06 500 ms ease-out · release spring 340 ms bounce .22 · glow 0→14 px 500 ms · stroke 2.2→3', render: (p) => <PowerE {...p} /> },
          { key: 'F', label: 'Knob click', note: 'The power glyph clicks a quarter turn on a bouncy spring (bounce .35) like a knob detent, while the fill slides in from the leading edge in 220 ms (leaves in 160 ms). Medium haptic. Physical, and distinct from every other button in the app.', tradeoff: 'Rotation on a glyph with a vertical stem reads as a knob; on other icons it would read as spinning.', spec: () => 'rotate 0→90° spring 500 ms bounce .35 · clip inset from leading edge 220 ms in / 160 ms out', render: (p) => <PowerF {...p} /> },
        ]} />

      <Demo id="brightness" title="Brightness" purpose="A continuous value under a finger. Never hide the number under the thumb; let the room show the effect." principles={['continuity', 'physical', 'hierarchy']} inZiggy={['components/ui/Slider.jsx', 'gestures.js useScrub', 'DeviceSheet.jsx']}
        knobs={[{ key: 'grow', label: 'Grow while held (A)', min: 0, max: 24, step: 1, value: 10, unit: 'px', digits: 0 }]}
        recommend="B"
        variants={[
          { key: 'A', label: 'Fill + grow (today)', note: 'The shipped slider feel: fill tracks the finger with no transition, snaps with 200ms when released, grows while held.', render: (p) => <BrightnessA {...p} /> },
          { key: 'B', label: 'Light well + room glow', note: 'Recommended for the device sheet. A tall vertical well; the page tints with the brightness through a spring. The environment answers the control, which is the one thing a slider cannot say.', tradeoff: 'Full-screen background tint is a design change, not only motion.', render: (p) => <BrightnessB {...p} /> },
          { key: 'C', label: 'Dial with detents', note: 'A rotary with 21 ticks and a haptic every 5%. Physical and forgiving of a shaky thumb.', tradeoff: 'Slower to reach 0/100 than a slider. Best for climate, maybe not lights.', render: (p) => <BrightnessC {...p} /> },
          { key: 'D', label: 'Scrub the tile', note: 'The shipped scrub gesture, plus a value readout that grows while scrubbing and a fill that tracks with zero lag.', render: (p) => <BrightnessD {...p} /> },
          { key: 'E', label: 'Arc on the tile', note: 'A ring around the tile\'s icon. Drag around it (atan2 from the ring centre, anywhere on the tile) and the arc fills clockwise; the percent rides at the arc\'s end so the finger never covers it; the tile\'s fill follows on a spring. Ticks every 5%. In RTL the arc runs counter-clockwise.', tradeoff: 'A 40 px ring is a small target; it works because the whole tile is the drag surface, which steals the tile\'s tap.', spec: () => 'stroke-dashoffset direct · fill spring 260/28 · label at r+22 · sticky ends at 0/100', render: (p) => <BrightnessE {...p} /> },
          { key: 'F', label: 'Two-stage: coarse then fine', note: 'Drag sideways and the whole bar is 100%. Still holding, drag down 28 px and the bar zooms to 106%, grows a "fine" chip and 1% ticks, and every 6 px is 1%. Release commits. Pro feel for setting exactly 30%, the way the iOS scrubber slows down when you pull away from it.', tradeoff: 'Discoverable only by accident or by the hint; must not break vertical scroll on a list, so the bar owns touch-action none.', spec: () => 'coarse: bar width = 100% · fine: 6 px = 1%, enter at |dy| > 28 px · zoom 1.06 spring 320 ms', render: (p) => <BrightnessF {...p} /> },
        ]} />

      <Demo id="temperature" title="Temperature target" purpose="A number that changes by steps should move like a number, not be replaced like a word." principles={['state', 'physical', 'continuity']} inZiggy={['DeviceControls.jsx (climate stepper)', 'Smart Climate cards']}
        knobs={[{ key: 'duration', label: 'Roll duration (A, E)', min: 0.15, max: 0.9, step: 0.02, value: 0.4, unit: 'ms' }]}
        recommend="E"
        variants={[
          { key: 'A', label: 'Rolling digits', note: 'Odometer. Each digit rolls to its new value; direction of roll = direction of change.', render: (p) => <TempA {...p} /> },
          { key: 'B', label: 'Spring-interpolated', note: 'The value glides through 24.3, 24.7… to 25.0. Feels like turning a dial.', tradeoff: 'Tenths flicker on fast taps; clamp display to 1 decimal.', render: (p) => <TempB {...p} /> },
          { key: 'C', label: 'Arc gauge', note: 'The target is an arc that grows; the current temperature is a tick. The gap is the work left. Number rides in the middle.', render: (p) => <TempC {...p} /> },
          { key: 'D', label: 'Drag rail', note: 'A ruler you drag; snaps per degree with a tick; a flick carries it. One gesture instead of eight taps.', render: (p) => <TempD {...p} /> },
          { key: 'E', label: 'Thermometer column', note: 'Recommended. The target is a fluid level: each step springs the column (bounce .3) with a meniscus wobble at the top, the digits roll, and the fluid tints blue below 21°, orange above 25°, green in between. The colour answers "what does 24 mean", which no number alone does; the stepper stays for precision.', tradeoff: 'Tall. Fits the AC sheet, not a card.', spec: (k) => `level spring ${Math.round((k.duration + 0.2) * 1000)} ms bounce .3 · meniscus scaleY 1→1.3→1 380 ms · tint 300 ms · digits roll ${Math.round(k.duration * 1000)} ms`, render: (p) => <TempE {...p} /> },
          { key: 'F', label: 'Flick the digits', note: 'The big number is the control: a vertical drag surface with momentum that snaps to whole degrees (modifyTarget) and ticks per degree. A ± hint sits beside it and fades after the first use. One flick from 24 to 27.', tradeoff: 'Momentum can overshoot by a degree on a hard flick; the per-degree tick is what makes that recoverable.', spec: () => 'drag y · momentum power .3 tc 150 · snap 84 px per degree · hint fades 400 ms', render: (p) => <TempF {...p} /> },
        ]} />

      <Demo id="segment" title="Mode segment (AC modes)" purpose="Which option is selected, and that selection moved. The pill must be one object." principles={['continuity', 'restraint']} inZiggy={['DeviceControls.jsx (climate mode)', 'Actions tabs (Automatic / On-demand)']}
        knobs={[
          { key: 'duration', label: 'Duration', min: 0.15, max: 0.8, step: 0.02, value: 0.36, unit: 'ms' },
          { key: 'bounce', label: 'Bounce (A, C)', min: 0, max: 0.4, step: 0.02, value: 0.14 },
          { key: 'ease', label: 'Ease (B)', type: 'ease', value: 'inOut' },
        ]}
        recommend="B"
        variants={[
          { key: 'A', label: 'Sliding pill (layoutId)', note: 'framer-motion shared layout. Text colour crossfades separately, which slightly ghosts mid-way.', render: (p) => <SegA {...p} /> },
          { key: 'B', label: 'Clip-path twin', note: 'Recommended for the AC modes. Duplicate row clipped to the active item; the clip slides. Text is never interpolated so there is no ghosting. Pure CSS, off the main thread.', render: (p) => <SegB {...p} /> },
          { key: 'C', label: 'Icon morph hero', note: 'A large mode glyph that turns into the next one (scale, rotate, 3px blur). Chips just recolour. Good for the AC sheet header.', render: (p) => <SegC {...p} /> },
          { key: 'D', label: 'Underline writes + tint', note: 'The restraint variant, for the Actions tabs where switching is frequent and the content below is what matters. A 2 px underline writes itself under the new chip from the side facing the old one while the old one retracts toward it; the new icon tints to its mode colour (cool = info blue, heat = accent). Nothing else moves.', tradeoff: 'Quieter than a pill; on a segment with icons only it can be missed.', spec: (k) => `pathLength 0→1 ${Math.round(k.duration * 1000)} ms ease-out · old retracts ${Math.round(k.duration * 600)} ms · tint 240 ms`, render: (p) => <SegD {...p} /> },
        ]} />

      <Demo id="hold-delete" title="Hold to delete" purpose="Destruction should cost a second of intent, without a dialog." principles={['causality', 'physical', 'hierarchy']} inZiggy={['Actions (delete automation)', 'Devices (remove device — cascades to HA)']}
        knobs={[{ key: 'hold', label: 'Hold time', min: 0.6, max: 2.5, step: 0.1, value: 1.2, unit: 's', digits: 1 }]}
        recommend="B"
        variants={[
          { key: 'A', label: 'Clip-path fill', note: 'A linear fill across the button while held; snap-back in 200 ms on release. Only the button knows what is happening.', spec: (k) => `fill linear ${k.hold.toFixed(1)} s · snap-back 200 ms ease-out`, render: (p) => <HoldDeleteA {...p} /> },
          { key: 'B', label: 'Shrink into the button', note: 'Recommended. The card, the thing at stake, reacts to the hold: it shrinks to 90%, dims to 60% and sinks toward the button as the fill grows. Let go early and it springs back with a little bounce (relief). Complete, and it collapses into the button, which turns into "Deleted · Undo". The consequence is visible before it happens.', tradeoff: 'Transforms on a list card need will-change and a stacking context above its neighbours.', spec: (k) => `hold ${k.hold.toFixed(1)} s linear · card scale 1→.9, opacity 1→.6, y 0→28 · release spring 450 ms bounce .28 · collapse 260 ms`, render: (p) => <HoldDeleteB {...p} /> },
          { key: 'C', label: 'Slide to remove', note: 'The confirmation is a distance rather than a duration: drag the red knob to the end (92%) and the card folds away; release early and it springs back. The label fades under the knob as you commit. Better for one-handed use, since a hold can be interrupted by a thumb slip.', tradeoff: 'Horizontal drag conflicts with swipe-to-go-back on iOS at the screen edge; keep the track inset.', spec: () => 'threshold 92% · spring back 420 ms bounce .2 · commit 250 ms · card folds 280 ms', render: (p) => <HoldDeleteC {...p} /> },
        ]} />
    </>
  )
}
