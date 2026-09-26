// Motion Lab — EXPERIMENTAL
// Ideas that may be too ambitious for production. Premium and unusual, kept
// honest about what they cost.
import { useState, useRef, useEffect, useMemo } from 'react'
import { motion, AnimatePresence, useMotionValue, useSpring, useTransform, animate } from 'framer-motion'
import gsap from 'gsap'
import { MorphSVGPlugin } from 'gsap/MorphSVGPlugin'
import { useGSAP } from '@gsap/react'
import { Demo } from '../ui/Demo'
import { SectionIntro } from '../ui/Section'
import { Icon, Page, Card, Button, useT } from '../ziggy/primitives'
import { useHaptic, useLab } from '../LabContext'
import { EASE } from '../time'
import { ROOMS, COPY } from '../mock/home'

gsap.registerPlugin(MorphSVGPlugin, useGSAP)

/* ───────────────────────── 1. AMBIENT HOME ───────────────────────── */

const LAYOUT = {
  living_room: { x: 0.30, y: 0.34, r: 0.30 }, kitchen: { x: 0.72, y: 0.22, r: 0.2 }, bedroom: { x: 0.22, y: 0.76, r: 0.2 },
  kids: { x: 0.56, y: 0.7, r: 0.17 }, office: { x: 0.84, y: 0.58, r: 0.14 }, bathroom: { x: 0.5, y: 0.5, r: 0.09 }, balcony: { x: 0.12, y: 0.15, r: 0.13 },
}

function AmbientHome({ tx, speed }) {
  const t = useT(); const h = useHaptic()
  const [rooms, setRooms] = useState(ROOMS.map(r => ({ ...r })))
  const toggle = (id) => { setRooms(rs => rs.map(r => r.id === id ? { ...r, lightsOn: r.lightsOn > 0 ? 0 : 2 } : r)); h('light') }
  const lit = rooms.filter(r => r.lightsOn > 0).length
  return (
    <div className="zl" style={{ position: 'absolute', inset: 0, background: 'var(--bg)', overflow: 'hidden' }}>
      <div style={{ position: 'absolute', inset: 0, filter: 'blur(28px) saturate(1.2)', opacity: 0.9 }}>
        {rooms.map(r => {
          const L = LAYOUT[r.id]; const on = r.lightsOn > 0
          return (
            <motion.div key={r.id} animate={{ opacity: on ? 1 : 0.18, scale: on ? 1 : 0.7 }} transition={tx({ type: 'spring', duration: 1.2, bounce: 0 })}
              style={{ position: 'absolute', left: `${L.x * 100}%`, top: `${L.y * 100}%`, width: `${L.r * 200}%`, paddingTop: `${L.r * 200}%`, transform: 'translate(-50%, -50%)', borderRadius: 999, background: on ? 'radial-gradient(circle, #f2b27a 0%, #c96442 45%, transparent 70%)' : 'radial-gradient(circle, var(--line-3) 0%, transparent 70%)', marginLeft: `-${L.r * 100}%`, marginTop: `-${L.r * 100}%` }} />
          )
        })}
      </div>
      <div style={{ position: 'absolute', inset: 0 }}>
        {rooms.map(r => {
          const L = LAYOUT[r.id]; const on = r.lightsOn > 0
          return (
            <motion.button key={r.id} onClick={() => toggle(r.id)} whileTap={{ scale: 0.94 }} style={{ position: 'absolute', left: `${L.x * 100}%`, top: `${L.y * 100}%`, transform: 'translate(-50%, -50%)', border: 0, background: 'transparent', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, color: 'var(--ink)' }}>
              <span style={{ position: 'relative', width: 44, height: 44, borderRadius: 999, background: on ? 'var(--surface)' : 'color-mix(in srgb, var(--surface) 60%, transparent)', display: 'grid', placeItems: 'center', boxShadow: on ? 'var(--shadow-md)' : 'none', transition: 'background 400ms, box-shadow 400ms', color: on ? 'var(--accent-text)' : 'var(--ink-mute)' }}>
                <Icon name={r.icon} size={20} />
                {r.occupancy === 'occupied' && <motion.span animate={{ scale: [1, 1.6], opacity: [0.5, 0] }} transition={{ duration: 2.6 / speed, repeat: Infinity, ease: 'easeOut' }} style={{ position: 'absolute', inset: 0, borderRadius: 999, border: '1.5px solid var(--ok)' }} />}
              </span>
              <span className="zl-caption" style={{ fontWeight: 600 }}>{t(r.name)}</span>
            </motion.button>
          )
        })}
      </div>
      <div style={{ position: 'absolute', left: 16, right: 16, top: 16 }}>
        <div className="zl-caption zl-mute" style={{ textTransform: 'uppercase', letterSpacing: '.06em' }}>{t(COPY.greeting)}</div>
        <AnimatePresence mode="popLayout" initial={false}><motion.div key={lit > 0 ? 'a' : 'c'} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} className="zl-title2">{lit > 0 ? t({ en: 'Home is awake', he: 'הבית ער' }) : t({ en: 'Home is calm', he: 'הבית רגוע' })}</motion.div></AnimatePresence>
      </div>
      <div className="ml-hint">tap a room · warmth = lights on · pulse = someone there</div>
    </div>
  )
}

/* ───────────────────────── 2. ROOM EXPOSURE ───────────────────────── */

function RoomExposure({ tx }) {
  const t = useT(); const h = useHaptic()
  const [pct, setPct] = useState(55)
  const [held, setHeld] = useState(false)
  const ref = useRef(null); const tickAt = useRef(55)
  const set = (clientY) => { const r = ref.current.getBoundingClientRect(); const p = Math.round(Math.min(100, Math.max(0, (1 - (clientY - r.top) / r.height) * 100))); setPct(p); if (Math.abs(p - tickAt.current) >= 5) { tickAt.current = p; h('selection') } }
  const exposure = useSpring(pct, tx({ stiffness: 120, damping: 20 }))
  useEffect(() => { exposure.set(pct) }, [pct, exposure])
  const filter = useTransform(exposure, (v) => `brightness(${0.25 + (v / 100) * 0.95}) saturate(${0.6 + (v / 100) * 0.6})`)
  const glow = useTransform(exposure, (v) => 0.15 + (v / 100) * 0.6)
  return (
    <div className="zl" style={{ position: 'absolute', inset: 0, overflow: 'hidden', background: '#1a1410' }}>
      <motion.div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(160deg, #c9a27a 0%, #8b6a4e 45%, #3a2c22 100%)', filter }} />
      <motion.div style={{ position: 'absolute', top: '18%', left: '50%', width: 220, height: 220, marginLeft: -110, borderRadius: 999, background: 'radial-gradient(circle, #ffd9a8 0%, rgba(255,200,140,0.4) 35%, transparent 70%)', opacity: glow, filter: 'blur(10px)', pointerEvents: 'none' }} />
      <div style={{ position: 'absolute', left: 20, top: 20, color: '#fff' }}>
        <div className="zl-title2">{t({ en: 'Living Room', he: 'סלון' })}</div>
        <div className="zl-footnote" style={{ opacity: 0.8 }}>{t({ en: 'Ceiling Light', he: 'תאורת תקרה' })} · <span className="zl-mono">{pct}%</span></div>
      </div>
      <motion.div ref={ref} animate={{ width: held ? 76 : 64 }} transition={tx({ type: 'spring', duration: 0.3, bounce: 0.1 })}
        onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); setHeld(true); set(e.clientY) }} onPointerMove={(e) => held && set(e.clientY)} onPointerUp={() => setHeld(false)} onPointerCancel={() => setHeld(false)}
        style={{ position: 'absolute', insetInlineEnd: 20, top: '20%', height: '60%', borderRadius: 32, background: 'rgba(255,255,255,0.14)', backdropFilter: 'blur(16px)', overflow: 'hidden', touchAction: 'none', cursor: 'ns-resize', border: '1px solid rgba(255,255,255,0.2)' }}>
        <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: `${pct}%`, background: 'rgba(255,255,255,0.85)', transition: held ? 'none' : 'height 200ms cubic-bezier(0.23,1,0.32,1)' }} />
      </motion.div>
      <div className="ml-hint" style={{ color: 'rgba(255,255,255,0.7)' }}>drag the well · the room's own light answers</div>
    </div>
  )
}

/* ───────────────────────── 3. ZIGGY ORB ───────────────────────── */

const BLOBS = {
  idle: 'M100,30 C140,30 170,60 170,100 C170,140 140,170 100,170 C60,170 30,140 30,100 C30,60 60,30 100,30 Z',
  listening: 'M100,22 C150,25 178,62 172,104 C166,146 138,176 96,174 C54,172 26,138 28,98 C30,58 50,19 100,22 Z',
  thinking: 'M104,28 C146,36 176,58 166,102 C156,146 130,178 92,170 C54,162 22,132 32,92 C42,52 62,20 104,28 Z',
  speaking: 'M100,34 C136,30 166,54 174,96 C182,138 150,172 104,168 C58,164 22,134 28,94 C34,54 64,38 100,34 Z',
}
const ORB_STATES = ['idle', 'listening', 'thinking', 'speaking']

function ZiggyOrb({ speed }) {
  const t = useT(); const h = useHaptic()
  const [state, setState] = useState('idle')
  const path = useRef(null); const wrap = useRef(null)
  useGSAP(() => {
    if (!path.current) return
    gsap.killTweensOf([path.current, wrap.current])
    gsap.to(path.current, { duration: 0.6, morphSVG: BLOBS[state], ease: 'power2.inOut' })
    if (state === 'listening') gsap.to(wrap.current, { scale: 1.06, duration: 1.1, yoyo: true, repeat: -1, ease: 'sine.inOut' })
    else if (state === 'thinking') gsap.to(wrap.current, { rotate: '+=360', duration: 6, repeat: -1, ease: 'none' })
    else if (state === 'speaking') gsap.to(wrap.current, { scale: 1.04, duration: 0.18, yoyo: true, repeat: -1, ease: 'sine.inOut' })
    else gsap.to(wrap.current, { scale: 1, rotate: 0, duration: 0.5, ease: 'power2.out' })
  }, { dependencies: [state] })
  const label = { idle: { en: 'Hey Ziggy', he: 'היי זיגי' }, listening: { en: 'Listening…', he: 'מקשיב…' }, thinking: { en: 'Thinking…', he: 'חושב…' }, speaking: { en: 'Speaking', he: 'מדבר' } }[state]
  return (
    <div className="zl" style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 20 }}>
      <div ref={wrap} style={{ width: 200, height: 200, display: 'grid', placeItems: 'center' }}>
        <svg width="200" height="200" viewBox="0 0 200 200" style={{ overflow: 'visible' }}>
          <defs><radialGradient id="orbg" cx="40%" cy="35%" r="70%"><stop offset="0" stopColor="#F19475" /><stop offset="0.6" stopColor="#C96442" /><stop offset="1" stopColor="#7a3a24" /></radialGradient></defs>
          <path ref={path} d={BLOBS.idle} fill="url(#orbg)" style={{ filter: 'drop-shadow(0 18px 30px rgba(201,100,66,0.35))' }} />
        </svg>
      </div>
      <AnimatePresence mode="popLayout"><motion.div key={state} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} className="zl-headline">{t(label)}</motion.div></AnimatePresence>
      <div className="zl-hstack">{ORB_STATES.map(s => <button key={s} className="zl-chip" data-on={state === s ? 'true' : 'false'} style={{ cursor: 'pointer' }} onClick={() => { setState(s); h('selection') }}>{s}</button>)}</div>
      <p className="zl-footnote zl-mute" style={{ textAlign: 'center', maxWidth: 300 }}>One shape morphs between four states (MorphSVG). Listening breathes, thinking rotates slowly, speaking pulses at speech rate. Replaces the three-dot thinking bubble and the mic ring.</p>
    </div>
  )
}

/* ───────────────────────── 4. REWIND THE DAY ───────────────────────── */

function dayState(hour) {
  // a plausible day for the mock home
  return ROOMS.map(r => {
    let on = false, occ = false
    if (r.id === 'living_room') { on = hour >= 18 && hour < 23.5; occ = (hour >= 7 && hour < 8.5) || (hour >= 17.5 && hour < 23.5) }
    if (r.id === 'kitchen') { on = (hour >= 6.5 && hour < 8) || (hour >= 18.5 && hour < 20.5); occ = on }
    if (r.id === 'bedroom') { on = (hour >= 6 && hour < 7) || (hour >= 22.5 && hour < 23.5); occ = hour < 7 || hour >= 22.5 }
    if (r.id === 'kids') { on = hour >= 19 && hour < 20.5; occ = hour < 7.5 || hour >= 16 }
    if (r.id === 'office') { on = hour >= 9 && hour < 17; occ = on }
    if (r.id === 'bathroom') { on = (hour >= 6.5 && hour < 7.5) || (hour >= 21 && hour < 22); occ = on }
    if (r.id === 'balcony') { on = hour >= 19.5 && hour < 23; occ = hour >= 20 && hour < 21 }
    return { ...r, on, occ }
  })
}

function RewindDay({ tx }) {
  const t = useT(); const h = useHaptic()
  const [hour, setHour] = useState(20)
  const rooms = dayState(hour)
  const lastTick = useRef(20)
  const ref = useRef(null)
  const set = (clientX) => { const r = ref.current.getBoundingClientRect(); const raw = Math.min(24, Math.max(0, ((clientX - r.left) / r.width) * 24)); const hh = ref.current.closest('[dir=rtl]') ? 24 - raw : raw; setHour(hh); if (Math.abs(hh - lastTick.current) >= 1) { lastTick.current = Math.round(hh); h('selection') } }
  const dragging = useRef(false)
  const sky = hour < 6 || hour >= 21 ? '#1c1b2a' : hour < 8 || hour >= 18.5 ? '#c98a5a' : '#dfe8f2'
  const hh = Math.floor(hour); const mm = Math.round((hour - hh) * 60)
  return (
    <Page>
      <motion.div animate={{ background: sky }} transition={tx({ duration: 0.5 })} style={{ borderRadius: 16, padding: 14, marginBottom: 12, color: hour < 8 || hour >= 18.5 ? '#fff' : 'var(--ink)' }}>
        <div className="zl-caption" style={{ textTransform: 'uppercase', letterSpacing: '.06em', opacity: 0.8 }}>{t({ en: 'Yesterday', he: 'אתמול' })}</div>
        <div className="zl-large zl-mono" style={{ fontSize: 40 }}>{String(hh).padStart(2, '0')}:{String(mm).padStart(2, '0')}</div>
        <div className="zl-footnote" style={{ opacity: 0.85 }}>{rooms.filter(r => r.on).length} {t({ en: 'lights on', he: 'אורות דולקים' })} · {rooms.filter(r => r.occ).length} {t({ en: 'rooms occupied', he: 'חדרים תפוסים' })}</div>
      </motion.div>
      <div className="zl-grid2" style={{ marginBottom: 14 }}>
        {rooms.map(r => (
          <motion.div key={r.id} animate={{ backgroundColor: r.on ? 'var(--surface)' : 'var(--tile-base)', borderColor: r.on ? 'color-mix(in srgb, var(--accent) 35%, var(--line))' : 'var(--line)' }} transition={tx({ duration: 0.3 })} className="zl-tile" style={{ minHeight: 84, padding: 10 }}>
            <div className="zl-tile__row"><motion.span className="zl-tile__icon" animate={{ backgroundColor: r.on ? 'var(--accent-2)' : 'var(--surface-2)', color: r.on ? 'var(--accent-text)' : 'var(--ink-mute)' }} transition={tx({ duration: 0.3 })} style={{ width: 30, height: 30 }}><Icon name={r.icon} size={16} /></motion.span><motion.span animate={{ backgroundColor: r.occ ? 'var(--ok)' : 'var(--ink-ghost)', scale: r.occ ? 1 : 0.8 }} transition={tx({ duration: 0.3 })} style={{ width: 8, height: 8, borderRadius: 999 }} /></div>
            <div className="zl-tile__name" style={{ fontSize: 13, marginTop: 4 }}>{t(r.name)}</div>
          </motion.div>
        ))}
      </div>
      <div ref={ref} onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); dragging.current = true; set(e.clientX) }} onPointerMove={(e) => dragging.current && set(e.clientX)} onPointerUp={() => { dragging.current = false }} onPointerCancel={() => { dragging.current = false }}
        style={{ position: 'relative', height: 44, borderRadius: 12, background: 'var(--surface-2)', border: '1px solid var(--line)', touchAction: 'none', cursor: 'ew-resize' }}>
        {[0, 6, 12, 18, 24].map(hr => <span key={hr} className="zl-caption zl-mute zl-mono" style={{ position: 'absolute', top: 4, insetInlineStart: `${(hr / 24) * 100}%`, transform: 'translateX(-50%)' }}>{hr}</span>)}
        <motion.span animate={{ insetInlineStart: `${(hour / 24) * 100}%` }} transition={{ duration: 0 }} style={{ position: 'absolute', top: 18, width: 3, height: 22, marginInlineStart: -1.5, borderRadius: 2, background: 'var(--accent)' }} />
      </div>
      <p className="zl-footnote zl-mute" style={{ marginTop: 10 }}>Scrub the day. Rooms light up and empty as time passes; the sky panel follows. A way to read the home's history without a chart.</p>
    </Page>
  )
}

/* ───────────────────────── 5. POINTER PARALLAX TILES ───────────────────────── */

function TiltTile({ r, t, tx }) {
  const ref = useRef(null)
  const rx = useSpring(0, tx({ stiffness: 200, damping: 18 })); const ry = useSpring(0, tx({ stiffness: 200, damping: 18 }))
  const gx = useMotionValue(50); const gy = useMotionValue(50)
  const glare = useTransform([gx, gy], ([x, y]) => `radial-gradient(circle at ${x}% ${y}%, rgba(255,255,255,0.35), transparent 60%)`)
  const on = r.lightsOn > 0
  return (
    <motion.div ref={ref} className="zl-tile zl-room" data-on={on ? 'true' : 'false'} style={{ rotateX: rx, rotateY: ry, transformStyle: 'preserve-3d', minHeight: 130, position: 'relative', overflow: 'hidden' }}
      onPointerMove={(e) => { const b = ref.current.getBoundingClientRect(); const px = (e.clientX - b.left) / b.width; const py = (e.clientY - b.top) / b.height; ry.set((px - 0.5) * 14); rx.set(-(py - 0.5) * 14); gx.set(px * 100); gy.set(py * 100) }}
      onPointerLeave={() => { rx.set(0); ry.set(0) }}>
      <motion.div style={{ position: 'absolute', inset: 0, background: glare, pointerEvents: 'none', opacity: on ? 0.8 : 0.3 }} />
      <div className="zl-tile__row" style={{ transform: 'translateZ(20px)' }}><span className="zl-tile__icon"><Icon name={r.icon} /></span></div>
      <div style={{ transform: 'translateZ(12px)' }}><div className="zl-tile__name">{t(r.name)}</div><div className="zl-tile__meta">{on ? t(COPY.lightsOn, r.lightsOn) : t(COPY.allOff)}</div></div>
    </motion.div>
  )
}

function ParallaxTiles({ tx }) {
  const t = useT()
  return (
    <Page title={t({ en: 'Rooms', he: 'חדרים' })}>
      <div className="zl-grid2" style={{ perspective: 800 }}>{ROOMS.slice(0, 6).map(r => <TiltTile key={r.id} r={r} t={t} tx={tx} />)}</div>
      <p className="zl-footnote zl-mute" style={{ marginTop: 12 }}>Desktop / hover only. Tiles tilt toward the pointer on a spring with a glare that follows. Decorative; gate behind (hover:hover) and (pointer:fine). Never on touch.</p>
    </Page>
  )
}

/* ───────────────────────── 6. AC BREEZE ───────────────────────── */

function AcBreeze({ speed }) {
  const t = useT(); const h = useHaptic()
  const [mode, setMode] = useState('cool')
  const ref = useRef(null)
  useGSAP(() => {
    const lines = ref.current?.querySelectorAll('.breeze')
    if (!lines) return
    gsap.killTweensOf(lines)
    if (mode === 'off') { gsap.to(lines, { opacity: 0, duration: 0.3 }); return }
    gsap.set(lines, { x: -10, opacity: 0 })
    gsap.to(lines, { x: 26, opacity: 0.8, duration: 1.6, stagger: { each: 0.35, repeat: -1 }, ease: 'sine.out', repeat: -1, yoyo: false, onRepeat() {} })
    gsap.to(lines, { keyframes: [{ opacity: 0 }, { opacity: 0.9 }, { opacity: 0 }], duration: 1.6, stagger: { each: 0.35, repeat: -1 }, repeat: -1, ease: 'none' })
  }, { dependencies: [mode] })
  const col = mode === 'cool' ? 'var(--info)' : mode === 'heat' ? 'var(--accent)' : 'var(--ink-mute)'
  return (
    <div className="zl" style={{ padding: 16 }}>
      <div className="zl-grid2">
        <div className="zl-tile" data-on={mode !== 'off' ? 'true' : 'false'} style={{ minHeight: 120, position: 'relative', overflow: 'hidden' }}>
          <div className="zl-tile__row">
            <span className="zl-tile__icon" style={{ position: 'relative', overflow: 'visible' }}>
              <Icon name="thermometer" />
              <svg ref={ref} width="60" height="36" viewBox="0 0 60 36" style={{ position: 'absolute', left: 30, top: 0, pointerEvents: 'none', overflow: 'visible' }}>
                {[8, 18, 28].map((y, i) => <path key={i} className="breeze" d={`M0 ${y} q 6 -3 12 0 t 12 0`} fill="none" stroke={col} strokeWidth="2" strokeLinecap="round" />)}
              </svg>
            </span>
          </div>
          <div><div className="zl-tile__name">{t({ en: 'Living Room AC', he: 'מזגן סלון' })}</div><div className="zl-tile__meta">{mode === 'off' ? t(COPY.off) : mode === 'cool' ? t({ en: 'Cooling · 24°', he: 'מקרר · 24°' }) : t({ en: 'Heating · 22°', he: 'מחמם · 22°' })}</div></div>
        </div>
        <div className="zl-stack">{['cool', 'heat', 'off'].map(m => <button key={m} className="zl-chip" data-on={mode === m ? 'true' : 'false'} style={{ cursor: 'pointer', justifyContent: 'center' }} onClick={() => { setMode(m); h('selection') }}>{m}</button>)}</div>
      </div>
      <p className="zl-footnote zl-mute" style={{ marginTop: 12 }}>Three breeze lines drift out of the AC while it runs, blue for cool, orange for heat (GSAP stagger with repeat). An ambient loop that means "air is moving", so it is allowed. Stop it under reduced motion.</p>
    </div>
  )
}

/* ───────────────────────── SECTION ───────────────────────── */

export default function Experimental() {
  const { speed } = useLab()
  return (
    <>
      <SectionIntro
        title="Experimental"
        lede="Concepts that go past the product's current design. Each is here to be experienced, then either pulled back into a restrained form or rejected outright."
      >
        <p>None of these is proposed as-is. They exist to find the edge.</p>
      </SectionIntro>

      <Demo id="ambient" title="Ambient home" purpose="The home as a field of light: warmth where lights are on, a pulse where someone is. A dashboard hero that is the state, not a summary of it." inZiggy={['Dashboard hero / greeting block (replacement concept)']}
        variants={[{ key: 'A', label: 'Light field', render: (p) => <AmbientHome {...p} /> }]} />

      <Demo id="exposure" title="Room exposure" purpose="Brightness controls the room's own light: the photo's exposure and a warm bloom answer the well." inZiggy={['Room detail hero + LightControls BrightnessLamp']}
        variants={[{ key: 'A', label: 'Photo exposure well', render: (p) => <RoomExposure {...p} /> }]} />

      <Demo id="orb" title="Ziggy orb" purpose="One living shape for idle, listening, thinking, speaking." inZiggy={['AIChat ThinkingBubble', 'composer mic ring', 'wall ZiggyBar orb']}
        variants={[{ key: 'A', label: 'MorphSVG blob', render: (p) => <ZiggyOrb {...p} speed={speed} /> }]} />

      <Demo id="rewind" title="Rewind the day" purpose="Scrub time; watch the home's state replay. History as a gesture, not a chart." inZiggy={['Recent Activity card (replacement concept)', 'occupancy diagnostics history']}
        variants={[{ key: 'A', label: 'Timeline scrub', render: (p) => <RewindDay {...p} /> }]} />

      <Demo id="parallax" title="Pointer parallax tiles" purpose="Desktop delight: tiles tilt toward the pointer with a glare. Decorative by admission." inZiggy={['Dashboard desktop RoomsGrid (hover only)']} stage="desktop" height={520}
        variants={[{ key: 'A', label: 'Tilt + glare', render: (p) => <ParallaxTiles {...p} /> }]} />

      <Demo id="breeze" title="AC breeze" purpose="A running AC moves air. Three drifting lines say so without a word." inZiggy={['Devices AC card', 'Smart Climate card']}
        variants={[{ key: 'A', label: 'GSAP stagger loop', render: (p) => <AcBreeze {...p} speed={speed} /> }]} />
    </>
  )
}
