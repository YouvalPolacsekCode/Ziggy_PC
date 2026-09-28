// Motion Lab — MOMENTS
// The rare interactions where delight is earned: onboarding steps, pairing,
// the chat's thinking → answer, running a scene, and the system's own voice.
// Phase 1 found every one of these is a hard cut today.
import { useState, useRef, useEffect } from 'react'
import { motion, AnimatePresence, LayoutGroup, useMotionValue, useTransform, animate } from 'framer-motion'
import { Demo } from '../ui/Demo'
import { SectionIntro } from '../ui/Section'
import { Icon, Page, Card, Button, useT } from '../ziggy/primitives'
import { useHaptic } from '../LabContext'
import { EASE } from '../time'
import { ROOMS, COPY } from '../mock/home'

/* ───────────────────────── 1. ONBOARDING STEPS ───────────────────────── */

const STEPS = [
  { key: 'sensors', title: { en: 'Confirm your sensors', he: 'אישור החיישנים' }, body: { en: "We'll walk through each sensor in your kit. Edit the name if you like, or just tap Next.", he: 'נעבור על כל חיישן בערכה. אפשר לערוך את השם, או פשוט להקיש הבא.' }, icon: 'radar' },
  { key: 'starter', title: { en: 'Starter actions', he: 'פעולות להתחלה' }, body: { en: 'Here are a few actions matched to your kit. Toggle the ones you want.', he: 'הנה כמה פעולות שמתאימות לערכה שלך. בחר את אלה שאתה רוצה.' }, icon: 'zap' },
  { key: 'notify', title: { en: 'Notifications', he: 'התראות' }, body: { en: 'Ziggy will send alerts about your home: arrivals, issues, and reminders you set.', he: 'זיגי ישלח התראות על הבית: הגעות, תקלות ותזכורות.' }, icon: 'bell' },
  { key: 'done', title: { en: "You're all set.", he: 'הכל מוכן.' }, body: { en: 'Your home is ready.', he: 'הבית שלך מוכן.' }, icon: 'check' },
]

function StepBody({ step, t }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, flex: 1 }}>
      <span className="zl-row__icon" style={{ width: 56, height: 56, borderRadius: 18, background: step.key === 'done' ? 'color-mix(in srgb, var(--ok) 12%, var(--surface))' : 'var(--surface-2)', color: step.key === 'done' ? 'var(--ok)' : 'var(--ink-mute)' }}><Icon name={step.icon} size={26} /></span>
      <div className="zl-title2">{t(step.title)}</div>
      <div className="zl-subhead zl-mute">{t(step.body)}</div>
      {step.key === 'sensors' && <Card style={{ display: 'flex', gap: 12, alignItems: 'center' }}><span className="zl-row__icon"><Icon name="door" /></span><div><div className="zl-row__title">{t({ en: 'Bedroom Door', he: 'דלת חדר שינה' })}</div><div className="zl-row__sub">SNZB-04P · 1 of 3</div></div></Card>}
      {step.key === 'starter' && ['Leave Home', 'Motion Light', 'Pre-cool on Arrival'].map((n, i) => <Card key={n} style={{ display: 'flex', gap: 12, alignItems: 'center' }}><span style={{ width: 24, height: 24, borderRadius: 999, background: i < 2 ? 'var(--ink)' : 'transparent', border: '2px solid var(--line-3)', color: '#fff', display: 'grid', placeItems: 'center' }}>{i < 2 && <Icon name="check" size={14} strokeWidth={3} />}</span><div className="zl-row__title">{n}</div></Card>)}
    </div>
  )
}

function Dots({ idx, n, tx, variant }) {
  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'center', height: 20 }}>
      {Array.from({ length: n }).map((_, i) => <motion.span key={i} animate={{ width: i === idx ? 18 : 7, backgroundColor: i < idx ? 'var(--ink-mute)' : i === idx ? 'var(--ink)' : 'var(--line-2)' }} transition={variant === 'A' ? { duration: 0 } : tx({ type: 'spring', duration: 0.4, bounce: 0.1 })} style={{ height: 7, borderRadius: 4, background: 'var(--line-2)' }} />)}
    </div>
  )
}

function OnboardingDemo({ variant, knobs, tx, rtl }) {
  const t = useT(); const h = useHaptic()
  const [idx, setIdx] = useState(0)
  const dir = useRef(1)
  const go = (d) => { const n = Math.max(0, Math.min(STEPS.length - 1, idx + d)); if (n === idx) return; dir.current = d; setIdx(n); h(n === STEPS.length - 1 ? 'success' : 'light') }
  const sign = rtl ? -1 : 1
  const step = STEPS[idx]
  const spring = tx({ type: 'spring', duration: knobs.duration, bounce: 0 })
  const isDone = idx === STEPS.length - 1
  return (
    <div className="zl zl-page">
      <div style={{ padding: '24px 20px 0', display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
        <div className="zl-caption zl-mute" style={{ textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 6 }}>{t({ en: 'Welcome to Ziggy Home', he: 'ברוכים הבאים ל־Ziggy Home' })}</div>
        <Dots idx={idx} n={STEPS.length} tx={tx} variant={variant} />
        <div style={{ position: 'relative', flex: 1, marginTop: 18, perspective: 1000 }}>
          {variant === 'A' && <StepBody step={step} t={t} />}
          {variant === 'B' && (
            <AnimatePresence mode="popLayout" initial={false} custom={dir.current}>
              <motion.div key={step.key} initial={{ x: 28 * dir.current * sign, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: -28 * dir.current * sign, opacity: 0, transition: tx({ duration: 0.14 }) }} transition={tx({ duration: knobs.duration, ease: EASE.out })} style={{ position: 'absolute', inset: 0 }}>
                <StepBody step={step} t={t} />
              </motion.div>
            </AnimatePresence>
          )}
          {variant === 'C' && (
            <div style={{ position: 'absolute', inset: 0 }}>
              {STEPS.map((s, i) => {
                const rel = i - idx
                if (rel < 0 || rel > 2) return null
                return (
                  <motion.div key={s.key} initial={false} animate={{ y: rel * -10, scale: 1 - rel * 0.04, opacity: rel === 0 ? 1 : 0.55 - rel * 0.15, zIndex: 10 - rel, rotateY: 0 }} exit={{ rotateY: -70 * sign, x: -60 * sign, opacity: 0 }} transition={spring}
                    className="zl-card zl-card--pad" style={{ position: 'absolute', inset: 0, transformOrigin: 'left center', display: 'flex', flexDirection: 'column', padding: 18, background: 'var(--surface)' }}>
                    <StepBody step={s} t={t} />
                  </motion.div>
                )
              })}
              <AnimatePresence>{/* exits handled by key removal above */}</AnimatePresence>
            </div>
          )}
          {variant === 'D' && (
            <LayoutGroup id="onb-d">
              <AnimatePresence mode="popLayout" initial={false}>
                <motion.div key={step.key} initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -16, transition: tx({ duration: 0.16 }) }} transition={tx({ duration: knobs.duration, ease: EASE.out, delay: 0.12 })} style={{ position: 'absolute', inset: 0 }}>
                  <StepBody step={step} t={t} />
                </motion.div>
              </AnimatePresence>
              <motion.div layoutId="onb-line" transition={spring} style={{ position: 'absolute', top: -12, insetInlineStart: 0, width: `${((idx + 1) / STEPS.length) * 100}%`, height: 2, background: 'var(--accent)', borderRadius: 2 }} />
            </LayoutGroup>
          )}
        </div>
        <div style={{ display: 'flex', gap: 10, padding: '16px 0 20px' }}>
          <Button style={{ flex: 1 }} onClick={() => go(-1)} disabled={idx === 0}>{t({ en: 'Back', he: 'חזרה' })}</Button>
          <Button variant="primary" style={{ flex: 2 }} onClick={() => isDone ? setIdx(0) : go(1)}>{isDone ? t({ en: 'Start over', he: 'מהתחלה' }) : t({ en: 'Next', he: 'הבא' })}</Button>
        </div>
      </div>
    </div>
  )
}

/* ───────────────────────── 2. PAIRING ───────────────────────── */

function PairingDemo({ variant, tx, ms, replayKey }) {
  const t = useT(); const h = useHaptic()
  const [phase, setPhase] = useState('searching') // searching | found
  const [secs, setSecs] = useState(180)
  useEffect(() => { setPhase('searching'); setSecs(180); const id = setInterval(() => setSecs(s => Math.max(0, s - 1)), ms(1000)); const f = setTimeout(() => { setPhase('found'); h('success') }, ms(4200)); return () => { clearInterval(id); clearTimeout(f) } }, [replayKey]) // eslint-disable-line
  const found = phase === 'found'
  return (
    <div className="zl zl-page">
      <div style={{ padding: '24px 20px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16, flex: 1 }}>
        <div className="zl-caption zl-mute" style={{ textTransform: 'uppercase', letterSpacing: '.06em' }}>{t({ en: 'Ready · Pairing · Configure', he: 'מוכן · מצמד · הגדרה' })}</div>
        <div style={{ position: 'relative', width: 220, height: 220, display: 'grid', placeItems: 'center' }}>
          {variant === 'A' && (
            <>
              {!found && <motion.div animate={{ scale: [1, 1.18, 1], opacity: [0.5, 0.1, 0.5] }} transition={{ duration: 2 / 1, repeat: Infinity, ease: 'easeInOut' }} style={{ position: 'absolute', width: 128, height: 128, borderRadius: 999, background: 'var(--accent-2)' }} />}
              <div style={{ position: 'relative', width: 128, height: 128, borderRadius: 999, background: 'var(--surface)', border: '0.5px solid var(--line)', display: 'grid', placeItems: 'center' }}>
                <svg width="128" height="128" viewBox="0 0 128 128" style={{ position: 'absolute', inset: 0, transform: 'rotate(-90deg)' }}><circle cx="64" cy="64" r="52" fill="none" stroke="var(--surface-3)" strokeWidth="6" /><circle cx="64" cy="64" r="52" fill="none" stroke="var(--accent)" strokeWidth="6" strokeDasharray="327" strokeDashoffset={327 * (1 - secs / 180)} strokeLinecap="round" style={{ transition: 'stroke-dashoffset 200ms' }} /></svg>
                <span className="zl-title2 zl-mono">{found ? <Icon name="check" size={32} /> : secs}</span>
              </div>
            </>
          )}
          {variant === 'B' && (
            <>
              <div style={{ position: 'absolute', inset: 0, borderRadius: 999, border: '1px solid var(--line)', background: 'radial-gradient(circle, var(--surface) 0%, var(--surface-2) 100%)' }} />
              {[0.33, 0.66].map(r => <div key={r} style={{ position: 'absolute', width: 220 * r, height: 220 * r, borderRadius: 999, border: '1px solid var(--line)' }} />)}
              {!found && <motion.div animate={{ rotate: 360 }} transition={{ duration: 2.4, repeat: Infinity, ease: 'linear' }} style={{ position: 'absolute', inset: 0, borderRadius: 999, background: 'conic-gradient(from 0deg, transparent 0deg, color-mix(in srgb, var(--accent) 45%, transparent) 60deg, transparent 61deg)' }} />}
              {!found && [[0.7, 40, 1.2], [0.45, 200, 2.0], [0.85, 300, 3.1]].map(([d, a, at], i) => (
                <motion.span key={i} initial={{ opacity: 0, scale: 0.4 }} animate={{ opacity: [0, 1, 0.2, 0], scale: [0.4, 1, 1, 0.6] }} transition={tx({ duration: 2.4, delay: at, repeat: Infinity, repeatDelay: 0.4 })} style={{ position: 'absolute', left: 110 + Math.cos(a * Math.PI / 180) * 100 * d - 5, top: 110 + Math.sin(a * Math.PI / 180) * 100 * d - 5, width: 10, height: 10, borderRadius: 999, background: 'var(--accent)' }} />
              ))}
              <AnimatePresence>
                {found && <motion.div key="f" initial={{ scale: 0.3, opacity: 0, left: 110 + Math.cos(200 * Math.PI / 180) * 45 - 32, top: 110 + Math.sin(200 * Math.PI / 180) * 45 - 32 }} animate={{ scale: 1, opacity: 1, left: 110 - 32, top: 110 - 32 }} transition={tx({ type: 'spring', duration: 0.6, bounce: 0.3 })} style={{ position: 'absolute', width: 64, height: 64, borderRadius: 20, background: 'var(--accent-2)', color: 'var(--accent-text)', display: 'grid', placeItems: 'center', boxShadow: 'var(--shadow-md)' }}><Icon name="lightbulb" size={28} /></motion.div>}
              </AnimatePresence>
              {!found && <span style={{ position: 'absolute', width: 8, height: 8, borderRadius: 999, background: 'var(--ink)' }} />}
            </>
          )}
          {variant === 'C' && (
            <div className="zl-tile" data-on={found ? 'true' : 'false'} style={{ width: 180, minHeight: 130, cursor: 'default', position: 'relative', overflow: 'visible', transition: 'background 300ms, border-color 300ms' }}>
              <div className="zl-tile__row"><span className="zl-tile__icon" style={{ position: 'relative', overflow: 'visible' }}>
                <motion.span animate={{ scale: found ? [1, 1.25, 1.08] : 1 }} transition={tx({ duration: 0.5, times: [0, 0.5, 1] })} style={{ display: 'grid' }}><Icon name="lightbulb" strokeWidth={found ? 2.2 : 1.6} /></motion.span>
                <svg width="34" height="34" viewBox="0 0 34 34" style={{ position: 'absolute', inset: 0, overflow: 'visible', pointerEvents: 'none' }}>{Array.from({ length: 8 }).map((_, i) => { const a = i * 45 * Math.PI / 180; return <motion.line key={i + '-' + replayKey} x1={17 + Math.cos(a) * 16} y1={17 + Math.sin(a) * 16} x2={17 + Math.cos(a) * 26} y2={17 + Math.sin(a) * 26} stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" initial={{ pathLength: 0, opacity: 0 }} animate={found ? { pathLength: 1, opacity: [0, 1, 0] } : { pathLength: 0, opacity: 0 }} transition={tx({ duration: 0.7, delay: i * 0.03 })} /> })}</svg>
                {!found && <motion.span animate={{ opacity: [0.2, 0.7, 0.2] }} transition={{ duration: 1.6, repeat: Infinity }} style={{ position: 'absolute', inset: -3, borderRadius: 13, border: '1.5px dashed var(--line-3)' }} />}
              </span></div>
              <div><div className="zl-tile__name">{found ? t({ en: 'New bulb', he: 'נורה חדשה' }) : t({ en: 'Looking…', he: 'מחפש…' })}</div><div className="zl-tile__meta">{found ? 'IKEA Trådfri · Zigbee' : `${secs}s`}</div></div>
            </div>
          )}
        </div>
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.div key={phase} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={tx({ duration: 0.24, ease: EASE.out })} style={{ textAlign: 'center' }}>
            <div className="zl-title3">{found ? t(COPY.found) : t({ en: 'Pairing mode active', he: 'מצב צימוד פעיל' })}</div>
            <div className="zl-subhead zl-mute">{found ? t({ en: 'IKEA Trådfri bulb · Give it a name', he: 'נורת IKEA · תן לה שם' }) : t(COPY.searching)}</div>
          </motion.div>
        </AnimatePresence>
        <AnimatePresence>{found && <motion.div key="cta" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={tx({ duration: 0.3, delay: 0.2, ease: EASE.out })} style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 8 }}><input className="zl-btn" defaultValue={t({ en: 'Kids Room Lamp', he: 'מנורת חדר ילדים' })} style={{ justifyContent: 'flex-start', fontWeight: 500 }} /><Button variant="primary">{t({ en: 'Save device', he: 'שמירת מכשיר' })}</Button></motion.div>}</AnimatePresence>
        <p className="zl-footnote zl-mute">{t({ en: 'The device is found after ~4 s. Press Replay to watch again.', he: 'המכשיר נמצא אחרי ~4 שניות. לחץ Replay.' })}</p>
      </div>
    </div>
  )
}

/* ───────────────────────── 3. CHAT THINKING → ANSWER ───────────────────────── */

const REPLY = { en: 'Living room lights are on and the AC is cooling to 24°. Want me to close the balcony blinds too?', he: 'אורות הסלון דולקים והמזגן מקרר ל־24°. לסגור גם את תריס המרפסת?' }

function Bubble({ children, style }) {
  return <div className="zl-card" style={{ padding: '12px 16px', borderEndStartRadius: 6, maxWidth: 300, ...style }}>{children}</div>
}
function Avatar() { return <span style={{ width: 28, height: 28, borderRadius: 8, background: 'var(--bg-2)', display: 'grid', placeItems: 'center', flex: 'none' }}><span className="ml-brand__mark" style={{ width: 16, height: 16, fontSize: 10, borderRadius: 4 }}>Z</span></span> }

function ChatDemo({ variant, tx, ms, replayKey }) {
  const t = useT()
  const [phase, setPhase] = useState('thinking')
  useEffect(() => { setPhase('thinking'); const id = setTimeout(() => setPhase('answer'), ms(2200)); return () => clearTimeout(id) }, [replayKey]) // eslint-disable-line
  const thinking = phase === 'thinking'
  const dots = (
    <div style={{ display: 'flex', gap: 5, alignItems: 'center', height: 20 }}>
      {[0, 1, 2].map(i => <motion.span key={i} animate={{ y: [0, -4, 0] }} transition={{ duration: 0.8, delay: i * 0.15, repeat: Infinity }} style={{ width: 8, height: 8, borderRadius: 999, background: 'var(--ink-mute)' }} />)}
    </div>
  )
  return (
    <Page title={t({ en: 'Chat', he: 'צ׳אט' })}>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}><div className="zl-card" style={{ padding: '12px 16px', background: 'var(--ink)', color: 'var(--bg)', borderEndEndRadius: 6, maxWidth: 260 }}>{t({ en: 'Turn on the living room and cool it down', he: 'תדליק את הסלון ותקרר אותו' })}</div></div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
        <LayoutGroup id={`chat-${variant}`}>
          {variant === 'C' ? (
            <motion.div layoutId="orb" transition={tx({ type: 'spring', duration: 0.6, bounce: 0.1 })} style={{ width: thinking ? 44 : 28, height: thinking ? 44 : 28, borderRadius: thinking ? 22 : 8, background: thinking ? 'radial-gradient(circle at 40% 35%, #F19475, #C96442 60%, #7a3a24)' : 'var(--bg-2)', display: 'grid', placeItems: 'center', flex: 'none' }}>
              {thinking ? <motion.span animate={{ scale: [1, 1.12, 1] }} transition={{ duration: 1.4, repeat: Infinity }} style={{ width: '100%', height: '100%', borderRadius: 'inherit' }} /> : <span className="ml-brand__mark" style={{ width: 16, height: 16, fontSize: 10, borderRadius: 4 }}>Z</span>}
            </motion.div>
          ) : <Avatar />}
          {variant === 'A' && (thinking ? <Bubble>{dots}</Bubble> : <Bubble>{t(REPLY)}</Bubble>)}
          {variant === 'B' && (
            <Bubble style={{ position: 'relative', minHeight: 44 }}>
              <AnimatePresence mode="popLayout" initial={false}>
                {thinking ? (
                  <motion.div key="d" exit={{ opacity: 0, scaleX: 8, transition: tx({ duration: 0.28, ease: EASE.inOut }) }} style={{ transformOrigin: 'left center' }}>{dots}</motion.div>
                ) : (
                  <motion.div key="a" initial={{ opacity: 0, clipPath: 'inset(0 100% 0 0)' }} animate={{ opacity: 1, clipPath: 'inset(0 0% 0 0)' }} transition={tx({ duration: 0.5, ease: EASE.out })}>{t(REPLY)}</motion.div>
                )}
              </AnimatePresence>
            </Bubble>
          )}
          {variant === 'C' && (
            <AnimatePresence>{!thinking && <motion.div key="a" initial={{ opacity: 0, scale: 0.96, x: -8 }} animate={{ opacity: 1, scale: 1, x: 0 }} transition={tx({ type: 'spring', duration: 0.5, bounce: 0.05, delay: 0.15 })} style={{ transformOrigin: 'left top' }}><Bubble>{t(REPLY)}</Bubble></motion.div>}</AnimatePresence>
          )}
          {variant === 'D' && (
            <Bubble>
              <AnimatePresence mode="popLayout" initial={false}>
                {thinking ? <motion.div key="d" exit={{ opacity: 0, transition: tx({ duration: 0.12 }) }}>{dots}</motion.div> : (
                  <motion.div key="a" initial="hidden" animate="show" variants={{ show: { transition: tx({ staggerChildren: 0.05 }) } }}>
                    {t(REPLY).split(' ').map((w, i) => <motion.span key={i} variants={{ hidden: { opacity: 0, filter: 'blur(3px)', y: 4 }, show: { opacity: 1, filter: 'blur(0px)', y: 0, transition: tx({ duration: 0.22 }) } }} style={{ display: 'inline-block', marginInlineEnd: '0.28em' }}>{w}</motion.span>)}
                  </motion.div>
                )}
              </AnimatePresence>
            </Bubble>
          )}
        </LayoutGroup>
      </div>
      <p className="zl-footnote zl-mute" style={{ marginTop: 14 }}>{t({ en: 'The answer lands after ~2 s. Replay to watch again.', he: 'התשובה מגיעה אחרי ~2 שניות.' })}</p>
    </Page>
  )
}

/* ───────────────────────── 4. SCENE RUN: GOOD NIGHT ───────────────────────── */

const ORDER = ['bedroom', 'bathroom', 'kids', 'office', 'kitchen', 'living_room', 'balcony'] // distance from the bedroom
const SCENE_STEPS = [{ en: 'Lights off', he: 'כיבוי אורות' }, { en: 'TV off', he: 'כיבוי טלוויזיה' }, { en: 'AC to 24°', he: 'מזגן ל־24°' }, { en: 'Lock the door', he: 'נעילת הדלת' }]

function SceneDemo({ variant, tx, ms, knobs }) {
  const t = useT(); const h = useHaptic()
  const [lit, setLit] = useState(() => Object.fromEntries(ROOMS.map(r => [r.id, true])))
  const [state, setState] = useState('idle') // idle | running | done
  const [stepIdx, setStepIdx] = useState(-1)
  const [curtain, setCurtain] = useState(false)
  const [toast, setToast] = useState(false)
  const timers = useRef([])
  const later = (fn, at) => timers.current.push(setTimeout(fn, ms(at)))
  useEffect(() => () => timers.current.forEach(clearTimeout), [])
  const allOff = Object.values(lit).every(v => !v)
  const run = () => {
    timers.current.forEach(clearTimeout); timers.current = []
    setState('running'); h('medium')
    if (variant === 'A') { later(() => { setLit(Object.fromEntries(ROOMS.map(r => [r.id, false]))); setToast(true); setState('done') }, 600); later(() => setToast(false), 3000); return }
    if (variant === 'B' || variant === 'C') {
      if (variant === 'C') setCurtain(true)
      ORDER.forEach((id, i) => later(() => { setLit(l => ({ ...l, [id]: false })); h('selection') }, 200 + i * knobs.cascade * 1000))
      later(() => { setState('done'); h('success') }, 200 + ORDER.length * knobs.cascade * 1000 + 300)
      return
    }
    // D: the button becomes the timeline
    SCENE_STEPS.forEach((_, i) => later(() => { setStepIdx(i); if (i === 0) setLit(Object.fromEntries(ROOMS.map(r => [r.id, false]))); h('selection') }, 300 + i * 700))
    later(() => { setState('done'); h('success') }, 300 + SCENE_STEPS.length * 700 + 300)
  }
  const reset = () => { timers.current.forEach(clearTimeout); setLit(Object.fromEntries(ROOMS.map(r => [r.id, true]))); setState('idle'); setStepIdx(-1); setCurtain(false); setToast(false) }
  const litCount = Object.values(lit).filter(Boolean).length
  return (
    <div className="zl zl-page">
      <div className="zl-page__scroll" style={{ position: 'relative' }}>
        <div className="zl-caption zl-mute" style={{ textTransform: 'uppercase', letterSpacing: '.06em' }}>{t({ en: 'Good evening, Youval', he: 'ערב טוב, יובל' })}</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, minHeight: 44 }}>
          <AnimatePresence mode="popLayout" initial={false}><motion.h1 key={allOff ? 'c' : 'a'} initial={{ opacity: 0, y: 10, filter: 'blur(3px)' }} animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }} exit={{ opacity: 0, y: -10, filter: 'blur(3px)' }} transition={tx({ duration: 0.32, ease: EASE.out })} className="zl-large" style={{ margin: 0 }}>{allOff ? t({ en: 'Good night', he: 'לילה טוב' }) : t({ en: 'Home is awake', he: 'הבית ער' })}</motion.h1></AnimatePresence>
          <AnimatePresence>{allOff && variant !== 'A' && <motion.span key="moon" initial={{ opacity: 0, y: 14, rotate: -30 }} animate={{ opacity: 1, y: 0, rotate: 0 }} transition={tx({ type: 'spring', duration: 0.8, bounce: 0.2, delay: 0.1 })} style={{ color: 'var(--gold)', display: 'grid' }}><Icon name="moon" size={26} /></motion.span>}</AnimatePresence>
        </div>
        <div className="zl-footnote zl-mute" style={{ marginBottom: 14 }}>{litCount} {t({ en: 'rooms lit', he: 'חדרים מוארים' })}</div>
        <div className="zl-grid2" style={{ marginBottom: 14 }}>
          {ROOMS.map(r => (
            <motion.div key={r.id} animate={{ backgroundColor: lit[r.id] ? 'var(--surface)' : 'var(--tile-base)', opacity: lit[r.id] ? 1 : 0.7 }} transition={tx({ duration: 0.4, ease: EASE.out })} className="zl-tile" style={{ minHeight: 78, padding: 10, cursor: 'default' }}>
              <div className="zl-tile__row"><motion.span className="zl-tile__icon" animate={{ backgroundColor: lit[r.id] ? 'var(--accent-2)' : 'var(--surface-2)', color: lit[r.id] ? 'var(--accent-text)' : 'var(--ink-mute)', scale: lit[r.id] ? 1 : 0.92 }} transition={tx({ duration: 0.36, ease: EASE.out })} style={{ width: 30, height: 30 }}><Icon name={r.icon} size={16} /></motion.span></div>
              <div className="zl-tile__name" style={{ fontSize: 13, marginTop: 4 }}>{t(r.name)}</div>
            </motion.div>
          ))}
        </div>
        <Card style={{ display: 'flex', alignItems: 'center', gap: 12, position: 'relative', overflow: 'hidden' }}>
          <span className="zl-row__icon" style={{ fontSize: 18 }}>🌙</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="zl-row__title">{t({ en: 'Good Night', he: 'לילה טוב' })}</div>
            {variant === 'D' && state !== 'idle' ? (
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 4 }}>
                {SCENE_STEPS.map((s, i) => <motion.span key={i} className="zl-chip" animate={{ backgroundColor: i <= stepIdx ? 'color-mix(in srgb, var(--ok) 14%, var(--surface))' : 'var(--surface-2)', color: i <= stepIdx ? 'var(--ok-text)' : 'var(--ink-mute)', scale: i === stepIdx ? [1, 1.06, 1] : 1 }} transition={tx({ duration: 0.3 })} style={{ height: 24, fontSize: 11, borderColor: 'transparent' }}>{i <= stepIdx && <Icon name="check" size={11} strokeWidth={3} />}{t(s)}</motion.span>)}
              </div>
            ) : <div className="zl-row__sub">4 {t({ en: 'steps', he: 'שלבים' })}</div>}
          </div>
          <motion.button onClick={state === 'done' ? reset : state === 'idle' ? run : undefined} layout animate={{ backgroundColor: state === 'done' ? 'var(--ok)' : state === 'running' ? 'var(--surface-2)' : 'var(--accent)', color: state === 'done' ? '#fff' : state === 'running' ? 'var(--ink-mute)' : 'var(--on-accent)' }} transition={tx({ type: 'spring', duration: 0.4, bounce: 0 })} style={{ height: 40, padding: '0 16px', borderRadius: 999, border: 0, fontWeight: 600, fontSize: 14, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, flex: 'none' }}>
            <AnimatePresence mode="popLayout" initial={false}><motion.span key={state} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={tx({ duration: 0.16 })} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>{state === 'idle' ? <><Icon name="play" size={14} />{t(COPY.run)}</> : state === 'running' ? t(COPY.running) : <><Icon name="check" size={14} strokeWidth={3} />{t({ en: 'Reset', he: 'איפוס' })}</>}</motion.span></AnimatePresence>
          </motion.button>
        </Card>
        <AnimatePresence>{curtain && <motion.div key="curtain" initial={{ scaleY: 0 }} animate={{ scaleY: 1 }} transition={tx({ duration: ORDER.length * knobs.cascade + 0.2, ease: 'linear' })} style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg, rgba(20,16,12,0.55), rgba(20,16,12,0.25))', transformOrigin: 'top', pointerEvents: 'none' }} />}</AnimatePresence>
      </div>
      <AnimatePresence>{toast && <motion.div key="t" className="zl-toast" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={tx({ duration: 0.24 })} style={{ position: 'absolute', bottom: 20, left: 16, right: 16 }}>{t({ en: 'Good Night — 4 steps completed', he: 'לילה טוב — 4 שלבים הושלמו' })}</motion.div>}</AnimatePresence>
    </div>
  )
}

/* ───────────────────────── 5. ZIGGY PILL: SYSTEM STATE ───────────────────────── */

const PILL_STATES = ['idle', 'listening', 'thinking', 'alert', 'offline', 'undo']

function ZiggyPill({ variant, tx }) {
  const t = useT(); const h = useHaptic()
  const [s, setS] = useState('idle')
  const label = { idle: null, listening: t({ en: 'Listening…', he: 'מקשיב…' }), thinking: t({ en: 'Thinking…', he: 'חושב…' }), alert: t({ en: 'Balcony door open · AC on', he: 'דלת מרפסת פתוחה · מזגן דולק' }), offline: t({ en: 'Reconnecting…', he: 'מתחבר מחדש…' }), undo: t({ en: 'Living Room lights off', he: 'אורות הסלון כבו' }) }[s]
  const tone = { alert: 'var(--warn)', offline: 'var(--err)', undo: 'var(--ok)' }[s]
  const expanded = variant === 'B' && s === 'alert'
  return (
    <div className="zl zl-page">
      <div style={{ position: 'absolute', top: 14, left: 0, right: 0, display: 'flex', justifyContent: 'center', zIndex: 3 }}>
        <LayoutGroup id={`pill-${variant}`}>
          <motion.div layout transition={tx({ type: 'spring', duration: 0.5, bounce: 0.18 })} style={{ background: 'var(--ink)', color: 'var(--bg)', borderRadius: expanded ? 20 : 999, height: expanded ? 'auto' : 36, minWidth: 36, padding: expanded ? 14 : label ? '0 14px 0 8px' : 0, display: 'flex', alignItems: expanded ? 'stretch' : 'center', flexDirection: expanded ? 'column' : 'row', gap: 8, boxShadow: 'var(--shadow-lg)', overflow: 'hidden', maxWidth: 320 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <motion.span layout="position" style={{ width: expanded ? 24 : 28, height: expanded ? 24 : 28, borderRadius: 999, display: 'grid', placeItems: 'center', background: tone || 'var(--accent)', color: '#1e1812', fontWeight: 700, fontSize: 12, flex: 'none', margin: expanded ? 0 : 4 }}>
                <AnimatePresence mode="popLayout" initial={false}>
                  <motion.span key={s} initial={{ opacity: 0, scale: 0.6 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.6 }} transition={tx({ duration: 0.16 })} style={{ display: 'grid' }}>
                    {s === 'listening' ? <span style={{ display: 'flex', gap: 2, alignItems: 'center', height: 12 }}>{[0, 1, 2, 3].map(i => <motion.span key={i} animate={{ scaleY: [0.3, 1, 0.3] }} transition={{ duration: 0.7 + i * 0.06, repeat: Infinity, delay: i * 0.07 }} style={{ width: 2, height: 12, background: '#1e1812', borderRadius: 1, transformOrigin: 'center' }} />)}</span>
                      : s === 'thinking' ? <motion.span animate={{ rotate: 360 }} transition={{ duration: 1.2, repeat: Infinity, ease: 'linear' }} style={{ width: 12, height: 12, borderRadius: 999, border: '2px solid #1e1812', borderTopColor: 'transparent' }} />
                      : s === 'alert' ? <Icon name="warning" size={13} strokeWidth={2.5} /> : s === 'offline' ? <Icon name="wifi-off" size={13} strokeWidth={2.5} /> : s === 'undo' ? <Icon name="check" size={13} strokeWidth={3} /> : 'Z'}
                  </motion.span>
                </AnimatePresence>
              </motion.span>
              <AnimatePresence mode="popLayout" initial={false}>
                {label && <motion.span key={s} layout="position" initial={{ opacity: 0, filter: 'blur(3px)', x: -4 }} animate={{ opacity: 1, filter: 'blur(0px)', x: 0 }} exit={{ opacity: 0, filter: 'blur(3px)', x: 4, transition: tx({ duration: 0.12 }) }} transition={tx({ duration: 0.22, delay: 0.08 })} style={{ fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap' }}>{label}</motion.span>}
              </AnimatePresence>
              {s === 'undo' && !expanded && <button className="zl-toast__action" style={{ color: 'var(--accent-3)' }} onClick={() => { setS('idle'); h('light') }}>{t(COPY.undo)}</button>}
            </div>
            <AnimatePresence>{expanded && <motion.div key="body" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={tx({ duration: 0.22, delay: 0.14 })} style={{ display: 'flex', gap: 8 }}><button className="zl-btn zl-btn--pill" style={{ background: 'var(--warn)', color: '#1e1812', border: 0 }} onClick={() => setS('idle')}>{t({ en: 'Turn AC off', he: 'כיבוי מזגן' })}</button><button className="zl-btn zl-btn--pill" style={{ background: 'transparent', color: 'var(--bg)', borderColor: 'rgba(255,255,255,.25)' }} onClick={() => setS('idle')}>{t({ en: 'Ignore', he: 'התעלם' })}</button></motion.div>}</AnimatePresence>
          </motion.div>
        </LayoutGroup>
      </div>
      <div className="zl-page__scroll" style={{ paddingTop: 70 }}>
        <h1 className="zl-title2 zl-page__title">{t({ en: 'Rooms', he: 'חדרים' })}</h1>
        <div className="zl-stack">{ROOMS.slice(0, 3).map(r => <Card key={r.id}><div className="zl-row__title">{t(r.name)}</div><div className="zl-row__sub">{r.lightsOn ? t(COPY.lightsOn, r.lightsOn) : t(COPY.allOff)}</div></Card>)}</div>
        <div className="zl-hstack" style={{ flexWrap: 'wrap', marginTop: 16 }}>{PILL_STATES.map(x => <button key={x} className="zl-chip" data-on={s === x ? 'true' : 'false'} style={{ cursor: 'pointer' }} onClick={() => { setS(x); h('selection') }}>{x}</button>)}</div>
        <p className="zl-footnote zl-mute" style={{ marginTop: 12 }}>{t({ en: 'One pill at the top is the system\'s voice: it grows to speak and shrinks when done. Every state morphs from the previous one.', he: 'גלולה אחת למעלה היא הקול של המערכת.' })}</p>
      </div>
    </div>
  )
}

/* ───────────────────────── SECTION ───────────────────────── */

export default function Moments() {
  return (
    <>
      <SectionIntro
        title="Moments"
        lede="The rare interactions where a moment is earned: first-run, pairing, Ziggy answering, a scene running, the system speaking. Phase 1 found every one of these is a hard cut today. Frequency is low, so delight is allowed, once, and it must still explain."
        found={[
          'Both onboarding wizards advance every step as a bare conditional; no progress indicator; the success disc is static and Continue pops in at 1000 ms.',
          'Pairing: a breathing halo and a countdown ring are the entire searching vocabulary; "Device found!" is a banner with no pop, no check, no haptic.',
          'Chat: the thinking dots vanish in one frame as the reply lands; no streaming; the status pill and thread drawer cut.',
          'Running a scene: a toast, then a WS toast seconds later; nothing on the home shows the scene happening.',
          'System messages have no single home: 190 error toasts, a fixed subscription strip, a sticky connection banner, a health card.',
        ]}
      />

      <Demo id="onboarding-steps" title="Onboarding step advance" purpose="First run is the one time the user watches every transition. The steps should feel like a path, not a slideshow." principles={['continuity', 'physical']} inZiggy={['WebOnboarding.jsx:96-112', 'MobileOnboarding.jsx:190-208', 'onboarding/steps.jsx']}
        knobs={[{ key: 'duration', label: 'Duration', min: 0.2, max: 0.8, step: 0.02, value: 0.4, unit: 'ms' }]}
        recommend="C"
        variants={[
          { key: 'A', label: 'Cut (today)', render: (p) => <OnboardingDemo {...p} variant="A" /> },
          { key: 'B', label: 'Slide + dots grow', note: 'Content slides in the direction of travel; the current dot widens to a bar. Exit 140 ms, enter 400 ms.', render: (p) => <OnboardingDemo {...p} variant="B" /> },
          { key: 'C', label: 'Deck of cards', note: 'Steps are a deck: the finished card swings away on its hinge and the next card comes forward from the stack. You can see how many are left. The success card arrives the same way.', tradeoff: 'rotateY needs perspective on the parent; keep the deck to ≤3 visible cards.', render: (p) => <OnboardingDemo {...p} variant="C" /> },
          { key: 'D', label: 'Progress line writes', note: 'A thin accent line grows toward the next step first (spring), then the content rises under it. Causality: the path extends, then you walk it.', render: (p) => <OnboardingDemo {...p} variant="D" /> },
        ]} />

      <Demo id="pairing" title="Pairing: searching → found" purpose="Searching should look like searching; finding should feel like a small arrival." principles={['causality', 'state']} inZiggy={['PairingWizard.jsx:727-899', 'CountdownRing']}
        recommend="B"
        variants={[
          { key: 'A', label: 'Halo + ring (today)', note: 'The countdown ring and a breathing halo; found = the number becomes a check.', render: (p) => <PairingDemo {...p} variant="A" /> },
          { key: 'B', label: 'Radar + blip lands', note: 'A sweep rotates; blips ping at bearings as the radio hears things; when the device is found, its blip flies to the centre and grows into a device icon on a spring. The search had a geometry; the result came from it.', render: (p) => <PairingDemo {...p} variant="B" /> },
          { key: 'C', label: 'The tile ignites', note: 'The device is shown as the real tile it will become, dashed while searching; on found it ignites (rays flash outward) and gets its name field. Continuity into the devices list.', render: (p) => <PairingDemo {...p} variant="C" /> },
        ]} />

      <Demo id="chat-thinking" title="Chat: thinking → answer" purpose="The thinking indicator should become the answer, not be replaced by it." principles={['continuity', 'causality']} inZiggy={['AIChat.jsx ThinkingBubble', 'Message entry']}
        recommend="B"
        variants={[
          { key: 'A', label: 'Dots vanish (today)', render: (p) => <ChatDemo {...p} variant="A" /> },
          { key: 'B', label: 'Dots stretch into the line', note: 'The three dots stretch horizontally into the width of the reply, which wipes in behind them (clip-path). One object turns into the text.', render: (p) => <ChatDemo {...p} variant="B" /> },
          { key: 'C', label: 'Orb becomes the avatar', note: 'While thinking, the orange orb breathes where the avatar will be; on the answer it shrinks into the 28 px avatar and the bubble unfolds from it.', render: (p) => <ChatDemo {...p} variant="C" /> },
          { key: 'D', label: 'Words arrive', note: 'Words fade in 50 ms apart with a 3 px blur, left to right. Reads as speech, without a per-character typewriter.', tradeoff: 'Long replies must cap the stagger (first 30 words) or the reader waits.', render: (p) => <ChatDemo {...p} variant="D" /> },
        ]} />

      <Demo id="scene-run" title="Scene run: Good Night" purpose="A scene changes the whole home. The home should visibly change, in the order it happens." principles={['causality', 'hierarchy', 'state']} inZiggy={['AutomationCard Run', 'RoutineCard Run now', 'execution_result toast']}
        knobs={[{ key: 'cascade', label: 'Cascade gap (B, C)', min: 0.05, max: 0.4, step: 0.01, value: 0.16, unit: 'ms' }]}
        recommend="B"
        variants={[
          { key: 'A', label: 'Toast (today)', render: (p) => <SceneDemo {...p} variant="A" /> },
          { key: 'B', label: 'Wave from the bedroom', note: 'Rooms go dark one after another, ordered by distance from the bedroom; the count rolls; the hero becomes "Good night" and a moon rises. The scene is watched, not reported.', render: (p) => <SceneDemo {...p} variant="B" /> },
          { key: 'C', label: 'Curtain', note: 'A dusk scrim descends over the dashboard as the rooms go dark beneath it, then the moon. Theatrical; once a night is the right frequency.', tradeoff: 'A full-frame scrim is a paint per frame; keep it to a gradient on one layer.', render: (p) => <SceneDemo {...p} variant="C" /> },
          { key: 'D', label: 'Run button becomes the timeline', note: 'The Run button turns into "Running…" and the row grows a step list that ticks off in real time (Lights off · TV off · AC 24° · Lock). Then the button becomes the result. Feedback exactly where the action was.', render: (p) => <SceneDemo {...p} variant="D" /> },
        ]} />

      <Demo id="ziggy-pill" title="Ziggy pill: the system's voice" purpose="One place for every system message: listening, thinking, an alert, offline, undo. It grows to speak and shrinks when done." principles={['continuity', 'hierarchy', 'restraint']} inZiggy={['Toast.jsx', 'ConnectionStatus', 'SubscriptionGateBanner', 'AIChat status pill', 'ChatBubble unread']}
        recommend="B"
        variants={[
          { key: 'A', label: 'Morphing pill', note: 'Width and content morph between states (layout + blur crossfade). The mark becomes a waveform, a spinner, a warning, a check.', render: (p) => <ZiggyPill {...p} variant="A" /> },
          { key: 'B', label: 'Pill opens into a card', note: 'Same pill; an alert that needs a decision expands downward into a small card with actions, then folds back. Dynamic-Island grammar applied to a home.', tradeoff: 'Competes with the top safe-area on phones with a notch; keep it under the status bar.', render: (p) => <ZiggyPill {...p} variant="B" /> },
        ]} />
    </>
  )
}
