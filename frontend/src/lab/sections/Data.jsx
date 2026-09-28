// Motion Lab — DATA
// Live numbers, history sparklines, battery/signal, confidence meters,
// counts and badges, time-based progress.
import { useState, useRef, useEffect } from 'react'
import { motion, AnimatePresence, useMotionValue, useSpring, useTransform, animate } from 'framer-motion'
import { Demo } from '../ui/Demo'
import { SectionIntro } from '../ui/Section'
import { Icon, Page, Card, Button, useT } from '../ziggy/primitives'
import { useHaptic } from '../LabContext'
import { EASE } from '../time'

/* ───────────────────────── digits ───────────────────────── */

function RollingNumber({ value, digits = 1, tx, dur = 0.45, size = 44 }) {
  const str = value.toFixed(digits)
  return (
    <span className="zl-mono" style={{ display: 'inline-flex', fontSize: size, lineHeight: 1, fontWeight: 700, letterSpacing: '-0.02em' }}>
      {str.split('').map((c, i) => c === '.' || c === '-' ? <span key={'s' + i}>{c}</span> : (
        <span key={i} style={{ display: 'inline-block', position: 'relative', height: '1em', width: '0.6em', overflow: 'hidden' }}>
          <motion.span animate={{ y: `-${Number(c)}em` }} transition={tx({ type: 'spring', duration: dur, bounce: 0.05 })} style={{ display: 'block' }}>
            {Array.from({ length: 10 }).map((_, d) => <span key={d} style={{ display: 'block', height: '1em', textAlign: 'center' }}>{d}</span>)}
          </motion.span>
        </span>
      ))}
    </span>
  )
}

function SpringNumber({ value, digits = 1, tx, size = 44 }) {
  const mv = useSpring(value, tx({ stiffness: 140, damping: 22 }))
  useEffect(() => { mv.set(value) }, [value, mv])
  const text = useTransform(mv, (v) => v.toFixed(digits))
  return <motion.span className="zl-mono" style={{ fontSize: size, lineHeight: 1, fontWeight: 700, letterSpacing: '-0.02em' }}>{text}</motion.span>
}

// "Blur-swap digits": the string is compared per character; only a character
// that changed blurs out (up) and its replacement blurs in (from below).
// Unchanged characters never move. Digits sit in fixed 0.6em cells so a swap
// cannot shift its neighbours; the whole thing is an LTR island.
function BlurDigits({ value, digits = 1, tx, size = 44 }) {
  const str = value.toFixed(digits)
  return (
    <span className="zl-mono" dir="ltr" style={{ display: 'inline-flex', fontSize: size, lineHeight: 1, fontWeight: 700, letterSpacing: '-0.02em' }}>
      {str.split('').map((c, i) => {
        const sep = c === '.' || c === '-' || c === ','
        return (
          <span key={'cell' + i} style={{ display: 'inline-grid', width: sep ? '0.3em' : '0.6em', height: '1em', justifyItems: 'center', overflow: 'visible' }}>
            <AnimatePresence mode="popLayout" initial={false}>
              <motion.span key={c} initial={{ opacity: 0, y: '0.14em', filter: 'blur(4px)' }} animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }} exit={{ opacity: 0, y: '-0.14em', filter: 'blur(4px)' }} transition={tx({ duration: 0.22, ease: EASE.out })} style={{ display: 'block', gridArea: '1 / 1' }}>{c}</motion.span>
            </AnimatePresence>
          </span>
        )
      })}
    </span>
  )
}

/* ───────────────────────── 1. LIVE READOUT ───────────────────────── */

function useLiveSensor(ms, auto) {
  const [temp, setTemp] = useState(24.5)
  const [hum, setHum] = useState(41)
  const [watts, setWatts] = useState(1180)
  const tick = () => { setTemp(v => +(v + (Math.random() - 0.5) * 0.6).toFixed(1)); setHum(v => Math.max(20, Math.min(80, v + Math.round((Math.random() - 0.5) * 4)))); setWatts(v => Math.max(0, Math.round(v + (Math.random() - 0.5) * 300))) }
  useEffect(() => { if (!auto) return; const id = setInterval(tick, ms(1800)); return () => clearInterval(id) }, [auto, ms])
  return { temp, hum, watts, tick }
}

function ReadoutDemo({ variant, tx, ms }) {
  const t = useT(); const h = useHaptic()
  const [auto, setAuto] = useState(false)
  const s = useLiveSensor(ms, auto)
  const prev = useRef(s.temp); const [trend, setTrend] = useState(0)
  useEffect(() => { setTrend(Math.sign(s.temp - prev.current)); prev.current = s.temp }, [s.temp])
  // a render helper, not a component: a component defined in render remounts on every
  // tick, which would reset the roll / blur-swap before it could play
  const num = (v, d, size) => variant === 'A' ? <span className="zl-mono" style={{ fontSize: size, lineHeight: 1, fontWeight: 700, letterSpacing: '-0.02em' }}>{v.toFixed(d)}</span> : variant === 'B' ? <RollingNumber value={v} digits={d} tx={tx} size={size} /> : variant === 'D' ? <BlurDigits value={v} digits={d} tx={tx} size={size} /> : <SpringNumber value={v} digits={d} tx={tx} size={size} />
  return (
    <Page title={t({ en: 'Living Room', he: 'סלון' })}>
      <div className="zl-hstack" style={{ marginBottom: 12 }}><Button style={{ height: 36 }} onClick={() => { s.tick(); h('selection') }}>{t({ en: 'Sensor reports', he: 'החיישן מדווח' })}</Button><Button style={{ height: 36 }} onClick={() => setAuto(a => !a)}>{auto ? t({ en: 'Stop live', he: 'עצור' }) : t({ en: 'Go live', he: 'שידור חי' })}</Button></div>
      <div className="zl-stack">
        <Card style={{ display: 'flex', alignItems: 'flex-end', gap: 12 }}>
          <div style={{ flex: 1 }}><div className="zl-footnote zl-mute">{t({ en: 'Temperature', he: 'טמפרטורה' })}</div><div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>{num(s.temp, 1, 44)}<span className="zl-title3 zl-mute">°C</span>
            {variant === 'C' && <AnimatePresence mode="popLayout">{trend !== 0 && <motion.span key={trend + s.temp} initial={{ opacity: 0, y: trend > 0 ? 6 : -6 }} animate={{ opacity: [0, 1, 1, 0], y: 0 }} transition={tx({ duration: 1.6, times: [0, 0.15, 0.7, 1] })} style={{ color: trend > 0 ? 'var(--err-text)' : 'var(--info)', display: 'grid', alignSelf: 'center' }}><Icon name="arrow-left" size={16} style={{ transform: `rotate(${trend > 0 ? 90 : -90}deg)` }} /></motion.span>}</AnimatePresence>}
          </div></div>
          <span className="zl-row__icon"><Icon name="thermometer" /></span>
        </Card>
        <div className="zl-grid2">
          <Card><div className="zl-footnote zl-mute">{t({ en: 'Humidity', he: 'לחות' })}</div><div style={{ display: 'flex', alignItems: 'baseline', gap: 2 }}>{num(s.hum, 0, 32)}<span className="zl-subhead zl-mute">%</span></div></Card>
          <Card><div className="zl-footnote zl-mute">{t({ en: 'Water heater', he: 'דוד' })}</div><div style={{ display: 'flex', alignItems: 'baseline', gap: 2 }}>{num(s.watts, 0, 32)}<span className="zl-subhead zl-mute">W</span></div></Card>
        </div>
      </div>
      <p className="zl-footnote zl-mute" style={{ marginTop: 12 }}>{variant === 'A' ? 'Today: every number cuts. Live sensors make the page flicker with unexplained swaps.' : variant === 'B' ? 'Each digit rolls to its new value. Direction of roll = direction of change. Digits that did not change stay still.' : variant === 'D' ? 'Each character is compared with its predecessor. Only a digit that changed blurs out upward and its replacement blurs in from below (220ms); the rest never move. 24.5 → 24.7 moves one glyph. The Apple Weather grammar.' : 'The value glides through the in-between numbers on a spring, and a brief arrow says which way it went. Reads as a gauge, not a label.'}</p>
    </Page>
  )
}

/* ───────────────────────── 2. SPARKLINE ───────────────────────── */

function Sparkline({ data, w = 320, h = 80, tx, live }) {
  const min = Math.min(...data), max = Math.max(...data)
  const pts = data.map((v, i) => [(i / (data.length - 1)) * w, h - ((v - min) / (max - min || 1)) * (h - 12) - 6])
  const d = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ')
  const area = d + ` L ${w} ${h} L 0 ${h} Z`
  const last = pts[pts.length - 1]
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{ overflow: 'visible', display: 'block', width: '100%' }}>
      <defs><linearGradient id="spk" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="var(--accent)" stopOpacity="0.28" /><stop offset="1" stopColor="var(--accent)" stopOpacity="0" /></linearGradient></defs>
      <motion.path key={live ? 'a' : 'a0'} d={area} fill="url(#spk)" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={tx({ duration: 0.6, delay: 0.4 })} />
      <motion.path d={d} fill="none" stroke="var(--accent)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" initial={live ? false : { pathLength: 0, d }} animate={{ pathLength: 1, d }} transition={live ? tx({ d: { duration: 0.4, ease: EASE.out } }) : tx({ duration: 1.1, ease: EASE.inOut })} />
      <motion.circle r="4" fill="var(--accent)" cx={last[0]} cy={last[1]} initial={false} animate={{ cx: last[0], cy: last[1] }} transition={tx({ duration: 0.4, ease: EASE.out })} />
    </svg>
  )
}

function SparkDemo({ tx, ms, replayKey }) {
  const t = useT(); const h = useHaptic()
  const [data, setData] = useState([23.1, 23.4, 23.9, 24.6, 25.2, 25.4, 25.1, 24.7, 24.9, 25.3, 25.8, 26.1, 26.0, 25.6, 25.2, 24.8])
  const [live, setLive] = useState(false)
  const push = () => { setLive(true); setData(d => [...d.slice(1), +(d[d.length - 1] + (Math.random() - 0.5) * 1.2).toFixed(1)]); h('selection') }
  return (
    <Page title={t({ en: 'Living Room · Temperature', he: 'סלון · טמפרטורה' })}>
      <Card>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10 }}><span className="zl-footnote zl-mute">{t({ en: 'Last 4 hours', he: '4 השעות האחרונות' })}</span><SpringNumber value={data[data.length - 1]} digits={1} tx={tx} size={28} /></div>
        <Sparkline data={data} tx={tx} live={live} />
      </Card>
      <div className="zl-hstack" style={{ marginTop: 12 }}><Button style={{ height: 36 }} onClick={push}>{t({ en: 'New sample', he: 'דגימה חדשה' })}</Button></div>
      <p className="zl-footnote zl-mute" style={{ marginTop: 12 }}>On load the line draws left to right (pathLength) and the area fades in beneath. A new sample slides the whole line one step and the end dot follows. The value rides along.</p>
    </Page>
  )
}

/* ───────────────────────── 3. BATTERY + SIGNAL ───────────────────────── */

function BarsDemo({ tx }) {
  const t = useT(); const h = useHaptic()
  const [battery, setBattery] = useState(78)
  const [signal, setSignal] = useState(3)
  const col = battery > 60 ? 'var(--ok)' : battery > 20 ? 'var(--warn)' : 'var(--err)'
  return (
    <Page title={t({ en: 'Door Sensor', he: 'חיישן דלת' })}>
      <div className="zl-stack">
        <Card>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}><span className="zl-footnote zl-mute">{t({ en: 'Battery', he: 'סוללה' })}</span><SpringNumber value={battery} digits={0} tx={tx} size={15} /></div>
          <div style={{ height: 10, borderRadius: 5, background: 'var(--surface-3)', overflow: 'hidden' }}><motion.div animate={{ width: `${battery}%`, backgroundColor: col }} transition={tx({ type: 'spring', duration: 0.6, bounce: 0 })} style={{ height: '100%', borderRadius: 5 }} /></div>
          <div className="zl-hstack" style={{ marginTop: 10 }}>{[92, 55, 14].map(v => <button key={v} className="zl-chip" data-on={battery === v ? 'true' : 'false'} style={{ cursor: 'pointer' }} onClick={() => { setBattery(v); h('selection') }}>{v}%</button>)}</div>
        </Card>
        <Card>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span className="zl-footnote zl-mute">{t({ en: 'Signal', he: 'אות' })}</span>
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: 20 }}>
              {[0, 1, 2, 3].map(i => <motion.span key={i} animate={{ backgroundColor: i < signal ? 'var(--ink)' : 'var(--line-2)', scaleY: i < signal ? 1 : 0.6 }} transition={tx({ duration: 0.22, delay: i * 0.05, ease: EASE.out })} style={{ width: 5, height: 6 + i * 4, borderRadius: 2, transformOrigin: 'bottom', background: 'var(--line-2)' }} />)}
            </div>
          </div>
          <div className="zl-hstack" style={{ marginTop: 10 }}>{[['Weak', 1], ['Fair', 2], ['Good', 3], ['Strong', 4]].map(([l, v]) => <button key={l} className="zl-chip" data-on={signal === v ? 'true' : 'false'} style={{ cursor: 'pointer' }} onClick={() => { setSignal(v); h('selection') }}>{l}</button>)}</div>
        </Card>
      </div>
      <p className="zl-footnote zl-mute" style={{ marginTop: 12 }}>Battery fill and colour glide; signal bars rise one after another, 50ms apart. Today both jump.</p>
    </Page>
  )
}

/* ───────────────────────── 4. CONFIDENCE METER ───────────────────────── */

function ConfidenceDemo({ variant, tx, replayKey }) {
  const t = useT()
  const [pct, setPct] = useState(82)
  const mv = useSpring(0, tx({ stiffness: 60, damping: 18 }))
  useEffect(() => { mv.set(pct) }, [pct, mv, replayKey])
  const text = useTransform(mv, (v) => Math.round(v) + '%')
  const dots = 5; const lit = Math.round((pct / 100) * dots)
  return (
    <Page title={t({ en: 'Suggested', he: 'מומלץ' })}>
      <Card>
        <div className="zl-caption zl-mute" style={{ textTransform: 'uppercase', letterSpacing: '.06em' }}>{t({ en: 'Pattern · time of day', he: 'תבנית · שעה ביום' })}</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '8px 0 10px' }}>
          {variant === 'A' ? <span className="zl-headline zl-mono">{pct}%</span> : <motion.span className="zl-headline zl-mono">{text}</motion.span>}
          <div style={{ display: 'flex', gap: 4 }}>{Array.from({ length: dots }).map((_, i) => <motion.span key={i + '-' + replayKey} initial={{ scale: 0.6, opacity: 0.4 }} animate={{ scale: 1, opacity: 1, backgroundColor: i < lit ? 'var(--accent)' : 'var(--line-2)' }} transition={tx({ type: 'spring', duration: 0.4, bounce: 0.3, delay: 0.1 + i * 0.07 })} style={{ width: 6, height: 6, borderRadius: 999, background: 'var(--line-2)' }} />)}</div>
        </div>
        <div className="zl-subhead" style={{ color: 'var(--ink-2)', marginBottom: 12 }}>{t({ en: 'You turn on the kids room night light around 19:40 on weekdays. Save it as an automatic action?', he: 'אתה מדליק את אור הלילה בחדר הילדים בסביבות 19:40 בימי חול. לשמור כפעולה אוטומטית?' })}</div>
        <div style={{ height: 6, borderRadius: 3, background: 'var(--surface-3)', overflow: 'hidden', marginBottom: 12 }}><motion.div key={replayKey} initial={{ width: 0 }} animate={{ width: `${pct}%` }} transition={tx({ type: 'spring', duration: 0.9, bounce: 0 })} style={{ height: '100%', background: 'var(--accent)' }} /></div>
        <div className="zl-hstack"><Button variant="primary" style={{ height: 40 }}>{t({ en: 'Yes, create', he: 'כן, צור' })}</Button><Button style={{ height: 40 }}>{t({ en: 'Later', he: 'אחר כך' })}</Button></div>
      </Card>
      <div className="zl-hstack" style={{ marginTop: 12 }}>{[44, 82, 96].map(v => <button key={v} className="zl-chip" data-on={pct === v ? 'true' : 'false'} style={{ cursor: 'pointer' }} onClick={() => setPct(v)}>{v}%</button>)}</div>
    </Page>
  )
}

/* ───────────────────────── 5. COUNTS + BADGES ───────────────────────── */

function CountDemo({ tx, variant = 'A' }) {
  const t = useT(); const h = useHaptic()
  const [n, setN] = useState(3)
  const nudge = variant === 'B'
  // B: direction of the last change drives the roll direction and the nudge
  const prev = useRef(n); const dir = Math.sign(n - prev.current) || 1
  const tabRef = useRef(null); const navRef = useRef(null)
  useEffect(() => {
    const d = Math.sign(n - prev.current); prev.current = n
    if (!nudge || !d) return
    // increase: up 3px and 1.2×; decrease: a 2px dip. A count going up is news; going down is relief.
    const kf = d > 0 ? { y: [0, -3, 0], scale: [1, 1.2, 1] } : { y: [0, 2, 0] }
    const opts = tx({ duration: d > 0 ? 0.36 : 0.26, times: [0, 0.35, 1], ease: EASE.out })
    const anims = [tabRef.current, navRef.current].filter(Boolean).map(el => animate(el, kf, opts))
    return () => anims.forEach(a => a.stop())
  }, [n]) // eslint-disable-line
  const roll = (key) => (
    <AnimatePresence mode="popLayout" initial={false} custom={dir}>
      <motion.span key={key} custom={dir} variants={{ in: (d) => ({ y: nudge ? (d > 0 ? 12 : -12) : 12, opacity: 0 }), show: { y: 0, opacity: 1 }, out: (d) => ({ y: nudge ? (d > 0 ? -12 : 12) : -12, opacity: 0 }) }} initial="in" animate="show" exit="out" transition={tx({ duration: 0.2, ease: EASE.out })} style={{ display: 'inline-block' }}>{key}</motion.span>
    </AnimatePresence>
  )
  return (
    <Page title={t({ en: 'Alerts', he: 'התראות' })}>
      <div style={{ display: 'flex', background: 'var(--surface-2)', border: '1px solid var(--line)', borderRadius: 12, padding: 4, marginBottom: 16 }}>
        <span style={{ flex: 1, height: 40, borderRadius: 9, background: 'var(--surface)', boxShadow: 'var(--shadow-sm)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, fontWeight: 600, fontSize: 15 }}>
          {t({ en: 'Active', he: 'פעילות' })}
          <AnimatePresence initial={false}>
            {(n > 0 || !nudge) && (
              <motion.span key="tabbadge" ref={tabRef} initial={nudge ? { scale: 0.5, opacity: 0 } : false} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.4, opacity: 0, transition: tx({ duration: 0.16, ease: EASE.out }) }} transition={tx({ type: 'spring', duration: 0.35, bounce: 0.4 })}
                style={{ position: 'relative', minWidth: 22, height: 22, borderRadius: 999, background: n > 0 ? 'var(--err)' : 'var(--line-2)', color: '#fff', display: 'grid', placeItems: 'center', fontSize: 12, padding: '0 6px', overflow: 'hidden', transition: `background calc(200ms * var(--lab-speed,1))` }}>
                {roll(n)}
              </motion.span>
            )}
          </AnimatePresence>
        </span>
        <span style={{ flex: 1, height: 40, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--ink-mute)', fontWeight: 500, fontSize: 15 }}>{t({ en: 'History', he: 'היסטוריה' })}</span>
      </div>
      <div className="zl-hstack"><Button style={{ height: 36 }} onClick={() => { setN(v => v + 1); h('warning') }}>+ {t({ en: 'new alert', he: 'התראה חדשה' })}</Button><Button style={{ height: 36 }} onClick={() => { setN(v => Math.max(0, v - 1)); h(nudge ? 'selection' : 'success') }}>− {t({ en: 'cleared', he: 'נוקתה' })}</Button></div>
      <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 56, borderTop: '1px solid var(--line)', display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', alignItems: 'center', background: 'var(--surface)' }}>
        {['house', 'layout-grid', 'lightbulb', 'zap', 'bell'].map((ic, i) => (
          <span key={ic} style={{ position: 'relative', display: 'grid', placeItems: 'center', color: i === 4 ? 'var(--ink)' : 'var(--ink-mute)' }}>
            <Icon name={ic} size={22} />
            {i === 4 && (
              <AnimatePresence>{n > 0 && <motion.span key="b" ref={navRef} initial={{ scale: 0.5, opacity: 0 }} animate={{ scale: [1.25, 1], opacity: 1 }} exit={{ scale: 0.5, opacity: 0, transition: tx({ duration: 0.16, ease: EASE.out }) }} transition={tx({ type: 'spring', duration: 0.35, bounce: 0.4 })} style={{ position: 'absolute', top: -6, marginInlineStart: 22, minWidth: 16, height: 16, borderRadius: 999, background: 'var(--err)', color: '#fff', fontSize: 10, fontWeight: 700, display: 'grid', placeItems: 'center', padding: '0 4px', boxShadow: '0 0 0 2px var(--surface)', overflow: 'hidden' }}>{nudge ? roll(n) : n}</motion.span>}</AnimatePresence>
            )}
          </span>
        ))}
      </div>
      <p className="zl-footnote zl-mute" style={{ marginTop: 12 }}>{nudge ? 'On increase the badge nudges up 3px and swells to 1.2× with a warning haptic; the digit rolls up. On decrease it only dips 2px and the digit rolls down. At zero it pops away. A count going up is news; going down is relief, so it gets less.' : 'Tab count rolls vertically; the nav badge pops in with a spring on the first alert and pops away at zero.'}</p>
    </Page>
  )
}

/* ───────────────────────── 6. TIME-BASED PROGRESS ───────────────────────── */

function CoolingDemo({ tx, ms, replayKey }) {
  const t = useT()
  const target = 24; const start = 27.2
  const progress = useMotionValue(0)
  const temp = useTransform(progress, [0, 1], [start, target])
  const tempText = useTransform(temp, (v) => v.toFixed(1))
  const eta = useTransform(progress, (p) => Math.max(0, Math.round((1 - p) * 6)))
  const etaText = useTransform(eta, (m) => m === 0 ? t({ en: 'reached', he: 'הושג' }) : `~${m} ${t({ en: 'min', he: 'דק׳' })}`)
  const dash = useTransform(progress, [0, 1], [0, 502])
  const dashArr = useTransform(dash, (d) => `${d} 502`)
  useEffect(() => { progress.set(0); const a = animate(progress, 1, tx({ duration: 8, ease: 'linear' })); return () => a.stop() }, [replayKey, progress]) // eslint-disable-line
  return (
    <Page title={t({ en: 'Living Room AC', he: 'מזגן סלון' })}>
      <Card style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: 20 }}>
        <div style={{ position: 'relative', width: 240, height: 200 }}>
          <svg width="240" height="200" viewBox="0 0 240 200">
            <path d="M 40 170 A 96 96 0 1 1 200 170" fill="none" stroke="var(--surface-3)" strokeWidth="14" strokeLinecap="round" pathLength="502" />
            <motion.path d="M 40 170 A 96 96 0 1 1 200 170" fill="none" stroke="var(--info)" strokeWidth="14" strokeLinecap="round" pathLength="502" style={{ strokeDasharray: dashArr }} />
          </svg>
          <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', paddingTop: 30, textAlign: 'center' }}>
            <div>
              <motion.div className="zl-large zl-mono" style={{ fontSize: 52, lineHeight: 1 }}>{tempText}</motion.div>
              <div className="zl-footnote zl-mute">{t({ en: 'cooling to', he: 'מקרר ל־' })} {target}° · <motion.span className="zl-mono">{etaText}</motion.span></div>
            </div>
          </div>
        </div>
      </Card>
      <p className="zl-footnote zl-mute" style={{ marginTop: 12 }}>Time-based progress, sped up 45×: the arc fills toward the target, the temperature glides down with it, and the estimate counts down. The user sees the work being done, not a static "cooling".</p>
    </Page>
  )
}

function CoolingBar({ tx, replayKey }) {
  // "Bar with ETA": a progress bar under the AC tile; the fill drifts toward
  // the target, the ETA counts down in tabular digits, the tile's tint cools
  // from warm to neutral, and a check appears at the bar's end on arrival.
  const t = useT(); const h = useHaptic()
  const target = 24; const start = 27.2
  const progress = useMotionValue(0)
  const [done, setDone] = useState(false)
  const temp = useTransform(progress, [0, 1], [start, target])
  const tempText = useTransform(temp, (v) => v.toFixed(1))
  const width = useTransform(progress, (p) => `${(p * 100).toFixed(1)}%`)
  const secs = useTransform(progress, (p) => Math.max(0, Math.ceil((1 - p) * 360)))
  const etaText = useTransform(secs, (s) => `${String(Math.floor(s / 60)).padStart(1, '0')}:${String(s % 60).padStart(2, '0')}`)
  const tileBg = useTransform(progress, (p) => `color-mix(in srgb, var(--err) ${((1 - p) * 16).toFixed(1)}%, var(--surface))`)
  const iconBg = useTransform(progress, (p) => `color-mix(in srgb, var(--err) ${((1 - p) * 28).toFixed(1)}%, var(--info) ${(p * 28).toFixed(1)}%)`)
  useEffect(() => {
    progress.set(0); setDone(false)
    const a = animate(progress, 1, tx({ duration: 8, ease: 'linear' }))
    a.then(() => { setDone(true); h('success') })
    return () => a.stop()
  }, [replayKey, progress]) // eslint-disable-line
  return (
    <Page title={t({ en: 'Living Room', he: 'סלון' })}>
      <div className="zl-grid2">
        <motion.div className="zl-tile" data-on="true" style={{ minHeight: 120, background: tileBg, gridColumn: '1 / -1', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div className="zl-tile__row">
            <motion.span className="zl-tile__icon" style={{ background: iconBg, color: 'var(--ink)' }}><Icon name="snowflake" /></motion.span>
            <span className="zl-chip zl-mono" style={{ height: 24, fontSize: 12, borderColor: 'transparent', gap: 4 }}><motion.span>{tempText}</motion.span>°</span>
          </div>
          <div>
            <div className="zl-tile__name">{t({ en: 'Living Room AC', he: 'מזגן סלון' })}</div>
            <div className="zl-tile__meta" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span>{t({ en: 'cooling to', he: 'מקרר ל־' })} {target}°</span>
              <span>·</span>
              <AnimatePresence mode="popLayout" initial={false}>
                {done ? <motion.span key="d" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={tx({ duration: 0.2, ease: EASE.out })} style={{ color: 'var(--ok-text, var(--ok))' }}>{t({ en: 'reached', he: 'הושג' })}</motion.span>
                  : <motion.span key="e" exit={{ opacity: 0, y: -4, transition: tx({ duration: 0.14 }) }} className="zl-mono" style={{ fontVariantNumeric: 'tabular-nums' }}><motion.span>{etaText}</motion.span> {t({ en: 'left', he: 'נותרו' })}</motion.span>}
              </AnimatePresence>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ flex: 1, height: 6, borderRadius: 3, background: 'var(--surface-3)', overflow: 'hidden' }}>
              <motion.div style={{ width, height: '100%', borderRadius: 3, background: 'linear-gradient(90deg, var(--err), var(--info))', backgroundSize: '100% 100%' }} />
            </div>
            <span style={{ width: 18, height: 18, display: 'grid', placeItems: 'center' }}>
              <AnimatePresence>
                {done && <motion.span key="chk" initial={{ scale: 0.4, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={tx({ type: 'spring', duration: 0.4, bounce: 0.35 })} style={{ width: 18, height: 18, borderRadius: 999, background: 'var(--ok)', color: '#fff', display: 'grid', placeItems: 'center' }}><Icon name="check" size={11} strokeWidth={3} /></motion.span>}
              </AnimatePresence>
            </span>
          </div>
        </motion.div>
      </div>
      <p className="zl-footnote zl-mute" style={{ marginTop: 12 }}>The tile is the device; the bar under it is the work. Fill, ETA (tabular, so it does not jitter), the number and the tile's warmth are all one progress value, so they cannot drift apart. The check at the bar's end is the only thing that pops. Sped up 45×.</p>
    </Page>
  )
}

/* ───────────────────────── SECTION ───────────────────────── */

export default function Data() {
  return (
    <>
      <SectionIntro
        title="Data"
        lede="A number that changes is an event. Interpolate it and the eye reads a gauge; swap it and the eye reads a glitch."
        found={[
          'Nothing interpolates. No useSpring, useMotionValue or count-up anywhere in the device, room or dashboard views; every brightness %, °C, W, %, count and countdown cuts.',
          'Battery bar width, signal bars, volume bars, the climate Dial arc and the PresetGauge fill all change with no transition.',
          'The suggestion ConfidenceMeter (82% + five dots) mounts static.',
          'Tab counts, chip badges and the "{active} of {total}" subtitle swap text.',
          'The only smoothly-advancing number in the app is media position, stepping at 1Hz.',
          'NumberFlow (React 18 OK) is the off-the-shelf option, but declares RTL/Hebrew digits unsupported; the rolling digit here is a 20-line hand-rolled equivalent that works inside a dir="ltr" island.',
        ]}
      />

      <Demo id="readout" title="Live sensor readout" purpose="Temperature, humidity, power: they move, so show them moving." principles={['state', 'restraint']} inZiggy={['SensorRemote hero (56px)', 'DeviceCard MetricPills', 'Dashboard room tile chips']}
        recommend="D"
        variants={[
          { key: 'A', label: 'Cut (today)', render: (p) => <ReadoutDemo {...p} variant="A" /> },
          { key: 'B', label: 'Rolling digits', note: 'Each digit rolls to its new value (an odometer); the direction of the roll is the direction of the change. Digits that did not change stay still.', render: (p) => <ReadoutDemo {...p} variant="B" /> },
          { key: 'C', label: 'Spring glide + trend', note: 'The value glides through the in-between numbers on a spring and a brief arrow says which way it went. Reads as a gauge.', tradeoff: 'A glide invents readings the sensor never reported (24.5 → 24.7 shows 24.6).', render: (p) => <ReadoutDemo {...p} variant="C" /> },
          { key: 'D', label: 'Blur-swap digits', note: 'Recommended. The string is compared per character; only a glyph that changed blurs out upward and its replacement blurs in from below (220ms), and every other glyph stays perfectly still. 24.5 → 24.7 moves one character. It wins over B and C because it never invents a value, never moves what did not change, and reads the same in a 56px hero and a 13px chip. The Apple Weather grammar.', tradeoff: 'A change that carries across a digit boundary (24.9 → 25.0) swaps two glyphs at once; it is honest, but B\'s roll shows that as one motion.', spec: () => '220 ms ease-out · blur 4 px · y ±0.14 em · fixed 0.6 em cells, LTR island', render: (p) => <ReadoutDemo {...p} variant="D" /> },
        ]} />

      <Demo id="sparkline" title="History sparkline" purpose="The past explains the present. Draw it, then let new samples push it along." principles={['continuity', 'state']} inZiggy={['DeviceDetail SensorHistoryChart']}
        variants={[{ key: 'A', label: 'Draw + live append', note: 'On load the line draws left to right (pathLength) and the area fades in beneath; a new sample slides the whole line one step and the end dot follows.', render: (p) => <SparkDemo {...p} /> }]} />

      <Demo id="bars" title="Battery and signal" purpose="A bar that fills to its value tells you how much; a bar that jumps tells you nothing about the change." principles={['state', 'causality']} inZiggy={['DeviceDetail.jsx BatteryBar / SignalBars']}
        variants={[{ key: 'A', label: 'Glide + stagger', note: 'Battery fill and colour glide on a flat spring; signal bars rise one after another, 50ms apart, so a stronger signal is more bars arriving, not a swap.', render: (p) => <BarsDemo {...p} /> }]} />

      <Demo id="confidence" title="Confidence meter" purpose="82% is a claim. Counting up to it, with the dots lighting in order, makes it feel measured." principles={['state', 'hierarchy']} inZiggy={['Suggestions.jsx ConfidenceMeter', 'SuggestedTab card']}
        recommend="B"
        variants={[
          { key: 'A', label: 'Dots stagger, number static', note: 'The five dots light in order on mount; the number is already there.', render: (p) => <ConfidenceDemo {...p} variant="A" /> },
          { key: 'B', label: 'Count-up + dots + bar', note: 'Recommended. The number counts up on a slow spring while the dots light and the bar fills; three views of one value arriving together. It reads as measured rather than asserted.', render: (p) => <ConfidenceDemo {...p} variant="B" /> },
        ]} />

      <Demo id="counts" title="Counts and badges" purpose="A count changing is news. Roll it; pop the badge on the first, retire it at zero." principles={['hierarchy', 'state']} inZiggy={['Anomalies tab counts', 'BottomNav (no badge today)', 'chat bubble unread pill']}
        recommend="B"
        variants={[
          { key: 'A', label: 'Roll + pop', note: 'The tab count rolls vertically (always upward); the nav badge pops in with a spring on the first alert and pops away at zero.', render: (p) => <CountDemo {...p} variant="A" /> },
          { key: 'B', label: 'Nudge', note: 'Recommended. On increase the badge nudges up 3px and swells to 1.2× with a warning haptic, and the digit rolls up; on decrease it only dips 2px and the digit rolls down; at zero it pops away. Hierarchy in the motion itself: a count increasing is more important than decreasing, so it gets more.', tradeoff: 'The nudge is imperative (animate on the element) so it retriggers on every change; a burst of five alerts in a second will stack nudges, so coalesce updates upstream.', spec: () => 'up: 360 ms y −3 px, scale 1.2, warning · down: 260 ms y +2 px · roll 200 ms', render: (p) => <CountDemo {...p} variant="B" /> },
        ]} />

      <Demo id="cooling" title="Progress over time (cooling to target)" purpose="Between now and the target there is work being done. Show its progress and its estimate." principles={['causality', 'state']} inZiggy={['Smart Climate Control card', 'ACRemote header', 'Pre-cool on Arrival']}
        recommend="B"
        variants={[
          { key: 'A', label: 'Arc + glide + ETA', note: 'A hero arc fills toward the target while the temperature glides down and the estimate counts down. The remote-page version: it deserves the space.', render: (p) => <CoolingDemo {...p} /> },
          { key: 'B', label: 'Bar with ETA', note: 'Recommended for the tile and the dashboard. A progress bar under the AC tile whose fill drifts toward the target; the ETA counts down in tabular digits; the tile\'s tint cools from warm to neutral; a check pops at the bar\'s end on arrival. Everything is one progress value, so the number, the bar and the colour cannot disagree. It wins because it fits where the work is actually watched: a tile in a grid, not a hero.', tradeoff: 'The ETA must come from the climate engine\'s model, not a linear guess, or the countdown will stall near the end like a Windows copy dialog.', spec: () => 'progress 8 s linear (45×) · tint err 16% → 0 · check spring 400 ms b0.35', render: (p) => <CoolingBar {...p} /> },
        ]} />
    </>
  )
}
