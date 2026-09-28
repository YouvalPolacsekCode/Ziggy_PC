// Motion Lab — the opening: one tap, six consequences.
//
// A single tap on a light tile sets off a choreographed chain that shows the
// whole thesis in two seconds: the control hears you, the hub is asked, the
// state arrives, the room learns it, the house changes mood, and the
// feedback grows out of the thing you touched. Each beat lights its caption
// on the side as it fires. Off is the same chain with faster exits.
import { useState, useRef, useEffect, useCallback } from 'react'
import { motion, AnimatePresence, LayoutGroup } from 'framer-motion'
import { Stage } from './Stage'
import { Icon, useT } from '../ziggy/primitives'
import { useLab, useHaptic } from '../LabContext'
import { EASE } from '../time'
import { COPY } from '../mock/home'

const BEATS = [
  { at: 0, key: 'press', title: 'Heard you', body: 'Press feedback under the finger, before any radio answers.', p: 'restraint' },
  { at: 120, key: 'pending', title: 'Asking the hub', body: 'The tile leans toward the new state and a bounded ring draws. Waiting has a shape.', p: 'causality' },
  { at: 760, key: 'arrive', title: 'State arrives', body: 'The hub answers: the tile commits and the bulb\'s rays draw outward. Light spreads from its source.', p: 'state' },
  { at: 980, key: 'room', title: 'The room learns it', body: 'The Living Room tile\'s count rolls 0 → 1 and its dot lights. Same object, new fact.', p: 'continuity' },
  { at: 1200, key: 'house', title: 'The house changes mood', body: 'Only the word that changed moves: calm → awake. The hero line is the home\'s state.', p: 'hierarchy' },
  { at: 1420, key: 'toast', title: 'Feedback from the cause', body: 'The tile\'s status dot grows into the confirmation, with Undo. Nothing pops from nowhere.', p: 'continuity' },
]

function Rays({ on, tx, tick }) {
  return (
    <svg width="34" height="34" viewBox="0 0 34 34" style={{ position: 'absolute', inset: 0, overflow: 'visible', pointerEvents: 'none' }}>
      {Array.from({ length: 6 }).map((_, i) => {
        const a = (-90 + i * 30 - 75) * Math.PI / 180
        return <motion.line key={i + '-' + tick} x1={17 + Math.cos(a) * 15} y1={17 + Math.sin(a) * 15} x2={17 + Math.cos(a) * 21} y2={17 + Math.sin(a) * 21} stroke="var(--accent)" strokeWidth="2" strokeLinecap="round"
          initial={{ pathLength: 0, opacity: 0 }} animate={on ? { pathLength: 1, opacity: 1 } : { pathLength: 0, opacity: 0 }} transition={tx({ duration: on ? 0.3 : 0.12, delay: on ? i * 0.02 : 0, ease: EASE.out })} />
      })}
    </svg>
  )
}

export function HeroCascade() {
  const lab = useLab(); const t = useT(); const h = useHaptic()
  const { tx, ms } = lab
  const [on, setOn] = useState(false)
  const [phase, setPhase] = useState('idle') // idle | pending | done
  const [beat, setBeat] = useState(-1)
  const [roomCount, setRoomCount] = useState(0)
  const [awake, setAwake] = useState(false)
  const [toast, setToast] = useState(false)
  const [tick, setTick] = useState(0)
  const timers = useRef([])
  const clear = () => { timers.current.forEach(clearTimeout); timers.current = [] }
  const later = (fn, at) => timers.current.push(setTimeout(fn, ms(at)))

  const fire = useCallback(() => {
    if (phase === 'pending') return
    clear()
    const next = !on
    setTick(k => k + 1)
    setBeat(0); h('light')
    later(() => { setPhase('pending'); setBeat(1) }, BEATS[1].at)
    later(() => { setOn(next); setPhase('done'); setBeat(2); h(next ? 'medium' : 'light') }, next ? BEATS[2].at : 520)
    later(() => { setRoomCount(next ? 1 : 0); setBeat(3) }, next ? BEATS[3].at : 640)
    later(() => { setAwake(next); setBeat(4) }, next ? BEATS[4].at : 760)
    later(() => { setToast(true); setBeat(5) }, next ? BEATS[5].at : 880)
    later(() => { setToast(false); setPhase('idle') }, next ? 4200 : 3200)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [on, phase, ms])

  useEffect(() => () => clear(), [])
  const lean = phase === 'pending'
  const title = awake ? { en: 'awake', he: 'ער' } : { en: 'calm', he: 'רגוע' }

  return (
    <div className="ml-hero">
      <div className="ml-hero__stage">
        <Stage kind="fixed" height={560}>
          <div className="zl zl-page" dir={lab.dir}>
            <div className="zl-page__scroll" style={{ paddingTop: 22 }}>
              <div className="zl-caption zl-mute" style={{ textTransform: 'uppercase', letterSpacing: '.06em' }}>{t(COPY.greeting)}</div>
              <h1 className="zl-large" style={{ margin: '2px 0 6px', display: 'flex', gap: '0.28em', flexWrap: 'wrap' }}>
                <span>{t({ en: 'Home is', he: 'הבית' })}</span>
                <span style={{ position: 'relative', display: 'inline-grid' }}>
                  <AnimatePresence mode="popLayout" initial={false}>
                    <motion.span key={awake ? 'a' : 'c'} initial={{ opacity: 0, y: 10, filter: 'blur(4px)' }} animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }} exit={{ opacity: 0, y: -10, filter: 'blur(4px)' }} transition={tx({ duration: 0.34, ease: EASE.out })} style={{ color: awake ? 'var(--accent-text)' : 'inherit' }}>{t(title)}</motion.span>
                  </AnimatePresence>
                </span>
              </h1>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 18 }}>
                <motion.span animate={{ background: awake ? 'var(--ok)' : 'var(--line-2)', boxShadow: awake ? '0 0 0 3px color-mix(in srgb, var(--ok) 30%, transparent)' : '0 0 0 0px transparent' }} transition={tx({ duration: 0.3 })} style={{ width: 8, height: 8, borderRadius: 999 }} />
                <AnimatePresence mode="popLayout" initial={false}><motion.span key={awake ? '1' : '0'} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={tx({ duration: 0.2 })} className="zl-subhead zl-mute">{awake ? t({ en: '1 room active', he: 'חדר אחד פעיל' }) : t({ en: 'All quiet', he: 'הכל שקט' })}</motion.span></AnimatePresence>
              </div>

              <div className="zl-caption zl-mute" style={{ textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 8 }}>{t({ en: 'Rooms', he: 'חדרים' })}</div>
              <motion.div className="zl-tile zl-room" animate={{ borderColor: roomCount ? 'color-mix(in srgb, var(--accent) 35%, var(--line))' : 'var(--line)' }} style={{ minHeight: 96, marginBottom: 18, cursor: 'default' }}>
                <div className="zl-tile__row"><span className="zl-tile__icon"><Icon name="sofa" /></span>
                  <motion.span animate={{ background: roomCount ? 'var(--ok)' : 'var(--ink-ghost)', scale: roomCount ? [1, 1.5, 1] : 1 }} transition={tx({ duration: 0.36 })} style={{ width: 8, height: 8, borderRadius: 999 }} />
                </div>
                <div><div className="zl-tile__name">{t({ en: 'Living Room', he: 'סלון' })}</div>
                  <div className="zl-tile__meta" style={{ display: 'flex', gap: 4 }}>
                    <span style={{ display: 'inline-block', height: 18, overflow: 'hidden', width: 10 }}>
                      <motion.span animate={{ y: `-${roomCount * 18}px` }} transition={tx({ type: 'spring', duration: 0.5, bounce: 0.1 })} style={{ display: 'block' }}><span style={{ display: 'block', height: 18 }}>0</span><span style={{ display: 'block', height: 18 }}>1</span></motion.span>
                    </span>
                    <span>{roomCount === 1 ? t({ en: 'light on', he: 'אור דולק' }) : t({ en: 'lights on', he: 'אורות דולקים' })}</span>
                  </div>
                </div>
              </motion.div>

              <div className="zl-caption zl-mute" style={{ textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 8 }}>{t({ en: 'Pinned devices', he: 'מכשירים מוצמדים' })}</div>
              <LayoutGroup id="hero-cascade">
                <div className="zl-grid2">
                  <motion.button className="zl-tile" data-on={on ? 'true' : 'false'} whileTap={{ scale: 0.97 }} onClick={fire}
                    animate={{ backgroundColor: lean ? 'color-mix(in srgb, var(--accent-2) 50%, var(--tile-base))' : on ? 'var(--surface)' : 'var(--tile-base)' }} transition={tx({ duration: 0.24, ease: EASE.out })}
                    style={{ minHeight: 110, position: 'relative', overflow: 'visible' }}>
                    <div className="zl-tile__row">
                      <span className="zl-tile__icon" style={{ position: 'relative', overflow: 'visible' }}>
                        <motion.span animate={{ scale: on ? 1.08 : 1 }} transition={tx({ type: 'spring', duration: 0.4, bounce: 0.3 })} style={{ display: 'grid' }}><Icon name="lightbulb" strokeWidth={on ? 2.2 : 1.9} /></motion.span>
                        <Rays on={on} tx={tx} tick={tick} />
                        <svg width="42" height="42" viewBox="0 0 42 42" style={{ position: 'absolute', inset: -4, transform: 'rotate(-90deg)', pointerEvents: 'none' }}>
                          <AnimatePresence>{lean && <motion.circle key="ring" cx="21" cy="21" r="19" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" initial={{ pathLength: 0 }} animate={{ pathLength: 0.9 }} exit={{ pathLength: 1, opacity: 0, transition: tx({ duration: 0.25 }) }} transition={tx({ duration: 0.64, ease: 'linear' })} />}</AnimatePresence>
                        </svg>
                      </span>
                      {!toast && <motion.span layoutId="hero-dot" style={{ width: 8, height: 8, borderRadius: 999, background: on ? 'var(--accent)' : 'var(--line-2)' }} />}
                    </div>
                    <div><div className="zl-tile__name">{t({ en: 'Ceiling Light', he: 'תאורת תקרה' })}</div>
                      <div className="zl-tile__meta">{lean ? '…' : on ? t(COPY.on) : t(COPY.off)}</div></div>
                  </motion.button>
                  <div className="zl-tile" style={{ minHeight: 110, opacity: 0.55, cursor: 'default' }}>
                    <div className="zl-tile__row"><span className="zl-tile__icon"><Icon name="thermometer" /></span></div>
                    <div><div className="zl-tile__name">{t({ en: 'Living Room AC', he: 'מזגן סלון' })}</div><div className="zl-tile__meta">{t(COPY.off)}</div></div>
                  </div>
                </div>
                <AnimatePresence>
                  {toast && (
                    <motion.div key="t" layoutId="hero-dot" transition={tx({ type: 'spring', duration: 0.5, bounce: 0 })} className="zl-toast" exit={{ opacity: 0, y: 6, transition: tx({ duration: 0.16 }) }} style={{ position: 'absolute', left: 16, right: 16, bottom: 72, borderRadius: 14, background: 'var(--ink)' }}>
                      <motion.span initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={tx({ duration: 0.16, delay: 0.16 })} style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%' }}>
                        <span style={{ width: 8, height: 8, borderRadius: 999, background: on ? 'var(--ok)' : 'var(--line-2)' }} />
                        <span style={{ flex: 1 }}>{on ? t(COPY.toastLightOn) : t({ en: 'Living Room lights off', he: 'אורות הסלון כבו' })}</span>
                        <button className="zl-toast__action" onClick={(e) => { e.stopPropagation(); fire() }}>{t(COPY.undo)}</button>
                      </motion.span>
                    </motion.div>
                  )}
                </AnimatePresence>
              </LayoutGroup>
            </div>
            <nav className="zl-nav">
              {['house', 'layout-grid', 'lightbulb', 'zap', 'settings'].map((ic, i) => <span key={ic} className="zl-nav__item" aria-current={i === 0 ? 'page' : undefined}><Icon name={ic} size={22} strokeWidth={i === 0 ? 2.2 : 1.7} /><span>{t([{ en: 'Home', he: 'בית' }, { en: 'Rooms', he: 'חדרים' }, { en: 'Devices', he: 'מכשירים' }, { en: 'Actions', he: 'פעולות' }, { en: 'More', he: 'עוד' }][i])}</span></span>)}
            </nav>
          </div>
        </Stage>
        <div className="ml-hero__cta">
          <button className="ml-btn ml-btn--big" onClick={fire} disabled={phase === 'pending'}>{on ? '▶ Turn it off' : '▶ Tap the light'}</button>
          <span className="ml-hero__hint">or tap the tile in the phone · try 0.25× speed</span>
        </div>
      </div>
      <ol className="ml-beats">
        {BEATS.map((b, i) => (
          <li key={b.key} className={`ml-beat ${beat === i ? 'is-live' : beat > i ? 'is-done' : ''}`}>
            <span className="ml-beat__at">{String(b.at).padStart(4, ' ')} ms</span>
            <div><div className="ml-beat__title">{b.title} <span className="ml-principle">{b.p}</span></div><div className="ml-beat__body">{b.body}</div></div>
          </li>
        ))}
      </ol>
    </div>
  )
}
