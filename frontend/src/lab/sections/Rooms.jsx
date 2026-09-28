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

function OccF({ tx }) {
  // "Light under the door": a 3px strip along the tile's leading edge. Warm
  // when someone is there, it cools and fades when they leave, dim grey when
  // we cannot see. Pure colour, so it survives reduced motion intact.
  const [state, setState] = useOcc(); const t = useT()
  const strip = {
    occupied: { background: 'color-mix(in srgb, var(--accent) 85%, #ffd166)', opacity: 1 },
    empty: { background: 'var(--info)', opacity: 0 },
    unknown: { background: 'var(--line-3)', opacity: 0.7 },
  }[state]
  const trans = state === 'occupied' ? tx({ duration: 0.6, ease: EASE.out }) : state === 'empty' ? tx({ background: { duration: 0.2 }, opacity: { duration: 0.45, delay: 0.1, ease: EASE.out } }) : tx({ duration: 0.4 })
  return (
    <OccFrame state={state} setState={setState} t={t}>
      <RoomTileBase state={state} t={t}>
        <Dot state={state} />
        {/* the glow (blurred, wider) and the strip (crisp, 3px) share one animate */}
        <motion.span initial={false} animate={strip} transition={trans} style={{ position: 'absolute', insetInlineStart: 4, top: 10, bottom: 10, width: 6, borderRadius: 3, filter: 'blur(6px)', pointerEvents: 'none', zIndex: 0 }} />
        <motion.span initial={false} animate={strip} transition={trans} style={{ position: 'absolute', insetInlineStart: 5, top: 12, bottom: 12, width: 3, borderRadius: 2, pointerEvents: 'none', zIndex: 0 }} />
      </RoomTileBase>
      <p className="zl-footnote zl-mute" style={{ gridColumn: '1 / -1' }}>{t({ en: 'The strip is the light showing under a door: warm when someone is in, cooling to blue then gone when they leave, dim grey when the sensor is silent. Three states in one 3px element, on the leading edge, so it also reads in Hebrew.', he: 'הפס הוא האור שנראה מתחת לדלת: חם כשמישהו בפנים, מתקרר לכחול ונעלם כשיוצאים, אפור עמום כשהחיישן שותק.' })}</p>
    </OccFrame>
  )
}

function OccG({ tx }) {
  // "Room breathes": occupied breathes the whole tile very slowly; empty is
  // still; unknown desaturates the icon box and fades only the '?'.
  const [state, setState] = useOcc(); const t = useT()
  const occ = state === 'occupied'; const unk = state === 'unknown'
  return (
    <OccFrame state={state} setState={setState} t={t}>
      <motion.div animate={occ ? { scale: [1, 1.008, 1] } : { scale: 1 }} transition={occ ? tx({ duration: 4, repeat: Infinity, ease: 'easeInOut' }) : tx({ duration: 0.3, ease: EASE.out })} style={{ transformOrigin: 'center', willChange: 'transform' }}>
        <div className="zl-tile zl-room" style={{ minHeight: 140, position: 'relative', overflow: 'hidden' }}>
          <div className="zl-tile__row" style={{ position: 'relative', zIndex: 1 }}>
            <motion.span className="zl-tile__icon" animate={occ ? { opacity: [0.9, 1, 0.9], filter: 'saturate(1)' } : unk ? { opacity: 1, filter: 'saturate(0)' } : { opacity: 1, filter: 'saturate(1)' }} transition={occ ? tx({ opacity: { duration: 4, repeat: Infinity, ease: 'easeInOut' }, filter: { duration: 0.4 } }) : tx({ duration: 0.4 })} style={{ position: 'relative' }}>
              <Icon name="sofa" />
              <AnimatePresence>
                {unk && <motion.span key="q" initial={{ opacity: 0 }} animate={{ opacity: [0.6, 1, 0.6] }} exit={{ opacity: 0, transition: tx({ duration: 0.16 }) }} transition={tx({ duration: 2.4, repeat: Infinity, ease: 'easeInOut' })} className="zl-caption" style={{ position: 'absolute', top: -5, insetInlineEnd: -5, width: 14, height: 14, borderRadius: 999, background: 'var(--surface)', border: '1px solid var(--line-3)', color: 'var(--ink-mute)', display: 'grid', placeItems: 'center', fontFamily: 'var(--ml-mono)', fontSize: 9, lineHeight: 1 }}>?</motion.span>}
              </AnimatePresence>
            </motion.span>
            <Dot state={state} />
          </div>
          <div style={{ position: 'relative', zIndex: 1 }}><div className="zl-tile__name">{t({ en: 'Living Room', he: 'סלון' })}</div><div className="zl-tile__meta">2 {t({ en: 'lights on', he: 'אורות דולקים' })} · 24.5°</div></div>
        </div>
      </motion.div>
      <p className="zl-footnote zl-mute" style={{ gridColumn: '1 / -1' }}>{t({ en: 'Occupied: the whole tile breathes, 0.8% over 4s, and the icon box brightens with it. Empty: perfectly still. Unknown: the icon box loses its colour and only the "?" fades slowly. The ambient-loop rule: a loop is earned by "true right now", and here it is the room itself that is alive.', he: 'יש מישהו: כל האריח נושם. ריק: דומם לגמרי. לא ידוע: תיבת האייקון מאבדת צבע ורק סימן השאלה דוהה לאט.' })}</p>
    </OccFrame>
  )
}

/* ───────────────────────── 2. ENVIRONMENT (TEMPERATURE) ───────────────────────── */

// Thermal palette: --info at 16°, neutral at 22°, --err at 28° (clamped).
const thermalMix = (v, max = 26) => {
  const d = v - 22
  const pct = Math.min(1, Math.abs(d) / 6) * max
  return d < 0 ? `color-mix(in srgb, var(--info) ${pct.toFixed(1)}%, var(--surface))` : `color-mix(in srgb, var(--err) ${pct.toFixed(1)}%, var(--surface))`
}

function TempTile({ value, tx, variant = 'A' }) {
  const t = useT()
  const roll = variant !== 'A'; const thermal = variant === 'C'
  const spring = useSpring(value, tx({ stiffness: 120, damping: 20 }))
  useEffect(() => { spring.set(value) }, [value, spring])
  const text = useTransform(spring, (v) => v.toFixed(1))
  // C: the tile's background is a function of the live value, not of a threshold
  const bg = useTransform(spring, (v) => thermalMix(v))
  const iconBg = useTransform(spring, (v) => thermalMix(v, 45))
  const cold = value < 18; const hot = value > 25
  const prev = useRef(value); const [trend, setTrend] = useState(0)
  useEffect(() => { setTrend(Math.sign(value - prev.current)); prev.current = value }, [value])
  return (
    <motion.div className="zl-tile zl-room" style={{ minHeight: 140, position: 'relative', overflow: 'hidden', background: thermal ? bg : undefined }}>
      {!thermal && <motion.div animate={{ opacity: cold || hot ? 1 : 0, background: cold ? 'radial-gradient(100% 70% at 100% 0%, color-mix(in srgb, var(--info) 22%, transparent), transparent 70%)' : 'radial-gradient(100% 70% at 100% 0%, color-mix(in srgb, var(--err) 22%, transparent), transparent 70%)' }} transition={tx({ duration: 0.6 })} style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }} />}
      <div className="zl-tile__row" style={{ position: 'relative' }}>
        <motion.span className="zl-tile__icon" style={{ background: thermal ? iconBg : undefined }}><Icon name="bed-double" /></motion.span>
        {thermal ? (
          <span className="zl-chip zl-mono" style={{ height: 24, fontSize: 12, borderColor: 'transparent', background: 'color-mix(in srgb, var(--surface) 70%, transparent)', gap: 3 }}>
            <motion.span>{text}</motion.span>°
            <AnimatePresence mode="popLayout">
              {trend !== 0 && <motion.span key={trend + '-' + value} initial={{ opacity: 0, y: trend > 0 ? 4 : -4 }} animate={{ opacity: [0, 1, 1, 0], y: 0 }} transition={tx({ duration: 1.8, times: [0, 0.12, 0.7, 1] })} style={{ display: 'inline-block', fontSize: 9, color: trend > 0 ? 'var(--err-text)' : 'var(--info)', lineHeight: 1 }}>{trend > 0 ? '▲' : '▼'}</motion.span>}
            </AnimatePresence>
          </span>
        ) : (
          <motion.span className="zl-chip zl-mono" animate={{ backgroundColor: cold ? 'color-mix(in srgb, var(--info) 18%, var(--surface))' : hot ? 'color-mix(in srgb, var(--err) 18%, var(--surface))' : 'var(--surface-2)', color: cold ? 'var(--info)' : hot ? 'var(--err-text)' : 'var(--ink-2)' }} transition={tx({ duration: 0.4 })} style={{ height: 24, fontSize: 12, borderColor: 'transparent' }}>
            {roll ? <motion.span>{text}</motion.span> : value.toFixed(1)}°
          </motion.span>
        )}
      </div>
      <div style={{ position: 'relative' }}><div className="zl-tile__name">{t({ en: 'Bedroom', he: 'חדר שינה' })}</div><div className="zl-tile__meta">{t(COPY.allOff)}</div></div>
    </motion.div>
  )
}

function EnvDemo({ variant, tx }) {
  const [v, setV] = useState(23.0); const t = useT(); const h = useHaptic()
  const steps = variant === 'C' ? [16.5, 19.8, 23.0, 25.2, 27.4] : [16.5, 23.0, 27.4]
  return (
    <Page title={t({ en: 'Rooms', he: 'חדרים' })}>
      <div className="zl-hstack" style={{ marginBottom: 12, flexWrap: 'wrap' }}>
        {steps.map(x => <button key={x} className="zl-chip" data-on={v === x ? 'true' : 'false'} style={{ cursor: 'pointer' }} onClick={() => { setV(x); h('selection') }}>{x}°</button>)}
      </div>
      <div className="zl-grid2"><TempTile value={v} tx={tx} variant={variant} /></div>
      <p className="zl-footnote zl-mute" style={{ marginTop: 12 }}>{variant === 'A' ? 'The chip tint crossfades between neutral, cold and hot; the number cuts (as today, plus the tint fade).' : variant === 'B' ? 'The number glides through the in-between values while the chip and a corner wash change colour with it. The room got colder; you saw it happen.' : 'There are no thresholds. The tile\'s background is a continuous function of the value (blue at 16°, neutral at 22°, red at 28°), computed from the same spring that drives the number, so colour and digits can never disagree. A small ▲/▼ says which way it went, then leaves.'}</p>
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
  const iconRef = useRef(null)
  const lightRefs = useRef({})
  const [ranks, setRanks] = useState({}) // C: light id → distance rank, shown after a commit
  const count = Object.values(on).filter(Boolean).length
  const fire = () => {
    const target = count > 0 ? false : true
    if (variant === 'A') { setOn(Object.fromEntries(lights.map(l => [l.id, target]))); setToast(`${t(room.name)} · ${target ? t(COPY.on) : t(COPY.off)}`); setTimeout(() => setToast(null), ms(2000)); h('medium'); return }
    if (variant === 'C') {
      // distance order from the room icon's centre; 70ms per rank
      const ic = iconRef.current?.getBoundingClientRect()
      const cx = ic ? ic.left + ic.width / 2 : 0, cy = ic ? ic.top + ic.height / 2 : 0
      const ordered = lights.map(l => { const r = lightRefs.current[l.id]?.getBoundingClientRect(); const d = r ? Math.hypot(r.left + r.width / 2 - cx, r.top + r.height / 2 - cy) : 0; return { l, d } }).sort((a, b) => a.d - b.d)
      setRanks(Object.fromEntries(ordered.map((o, i) => [o.l.id, i + 1])))
      ordered.forEach(({ l }, i) => setTimeout(() => { setOn(o => ({ ...o, [l.id]: target })); h('selection') }, ms(i * knobs.cascade * 1000)))
      h('medium'); return
    }
    // B: cascade, one tile after another
    lights.forEach((l, i) => setTimeout(() => { setOn(o => ({ ...o, [l.id]: target })); h('selection') }, ms(i * knobs.cascade * 1000)))
    h('medium')
  }
  const start = () => {
    setHolding(true)
    if (variant === 'B') ctrl.current = animate(progress, 1, tx({ duration: 0.48, ease: 'linear' }))
    timer.current = setTimeout(() => { setHolding(false); fire() }, ms(480))
  }
  const cancel = () => { setHolding(false); clearTimeout(timer.current); ctrl.current?.stop(); animate(progress, 0, tx({ duration: 0.16 })) }
  const dash = useTransform(progress, [0, 1], [126, 0])
  const lightTile = (l, extraStyle) => (
    <motion.div key={l.id} ref={(el) => { lightRefs.current[l.id] = el }} animate={{ background: on[l.id] ? 'var(--accent-2)' : 'var(--surface-2)', color: on[l.id] ? 'var(--accent-text)' : 'var(--ink-mute)', scale: on[l.id] ? 1 : 0.94 }} transition={tx({ duration: 0.22, ease: EASE.out })} style={{ borderRadius: 12, height: 44, display: 'grid', placeItems: 'center', position: 'relative', ...extraStyle }}>
      <Icon name="lightbulb" size={18} />
      {variant === 'C' && ranks[l.id] && <span className="zl-caption" style={{ position: 'absolute', top: 3, insetInlineEnd: 5, fontFamily: 'var(--ml-mono)', fontSize: 9, opacity: 0.6 }}>{ranks[l.id]}</span>}
    </motion.div>
  )
  return (
    <div className="zl" style={{ position: 'absolute', inset: 0 }}>
      <Page title={t({ en: 'Rooms', he: 'חדרים' })}>
        <div className="zl-grid2">
          <motion.div className="zl-tile zl-room" animate={{ scale: holding ? 0.97 : 1 }} transition={tx({ duration: 0.16, ease: EASE.out })} style={{ minHeight: 140, position: 'relative', touchAction: 'none', userSelect: 'none', overflow: 'visible', zIndex: 1 }}
            onPointerDown={(e) => { try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* synthetic pointer */ } start() }} onPointerUp={cancel} onPointerCancel={cancel} onPointerLeave={cancel}>
            <div className="zl-tile__row">
              <span className="zl-tile__icon" ref={iconRef} style={{ position: 'relative', overflow: 'visible' }}>
                <Icon name="sofa" />
                {variant === 'B' && <svg width="44" height="44" viewBox="0 0 44 44" style={{ position: 'absolute', inset: -4, transform: 'rotate(-90deg)', pointerEvents: 'none' }}><motion.circle cx="22" cy="22" r="20" fill="none" stroke="var(--accent)" strokeWidth="2.5" strokeDasharray="126" style={{ strokeDashoffset: dash }} strokeLinecap="round" /></svg>}
                {variant === 'C' && (
                  <AnimatePresence>
                    {holding && [0, 1, 2].map(i => (
                      <motion.span key={'ring' + i} initial={{ scale: 1, opacity: 0 }} animate={{ scale: [1, 5.5], opacity: [0.55, 0] }} exit={{ opacity: 0, transition: tx({ duration: 0.12 }) }} transition={tx({ duration: 1.8, delay: i * 0.6, repeat: Infinity, ease: EASE.out })}
                        style={{ position: 'absolute', inset: 0, borderRadius: 12, border: '1.5px solid var(--accent)', pointerEvents: 'none' }} />
                    ))}
                  </AnimatePresence>
                )}
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
          {variant === 'C' ? (
            // the lights sit at different distances from the icon, so the order is visible
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gridTemplateRows: '44px 44px', gap: 6, alignContent: 'start' }}>
              {lightTile(lights[0], { gridColumn: 1, gridRow: 1 })}
              {lightTile(lights[1], { gridColumn: 3, gridRow: 1 })}
              {lightTile(lights[2], { gridColumn: 2, gridRow: 2 })}
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6, alignContent: 'start' }}>
              {lights.map(l => lightTile(l))}
            </div>
          )}
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
  // C: the hero line split into a fixed stem and the one word that changes
  const stem = t({ en: 'Home is', he: 'הבית' })
  const word = awake ? t({ en: 'awake', he: 'ער' }) : t({ en: 'calm', he: 'רגוע' })
  const wordTx = tx({ duration: 0.28, ease: EASE.out })
  return (
    <Page>
      <div className="zl-caption zl-mute" style={{ textTransform: 'uppercase', letterSpacing: '.06em' }}>{t(COPY.greeting)}</div>
      <div style={{ minHeight: 44, marginTop: 4 }}>
        {variant === 'A' ? <h1 className="zl-large" style={{ margin: 0 }}>{title}</h1> : variant === 'C' ? (
          <h1 className="zl-large" style={{ margin: 0, display: 'flex', gap: '0.28em', alignItems: 'baseline' }}>
            <span>{stem}</span>
            <span style={{ position: 'relative', display: 'inline-grid' }}>
              <AnimatePresence mode="popLayout" initial={false}>
                <motion.span key={word} layout initial={{ opacity: 0, y: 8, filter: 'blur(4px)' }} animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }} exit={{ opacity: 0, y: -8, filter: 'blur(4px)', transition: tx({ duration: 0.18, ease: EASE.out }) }} transition={wordTx} style={{ display: 'inline-block', color: awake ? 'var(--ink)' : 'var(--ink-2)' }}>{word}</motion.span>
              </AnimatePresence>
            </span>
          </h1>
        ) : (
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.h1 key={title} initial={{ opacity: 0, y: 10, filter: 'blur(3px)' }} animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }} exit={{ opacity: 0, y: -10, filter: 'blur(3px)' }} transition={tx({ duration: 0.32, ease: EASE.out })} className="zl-large" style={{ margin: 0 }}>{title}</motion.h1>
          </AnimatePresence>
        )}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
        <span style={{ position: 'relative', width: 10, height: 10, display: 'grid', placeItems: 'center' }}>
          <motion.span animate={{ background: awake ? 'var(--ok)' : 'var(--line-2)', boxShadow: awake ? (variant === 'C' ? '0 0 0 5px color-mix(in srgb, var(--ok) 22%, transparent)' : '0 0 0 3px color-mix(in srgb, var(--ok) 30%, transparent)') : '0 0 0 0px transparent' }} transition={variant === 'C' ? tx({ type: 'spring', duration: 0.5, bounce: 0.2 }) : tx({ duration: 0.3 })} style={{ width: 8, height: 8, borderRadius: 999 }} />
        </span>
        {variant === 'A' ? <span className="zl-subhead zl-mute">{line}</span> : variant === 'C' ? (
          // only the number rolls; "rooms active" stays put. Crossing zero swaps the whole phrase (it has to).
          <span className="zl-subhead zl-mute" style={{ display: 'inline-flex', gap: 4 }}>
            <AnimatePresence mode="popLayout" initial={false}>
              {awake ? (
                <motion.span key="n" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={tx({ duration: 0.16 })} style={{ display: 'inline-flex', gap: 4 }}>
                  <span style={{ display: 'inline-grid', minWidth: '0.7em' }}><AnimatePresence mode="popLayout" initial={false}><motion.span key={active} initial={{ y: 8, opacity: 0, filter: 'blur(2px)' }} animate={{ y: 0, opacity: 1, filter: 'blur(0px)' }} exit={{ y: -8, opacity: 0, filter: 'blur(2px)', transition: tx({ duration: 0.14 }) }} transition={tx({ duration: 0.22, ease: EASE.out })} className="zl-mono" style={{ display: 'inline-block' }}>{active}</motion.span></AnimatePresence></span>
                  <span>{t({ en: `room${active === 1 ? '' : 's'} active`, he: 'חדרים פעילים' })}</span>
                </motion.span>
              ) : <motion.span key="q" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={tx({ duration: 0.2 })}>{t({ en: 'All quiet', he: 'הכל שקט' })}</motion.span>}
            </AnimatePresence>
          </span>
        ) : (
          <AnimatePresence mode="popLayout" initial={false}><motion.span key={line} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={tx({ duration: 0.2 })} className="zl-subhead zl-mute">{line}</motion.span></AnimatePresence>
        )}
      </div>
      <div className="zl-hstack" style={{ marginTop: 24 }}>
        <Button style={{ height: 36 }} onClick={() => { setActive(a => Math.max(0, a - 1)); h('selection') }}>− {t({ en: 'room quiet', he: 'חדר שקט' })}</Button>
        <Button style={{ height: 36 }} onClick={() => { setActive(a => Math.min(6, a + 1)); h('selection') }}>+ {t({ en: 'room active', he: 'חדר פעיל' })}</Button>
      </div>
      <p className="zl-footnote zl-mute" style={{ marginTop: 16 }}>{variant === 'A' ? 'Today: the hero line and the status swap in place when the count crosses zero.' : variant === 'B' ? 'The hero line leaves upward and the new one arrives from below with a 3px blur; the count line does the same, smaller. The house changed state and the page said so.' : '"Home is" never moves. Only "awake" ↔ "calm" crossfades, with a blur and 8px of travel, and the dot\'s halo springs wider. In the count line only the digit rolls. The eye is told exactly what changed and nothing else.'}</p>
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

      <Demo id="occupancy" title="Room occupancy" purpose="Occupied, empty, unknown: three facts, three looks. And a change between them is an event." principles={['state', 'restraint']} inZiggy={['Dashboard.jsx RoomTileFace', 'Rooms.jsx RoomTile', 'services/occupancy → binary_sensor.ziggy_room_*']}
        knobs={[{ key: 'breath', label: 'Breath period (B)', min: 1.5, max: 5, step: 0.1, value: 3, unit: 's', digits: 1 }]}
        recommend="F"
        variants={[
          { key: 'A', label: 'Chip when occupied (today)', render: (p) => <OccA {...p} /> },
          { key: 'B', label: 'Three-state dot + reason', note: 'Occupied: a green dot with a slow outward pulse (the one earned ambient loop). Empty: still. Unknown: a hollow ring. The reason line is the engine\'s, translated, never invented.', render: (p) => <OccB {...p} /> },
          { key: 'C', label: 'Ambient wash', note: 'A warm wash rises into the tile when someone is there and sinks when they leave. Unknown desaturates the tile. Survives reduced motion as pure colour.', tradeoff: 'A design change (tile has a tint), not only motion.', render: (p) => <OccC {...p} /> },
          { key: 'D', label: 'Presence arrives / leaves', note: 'A person mark enters from the tile\'s edge with a ripple, and slides back out the way it came. Direction = door.', render: (p) => <OccD {...p} /> },
          { key: 'E', label: 'Last-hour strip', note: 'A 24-bar timeline under the room; each change appends a bar. History explains the present.', tradeoff: 'Needs occupancy history from the engine (it exists in the diagnostics endpoint).', render: (p) => <OccE {...p} /> },
          { key: 'F', label: 'Light under the door', note: 'Recommended. A 3px strip on the tile\'s leading edge, blurred 6px: warm when someone is in, cooling to blue and fading when they leave, dim grey when the sensor is silent. Three states in one small element, no loop, no chip, and it degrades to plain colour under reduced motion. It wins over B because it says the same three things with less, on every tile, without a pulse.', tradeoff: 'Subtle by design; pair it with B\'s reason line on the room page, where there is space.', spec: () => 'enter 600 ms ease-out · leave 200 ms cool + 450 ms fade · unknown 400 ms', render: (p) => <OccF {...p} /> },
          { key: 'G', label: 'Room breathes', note: 'The whole tile breathes while occupied (1 → 1.008 → 1 over 4s; the icon box brightens with it), sits perfectly still when empty, and when unknown the icon box loses its colour and only the "?" fades slowly. The ambient-loop rule is honoured: the loop means "alive right now".', tradeoff: 'A transform on the whole tile shimmers text at fractional scales, and a grid of seven breathing rooms is seven loops. Empty-vs-still is easy to miss on a single tile.', spec: () => 'breath 4000 ms easeInOut loop · unknown "?" 2400 ms loop', render: (p) => <OccG {...p} /> },
        ]} />

      <Demo id="environment" title="Temperature change" purpose="The room got colder. The tile should show it getting colder, not being colder." principles={['state', 'continuity']} inZiggy={['Dashboard.jsx temperature chip (18°/25° thresholds)', 'Rooms.jsx tile chips']}
        recommend="C"
        variants={[
          { key: 'A', label: 'Tint crossfade', note: 'The chip tint crossfades at the 18° / 25° thresholds; the number cuts.', render: (p) => <EnvDemo {...p} variant="A" /> },
          { key: 'B', label: 'Number glides + corner wash', note: 'The number glides on a spring while the chip and a corner wash change colour with it.', render: (p) => <EnvDemo {...p} variant="B" /> },
          { key: 'C', label: 'Thermal shift', note: 'Recommended. No thresholds: the tile background is a continuous color-mix of --info (16°) through neutral (22°) to --err (28°), computed by useTransform from the same spring that drives the digits, so colour and number cannot disagree; a small ▲/▼ says the direction and leaves. The environment IS the tile. It wins because 19.8° looks slightly cool and 25.2° slightly warm, which is the truth.', tradeoff: 'A design change: room tiles gain a tint that must be tuned per palette (dark mode needs lower mix percentages).', spec: () => 'spring stiffness 120 / damping 20 · mix ≤ 26% tile, ≤ 45% icon box · arrow 1800 ms', render: (p) => <EnvDemo {...p} variant="C" /> },
        ]} />

      <Demo id="longpress" title="Long-press: all lights off" purpose="A hold is intent building up; the result is several things happening. Show both." principles={['causality', 'physical']} inZiggy={['gestures.js useLongPress (480ms)', 'Rooms.jsx toggleRoomLights', 'Dashboard.jsx useRoomTileMotion']}
        knobs={[{ key: 'cascade', label: 'Cascade gap (B, C)', min: 0, max: 0.2, step: 0.01, value: 0.07, unit: 'ms' }]}
        recommend="B"
        variants={[
          { key: 'A', label: 'Toast (today)', note: 'Hold 480ms; a toast says "Living Room · Off". The lights re-render after the refetch.', render: (p) => <LongPressDemo {...p} variant="A" /> },
          { key: 'B', label: 'Progress ring + cascade', note: 'Recommended. A ring fills around the room icon while you hold (so you know it is a hold, and how long); on commit the room\'s lights go off one after another, 70ms apart, and the count rolls down. No toast. It wins over C because the ring is a bounded progress: it tells you when the hold will land.', render: (p) => <LongPressDemo {...p} variant="B" /> },
          { key: 'C', label: 'Rings out from the icon', note: 'While holding, concentric rings emanate from the room icon (three, 600ms apart) as if the intent were radiating into the room; on commit the lights go off in distance order from that icon (each light\'s distance to the icon centre is measured, then staggered 70ms per rank; the rank is shown on each light). The cause is a place, and the effect spreads from it.', tradeoff: 'The rings say "something is building" but not "how long"; combine with B\'s ring if the hold length matters. Distance order needs real positions (a floor plan), which the grid only approximates.', spec: (k) => `rings 1800 ms, 600 ms apart · cascade ${Math.round(k.cascade * 1000)} ms per rank`, render: (p) => <LongPressDemo {...p} variant="C" /> },
        ]} />

      <Demo id="status" title="Home status line" purpose="The dashboard's first line is the house's mood. When it changes, let it change." principles={['state', 'restraint']} inZiggy={['Dashboard.jsx:1245-1279 greeting block']}
        recommend="C"
        variants={[
          { key: 'A', label: 'Swap (today)', render: (p) => <StatusLine {...p} variant="A" /> },
          { key: 'B', label: 'Line replaces line', note: 'Old line leaves up with a 3px blur, new line arrives from below. The dot\'s halo grows. 320ms; rare enough to be a moment.', render: (p) => <StatusLine {...p} variant="B" /> },
          { key: 'C', label: 'Only the word changes', note: 'Recommended, and usually the best one. The hero line is split into words; "Home is" never moves, only "awake" ↔ "calm" crossfades with a 4px blur and 8px of travel, and the dot\'s halo springs wider. In the count line only the digit rolls. The eye is told exactly what changed. Restraint: the event is one word, so one word moves.', tradeoff: 'Word-level splitting must be done per language ("הבית ער" has a different stem); the copy layer has to expose the parts, not a sentence.', spec: () => 'word in 280 ms ease-out · out 180 ms · halo spring 500 ms b0.2', render: (p) => <StatusLine {...p} variant="C" /> },
        ]} />
    </>
  )
}
