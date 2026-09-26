// Motion Lab — ROOMS
// Occupancy visualisation, environment (temperature) change, long-press
// "all lights off" choreography, the home's live status line.
import { useState, useRef, useEffect } from 'react'
import { motion, AnimatePresence, useMotionValue, useSpring, useTransform, animate } from 'framer-motion'
import { Demo } from '../ui/Demo'
import { SectionIntro } from '../ui/Section'
import { Icon, Page, Card, Button, Dot, useT } from '../ziggy/primitives'
import { useHaptic } from '../LabContext'
import { EASE, cssEase } from '../time'
import { ROOMS, COPY, devicesInRoom } from '../mock/home'

/* ───────────────────────── 1. OCCUPANCY ───────────────────────── */

const OCC_ORDER = ['occupied', 'empty', 'unknown']
const OCC_REASON = {
  occupied: { en: 'motion 20s ago', he: 'תנועה לפני 20 שניות' },
  empty: { en: 'quiet for 6 min', he: 'שקט 6 דקות' },
  unknown: { en: 'sensor not reporting', he: 'החיישן לא מדווח' },
}

function useOcc() {
  const [state, setState] = useState('occupied')
  const cycle = () => setState(s => OCC_ORDER[(OCC_ORDER.indexOf(s) + 1) % OCC_ORDER.length])
  return [state, setState, cycle]
}

function OccFrame({ state, setState, children, t }) {
  return (
    <Page title={t({ en: 'Rooms', he: 'חדרים' })}>
      <div className="zl-hstack" style={{ marginBottom: 12 }}>
        {OCC_ORDER.map(s => <button key={s} className="zl-chip" data-on={state === s ? 'true' : 'false'} style={{ cursor: 'pointer' }} onClick={() => setState(s)}>{t(COPY[s])}</button>)}
      </div>
      <div className="zl-grid2">{children}</div>
    </Page>
  )
}

function RoomTileBase({ state, children, t, style }) {
  return (
    <div className="zl-tile zl-room" style={{ minHeight: 140, position: 'relative', overflow: 'hidden', ...style }}>
      <div className="zl-tile__row" style={{ position: 'relative', zIndex: 1 }}><span className="zl-tile__icon"><Icon name="sofa" /></span>{children}</div>
      <div style={{ position: 'relative', zIndex: 1 }}><div className="zl-tile__name">{t({ en: 'Living Room', he: 'סלון' })}</div><div className="zl-tile__meta">2 {t({ en: 'lights on', he: 'אורות דולקים' })} · 24.5°</div></div>
    </div>
  )
}

function OccA({ tx }) {
  const [state, setState] = useOcc(); const t = useT()
  return (
    <OccFrame state={state} setState={setState} t={t}>
      <RoomTileBase state={state} t={t}>
        {state === 'occupied' && <span className="zl-chip" style={{ height: 24, padding: '0 8px', background: 'color-mix(in srgb, var(--ok) 55%, transparent)', color: '#fff', borderColor: 'transparent' }}><Icon name="users" size={14} /></span>}
      </RoomTileBase>
      <p className="zl-footnote zl-mute" style={{ gridColumn: '1 / -1' }}>Today: a chip appears only when occupied. Empty and unknown look identical, and the chip mounts with no transition.</p>
    </OccFrame>
  )
}

function OccB({ tx, knobs }) {
  // breathing dot with a reason line; unknown is a hollow ring; empty is still
  const [state, setState] = useOcc(); const t = useT()
  return (
    <OccFrame state={state} setState={setState} t={t}>
      <RoomTileBase state={state} t={t}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ position: 'relative', width: 10, height: 10, display: 'grid', placeItems: 'center' }}>
            <motion.span animate={{ background: state === 'occupied' ? 'var(--ok)' : state === 'empty' ? 'var(--ink-ghost)' : 'transparent', boxShadow: state === 'unknown' ? 'inset 0 0 0 1.5px var(--line-3)' : 'inset 0 0 0 0px transparent' }} transition={tx({ duration: 0.3 })} style={{ width: 8, height: 8, borderRadius: 999 }} />
            {state === 'occupied' && <motion.span animate={{ scale: [1, 2.2], opacity: [0.5, 0] }} transition={tx({ duration: knobs.breath, repeat: Infinity, ease: 'easeOut' })} style={{ position: 'absolute', width: 8, height: 8, borderRadius: 999, background: 'var(--ok)' }} />}
          </span>
          <AnimatePresence mode="wait" initial={false}>
            <motion.span key={state} initial={{ opacity: 0, y: 3 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -3 }} transition={tx({ duration: 0.16 })} className="zl-caption" style={{ color: state === 'occupied' ? 'var(--ok-text)' : 'var(--ink-mute)' }}>{t(COPY[state])}</motion.span>
          </AnimatePresence>
        </div>
      </RoomTileBase>
      <Card style={{ gridColumn: '1 / -1' }}>
        <div className="zl-footnote zl-mute">{t({ en: 'Reason', he: 'סיבה' })}</div>
        <AnimatePresence mode="wait" initial={false}><motion.div key={state} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={tx({ duration: 0.18 })} className="zl-subhead">{t(OCC_REASON[state])}</motion.div></AnimatePresence>
      </Card>
      <p className="zl-footnote zl-mute" style={{ gridColumn: '1 / -1' }}>Three distinct states. Occupied pulses (the one earned ambient loop: it means "true right now"); empty is a still dot; unknown is a hollow ring. The engine's reason is a line, never invented.</p>
    </OccFrame>
  )
}

function OccC({ tx }) {
  // ambient: a warm wash rises when occupied; empty cools; unknown desaturates the tile
  const [state, setState] = useOcc(); const t = useT()
  return (
    <OccFrame state={state} setState={setState} t={t}>
      <motion.div animate={{ filter: state === 'unknown' ? 'saturate(0.4)' : 'saturate(1)', opacity: state === 'unknown' ? 0.75 : 1 }} transition={tx({ duration: 0.5 })} style={{ position: 'relative' }}>
        <RoomTileBase state={state} t={t}>
          <Dot state={state} />
        </RoomTileBase>
        <motion.div animate={{ opacity: state === 'occupied' ? 1 : 0, y: state === 'occupied' ? 0 : 40 }} transition={tx({ type: 'spring', duration: 0.9, bounce: 0 })} style={{ position: 'absolute', inset: 0, borderRadius: 16, background: 'radial-gradient(120% 80% at 50% 110%, color-mix(in srgb, var(--accent) 22%, transparent), transparent 70%)', pointerEvents: 'none' }} />
      </motion.div>
      <p className="zl-footnote zl-mute" style={{ gridColumn: '1 / -1' }}>A warm wash rises from the bottom of the tile when someone is there and sinks when they leave. Unknown desaturates: "I can't see". Colour and opacity survive reduced motion.</p>
    </OccFrame>
  )
}

function OccD({ tx }) {
  // presence "ripple": a person mark arrives with a ripple; leaves by fading toward the door edge
  const [state, setState] = useOcc(); const t = useT()
  return (
    <OccFrame state={state} setState={setState} t={t}>
      <RoomTileBase state={state} t={t}>
        <span style={{ position: 'relative', width: 28, height: 28, display: 'grid', placeItems: 'center' }}>
          <AnimatePresence>
            {state === 'occupied' && (
              <>
                <motion.span key="rip" initial={{ scale: 0.4, opacity: 0.6 }} animate={{ scale: 2.4, opacity: 0 }} transition={tx({ duration: 0.8, ease: EASE.out })} style={{ position: 'absolute', width: 28, height: 28, borderRadius: 999, border: '2px solid var(--ok)' }} />
                <motion.span key="p" initial={{ x: 14, opacity: 0, scale: 0.8 }} animate={{ x: 0, opacity: 1, scale: 1 }} exit={{ x: 14, opacity: 0, scale: 0.8, transition: tx({ duration: 0.28, ease: EASE.inOut }) }} transition={tx({ type: 'spring', duration: 0.5, bounce: 0.25 })} style={{ position: 'absolute', width: 24, height: 24, borderRadius: 999, background: 'var(--ok)', color: '#fff', display: 'grid', placeItems: 'center' }}><Icon name="users" size={13} strokeWidth={2.5} /></motion.span>
              </>
            )}
            {state === 'unknown' && <motion.span key="q" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="zl-caption zl-mute" style={{ fontFamily: 'var(--ml-mono)' }}>?</motion.span>}
          </AnimatePresence>
        </span>
      </RoomTileBase>
      <p className="zl-footnote zl-mute" style={{ gridColumn: '1 / -1' }}>Someone arrives: a person mark enters from the tile's edge with a ripple. Leaving: it slides back out the way it came. Unknown is a quiet "?".</p>
    </OccFrame>
  )
}

function OccE({ tx }) {
  // last-60-minutes timeline strip on the tile
  const [state, setState] = useOcc(); const t = useT()
  const [hist, setHist] = useState(() => Array.from({ length: 24 }, (_, i) => (i < 8 ? 'empty' : i < 20 ? 'occupied' : 'occupied')))
  useEffect(() => { setHist(h => [...h.slice(1), state]) }, [state])
  const col = { occupied: 'var(--ok)', empty: 'var(--line-2)', unknown: 'var(--line-3)' }
  return (
    <OccFrame state={state} setState={setState} t={t}>
      <RoomTileBase state={state} t={t}>
        <Dot state={state} />
      </RoomTileBase>
      <Card style={{ gridColumn: '1 / -1' }}>
        <div className="zl-footnote zl-mute" style={{ marginBottom: 8 }}>{t({ en: 'Last hour', he: 'השעה האחרונה' })}</div>
        <div style={{ display: 'flex', gap: 2, height: 14 }}>
          {hist.map((s, i) => <motion.span key={i + '-' + hist.length} layout initial={i === hist.length - 1 ? { scaleY: 0 } : false} animate={{ scaleY: 1, background: col[s], opacity: s === 'unknown' ? 0.5 : 1 }} transition={tx({ duration: 0.3, ease: EASE.out })} style={{ flex: 1, borderRadius: 2, transformOrigin: 'bottom', background: col[s] }} />)}
        </div>
      </Card>
      <p className="zl-footnote zl-mute" style={{ gridColumn: '1 / -1' }}>Changing state appends a bar to the strip; the strip scrolls one step. History explains the present state at a glance.</p>
    </OccFrame>
  )
}

/* ───────────────────────── 2. ENVIRONMENT (TEMPERATURE) ───────────────────────── */

function TempTile({ value, tx, roll }) {
  const t = useT()
  const spring = useSpring(value, tx({ stiffness: 120, damping: 20 }))
  useEffect(() => { spring.set(value) }, [value, spring])
  const text = useTransform(spring, (v) => v.toFixed(1))
  const tint = value < 18 ? 'var(--info)' : value > 25 ? 'var(--err)' : 'transparent'
  const cold = value < 18; const hot = value > 25
  return (
    <div className="zl-tile zl-room" style={{ minHeight: 140, position: 'relative', overflow: 'hidden' }}>
      <motion.div animate={{ opacity: cold || hot ? 1 : 0, background: cold ? 'radial-gradient(100% 70% at 100% 0%, color-mix(in srgb, var(--info) 22%, transparent), transparent 70%)' : 'radial-gradient(100% 70% at 100% 0%, color-mix(in srgb, var(--err) 22%, transparent), transparent 70%)' }} transition={tx({ duration: 0.6 })} style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }} />
      <div className="zl-tile__row" style={{ position: 'relative' }}>
        <span className="zl-tile__icon"><Icon name="bed-double" /></span>
        <motion.span className="zl-chip zl-mono" animate={{ backgroundColor: cold ? 'color-mix(in srgb, var(--info) 18%, var(--surface))' : hot ? 'color-mix(in srgb, var(--err) 18%, var(--surface))' : 'var(--surface-2)', color: cold ? 'var(--info)' : hot ? 'var(--err-text)' : 'var(--ink-2)' }} transition={tx({ duration: 0.4 })} style={{ height: 24, fontSize: 12, borderColor: 'transparent' }}>
          {roll ? <motion.span>{text}</motion.span> : value.toFixed(1)}°
        </motion.span>
      </div>
      <div style={{ position: 'relative' }}><div className="zl-tile__name">{t({ en: 'Bedroom', he: 'חדר שינה' })}</div><div className="zl-tile__meta">{t(COPY.allOff)}</div></div>
    </div>
  )
}

function EnvDemo({ variant, tx }) {
  const [v, setV] = useState(23.0); const t = useT(); const h = useHaptic()
  return (
    <Page title={t({ en: 'Rooms', he: 'חדרים' })}>
      <div className="zl-hstack" style={{ marginBottom: 12, flexWrap: 'wrap' }}>
        {[16.5, 23.0, 27.4].map(x => <button key={x} className="zl-chip" data-on={v === x ? 'true' : 'false'} style={{ cursor: 'pointer' }} onClick={() => { setV(x); h('selection') }}>{x}°</button>)}
      </div>
      <div className="zl-grid2"><TempTile value={v} tx={tx} roll={variant === 'B'} /></div>
      <p className="zl-footnote zl-mute" style={{ marginTop: 12 }}>{variant === 'A' ? 'The chip tint crossfades between neutral, cold and hot; the number cuts (as today, plus the tint fade).' : 'The number glides through the in-between values while the chip and a corner wash change colour with it. The room got colder; you saw it happen.'}</p>
    </Page>
  )
}

/* ───────────────────────── 3. LONG-PRESS: ALL LIGHTS OFF ───────────────────────── */

function LongPressDemo({ variant, knobs, tx, ms }) {
  const t = useT(); const h = useHaptic()
  const room = ROOMS[0]
  const lights = devicesInRoom(room.id).filter(d => d.kind === 'light')
  const [on, setOn] = useState(() => Object.fromEntries(lights.map(l => [l.id, l.on])))
  const [holding, setHolding] = useState(false)
  const [toast, setToast] = useState(null)
  const progress = useMotionValue(0)
  const ctrl = useRef(null)
  const timer = useRef(null)
  const count = Object.values(on).filter(Boolean).length
  const fire = () => {
    const target = count > 0 ? false : true
    if (variant === 'A') { setOn(Object.fromEntries(lights.map(l => [l.id, target]))); setToast(`${t(room.name)} · ${target ? t(COPY.on) : t(COPY.off)}`); setTimeout(() => setToast(null), ms(2000)); h('medium'); return }
    // B: cascade, one tile after another
    lights.forEach((l, i) => setTimeout(() => { setOn(o => ({ ...o, [l.id]: target })); h('selection') }, ms(i * knobs.cascade * 1000)))
    h('medium')
  }
  const start = () => {
    setHolding(true)
    if (variant === 'B') ctrl.current = animate(progress, 1, { duration: 0.48 / 1, ease: 'linear' })
    timer.current = setTimeout(() => { setHolding(false); fire() }, ms(480))
  }
  const cancel = () => { setHolding(false); clearTimeout(timer.current); ctrl.current?.stop(); animate(progress, 0, tx({ duration: 0.16 })) }
  const dash = useTransform(progress, [0, 1], [126, 0])
  return (
    <div className="zl" style={{ position: 'absolute', inset: 0 }}>
      <Page title={t({ en: 'Rooms', he: 'חדרים' })}>
        <div className="zl-grid2">
          <motion.div className="zl-tile zl-room" animate={{ scale: holding ? 0.97 : 1 }} transition={tx({ duration: 0.16, ease: EASE.out })} style={{ minHeight: 140, position: 'relative', touchAction: 'none', userSelect: 'none' }}
            onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); start() }} onPointerUp={cancel} onPointerCancel={cancel} onPointerLeave={cancel}>
            <div className="zl-tile__row">
              <span className="zl-tile__icon" style={{ position: 'relative' }}>
                <Icon name="sofa" />
                {variant === 'B' && <svg width="44" height="44" viewBox="0 0 44 44" style={{ position: 'absolute', inset: -4, transform: 'rotate(-90deg)', pointerEvents: 'none' }}><motion.circle cx="22" cy="22" r="20" fill="none" stroke="var(--accent)" strokeWidth="2.5" strokeDasharray="126" style={{ strokeDashoffset: dash }} strokeLinecap="round" /></svg>}
              </span>
              <Dot state="occupied" />
            </div>
            <div>
              <div className="zl-tile__name">{t(room.name)}</div>
              <div className="zl-tile__meta" style={{ display: 'flex', gap: 4 }}>
                <AnimatePresence mode="popLayout" initial={false}><motion.span key={count} initial={{ y: 8, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: -8, opacity: 0 }} transition={tx({ duration: 0.18 })} style={{ display: 'inline-block', minWidth: 10 }}>{count}</motion.span></AnimatePresence>
                <span>{t({ en: 'lights on', he: 'אורות דולקים' })}</span>
              </div>
            </div>
          </motion.div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6, alignContent: 'start' }}>
            {lights.map(l => (
              <motion.div key={l.id} animate={{ background: on[l.id] ? 'var(--accent-2)' : 'var(--surface-2)', color: on[l.id] ? 'var(--accent-text)' : 'var(--ink-mute)', scale: on[l.id] ? 1 : 0.94 }} transition={tx({ duration: 0.22, ease: EASE.out })} style={{ borderRadius: 12, height: 44, display: 'grid', placeItems: 'center' }}><Icon name="lightbulb" size={18} /></motion.div>
            ))}
          </div>
        </div>
      </Page>
      <AnimatePresence>{toast && <motion.div key="t" className="zl-toast" initial={{ opacity: 0, y: 8, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -4, scale: 0.98 }} transition={tx({ duration: 0.24, ease: EASE.enter })} style={{ position: 'absolute', bottom: 20, left: 16, right: 16 }}>{toast}</motion.div>}</AnimatePresence>
      <div className="ml-hint">press and hold the room tile (480ms)</div>
    </div>
  )
}

/* ───────────────────────── 4. HOME STATUS LINE ───────────────────────── */

function StatusLine({ variant, tx }) {
  const t = useT(); const h = useHaptic()
  const [active, setActive] = useState(2)
  const awake = active > 0
  const line = awake ? t({ en: `${active} room${active === 1 ? '' : 's'} active`, he: `${active} חדרים פעילים` }) : t({ en: 'All quiet', he: 'הכל שקט' })
  const title = awake ? t({ en: 'Home is awake', he: 'הבית ער' }) : t({ en: 'Home is calm', he: 'הבית רגוע' })
  return (
    <Page>
      <div className="zl-caption zl-mute" style={{ textTransform: 'uppercase', letterSpacing: '.06em' }}>{t(COPY.greeting)}</div>
      <div style={{ minHeight: 44, marginTop: 4 }}>
        {variant === 'A' ? <h1 className="zl-large" style={{ margin: 0 }}>{title}</h1> : (
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.h1 key={title} initial={{ opacity: 0, y: 10, filter: 'blur(3px)' }} animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }} exit={{ opacity: 0, y: -10, filter: 'blur(3px)' }} transition={tx({ duration: 0.32, ease: EASE.out })} className="zl-large" style={{ margin: 0 }}>{title}</motion.h1>
          </AnimatePresence>
        )}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
        <span style={{ position: 'relative', width: 10, height: 10, display: 'grid', placeItems: 'center' }}>
          <motion.span animate={{ background: awake ? 'var(--ok)' : 'var(--line-2)', boxShadow: awake ? '0 0 0 3px color-mix(in srgb, var(--ok) 30%, transparent)' : '0 0 0 0px transparent' }} transition={tx({ duration: 0.3 })} style={{ width: 8, height: 8, borderRadius: 999 }} />
        </span>
        {variant === 'A' ? <span className="zl-subhead zl-mute">{line}</span> : (
          <AnimatePresence mode="popLayout" initial={false}><motion.span key={line} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={tx({ duration: 0.2 })} className="zl-subhead zl-mute">{line}</motion.span></AnimatePresence>
        )}
      </div>
      <div className="zl-hstack" style={{ marginTop: 24 }}>
        <Button style={{ height: 36 }} onClick={() => { setActive(a => Math.max(0, a - 1)); h('selection') }}>− {t({ en: 'room quiet', he: 'חדר שקט' })}</Button>
        <Button style={{ height: 36 }} onClick={() => { setActive(a => Math.min(6, a + 1)); h('selection') }}>+ {t({ en: 'room active', he: 'חדר פעיל' })}</Button>
      </div>
      <p className="zl-footnote zl-mute" style={{ marginTop: 16 }}>{variant === 'A' ? 'Today: the hero line and the status swap in place when the count crosses zero.' : 'The hero line leaves upward and the new one arrives from below with a 3px blur; the count line does the same, smaller. The house changed state and the page said so.'}</p>
    </Page>
  )
}

/* ───────────────────────── SECTION ───────────────────────── */

export default function Rooms() {
  return (
    <>
      <SectionIntro
        title="Rooms"
        lede="A room is a place with people in it and an environment around them. Occupancy is a property of the room, with three honest states; the tile should show all three, and show them changing."
        found={[
          'Occupancy renders as a User-glyph chip only when occupied === true; false and null are indistinguishable (Dashboard.jsx:481). The chip mounts and unmounts with no transition.',
          'data-motion-live (a breathing dot for "true right now") was specified in the motion layer and never emitted by anything.',
          'Temperature chips jump between neutral, info and err tints at 18°/25° with no transition; the number cuts.',
          'Long-press a room toggles all its lights; the feedback is a toast and a forced refetch. Nothing on the tile shows the hold or the cascade.',
          'The dashboard hero ("Home is awake" / "Home is calm") and the "{n} rooms active" line swap text in place.',
        ]}
      />

      <Demo id="occupancy" title="Room occupancy" purpose="Occupied, empty, unknown: three facts, three looks. And a change between them is an event." inZiggy={['Dashboard.jsx RoomTileFace', 'Rooms.jsx RoomTile', 'services/occupancy → binary_sensor.ziggy_room_*']}
        knobs={[{ key: 'breath', label: 'Breath period (B)', min: 1.5, max: 5, step: 0.1, value: 3, unit: 's', digits: 1 }]}
        recommend="B"
        variants={[
          { key: 'A', label: 'Chip when occupied (today)', render: (p) => <OccA {...p} /> },
          { key: 'B', label: 'Three-state dot + reason', note: 'Occupied: a green dot with a slow outward pulse (the one earned ambient loop). Empty: still. Unknown: a hollow ring. The reason line is the engine\'s, translated, never invented.', render: (p) => <OccB {...p} /> },
          { key: 'C', label: 'Ambient wash', note: 'A warm wash rises into the tile when someone is there and sinks when they leave. Unknown desaturates the tile. Survives reduced motion as pure colour.', tradeoff: 'A design change (tile has a tint), not only motion.', render: (p) => <OccC {...p} /> },
          { key: 'D', label: 'Presence arrives / leaves', note: 'A person mark enters from the tile\'s edge with a ripple, and slides back out the way it came. Direction = door.', render: (p) => <OccD {...p} /> },
          { key: 'E', label: 'Last-hour strip', note: 'A 24-bar timeline under the room; each change appends a bar. History explains the present.', tradeoff: 'Needs occupancy history from the engine (it exists in the diagnostics endpoint).', render: (p) => <OccE {...p} /> },
        ]} />

      <Demo id="environment" title="Temperature change" purpose="The room got colder. The tile should show it getting colder, not being colder." inZiggy={['Dashboard.jsx temperature chip (18°/25° thresholds)', 'Rooms.jsx tile chips']}
        recommend="B"
        variants={[
          { key: 'A', label: 'Tint crossfade', render: (p) => <EnvDemo {...p} variant="A" /> },
          { key: 'B', label: 'Number glides + corner wash', render: (p) => <EnvDemo {...p} variant="B" /> },
        ]} />

      <Demo id="longpress" title="Long-press: all lights off" purpose="A hold is intent building up; the result is several things happening. Show both." inZiggy={['gestures.js useLongPress (480ms)', 'Rooms.jsx toggleRoomLights', 'Dashboard.jsx useRoomTileMotion']}
        knobs={[{ key: 'cascade', label: 'Cascade gap (B)', min: 0, max: 0.2, step: 0.01, value: 0.07, unit: 'ms' }]}
        recommend="B"
        variants={[
          { key: 'A', label: 'Toast (today)', note: 'Hold 480ms; a toast says "Living Room · Off". The lights re-render after the refetch.', render: (p) => <LongPressDemo {...p} variant="A" /> },
          { key: 'B', label: 'Progress ring + cascade', note: 'A ring fills around the room icon while you hold (so you know it is a hold); on commit the room\'s lights go off one after another, 70ms apart, and the count rolls down. No toast.', render: (p) => <LongPressDemo {...p} variant="B" /> },
        ]} />

      <Demo id="status" title="Home status line" purpose="The dashboard's first line is the house's mood. When it changes, let it change." inZiggy={['Dashboard.jsx:1245-1279 greeting block']}
        recommend="B"
        variants={[
          { key: 'A', label: 'Swap (today)', render: (p) => <StatusLine {...p} variant="A" /> },
          { key: 'B', label: 'Line replaces line', note: 'Old line leaves up with a 3px blur, new line arrives from below. The dot\'s halo grows. 320ms; rare enough to be a moment.', render: (p) => <StatusLine {...p} variant="B" /> },
        ]} />
    </>
  )
}
