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
  const Num = ({ v, d, size }) => variant === 'A' ? <span className="zl-mono" style={{ fontSize: size, lineHeight: 1, fontWeight: 700, letterSpacing: '-0.02em' }}>{v.toFixed(d)}</span> : variant === 'B' ? <RollingNumber value={v} digits={d} tx={tx} size={size} /> : <SpringNumber value={v} digits={d} tx={tx} size={size} />
  return (
    <Page title={t({ en: 'Living Room', he: 'סלון' })}>
      <div className="zl-hstack" style={{ marginBottom: 12 }}><Button style={{ height: 36 }} onClick={() => { s.tick(); h('selection') }}>{t({ en: 'Sensor reports', he: 'החיישן מדווח' })}</Button><Button style={{ height: 36 }} onClick={() => setAuto(a => !a)}>{auto ? t({ en: 'Stop live', he: 'עצור' }) : t({ en: 'Go live', he: 'שידור חי' })}</Button></div>
      <div className="zl-stack">
        <Card style={{ display: 'flex', alignItems: 'flex-end', gap: 12 }}>
          <div style={{ flex: 1 }}><div className="zl-footnote zl-mute">{t({ en: 'Temperature', he: 'טמפרטורה' })}</div><div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}><Num v={s.temp} d={1} size={44} /><span className="zl-title3 zl-mute">°C</span>
            {variant === 'C' && <AnimatePresence mode="popLayout">{trend !== 0 && <motion.span key={trend + s.temp} initial={{ opacity: 0, y: trend > 0 ? 6 : -6 }} animate={{ opacity: [0, 1, 1, 0], y: 0 }} transition={tx({ duration: 1.6, times: [0, 0.15, 0.7, 1] })} style={{ color: trend > 0 ? 'var(--err-text)' : 'var(--info)', display: 'grid', alignSelf: 'center' }}><Icon name="arrow-left" size={16} style={{ transform: `rotate(${trend > 0 ? 90 : -90}deg)` }} /></motion.span>}</AnimatePresence>}
          </div></div>
          <span className="zl-row__icon"><Icon name="thermometer" /></span>
        </Card>
        <div className="zl-grid2">
          <Card><div className="zl-footnote zl-mute">{t({ en: 'Humidity', he: 'לחות' })}</div><div style={{ display: 'flex', alignItems: 'baseline', gap: 2 }}><Num v={s.hum} d={0} size={32} /><span className="zl-subhead zl-mute">%</span></div></Card>
          <Card><div className="zl-footnote zl-mute">{t({ en: 'Water heater', he: 'דוד' })}</div><div style={{ display: 'flex', alignItems: 'baseline', gap: 2 }}><Num v={s.watts} d={0} size={32} /><span className="zl-subhead zl-mute">W</span></div></Card>
        </div>
      </div>
      <p className="zl-footnote zl-mute" style={{ marginTop: 12 }}>{variant === 'A' ? 'Today: every number cuts. Live sensors make the page flicker with unexplained swaps.' : variant === 'B' ? 'Each digit rolls to its new value. Direction of roll = direction of change. Digits that did not change stay still.' : 'The value glides through the in-between numbers on a spring, and a brief arrow says which way it went. Reads as a gauge, not a label.'}</p>
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
      <motion.path d={d} fill="none" stroke="var(--accent)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" initial={live ? false : { pathLength: 0 }} animate={{ pathLength: 1, d }} transition={live ? tx({ d: { duration: 0.4, ease: EASE.out } }) : tx({ duration: 1.1, ease: EASE.inOut })} />
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

function CountDemo({ tx }) {
  const t = useT(); const h = useHaptic()
  const [n, setN] = useState(3)
  return (
    <Page title={t({ en: 'Alerts', he: 'התראות' })}>
      <div style={{ display: 'flex', background: 'var(--surface-2)', border: '1px solid var(--line)', borderRadius: 12, padding: 4, marginBottom: 16 }}>
        <span style={{ flex: 1, height: 40, borderRadius: 9, background: 'var(--surface)', boxShadow: 'var(--shadow-sm)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, fontWeight: 600, fontSize: 15 }}>
          {t({ en: 'Active', he: 'פעילות' })}
          <span style={{ position: 'relative', minWidth: 22, height: 22, borderRadius: 999, background: n > 0 ? 'var(--err)' : 'var(--line-2)', color: '#fff', display: 'grid', placeItems: 'center', fontSize: 12, padding: '0 6px', overflow: 'hidden', transition: 'background 200ms' }}>
            <AnimatePresence mode="popLayout" initial={false}><motion.span key={n} initial={{ y: 12, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: -12, opacity: 0 }} transition={tx({ duration: 0.2, ease: EASE.out })}>{n}</motion.span></AnimatePresence>
          </span>
        </span>
        <span style={{ flex: 1, height: 40, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--ink-mute)', fontWeight: 500, fontSize: 15 }}>{t({ en: 'History', he: 'היסטוריה' })}</span>
      </div>
      <div className="zl-hstack"><Button style={{ height: 36 }} onClick={() => { setN(v => v + 1); h('warning') }}>+ {t({ en: 'new alert', he: 'התראה חדשה' })}</Button><Button style={{ height: 36 }} onClick={() => { setN(v => Math.max(0, v - 1)); h('success') }}>− {t({ en: 'cleared', he: 'נוקתה' })}</Button></div>
      <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 56, borderTop: '1px solid var(--line)', display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', alignItems: 'center', background: 'var(--surface)' }}>
        {['house', 'layout-grid', 'lightbulb', 'zap', 'bell'].map((ic, i) => (
          <span key={ic} style={{ position: 'relative', display: 'grid', placeItems: 'center', color: i === 4 ? 'var(--ink)' : 'var(--ink-mute)' }}>
            <Icon name={ic} size={22} />
            {i === 4 && (
              <AnimatePresence>{n > 0 && <motion.span key="b" initial={{ scale: 0.5, opacity: 0 }} animate={{ scale: [1.25, 1], opacity: 1 }} exit={{ scale: 0.5, opacity: 0 }} transition={tx({ type: 'spring', duration: 0.35, bounce: 0.4 })} style={{ position: 'absolute', top: -6, marginInlineStart: 22, minWidth: 16, height: 16, borderRadius: 999, background: 'var(--err)', color: '#fff', fontSize: 10, fontWeight: 700, display: 'grid', placeItems: 'center', padding: '0 4px', boxShadow: '0 0 0 2px var(--surface)' }}>{n}</motion.span>}</AnimatePresence>
            )}
          </span>
        ))}
      </div>
      <p className="zl-footnote zl-mute" style={{ marginTop: 12 }}>Tab count rolls vertically; the nav badge pops in with a spring on the first alert and pops away at zero.</p>
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
  useEffect(() => { progress.set(0); const a = animate(progress, 1, { duration: 8 / 1, ease: 'linear' }); return () => a.stop() }, [replayKey, progress])
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

      <Demo id="readout" title="Live sensor readout" purpose="Temperature, humidity, power: they move, so show them moving." inZiggy={['SensorRemote hero (56px)', 'DeviceCard MetricPills', 'Dashboard room tile chips']}
        recommend="C"
        variants={[
          { key: 'A', label: 'Cut (today)', render: (p) => <ReadoutDemo {...p} variant="A" /> },
          { key: 'B', label: 'Rolling digits', render: (p) => <ReadoutDemo {...p} variant="B" /> },
          { key: 'C', label: 'Spring glide + trend', render: (p) => <ReadoutDemo {...p} variant="C" /> },
        ]} />

      <Demo id="sparkline" title="History sparkline" purpose="The past explains the present. Draw it, then let new samples push it along." inZiggy={['DeviceDetail SensorHistoryChart']}
        variants={[{ key: 'A', label: 'Draw + live append', render: (p) => <SparkDemo {...p} /> }]} />

      <Demo id="bars" title="Battery and signal" purpose="A bar that fills to its value tells you how much; a bar that jumps tells you nothing about the change." inZiggy={['DeviceDetail.jsx BatteryBar / SignalBars']}
        variants={[{ key: 'A', label: 'Glide + stagger', render: (p) => <BarsDemo {...p} /> }]} />

      <Demo id="confidence" title="Confidence meter" purpose="82% is a claim. Counting up to it, with the dots lighting in order, makes it feel measured." inZiggy={['Suggestions.jsx ConfidenceMeter', 'SuggestedTab card']}
        recommend="B"
        variants={[
          { key: 'A', label: 'Dots stagger, number static', render: (p) => <ConfidenceDemo {...p} variant="A" /> },
          { key: 'B', label: 'Count-up + dots + bar', render: (p) => <ConfidenceDemo {...p} variant="B" /> },
        ]} />

      <Demo id="counts" title="Counts and badges" purpose="A count changing is news. Roll it; pop the badge on the first, retire it at zero." inZiggy={['Anomalies tab counts', 'BottomNav (no badge today)', 'chat bubble unread pill']}
        variants={[{ key: 'A', label: 'Roll + pop', render: (p) => <CountDemo {...p} /> }]} />

      <Demo id="cooling" title="Progress over time (cooling to target)" purpose="Between now and the target there is work being done. Show its progress and its estimate." inZiggy={['Smart Climate Control card', 'ACRemote header', 'Pre-cool on Arrival']}
        variants={[{ key: 'A', label: 'Arc + glide + ETA', render: (p) => <CoolingDemo {...p} /> }]} />
    </>
  )
}
