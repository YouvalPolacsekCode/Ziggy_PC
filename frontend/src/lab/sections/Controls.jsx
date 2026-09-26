// Motion Lab — CONTROLS
// Toggles, power buttons, brightness, temperature, mode segments, hold-to-confirm.
// The question each prototype answers: when a value changes under the finger,
// how does the control show it heard, how does it show the value moving, and
// how does it show the hub confirming?
import { useState, useRef, useEffect, useCallback } from 'react'
import { motion, useMotionValue, useSpring, useTransform, animate, AnimatePresence, LayoutGroup } from 'framer-motion'
import { Demo } from '../ui/Demo'
import { SectionIntro } from '../ui/Section'
import { Icon, Button, useT } from '../ziggy/primitives'
import { useHaptic } from '../LabContext'
import { EASE, cssEase } from '../time'
import { COPY } from '../mock/home'

/* ───────────────────────── 1. TOGGLE ───────────────────────── */

function ToggleFrame({ label, sub, children, on }) {
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
      <p className="zl-footnote zl-mute" style={{ marginTop: 12 }}>Tap the switch. Watch the thumb, then the track.</p>
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

function ToggleD({ knobs, tx }) {
  // draggable: the thumb follows the finger; release commits by position OR velocity
  const [on, setOn] = useState(false)
  const t = useT(); const h = useHaptic()
  const x = useMotionValue(0)
  const bg = useTransform(x, [0, 16], ['#b7a992', '#3D8A5F'])
  useEffect(() => { animate(x, on ? 16 : 0, tx({ type: 'spring', duration: knobs.duration, bounce: knobs.bounce })) }, [on]) // eslint-disable-line
  return (
    <ToggleFrame label={t({ en: 'Floor Lamp', he: 'מנורת רצפה' })} sub={on ? t(COPY.on) : t(COPY.off)} on={on}>
      <motion.button className="zl-switch" data-state={on ? 'checked' : 'unchecked'} style={{ backgroundColor: bg }}
        onClick={() => { setOn(v => !v); h('light') }}>
        <motion.span className="zl-switch__thumb" style={{ x }} drag="x" dragConstraints={{ left: 0, right: 16 }} dragElastic={0.08} dragMomentum={false}
          onDragEnd={(_, info) => {
            const next = info.velocity.x > 200 ? true : info.velocity.x < -200 ? false : x.get() > 8
            if (next !== on) h('light')
            setOn(next)
            animate(x, next ? 16 : 0, tx({ type: 'spring', duration: knobs.duration, bounce: knobs.bounce }))
          }}
          onClick={(e) => e.stopPropagation()} />
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
      <p className="zl-footnote zl-mute">{hint}</p>
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
  const [on, setOn] = useState(false); const h = useHaptic()
  return (
    <PowerFrame on={on} hint="Ignition: on arrives with a small overshoot; off leaves faster with none.">
      <motion.button whileTap={{ scale: 0.96 }}
        onClick={() => { setOn(v => !v); h(on ? 'light' : 'medium') }}
        animate={{ backgroundColor: on ? 'var(--accent)' : 'var(--surface)', color: on ? 'var(--on-accent)' : 'var(--ink-mute)', borderColor: on ? 'var(--accent)' : 'var(--line)' }}
        transition={tx({ duration: on ? 0.22 : 0.16, ease: EASE.out })}
        style={{ position: 'relative', width: 88, height: 88, borderRadius: 999, border: '1px solid', display: 'grid', placeItems: 'center', cursor: 'pointer' }}>
        <AnimatePresence>
          {on && (
            <motion.span key="ring" initial={{ scale: 0.8, opacity: 0.6 }} animate={{ scale: 1.6, opacity: 0 }} exit={{ opacity: 0 }}
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
        style={{ position: 'relative', overflow: 'hidden', width: 88, height: 88, borderRadius: 999, border: '1px solid var(--line)', background: 'var(--surface)', display: 'grid', placeItems: 'center', cursor: 'pointer', color: on ? 'var(--on-accent)' : 'var(--ink-mute)', transition: `color 200ms` }}>
        <motion.span
          animate={{ clipPath: on ? `circle(150% at ${origin.x}% ${origin.y}%)` : `circle(0% at ${origin.x}% ${origin.y}%)` }}
          transition={tx({ duration: on ? knobs.duration : knobs.duration * 0.7, ease: on ? EASE.out : EASE.inOut })}
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

/* ───────────────────────── 3. BRIGHTNESS ───────────────────────── */

function useDragValue(initial, onChange) {
  const v = useMotionValue(initial)
  return v
}

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

/* ───────────────────────── 5. MODE SEGMENT ───────────────────────── */

const MODES = [
  { key: 'cool', icon: 'snowflake', label: { en: 'Cool', he: 'קירור' } },
  { key: 'heat', icon: 'flame', label: { en: 'Heat', he: 'חימום' } },
  { key: 'fan', icon: 'fan', label: { en: 'Fan', he: 'מאוורר' } },
  { key: 'dry', icon: 'droplets', label: { en: 'Dry', he: 'ייבוש' } },
]

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

/* ───────────────────────── 6. HOLD TO DELETE ───────────────────────── */

function HoldDelete({ knobs, tx }) {
  const t = useT(); const h = useHaptic()
  const [state, setState] = useState('idle') // idle | holding | deleted
  const timer = useRef(null)
  const start = () => { if (state === 'deleted') return; setState('holding'); timer.current = setTimeout(() => { setState('deleted'); h('success') }, knobs.hold * 1000 / 1) }
  const stop = () => { if (state === 'holding') { clearTimeout(timer.current); setState('idle') } }
  return (
    <div className="zl" style={{ padding: 16, paddingTop: 40, display: 'flex', flexDirection: 'column', gap: 16, alignItems: 'center' }}>
      <div className="zl-card zl-card--pad" style={{ width: '100%' }}>
        <div className="zl-row__title">{t({ en: 'Balcony light at sunset', he: 'אור מרפסת בשקיעה' })}</div>
        <div className="zl-row__sub">{t({ en: 'Automation · ran yesterday', he: 'אוטומציה · רץ אתמול' })}</div>
      </div>
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

      <Demo id="toggle" title="Toggle switch" purpose="A switch is a physical object with travel. Show the travel, then let the circuit close." inZiggy={['components/ui/Toggle.jsx', 'motion/controls.css', 'DeviceControls.jsx']}
        knobs={[
          { key: 'duration', label: 'Duration', min: 0.12, max: 0.8, step: 0.02, value: 0.3, unit: 'ms' },
          { key: 'bounce', label: 'Bounce', min: 0, max: 0.5, step: 0.02, value: 0.18 },
          { key: 'ease', label: 'Ease (A)', type: 'ease', value: 'out' },
        ]}
        recommend="C"
        variants={[
          { key: 'A', label: 'Linear slide (today)', note: 'Thumb and track change together with one ease-out. Correct, forgettable.', render: (p) => <ToggleA {...p} /> },
          { key: 'B', label: 'Spring + squash', note: 'The thumb stretches in its direction of travel and settles with a small bounce. Reads as mass.', tradeoff: 'Bounce above ~0.25 starts to feel like a toy.', render: (p) => <ToggleB {...p} /> },
          { key: 'C', label: 'Thumb first, then circuit', note: 'Track colour waits for the thumb to arrive, then sweeps in from the thumb\'s side. Off is immediate. Causality: the thumb closes the circuit.', render: (p) => <ToggleC {...p} /> },
          { key: 'D', label: 'Draggable', note: 'Follow the finger. Commit by position or a 200px/s flick. Tap still works. Colour tracks the thumb continuously.', tradeoff: 'Needs pointer capture and a scroll-lock decision on lists.', render: (p) => <ToggleD {...p} /> },
        ]} />

      <Demo id="power" title="Power button" purpose="The most frequent action in the app. It must answer in under 100ms and then show the state arriving." inZiggy={['DeviceControls.jsx (power)', 'DeviceSheet.jsx', 'motion.css [data-on]']}
        knobs={[
          { key: 'overshoot', label: 'Icon overshoot (B)', min: 0, max: 0.2, step: 0.01, value: 0.0 },
          { key: 'duration', label: 'Ripple duration (C)', min: 0.15, max: 0.8, step: 0.02, value: 0.36, unit: 'ms' },
          { key: 'hold', label: 'Hold time (D)', min: 0.5, max: 2, step: 0.1, value: 1.0, unit: 's', digits: 1 },
        ]}
        variants={[
          { key: 'A', label: 'Press + fill', note: 'Scale 0.94 on press, colour on release. The baseline.', render: (p) => <PowerA {...p} /> },
          { key: 'B', label: 'Ignition (today)', note: 'The shipped grammar: on arrives with an expanding ring and a small icon pop; off is faster and flat.', render: (p) => <PowerB {...p} /> },
          { key: 'C', label: 'Ripple from touch', note: 'The on-state spreads from the exact point you touched (clip-path circle). Off contracts back to it. The finger is the cause.', render: (p) => <PowerC {...p} /> },
          { key: 'D', label: 'Hold to commit', note: 'For consequential actions ("everything off"): a linear progress ring while held, snap-back on release, success haptic at the end.', render: (p) => <PowerD {...p} /> },
        ]} />

      <Demo id="brightness" title="Brightness" purpose="A continuous value under a finger. Never hide the number under the thumb; let the room show the effect." inZiggy={['components/ui/Slider.jsx', 'gestures.js useScrub', 'DeviceSheet.jsx']}
        knobs={[{ key: 'grow', label: 'Grow while held (A)', min: 0, max: 24, step: 1, value: 10, unit: 'px', digits: 0 }]}
        recommend="B"
        variants={[
          { key: 'A', label: 'Fill + grow (today)', note: 'The shipped slider feel: fill tracks the finger with no transition, snaps with 200ms when released, grows while held.', render: (p) => <BrightnessA {...p} /> },
          { key: 'B', label: 'Light well + room glow', note: 'A tall vertical well; the page tints with the brightness through a spring. The environment answers the control.', tradeoff: 'Full-screen background tint is a design change, not only motion.', render: (p) => <BrightnessB {...p} /> },
          { key: 'C', label: 'Dial with detents', note: 'A rotary with 21 ticks and a haptic every 5%. Physical and forgiving of a shaky thumb.', tradeoff: 'Slower to reach 0/100 than a slider. Best for climate, maybe not lights.', render: (p) => <BrightnessC {...p} /> },
          { key: 'D', label: 'Scrub the tile', note: 'The shipped scrub gesture, plus a value readout that grows while scrubbing and a fill that tracks with zero lag.', render: (p) => <BrightnessD {...p} /> },
        ]} />

      <Demo id="temperature" title="Temperature target" purpose="A number that changes by steps should move like a number, not be replaced like a word." inZiggy={['DeviceControls.jsx (climate stepper)', 'Smart Climate cards']}
        knobs={[{ key: 'duration', label: 'Roll duration (A)', min: 0.15, max: 0.9, step: 0.02, value: 0.4, unit: 'ms' }]}
        variants={[
          { key: 'A', label: 'Rolling digits', note: 'Odometer. Each digit rolls to its new value; direction of roll = direction of change.', render: (p) => <TempA {...p} /> },
          { key: 'B', label: 'Spring-interpolated', note: 'The value glides through 24.3, 24.7… to 25.0. Feels like turning a dial.', tradeoff: 'Tenths flicker on fast taps; clamp display to 1 decimal.', render: (p) => <TempB {...p} /> },
          { key: 'C', label: 'Arc gauge', note: 'The target is an arc that grows; the current temperature is a tick. The gap is the work left. Number rides in the middle.', render: (p) => <TempC {...p} /> },
          { key: 'D', label: 'Drag rail', note: 'A ruler you drag; snaps per degree with a tick; a flick carries it. One gesture instead of eight taps.', render: (p) => <TempD {...p} /> },
        ]} />

      <Demo id="segment" title="Mode segment (AC modes)" purpose="Which option is selected, and that selection moved. The pill must be one object." inZiggy={['DeviceControls.jsx (climate mode)', 'Actions tabs (Automatic / On-demand)']}
        knobs={[
          { key: 'duration', label: 'Duration', min: 0.15, max: 0.8, step: 0.02, value: 0.36, unit: 'ms' },
          { key: 'bounce', label: 'Bounce (A, C)', min: 0, max: 0.4, step: 0.02, value: 0.14 },
          { key: 'ease', label: 'Ease (B)', type: 'ease', value: 'inOut' },
        ]}
        recommend="B"
        variants={[
          { key: 'A', label: 'Sliding pill (layoutId)', note: 'framer-motion shared layout. Text colour crossfades separately, which slightly ghosts mid-way.', render: (p) => <SegA {...p} /> },
          { key: 'B', label: 'Clip-path twin', note: 'Duplicate row clipped to the active item; the clip slides. Text is never interpolated so there is no ghosting. Pure CSS, off the main thread.', render: (p) => <SegB {...p} /> },
          { key: 'C', label: 'Icon morph hero', note: 'A large mode glyph that turns into the next one (scale, rotate, 3px blur). Chips just recolour. Good for the AC sheet header.', render: (p) => <SegC {...p} /> },
        ]} />

      <Demo id="hold-delete" title="Hold to delete" purpose="Destruction should cost a second of intent, without a dialog." inZiggy={['Actions (delete automation)', 'Devices (remove device — cascades to HA)']}
        knobs={[{ key: 'hold', label: 'Hold time', min: 0.6, max: 2.5, step: 0.1, value: 1.2, unit: 's', digits: 1 }]}
        variants={[{ key: 'A', label: 'Clip-path fill', render: (p) => <HoldDelete {...p} /> }]} />
    </>
  )
}
