// Motion Lab — DEVICES
// Device state change (local vs remote), pending/confirmed/failed, card expand,
// icon morphs, the device sheet with detents.
import { useState, useRef, useEffect, useCallback } from 'react'
import { motion, AnimatePresence, LayoutGroup, useMotionValue, useTransform, animate } from 'framer-motion'
import gsap from 'gsap'
import { MorphSVGPlugin } from 'gsap/MorphSVGPlugin'
import { useGSAP } from '@gsap/react'
import { Demo } from '../ui/Demo'
import { SectionIntro } from '../ui/Section'
import { Icon, Page, Card, Button, useT } from '../ziggy/primitives'
import { useHaptic } from '../LabContext'
import { EASE, cssEase } from '../time'
import { DEVICES, COPY, PEOPLE } from '../mock/home'

gsap.registerPlugin(MorphSVGPlugin, useGSAP)

const KIND_ICON = { light: 'lightbulb', climate: 'thermometer', media: 'tv', cover: 'blinds', sensor: 'radar', switch: 'power', lock: 'lock', camera: 'camera' }

/* ───────────────────────── 1. STATE CHANGE ORIGIN ───────────────────────── */

function OriginFrame({ children, onLocal, onRemote, onPerson, t }) {
  const tslil = PEOPLE.find(p => p.id === 'tslil')
  return (
    <Page title={t({ en: 'Living Room', he: 'סלון' })}>
      <div className="zl-hstack" style={{ marginBottom: 12, flexWrap: 'wrap' }}>
        <Button style={{ height: 36 }} onClick={onLocal}>{t({ en: 'I tap it', he: 'אני מקיש' })}</Button>
        <Button style={{ height: 36 }} onClick={() => onRemote('wall')}>{t({ en: 'Someone flips the wall switch', he: 'מישהו לוחץ על המתג בקיר' })}</Button>
        {onPerson && <Button style={{ height: 36 }} onClick={() => onPerson(tslil)}>{t({ en: `${t(tslil.name)} taps in her app`, he: `${t(tslil.name)} מקישה באפליקציה שלה` })}</Button>}
      </div>
      <div className="zl-grid2">{children}</div>
    </Page>
  )
}

function useOriginState() {
  const [on, setOn] = useState(false)
  const [origin, setOrigin] = useState(null) // 'local' | 'remote'
  const [by, setBy] = useState(null) // null | 'wall' | a PEOPLE entry
  const [tick, setTick] = useState(0)
  const local = () => { setOrigin('local'); setBy(null); setOn(v => !v); setTick(k => k + 1) }
  const remote = (who = 'wall') => { setOrigin('remote'); setBy(who); setOn(v => !v); setTick(k => k + 1) }
  return { on, origin, by, tick, local, remote }
}

function BaseTile({ on, name, meta, children, style, ...rest }) {
  const t = useT()
  return (
    <div className="zl-tile" data-on={on ? 'true' : 'false'} style={{ minHeight: 120, position: 'relative', ...style }} {...rest}>
      <div className="zl-tile__row" style={{ position: 'relative', zIndex: 1 }}>{children}</div>
      <div style={{ position: 'relative', zIndex: 1 }}><div className="zl-tile__name">{t(name)}</div><div className="zl-tile__meta">{meta}</div></div>
    </div>
  )
}

function OriginA({ tx }) {
  const s = useOriginState(); const t = useT()
  return (
    <OriginFrame t={t} onLocal={s.local} onRemote={s.remote}>
      <BaseTile on={s.on} name={{ en: 'Ceiling Light', he: 'תאורת תקרה' }} meta={s.on ? t(COPY.on) : t(COPY.off)} style={{ transition: `background calc(${s.on ? 220 : 160}ms * var(--lab-speed,1)) ${cssEase('enter')}, border-color calc(200ms * var(--lab-speed,1))` }}>
        <motion.span key={s.tick} className="zl-tile__icon" animate={s.on ? { scale: [0.94, 1.06, 1] } : { scale: 1 }} transition={tx({ duration: 0.36, ease: EASE.enter })}><Icon name="lightbulb" /></motion.span>
      </BaseTile>
      <p className="zl-footnote zl-mute" style={{ gridColumn: '1 / -1' }}>Both buttons look identical on the tile. You cannot tell who did it.</p>
    </OriginFrame>
  )
}

function OriginB({ tx, knobs }) {
  const s = useOriginState(); const t = useT()
  return (
    <OriginFrame t={t} onLocal={s.local} onRemote={s.remote}>
      <BaseTile on={s.on} name={{ en: 'Ceiling Light', he: 'תאורת תקרה' }} meta={s.on ? t(COPY.on) : t(COPY.off)} style={{ transition: `background calc(220ms * var(--lab-speed,1)) ${cssEase('enter')}, border-color calc(200ms * var(--lab-speed,1))`, overflow: 'visible' }}>
        <span className="zl-tile__icon" style={{ position: 'relative' }}>
          <Icon name="lightbulb" />
          <AnimatePresence>
            {s.origin === 'remote' && <motion.span key={s.tick} initial={{ scale: 0.6, opacity: 0.8 }} animate={{ scale: 2.6, opacity: 0 }} exit={{ opacity: 0 }} transition={tx({ duration: knobs.duration, ease: EASE.out })} style={{ position: 'absolute', inset: 0, borderRadius: 12, border: '2px solid var(--info)', pointerEvents: 'none' }} />}
          </AnimatePresence>
        </span>
        <AnimatePresence>
          {s.origin === 'remote' && (
            <motion.span key={'chip' + s.tick} initial={{ opacity: 0, y: -4, scale: 0.9 }} animate={{ opacity: [0, 1, 1, 0], y: 0, scale: 1 }} transition={tx({ duration: 2.4, times: [0, 0.1, 0.8, 1] })} className="zl-chip" style={{ background: 'color-mix(in srgb, var(--info) 14%, var(--surface))', color: 'var(--info)', borderColor: 'transparent', height: 24, fontSize: 11 }}>
              <Icon name="users" size={12} /> {t({ en: 'wall switch', he: 'מתג קיר' })}
            </motion.span>
          )}
        </AnimatePresence>
      </BaseTile>
      <p className="zl-footnote zl-mute" style={{ gridColumn: '1 / -1' }}>A remote change rings outward from the icon and names its source for 2s. Your own tap does not.</p>
    </OriginFrame>
  )
}

function BulbRays({ on, tx, tick }) {
  // the bulb's rays draw outward when it comes on
  const rays = Array.from({ length: 6 })
  return (
    <svg width="36" height="36" viewBox="0 0 36 36" style={{ position: 'absolute', inset: 0, overflow: 'visible', pointerEvents: 'none' }}>
      {rays.map((_, i) => {
        const a = (-90 + i * 30 - 75) * Math.PI / 180
        return <motion.line key={i + '-' + tick} x1={18 + Math.cos(a) * 16} y1={18 + Math.sin(a) * 16} x2={18 + Math.cos(a) * 22} y2={18 + Math.sin(a) * 22} stroke="var(--accent)" strokeWidth="2" strokeLinecap="round"
          initial={{ pathLength: 0, opacity: 0 }} animate={on ? { pathLength: 1, opacity: 1 } : { pathLength: 0, opacity: 0 }} transition={tx({ duration: on ? 0.32 : 0.14, delay: on ? 0.08 + i * 0.02 : 0, ease: EASE.out })} />
      })}
    </svg>
  )
}

function OriginC({ tx }) {
  const s = useOriginState(); const t = useT()
  return (
    <OriginFrame t={t} onLocal={s.local} onRemote={s.remote}>
      <BaseTile on={s.on} name={{ en: 'Ceiling Light', he: 'תאורת תקרה' }} meta={s.on ? t(COPY.on) : t(COPY.off)} style={{ transition: `background calc(220ms * var(--lab-speed,1)) ${cssEase('enter')}, border-color calc(200ms * var(--lab-speed,1))`, overflow: 'visible' }}>
        <span className="zl-tile__icon" style={{ position: 'relative', overflow: 'visible' }}>
          <motion.span animate={{ scale: s.on ? 1.08 : 1 }} transition={tx({ type: 'spring', duration: 0.4, bounce: 0.3 })} style={{ display: 'grid' }}><Icon name="lightbulb" strokeWidth={s.on ? 2.2 : 1.9} /></motion.span>
          <BulbRays on={s.on} tx={tx} tick={s.tick} />
        </span>
      </BaseTile>
      <p className="zl-footnote zl-mute" style={{ gridColumn: '1 / -1' }}>Rays draw outward as the bulb comes on (SVG pathLength); they vanish quickly when it goes off.</p>
    </OriginFrame>
  )
}

function OriginD({ tx, knobs }) {
  const s = useOriginState(); const t = useT()
  return (
    <OriginFrame t={t} onLocal={s.local} onRemote={s.remote}>
      <BaseTile on={s.on} name={{ en: 'Ceiling Light', he: 'תאורת תקרה' }} meta={s.on ? t(COPY.on) : t(COPY.off)} style={{ overflow: 'hidden', background: 'var(--tile-base)', transition: 'border-color 200ms' }}>
        <motion.span animate={{ scale: s.on ? 6 : 0, opacity: s.on ? 1 : 0 }} transition={tx(s.on ? { type: 'spring', duration: knobs.duration, bounce: 0 } : { duration: 0.2, ease: EASE.out })}
          style={{ position: 'absolute', top: 12, insetInlineStart: 12, width: 36, height: 36, borderRadius: 999, background: 'radial-gradient(circle, var(--accent-2) 0%, var(--surface) 70%)', zIndex: 0, transformOrigin: 'center' }} />
        <span className="zl-tile__icon"><Icon name="lightbulb" /></span>
      </BaseTile>
      <p className="zl-footnote zl-mute" style={{ gridColumn: '1 / -1' }}>The on-state blooms out of the icon and fills the tile: light spreading from a source.</p>
    </OriginFrame>
  )
}

function OriginE({ tx, ms, rtl }) {
  // "Who did it": a chip for the source (a person's initials, or a switch glyph)
  // slides in from the tile's trailing edge, docks beside the icon for 2s,
  // then slides back out the way it came.
  const s = useOriginState(); const t = useT()
  const [who, setWho] = useState(null)
  useEffect(() => {
    if (s.origin !== 'remote' || !s.by) return
    setWho({ by: s.by, tick: s.tick })
    const id = setTimeout(() => setWho(null), ms(2000))
    return () => clearTimeout(id)
  }, [s.tick]) // eslint-disable-line
  const from = rtl ? -150 : 150 // trailing edge, direction-aware
  const person = who && who.by !== 'wall' ? who.by : null
  return (
    <OriginFrame t={t} onLocal={s.local} onRemote={s.remote} onPerson={(p) => s.remote(p)}>
      <BaseTile on={s.on} name={{ en: 'Ceiling Light', he: 'תאורת תקרה' }} meta={s.on ? t(COPY.on) : t(COPY.off)} style={{ transition: `background calc(220ms * var(--lab-speed,1)) ${cssEase('enter')}, border-color calc(200ms * var(--lab-speed,1))` }}>
        <span className="zl-tile__icon"><Icon name="lightbulb" /></span>
        <AnimatePresence>
          {who && (
            <motion.span key={'who' + who.tick} title={person ? t(person.name) : t({ en: 'wall switch', he: 'מתג קיר' })}
              initial={{ x: from, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: from, opacity: 0, transition: tx({ duration: 0.24, ease: EASE.inOut }) }} transition={tx({ duration: 0.38, ease: EASE.out })}
              style={{ position: 'absolute', top: 0, insetInlineStart: 42, width: 28, height: 28, borderRadius: 999, background: 'var(--info)', color: '#fff', display: 'grid', placeItems: 'center', fontSize: 12, fontWeight: 700, boxShadow: '0 0 0 2px var(--surface)', zIndex: 2 }}>
              {person ? person.initials : <Icon name="power" size={14} strokeWidth={2.4} />}
            </motion.span>
          )}
        </AnimatePresence>
      </BaseTile>
      <p className="zl-footnote zl-mute" style={{ gridColumn: '1 / -1' }}>{t({ en: 'A remote change carries its author: initials from the household (T for Tslil) on an info disc, or a switch glyph for the wall. It arrives from the trailing edge, sits beside the icon for 2s, and leaves the way it came. Your own tap shows nothing.', he: 'שינוי מרחוק נושא את מי שעשה אותו: ראשי תיבות של בן משפחה על דיסקית, או סמל מתג לקיר. ההקשה שלך לא מציגה דבר.' })}</p>
    </OriginFrame>
  )
}

function OriginF({ tx }) {
  // "Knock": the tile is nudged as if pressed from the other side.
  // Your own tap has the press (0.97 on down) instead.
  const s = useOriginState(); const t = useT(); const h = useHaptic()
  const ref = useRef(null)
  useEffect(() => {
    if (s.origin !== 'remote' || !ref.current) return
    const a = animate(ref.current,
      { scale: [1, 0.985, 1.012, 1], boxShadow: ['0 0 0 0px color-mix(in srgb, var(--info) 0%, transparent)', '0 0 0 3px color-mix(in srgb, var(--info) 28%, transparent)', '0 0 0 5px color-mix(in srgb, var(--info) 10%, transparent)', '0 0 0 0px color-mix(in srgb, var(--info) 0%, transparent)'] },
      tx({ duration: 0.32, times: [0, 0.3, 0.65, 1], ease: EASE.out }))
    return () => a.stop()
  }, [s.tick]) // eslint-disable-line
  return (
    <OriginFrame t={t} onLocal={s.local} onRemote={s.remote}>
      <motion.div ref={ref} className="zl-tile" data-on={s.on ? 'true' : 'false'} onClick={() => { s.local(); h('light') }} whileTap={{ scale: 0.97 }} transition={tx({ type: 'spring', duration: 0.18, bounce: 0 })}
        style={{ minHeight: 120, position: 'relative', cursor: 'pointer', transition: `background calc(220ms * var(--lab-speed,1)) ${cssEase('enter')}, border-color calc(200ms * var(--lab-speed,1))` }}>
        <div className="zl-tile__row"><span className="zl-tile__icon"><Icon name="lightbulb" /></span></div>
        <div><div className="zl-tile__name">{t({ en: 'Ceiling Light', he: 'תאורת תקרה' })}</div><div className="zl-tile__meta">{s.on ? t(COPY.on) : t(COPY.off)}</div></div>
      </motion.div>
      <p className="zl-footnote zl-mute" style={{ gridColumn: '1 / -1' }}>{t({ en: 'Someone else\'s change knocks the tile from behind: 0.985 → 1.012 → 1 in 320ms with a faint ring, under the same colour crossfade. Your own tap (tap the tile) presses it from the front instead. Two causes, two directions, no words.', he: 'שינוי של מישהו אחר דופק על האריח מאחור; ההקשה שלך לוחצת אותו מלפנים. שתי סיבות, שני כיוונים, בלי מילים.' })}</p>
    </OriginFrame>
  )
}

/* ───────────────────────── 2. PENDING → CONFIRMED / FAILED ───────────────────────── */

function usePendingSim(ms, delayMs = 1400) {
  const [state, setState] = useState('idle') // idle | pending | ok | fail
  const [on, setOn] = useState(false)
  const timer = useRef(null)
  const fire = (outcome) => {
    clearTimeout(timer.current)
    setState('pending')
    const next = !on
    setOn(next)
    timer.current = setTimeout(() => {
      if (outcome === 'ok') { setState('ok'); setTimeout(() => setState('idle'), ms(600)) }
      else { setOn(!next); setState('fail'); setTimeout(() => setState('idle'), ms(2200)) }
    }, ms(delayMs))
  }
  useEffect(() => () => clearTimeout(timer.current), [])
  return { state, on, fire }
}

function PendingFrame({ children, sim, t }) {
  return (
    <Page title={t({ en: 'Bedroom', he: 'חדר שינה' })}>
      <div className="zl-hstack" style={{ marginBottom: 12 }}>
        <Button style={{ height: 36 }} onClick={() => sim.fire('ok')}>{t({ en: 'Tap · hub answers', he: 'הקשה · הרכזת עונה' })}</Button>
        <Button style={{ height: 36 }} onClick={() => sim.fire('fail')}>{t({ en: 'Tap · hub fails', he: 'הקשה · הרכזת נכשלת' })}</Button>
      </div>
      <div className="zl-grid2">{children}</div>
    </Page>
  )
}

function PendingA({ ms, tx }) {
  const sim = usePendingSim(ms); const t = useT()
  return (
    <PendingFrame sim={sim} t={t}>
      <motion.div className="zl-tile" data-on={sim.on ? 'true' : 'false'} animate={{ opacity: sim.state === 'pending' ? [1, 0.62, 1] : 1 }} transition={sim.state === 'pending' ? tx({ duration: 1.1, repeat: Infinity, ease: 'easeInOut' }) : tx({ duration: 0.2 })} style={{ minHeight: 120, transition: 'background 200ms, border-color 200ms' }}>
        <div className="zl-tile__row"><span className="zl-tile__icon"><Icon name="thermometer" /></span></div>
        <div><div className="zl-tile__name">{t({ en: 'Bedroom AC', he: 'מזגן חדר שינה' })}</div><div className="zl-tile__meta">{sim.on ? t({ en: 'Cooling · 23°', he: 'מקרר · 23°' }) : t(COPY.off)}</div></div>
      </motion.div>
      <p className="zl-footnote zl-mute" style={{ gridColumn: '1 / -1' }}>Today: the tile breathes at 1.1s while the command is in flight. On failure it just re-renders back and a toast appears elsewhere.</p>
    </PendingFrame>
  )
}

function PendingB({ ms, tx }) {
  const sim = usePendingSim(ms); const t = useT(); const h = useHaptic()
  useEffect(() => { if (sim.state === 'ok') h('success'); if (sim.state === 'fail') h('error') }, [sim.state]) // eslint-disable-line
  return (
    <PendingFrame sim={sim} t={t}>
      <div className="zl-tile" data-on={sim.on ? 'true' : 'false'} style={{ minHeight: 120, transition: 'background 200ms, border-color 200ms' }}>
        <div className="zl-tile__row">
          <span className="zl-tile__icon" style={{ position: 'relative' }}>
            <Icon name="thermometer" />
            <svg width="44" height="44" viewBox="0 0 44 44" style={{ position: 'absolute', inset: -4, transform: 'rotate(-90deg)', pointerEvents: 'none' }}>
              <AnimatePresence>
                {sim.state === 'pending' && <motion.circle key="ring" cx="22" cy="22" r="20" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" initial={{ pathLength: 0, opacity: 1 }} animate={{ pathLength: 0.9 }} exit={{ opacity: 0 }} transition={tx({ duration: 1.6, ease: 'linear' })} />}
                {sim.state === 'ok' && <motion.circle key="ok" cx="22" cy="22" r="20" fill="none" stroke="var(--ok)" strokeWidth="2" initial={{ pathLength: 0.9, opacity: 1 }} animate={{ pathLength: 1, opacity: 0 }} transition={tx({ duration: 0.5 })} />}
              </AnimatePresence>
            </svg>
            <AnimatePresence>
              {sim.state === 'ok' && <motion.span key="chk" initial={{ scale: 0.5, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.8, opacity: 0 }} transition={tx({ type: 'spring', duration: 0.35, bounce: 0.35 })} style={{ position: 'absolute', top: -6, insetInlineEnd: -6, width: 18, height: 18, borderRadius: 999, background: 'var(--ok)', color: '#fff', display: 'grid', placeItems: 'center' }}><Icon name="check" size={11} strokeWidth={3} /></motion.span>}
              {sim.state === 'fail' && <motion.span key="x" initial={{ scale: 0.5, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.8, opacity: 0 }} transition={tx({ type: 'spring', duration: 0.35, bounce: 0.35 })} style={{ position: 'absolute', top: -6, insetInlineEnd: -6, width: 18, height: 18, borderRadius: 999, background: 'var(--err)', color: '#fff', display: 'grid', placeItems: 'center' }}><Icon name="x" size={11} strokeWidth={3} /></motion.span>}
            </AnimatePresence>
          </span>
        </div>
        <div><div className="zl-tile__name">{t({ en: 'Bedroom AC', he: 'מזגן חדר שינה' })}</div><div className="zl-tile__meta">{sim.state === 'fail' ? <span style={{ color: 'var(--err-text)' }}>{t({ en: "Didn't respond", he: 'לא הגיב' })}</span> : sim.on ? t({ en: 'Cooling · 23°', he: 'מקרר · 23°' }) : t(COPY.off)}</div></div>
      </div>
      <p className="zl-footnote zl-mute" style={{ gridColumn: '1 / -1' }}>A ring draws around the icon while waiting (bounded, not looping). A check or a cross pops on the answer; the state line says why.</p>
    </PendingFrame>
  )
}

function PendingC({ ms, tx }) {
  // lean & commit: the tile goes halfway to the new state, then commits or snaps back with a shake
  const sim = usePendingSim(ms); const t = useT(); const h = useHaptic()
  useEffect(() => { if (sim.state === 'fail') h('error') }, [sim.state]) // eslint-disable-line
  const tint = sim.state === 'pending' ? 'color-mix(in srgb, var(--accent-2) 50%, var(--tile-base))' : sim.on ? 'var(--surface)' : 'var(--tile-base)'
  return (
    <PendingFrame sim={sim} t={t}>
      <motion.div className="zl-tile" data-on={sim.on ? 'true' : 'false'} animate={sim.state === 'fail' ? { x: [0, -6, 6, -4, 4, 0] } : { x: 0 }} transition={tx({ duration: 0.4, ease: 'easeInOut' })} style={{ minHeight: 120, background: tint, transition: `background calc(240ms * var(--lab-speed,1)) ${cssEase('out')}, border-color 200ms`, borderColor: sim.state === 'fail' ? 'var(--err)' : undefined }}>
        <div className="zl-tile__row"><span className="zl-tile__icon" style={{ background: sim.state === 'pending' ? 'color-mix(in srgb, var(--accent-2) 60%, var(--surface-2))' : undefined, transition: 'background 240ms' }}><Icon name="thermometer" /></span>
          {sim.state === 'pending' && <span className="zl-caption zl-mute" style={{ fontFamily: 'var(--ml-mono)' }}>…</span>}
        </div>
        <div><div className="zl-tile__name">{t({ en: 'Bedroom AC', he: 'מזגן חדר שינה' })}</div>
          <AnimatePresence mode="wait" initial={false}>
            <motion.div key={sim.state === 'fail' ? 'f' : sim.on ? 'on' : 'off'} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={tx({ duration: 0.16 })} className="zl-tile__meta" style={{ color: sim.state === 'fail' ? 'var(--err-text)' : undefined }}>
              {sim.state === 'fail' ? t({ en: "Couldn't reach it · Retry", he: 'לא הגעתי אליו · נסה שוב' }) : sim.on ? t({ en: 'Cooling · 23°', he: 'מקרר · 23°' }) : t(COPY.off)}
            </motion.div>
          </AnimatePresence>
        </div>
      </motion.div>
      <p className="zl-footnote zl-mute" style={{ gridColumn: '1 / -1' }}>The tile leans toward the new state (half tint) until the hub answers, then commits. On failure it shakes back and the state line carries the reason and a retry.</p>
    </PendingFrame>
  )
}

function PendingD({ ms, tx }) {
  const sim = usePendingSim(ms); const t = useT()
  return (
    <PendingFrame sim={sim} t={t}>
      <div className="zl-tile" data-on={sim.on ? 'true' : 'false'} style={{ minHeight: 120, position: 'relative', overflow: 'hidden', transition: 'background 200ms, border-color 200ms' }}>
        {sim.state === 'pending' && <motion.span initial={{ x: '-120%' }} animate={{ x: '220%' }} transition={tx({ duration: 1.1, repeat: Infinity, ease: 'linear' })} style={{ position: 'absolute', top: 0, bottom: 0, width: '45%', background: 'linear-gradient(90deg, transparent, rgba(255,255,255,.35), transparent)', pointerEvents: 'none' }} />}
        <div className="zl-tile__row"><span className="zl-tile__icon"><Icon name="thermometer" /></span></div>
        <div><div className="zl-tile__name">{t({ en: 'Bedroom AC', he: 'מזגן חדר שינה' })}</div><div className="zl-tile__meta">{sim.on ? t({ en: 'Cooling · 23°', he: 'מקרר · 23°' }) : t(COPY.off)}</div></div>
      </div>
      <p className="zl-footnote zl-mute" style={{ gridColumn: '1 / -1' }}>A shimmer sweeps the tile while in flight. Familiar from loading; reads as "not yet real".</p>
    </PendingFrame>
  )
}

function PendingE({ ms, tx, rtl }) {
  // "Fill toward the answer": the on-tint fills from the leading edge over the
  // expected latency (1.4s, linear, bounded). Ack = green edge flash and it
  // settles; fail = it drains back with a red edge and the state line says so.
  const sim = usePendingSim(ms); const t = useT(); const h = useHaptic()
  useEffect(() => { if (sim.state === 'ok') h('success'); if (sim.state === 'fail') h('error') }, [sim.state]) // eslint-disable-line
  const fillTx = sim.state === 'pending' ? tx({ duration: 1.4, ease: 'linear' }) : sim.state === 'fail' ? tx({ duration: 0.32, ease: EASE.out }) : tx({ duration: 0.16, ease: EASE.out })
  return (
    <PendingFrame sim={sim} t={t}>
      <div className="zl-tile" data-on={sim.on ? 'true' : 'false'} style={{ minHeight: 120, position: 'relative', overflow: 'hidden', background: 'var(--tile-base)', transition: `border-color calc(200ms * var(--lab-speed,1))` }}>
        <motion.span initial={false} animate={{ width: sim.on ? '100%' : '0%' }} transition={fillTx}
          style={{ position: 'absolute', top: 0, bottom: 0, insetInlineStart: 0, background: 'color-mix(in srgb, var(--accent-2) 70%, var(--surface))', pointerEvents: 'none' }} />
        <AnimatePresence>
          {sim.state === 'ok' && <motion.span key="okring" initial={{ boxShadow: 'inset 0 0 0 2px var(--ok)', opacity: 1 }} animate={{ opacity: 0 }} exit={{ opacity: 0 }} transition={tx({ duration: 0.55, ease: EASE.out })} style={{ position: 'absolute', inset: 0, borderRadius: 'inherit', boxShadow: 'inset 0 0 0 2px var(--ok)', pointerEvents: 'none' }} />}
          {sim.state === 'fail' && <motion.span key="failring" initial={{ opacity: 1 }} animate={{ opacity: [1, 1, 0] }} exit={{ opacity: 0 }} transition={tx({ duration: 1.6, times: [0, 0.6, 1], ease: EASE.out })} style={{ position: 'absolute', inset: 0, borderRadius: 'inherit', boxShadow: 'inset 0 0 0 2px var(--err)', pointerEvents: 'none' }} />}
        </AnimatePresence>
        <div className="zl-tile__row" style={{ position: 'relative' }}><span className="zl-tile__icon"><Icon name="thermometer" /></span></div>
        <div style={{ position: 'relative' }}><div className="zl-tile__name">{t({ en: 'Bedroom AC', he: 'מזגן חדר שינה' })}</div>
          <AnimatePresence mode="wait" initial={false}>
            <motion.div key={sim.state === 'fail' ? 'f' : sim.state === 'pending' ? 'p' : sim.on ? 'on' : 'off'} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={tx({ duration: 0.14 })} className="zl-tile__meta" style={{ color: sim.state === 'fail' ? 'var(--err-text)' : undefined }}>
              {sim.state === 'fail' ? t({ en: "Didn't respond · Retry", he: 'לא הגיב · נסה שוב' }) : sim.state === 'pending' ? t({ en: 'Asking the hub…', he: 'שואל את הרכזת…' }) : sim.on ? t({ en: 'Cooling · 23°', he: 'מקרר · 23°' }) : t(COPY.off)}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
      <p className="zl-footnote zl-mute" style={{ gridColumn: '1 / -1' }}>{t({ en: 'The tint fills from the leading edge at the speed we expect the hub to answer (1.4s, linear, then it stops). The answer completes it with a green edge, or drains it back with a red one. Waiting has a visible budget; the tile never lies about being done.', he: 'הגוון מתמלא מהקצה המוביל בקצב שבו הרכזת אמורה לענות. התשובה משלימה אותו בירוק, או מרוקנת אותו באדום.' })}</p>
    </PendingFrame>
  )
}

function PendingF({ ms, tx }) {
  // "Icon breathes, dots in the line": one slow breath on the icon; the state
  // text becomes three dots that resolve into the answer.
  const sim = usePendingSim(ms); const t = useT(); const h = useHaptic()
  useEffect(() => { if (sim.state === 'ok') h('success'); if (sim.state === 'fail') h('error') }, [sim.state]) // eslint-disable-line
  const pending = sim.state === 'pending'
  return (
    <PendingFrame sim={sim} t={t}>
      <div className="zl-tile" data-on={sim.on ? 'true' : 'false'} style={{ minHeight: 120, transition: `background calc(200ms * var(--lab-speed,1)), border-color calc(200ms * var(--lab-speed,1))` }}>
        <div className="zl-tile__row">
          <motion.span className="zl-tile__icon" animate={pending ? { scale: [1, 1.05, 1] } : { scale: 1 }} transition={pending ? tx({ duration: 1.2, ease: 'easeInOut' }) : tx({ duration: 0.16 })}><Icon name="thermometer" /></motion.span>
        </div>
        <div><div className="zl-tile__name">{t({ en: 'Bedroom AC', he: 'מזגן חדר שינה' })}</div>
          <div className="zl-tile__meta" style={{ position: 'relative', height: 18 }}>
            <AnimatePresence mode="wait" initial={false}>
              {pending ? (
                <motion.span key="dots" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, filter: 'blur(2px)' }} transition={tx({ duration: 0.12 })} style={{ display: 'inline-flex', gap: 3, alignItems: 'center', height: 18 }}>
                  {[0, 1, 2].map(i => <motion.span key={i} animate={{ opacity: [0.25, 1, 0.25] }} transition={tx({ duration: 0.9, repeat: Infinity, delay: i * 0.15, ease: 'easeInOut' })} style={{ width: 4, height: 4, borderRadius: 999, background: 'var(--ink-mute)' }} />)}
                </motion.span>
              ) : (
                <motion.span key={sim.state === 'fail' ? 'f' : sim.on ? 'on' : 'off'} initial={{ opacity: 0, filter: 'blur(2px)' }} animate={{ opacity: 1, filter: 'blur(0px)' }} exit={{ opacity: 0 }} transition={tx({ duration: 0.2, ease: EASE.out })} style={{ display: 'inline-block', color: sim.state === 'fail' ? 'var(--err-text)' : undefined }}>
                  {sim.state === 'fail' ? t({ en: "Didn't respond", he: 'לא הגיב' }) : sim.on ? t({ en: 'Cooling · 23°', he: 'מקרר · 23°' }) : t(COPY.off)}
                </motion.span>
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>
      <p className="zl-footnote zl-mute" style={{ gridColumn: '1 / -1' }}>{t({ en: 'One slow breath on the icon (1→1.05→1, 1.2s, one cycle) and the state line becomes three dots that resolve into the answer. The tile stays put; only the fact that is unknown moves. Quieter than A\'s whole-tile breathing.', he: 'נשימה אחת איטית על האייקון ושורת המצב הופכת לשלוש נקודות שמתבהרות לתשובה. שקט יותר מהנשימה של כל האריח.' })}</p>
    </PendingFrame>
  )
}

/* ───────────────────────── 3. CARD EXPAND ("Show controls") ───────────────────────── */

function ControlsBody({ t }) {
  return (
    <div style={{ paddingTop: 12 }}>
      <div className="zl-footnote zl-mute" style={{ marginBottom: 6 }}>{t({ en: 'Brightness', he: 'בהירות' })}</div>
      <div style={{ height: 36, borderRadius: 12, background: 'var(--surface-3)', overflow: 'hidden', marginBottom: 10 }}><div style={{ width: '62%', height: '100%', background: 'var(--accent)' }} /></div>
      <div className="zl-hstack">{['2700K', '3500K', '5000K'].map((k, i) => <span key={k} className="zl-chip" data-on={i === 0 ? 'true' : 'false'}>{k}</span>)}</div>
    </div>
  )
}

function ExpandGrid({ variant, knobs, tx }) {
  const [open, setOpen] = useState(null); const t = useT(); const h = useHaptic()
  const [sheet, setSheet] = useState(null)
  const spring = tx({ type: 'spring', duration: knobs.duration, bounce: 0 })
  const devs = DEVICES.filter(d => d.kind === 'light').slice(0, 4)
  return (
    <div className="zl" style={{ position: 'absolute', inset: 0 }}>
      <Page title={t({ en: 'Devices', he: 'מכשירים' })}>
        <LayoutGroup id={`exp-${variant}`}>
          <div className="zl-grid2" style={{ alignItems: 'start' }}>
            {devs.map(d => {
              const isOpen = open === d.id
              if (variant === 'D') {
                // "Lid lifts": the tile's top half is a lid hinged at its top edge; the
                // controls were "under" it all along and fade up as it lifts.
                return (
                  <motion.div key={d.id} layout transition={spring} className="zl-tile" data-on={d.on ? 'true' : 'false'} style={{ minHeight: 120, gridColumn: isOpen ? '1 / -1' : undefined, cursor: 'default', overflow: 'visible', padding: 0, perspective: 800, background: 'transparent', border: 0 }}>
                    <motion.div layout="position" animate={{ rotateX: isOpen ? -14 : 0, boxShadow: isOpen ? '0 14px 22px -10px color-mix(in srgb, var(--ink) 30%, transparent)' : '0 0 0 0 transparent' }} transition={isOpen ? spring : tx({ duration: 0.22, ease: EASE.out })}
                      className="zl-tile" data-on={d.on ? 'true' : 'false'} style={{ transformOrigin: 'top center', transformStyle: 'preserve-3d', minHeight: 96, position: 'relative', zIndex: 2, cursor: 'default' }}>
                      <div className="zl-tile__row"><span className="zl-tile__icon"><Icon name="lightbulb" /></span>
                        <button className="zl-btn zl-btn--pill" style={{ height: 30, fontSize: 12 }} onClick={() => { h('selection'); setOpen(o => o === d.id ? null : d.id) }}>{isOpen ? t({ en: 'Hide', he: 'הסתר' }) : t({ en: 'Controls', he: 'בקרות' })}</button>
                      </div>
                      <div><div className="zl-tile__name">{t(d.name)}</div><div className="zl-tile__meta">{d.on ? `${d.brightness}%` : t(COPY.off)}</div></div>
                    </motion.div>
                    <AnimatePresence initial={false}>
                      {isOpen && (
                        <motion.div key="under" initial={{ height: 0 }} animate={{ height: 'auto' }} exit={{ height: 0, transition: tx({ duration: 0.2, ease: EASE.out }) }} transition={spring} style={{ overflow: 'hidden', margin: '-12px 0 0', padding: '12px 0 0', background: 'var(--surface-2)', borderRadius: '0 0 16px 16px', border: '0.5px solid var(--line)', borderTop: 0 }}>
                          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 4, transition: tx({ duration: 0.12 }) }} transition={tx({ duration: 0.26, delay: 0.1, ease: EASE.out })} style={{ padding: '0 12px 12px' }}><ControlsBody t={t} /></motion.div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </motion.div>
                )
              }
              return (
                <motion.div key={d.id} layout={variant !== 'A'} layoutId={variant === 'C' ? `card-${d.id}` : undefined} transition={spring} className="zl-tile" data-on={d.on ? 'true' : 'false'} style={{ minHeight: 120, gridColumn: isOpen && variant !== 'C' ? '1 / -1' : undefined, cursor: 'default', overflow: 'hidden' }}>
                  <motion.div layout="position" className="zl-tile__row"><span className="zl-tile__icon"><Icon name="lightbulb" /></span>
                    <button className="zl-btn zl-btn--pill" style={{ height: 30, fontSize: 12 }} onClick={() => { h('selection'); if (variant === 'C') setSheet(d); else setOpen(o => o === d.id ? null : d.id) }}>{isOpen ? t({ en: 'Hide', he: 'הסתר' }) : t({ en: 'Controls', he: 'בקרות' })}</button>
                  </motion.div>
                  <motion.div layout="position"><div className="zl-tile__name">{t(d.name)}</div><div className="zl-tile__meta">{d.on ? `${d.brightness}%` : t(COPY.off)}</div></motion.div>
                  <AnimatePresence initial={false}>
                    {isOpen && variant !== 'C' && <motion.div key="c" initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={variant === 'A' ? tx({ duration: 0.22, ease: EASE.drawer }) : spring} style={{ overflow: 'hidden' }}><ControlsBody t={t} /></motion.div>}
                  </AnimatePresence>
                </motion.div>
              )
            })}
          </div>
          <AnimatePresence>
            {sheet && variant === 'C' && (
              <>
                <motion.div key="bd" className="zl-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={tx({ duration: 0.2 })} onClick={() => setSheet(null)} style={{ zIndex: 4 }} />
                <motion.div key="sh" layoutId={`card-${sheet.id}`} transition={spring} className="zl-sheet" style={{ zIndex: 5, padding: '8px 16px 20px', background: 'var(--surface)' }}>
                  <div className="zl-sheet__grabber" />
                  <motion.div layout="position" className="zl-headline" style={{ marginBottom: 6 }}>{t(sheet.name)}</motion.div>
                  <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={tx({ duration: 0.2, delay: 0.12 })}><ControlsBody t={t} /><Button variant="primary" style={{ width: '100%', marginTop: 14 }} onClick={() => setSheet(null)}>{t({ en: 'Done', he: 'סיום' })}</Button></motion.div>
                </motion.div>
              </>
            )}
          </AnimatePresence>
        </LayoutGroup>
      </Page>
    </div>
  )
}

/* ───────────────────────── 4. ICON MORPHS ───────────────────────── */

const PLAY = 'M8 5 L19 12 L8 19 Z'
const PAUSE = 'M6 5 H10 V19 H6 Z M14 5 H18 V19 H14 Z'

function PlayPauseMorph({ tx, speed }) {
  const [playing, setPlaying] = useState(false)
  const ref = useRef(null); const h = useHaptic()
  useGSAP(() => {
    if (!ref.current) return
    gsap.to(ref.current, { duration: 0.32, morphSVG: { shape: playing ? PAUSE : PLAY, shapeIndex: 'auto' }, ease: 'power2.inOut' })
  }, { dependencies: [playing] })
  return (
    <button onClick={() => { setPlaying(p => !p); h('light') }} style={{ width: 72, height: 72, borderRadius: 999, border: '1px solid var(--line)', background: 'var(--surface)', color: 'var(--ink)', cursor: 'pointer', display: 'grid', placeItems: 'center' }}>
      <svg width="32" height="32" viewBox="0 0 24 24"><path ref={ref} d={PLAY} fill="currentColor" /></svg>
    </button>
  )
}

function LockMorph({ tx }) {
  const [locked, setLocked] = useState(true); const h = useHaptic()
  return (
    <button onClick={() => { setLocked(l => !l); h(locked ? 'medium' : 'success') }} style={{ width: 72, height: 72, borderRadius: 999, border: '1px solid var(--line)', background: locked ? 'var(--surface)' : 'var(--accent-2)', color: locked ? 'var(--ink)' : 'var(--accent-text)', cursor: 'pointer', display: 'grid', placeItems: 'center', transition: 'background 240ms, color 240ms' }}>
      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ overflow: 'visible' }}>
        <motion.rect x="4" y="11" width="16" height="10" rx="2" animate={{ y: locked ? 11 : 11.5 }} transition={tx({ type: 'spring', duration: 0.4, bounce: 0.3 })} />
        <motion.path d="M8 11 V7 a4 4 0 0 1 8 0 v4" animate={{ rotate: locked ? 0 : -28, y: locked ? 0 : -1.5, x: locked ? 0 : -1 }} style={{ transformOrigin: '16px 11px' }} transition={tx({ type: 'spring', duration: 0.5, bounce: 0.35 })} />
      </svg>
    </button>
  )
}

function BlindsMorph({ tx }) {
  const [pos, setPos] = useState(60); const h = useHaptic()
  const slats = [0, 1, 2, 3, 4]
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
      <button onClick={() => { setPos(p => p >= 100 ? 0 : p + 25); h('selection') }} style={{ width: 72, height: 72, borderRadius: 999, border: '1px solid var(--line)', background: 'var(--surface)', color: 'var(--ink)', cursor: 'pointer', display: 'grid', placeItems: 'center' }}>
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <rect x="4" y="3" width="16" height="18" rx="2" />
          {slats.map(i => { const y = 5 + i * (3.2 * (1 - pos / 100)) + 0.5; return <motion.line key={i} x1="6" x2="18" y1={y} y2={y} initial={false} animate={{ y1: y, y2: y, opacity: 1 - i * 0.1 }} transition={tx({ type: 'spring', duration: 0.5, bounce: 0.1 })} /> })}
          <motion.line x1="12" x2="12" y1="21" y2={21 - (pos / 100) * 14} initial={false} animate={{ y2: 21 - (pos / 100) * 14 }} transition={tx({ type: 'spring', duration: 0.5, bounce: 0.1 })} strokeWidth="1" opacity="0.5" />
        </svg>
      </button>
      <span className="zl-footnote zl-mono zl-mute">{pos}%</span>
    </div>
  )
}

function FanMorph({ tx, speed }) {
  const [level, setLevel] = useState(0); const h = useHaptic()
  const rot = useMotionValue(0)
  useEffect(() => {
    const dur = level === 0 ? 0 : [0, 2.4, 1.2, 0.5][level]
    if (!dur) { const a = animate(rot, rot.get() + 30, { duration: 0.6 / speed, ease: EASE.out }); return () => a.stop() }
    const a = animate(rot, rot.get() + 360, { duration: dur / speed, ease: 'linear', repeat: Infinity })
    return () => a.stop()
  }, [level, speed, rot])
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
      <button onClick={() => { setLevel(l => (l + 1) % 4); h('selection') }} style={{ width: 72, height: 72, borderRadius: 999, border: '1px solid var(--line)', background: level ? 'var(--accent-2)' : 'var(--surface)', color: level ? 'var(--accent-text)' : 'var(--ink)', cursor: 'pointer', display: 'grid', placeItems: 'center', transition: 'background 240ms, color 240ms' }}>
        <motion.span style={{ rotate: rot, display: 'grid' }}><Icon name="fan" size={32} strokeWidth={1.8} /></motion.span>
      </button>
      <span className="zl-footnote zl-mono zl-mute">{['off', 'low', 'mid', 'high'][level]}</span>
    </div>
  )
}

/* ── B: sensors & rooms ── */

const MORPH_BTN = (active) => ({ width: 72, height: 72, borderRadius: 999, border: '1px solid var(--line)', background: active ? 'var(--accent-2)' : 'var(--surface)', color: active ? 'var(--accent-text)' : 'var(--ink)', cursor: 'pointer', display: 'grid', placeItems: 'center', transition: `background calc(240ms * var(--lab-speed,1)), color calc(240ms * var(--lab-speed,1))` })

function DoorMorph({ tx, rtl }) {
  // the door panel is HTML (SVG children cannot rotate in 3D reliably); the hinge is the leading edge
  const [open, setOpen] = useState(false); const h = useHaptic()
  return (
    <button onClick={() => { setOpen(o => !o); h(open ? 'light' : 'medium') }} style={MORPH_BTN(open)}>
      <span style={{ position: 'relative', width: 22, height: 30, perspective: 120, display: 'block' }}>
        <span style={{ position: 'absolute', inset: 0, border: '2px solid currentColor', borderBottom: 0, borderRadius: '3px 3px 0 0', opacity: 0.55 }} />
        <motion.span animate={{ rotateY: open ? (rtl ? 60 : -60) : 0 }} transition={open ? tx({ type: 'spring', duration: 0.55, bounce: 0.18 }) : tx({ duration: 0.26, ease: EASE.out })}
          style={{ position: 'absolute', inset: 2, background: 'currentColor', borderRadius: 2, transformOrigin: rtl ? 'right center' : 'left center', transformStyle: 'preserve-3d' }}>
          <span style={{ position: 'absolute', top: '50%', insetInlineEnd: 3, width: 3, height: 3, borderRadius: 999, background: 'var(--surface)', transform: 'translateY(-50%)' }} />
        </motion.span>
      </span>
    </button>
  )
}

function CameraMorph({ tx }) {
  // a red "live" dot blinks twice then holds; the lens ring breathes only while live
  const [live, setLive] = useState(false); const h = useHaptic()
  return (
    <button onClick={() => { setLive(l => !l); h('selection') }} style={{ ...MORPH_BTN(false), position: 'relative' }}>
      <span style={{ position: 'relative', display: 'grid', placeItems: 'center' }}>
        <Icon name="camera" size={30} strokeWidth={1.8} />
        <AnimatePresence>
          {live && <motion.span key="ring" initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: [1, 1.12, 1], opacity: 1 }} exit={{ scale: 0.6, opacity: 0, transition: tx({ duration: 0.16 }) }} transition={tx({ scale: { duration: 2.2, repeat: Infinity, ease: 'easeInOut' }, opacity: { duration: 0.2 } })} style={{ position: 'absolute', top: '50%', left: '50%', width: 14, height: 14, marginTop: -5, marginLeft: -7, borderRadius: 999, border: '1.5px solid var(--err)', pointerEvents: 'none' }} />}
        </AnimatePresence>
      </span>
      <AnimatePresence>
        {live && <motion.span key="dot" initial={{ opacity: 0 }} animate={{ opacity: [0, 1, 0, 1, 0, 1] }} exit={{ opacity: 0, transition: tx({ duration: 0.12 }) }} transition={tx({ duration: 0.9, times: [0, 0.18, 0.36, 0.54, 0.72, 1], ease: 'linear' })} style={{ position: 'absolute', top: 14, insetInlineEnd: 14, width: 8, height: 8, borderRadius: 999, background: 'var(--err)', boxShadow: '0 0 0 2px var(--surface)' }} />}
      </AnimatePresence>
    </button>
  )
}

function SnowflakeMorph({ tx }) {
  // six hand-drawn arms draw outward (pathLength) as cooling starts, while the
  // whole flake spins in half a turn on a spring; off retracts the arms fast
  const [on, setOn] = useState(false); const [turns, setTurns] = useState(0); const h = useHaptic()
  const arms = Array.from({ length: 6 }, (_, i) => (i * 60 - 90) * Math.PI / 180)
  return (
    <button onClick={() => { setOn(o => { if (!o) setTurns(k => k + 1); return !o }); h(on ? 'light' : 'medium') }} style={MORPH_BTN(on)}>
      <motion.svg width="32" height="32" viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" animate={{ rotate: turns * 180 }} transition={tx({ type: 'spring', duration: 0.7, bounce: 0.2 })} style={{ overflow: 'visible' }}>
        {arms.map((a, i) => {
          const x2 = 16 + Math.cos(a) * 13, y2 = 16 + Math.sin(a) * 13
          const bx = 16 + Math.cos(a) * 8, by = 16 + Math.sin(a) * 8
          const l = a + Math.PI / 6, r = a - Math.PI / 6
          return (
            <g key={i}>
              <motion.line x1="16" y1="16" x2={x2} y2={y2} initial={false} animate={{ pathLength: on ? 1 : 0, opacity: on ? 1 : 0.35 }} transition={on ? tx({ duration: 0.36, delay: i * 0.04, ease: EASE.out }) : tx({ duration: 0.14, ease: EASE.out })} />
              <motion.path d={`M ${bx + Math.cos(l) * 4} ${by + Math.sin(l) * 4} L ${bx} ${by} L ${bx + Math.cos(r) * 4} ${by + Math.sin(r) * 4}`} initial={false} animate={{ pathLength: on ? 1 : 0, opacity: on ? 1 : 0 }} transition={on ? tx({ duration: 0.24, delay: 0.2 + i * 0.04, ease: EASE.out }) : tx({ duration: 0.1 })} />
            </g>
          )
        })}
        <circle cx="16" cy="16" r="1.6" fill="currentColor" stroke="none" />
      </motion.svg>
    </button>
  )
}

const BULB_OUTLINE = 'M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1.3.5 2.6 1.5 3.5.7.7 1.3 1.5 1.5 2.5'
const FILAMENT = 'M9.6 13.2 L10.4 9.6 L12 12.4 L13.6 9.6 L14.4 13.2'

function FilamentMorph({ tx }) {
  // the bulb outline is lucide's; inside it a filament draws and glows gold when on
  const [on, setOn] = useState(false); const h = useHaptic()
  return (
    <button onClick={() => { setOn(o => !o); h('light') }} style={MORPH_BTN(on)}>
      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ overflow: 'visible' }}>
        <path d={BULB_OUTLINE} /><path d="M9 18h6" /><path d="M10 22h4" />
        <motion.path d={FILAMENT} stroke="#f5b800" strokeWidth="1.6" initial={false} animate={{ pathLength: on ? 1 : 0, opacity: on ? 1 : 0, filter: on ? 'drop-shadow(0 0 6px #f5b800)' : 'drop-shadow(0 0 0px #f5b800)' }} transition={on ? tx({ pathLength: { duration: 0.42, ease: EASE.out }, opacity: { duration: 0.1 }, filter: { duration: 0.5, delay: 0.25 } }) : tx({ duration: 0.16, ease: EASE.out })} />
      </svg>
    </button>
  )
}

function IconMorphsB({ tx, rtl }) {
  const t = useT()
  const cell = (el, label) => <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, width: 120 }}>{el}<span className="zl-footnote zl-mute" style={{ textAlign: 'center' }}>{label}</span></div>
  return (
    <div className="zl" style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 28, padding: 16 }}>
      <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', justifyContent: 'center' }}>
        {cell(<DoorMorph tx={tx} rtl={rtl} />, t({ en: 'Door sensor · swings on its hinge', he: 'חיישן דלת · נפתחת על הציר' }))}
        {cell(<CameraMorph tx={tx} />, t({ en: 'Camera · live dot blinks twice, ring breathes', he: 'מצלמה · נקודת שידור מהבהבת פעמיים' }))}
        {cell(<SnowflakeMorph tx={tx} />, t({ en: 'AC · arms draw as cooling starts', he: 'מזגן · הזרועות נמשכות כשהקירור מתחיל' }))}
        {cell(<FilamentMorph tx={tx} />, t({ en: 'Bulb · filament draws and glows', he: 'נורה · חוט הלהט נמשך וזוהר' }))}
      </div>
      <p className="zl-footnote zl-mute" style={{ textAlign: 'center', maxWidth: 320 }}>{t({ en: 'Tap each. The door opens from its hinge (the leading edge, so it mirrors in Hebrew). The camera\'s red dot is the one blink that means "recording"; its ring breathes only while live. The snowflake spins in while its arms draw; off retracts them in 140ms. The filament is the on-state.', he: 'הקש על כל אחד. הדלת נפתחת מהציר שלה; הנקודה האדומה של המצלמה מהבהבת פעמיים; הפתית מסתובב פנימה בזמן שהזרועות נמשכות; חוט הלהט הוא המצב הדולק.' })}</p>
    </div>
  )
}

function IconMorphs({ tx, speed }) {
  const t = useT()
  return (
    <div className="zl" style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 28, padding: 16 }}>
      <div style={{ display: 'flex', gap: 28, flexWrap: 'wrap', justifyContent: 'center' }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}><PlayPauseMorph tx={tx} speed={speed} /><span className="zl-footnote zl-mute">{t({ en: 'Play ↔ Pause · MorphSVG', he: 'נגן ↔ השהה' })}</span></div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}><LockMorph tx={tx} /><span className="zl-footnote zl-mute">{t({ en: 'Lock · shackle swings', he: 'מנעול' })}</span></div>
        <BlindsMorph tx={tx} />
        <FanMorph tx={tx} speed={speed} />
      </div>
      <p className="zl-footnote zl-mute" style={{ textAlign: 'center', maxWidth: 320 }}>{t({ en: 'Tap each. Today every one of these is a hard glyph swap. The glyph itself carrying the state is cheaper than a colour change and reads at a glance.', he: 'הקש על כל אחד. היום כל אחד מהם הוא החלפה חדה של סמל.' })}</p>
    </div>
  )
}

/* ───────────────────────── 5. DEVICE SHEET DETENTS ───────────────────────── */

function SheetDetents({ knobs, tx, variant = 'A' }) {
  const t = useT(); const h = useHaptic()
  const [open, setOpen] = useState(true)
  const H = 640
  const stops = [H * (1 - knobs.peek), 0] // y offsets: peek, top
  const y = useMotionValue(stops[0])
  const scrim = useTransform(y, [0, stops[0], H], [0.55, 0.4, 0])
  const radius = useTransform(y, [0, 40], [0, 24])
  // B: the page beneath recedes as the sheet rises, driven by the sheet's live y
  const pageScale = useTransform(y, [0, stops[0], H], [0.94, 0.965, 1])
  const pageRadius = useTransform(y, [0, H], [18, 0])
  const pageDim = useTransform(y, [0, stops[0], H], [0.42, 0.22, 0])
  const lastStop = useRef(0)
  const settle = (target) => animate(y, target, tx({ type: 'spring', stiffness: 400, damping: 30, mass: 0.8 }))
  const peek = variant === 'B'
  return (
    <div className="zl" style={{ position: 'absolute', inset: 0, overflow: 'hidden', background: peek ? 'var(--ink)' : undefined }}>
      <motion.div style={{ position: 'absolute', inset: 0, scale: peek ? pageScale : 1, borderRadius: peek ? pageRadius : 0, overflow: 'hidden', transformOrigin: '50% 0%' }}>
        <Page title={t({ en: 'Devices', he: 'מכשירים' })}>
          <div className="zl-grid2">{DEVICES.slice(0, 6).map(d => <button key={d.id} className="zl-tile" data-on={d.on ? 'true' : 'false'} onClick={() => { setOpen(true); settle(stops[0]) }}><div className="zl-tile__row"><span className="zl-tile__icon"><Icon name={KIND_ICON[d.kind]} /></span></div><div><div className="zl-tile__name">{t(d.name)}</div><div className="zl-tile__meta">{d.on ? t(COPY.on) : t(COPY.off)}</div></div></button>)}</div>
        </Page>
        {peek && open && <motion.div style={{ position: 'absolute', inset: 0, background: 'var(--ink)', opacity: pageDim, pointerEvents: 'none' }} />}
      </motion.div>
      {open && <motion.div className="zl-backdrop" style={{ opacity: peek ? 0 : scrim }} onClick={() => animate(y, H, tx({ duration: 0.24, ease: EASE.enter })).then(() => setOpen(false))} />}
      {open && (
        <motion.div className="zl-sheet" style={{ y, height: H, borderTopLeftRadius: radius, borderTopRightRadius: radius, touchAction: 'none' }}
          drag="y" dragConstraints={{ top: 0, bottom: H }} dragElastic={{ top: knobs.elastic, bottom: 1 }} dragMomentum={false}
          onDrag={(_, info) => { const nearest = stops.reduce((a, b) => Math.abs(b - y.get()) < Math.abs(a - y.get()) ? b : a); if (nearest !== lastStop.current) { lastStop.current = nearest; h('medium') } }}
          onDragEnd={(_, info) => {
            const v = info.velocity.y; const cur = y.get()
            const projected = cur + v * 0.12
            if (v > 900 || projected > H * 0.85) { animate(y, H, tx({ duration: 0.24, ease: EASE.enter })).then(() => setOpen(false)); h('light'); return }
            if (v < -900) { settle(0); return }
            const target = [...stops, H].reduce((a, b) => Math.abs(b - projected) < Math.abs(a - projected) ? b : a)
            if (target === H) { animate(y, H, tx({ duration: 0.24, ease: EASE.enter })).then(() => setOpen(false)); h('light') } else settle(target)
          }}>
          <div className="zl-sheet__grabber" onClick={() => settle(y.get() > 10 ? 0 : stops[0])} />
          <div style={{ padding: '4px 16px 16px' }}>
            <div className="zl-headline" style={{ marginBottom: 12 }}>{t({ en: 'Ceiling Light', he: 'תאורת תקרה' })}</div>
            <Card style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14, padding: 24 }}>
              <div style={{ width: 96, height: 96, borderRadius: 999, background: 'var(--accent)', color: 'var(--on-accent)', display: 'grid', placeItems: 'center' }}><Icon name="power" size={36} /></div>
              <div style={{ width: '100%', height: 44, borderRadius: 14, background: 'var(--surface-3)', overflow: 'hidden' }}><div style={{ width: '72%', height: '100%', background: 'var(--accent)' }} /></div>
            </Card>
            <div className="zl-stack" style={{ marginTop: 12 }}>
              {[['Room', 'Living Room'], ['Signal', 'Strong'], ['Firmware', '1.0.6']].map(([k, v]) => <Card key={k} style={{ display: 'flex', justifyContent: 'space-between' }}><span className="zl-mute">{k}</span><span style={{ fontWeight: 500 }}>{v}</span></Card>)}
            </div>
          </div>
        </motion.div>
      )}

    </div>
  )
}

/* ───────────────────────── SECTION ───────────────────────── */

export default function Devices() {
  return (
    <>
      <SectionIntro
        title="Devices"
        lede="A device tile is a live thing: it changes because you touched it, because someone else did, or because the hub finally answered. Three different causes; today they all look the same."
        found={[
          'Local and remote state changes render identically: a 160/220ms colour crossfade and a one-shot 6% icon "ignition". No origin cue anywhere except an IR-only pulsing dot and toast.',
          'In-flight commands breathe the tile at 1.1s (data-pending) on some surfaces and not others; failure is a toast plus a silent re-render back.',
          'Five different optimistic-update strategies coexist (DeviceCard, Devices.jsx, LightControls commit-lock, SwitchRemote predictedOn, ACRemote); only the wall has a real snapshot + rollback.',
          'No icon morphs. Play/Pause, Lock/LockOpen, Volume/Mute hard-swap; the light bulb glyph is the same asset on and off.',
          'The device sheet: 72%/100% detents, velocity-projected snapping, backdrop follows the drag, handoff to the full page after a 120ms hold. This is the most complete gesture in the app and is kept here as the baseline.',
        ]}
      />

      <Demo id="origin" title="State change: who did it?" purpose="Your own tap needs no announcement. A change from elsewhere does." principles={['causality', 'restraint']} inZiggy={['Devices.jsx / DeviceCard.jsx tiles', 'App.jsx state_changed handler', 'motion.css [data-on] + zm-ignite']}
        knobs={[{ key: 'duration', label: 'Ring / bloom duration', min: 0.2, max: 1, step: 0.02, value: 0.6, unit: 'ms' }]}
        recommend="E"
        variants={[
          { key: 'A', label: 'Ignition (today)', render: (p) => <OriginA {...p} /> },
          { key: 'B', label: 'Remote ring + source', note: 'A remote change rings outward from the icon in the info colour and a small "wall switch" chip names the cause for 2s. Your tap stays quiet. Needs the WS event to carry an origin (context.user_id / physical).', render: (p) => <OriginB {...p} /> },
          { key: 'C', label: 'Bulb rays draw', note: 'The bulb glyph grows 8% and six rays draw outward (pathLength) as it comes on; off retracts them in 140ms. The icon itself carries the state.', render: (p) => <OriginC {...p} /> },
          { key: 'D', label: 'Glow bloom', note: 'The on-tint blooms from the icon and fills the tile: light spreading from its source. Off contracts back into the icon.', tradeoff: 'A 36px→216px scale on a radial gradient; cheap on the compositor but avoid on 50 tiles at once.', render: (p) => <OriginD {...p} /> },
          { key: 'E', label: 'Who did it', note: 'Recommended. The cause has a face: a household member\'s initials (from PEOPLE) or a switch glyph slides in from the trailing edge, docks beside the icon for 2s, and slides back out. Continuity from the person to the tile; it answers the question B only hints at, and it is silent for your own tap. The wall-switch case falls back to the glyph because HA reports "physical", not a name.', tradeoff: 'Needs the WS event to carry context.user_id; a chip on every remote change in a busy home is noise, so cap it to one visible chip per tile.', spec: () => 'in 380 ms ease-out · hold 2000 ms · out 240 ms', render: (p) => <OriginE {...p} /> },
          { key: 'F', label: 'Knock', note: 'The restraint variant: someone else\'s change nudges the tile from behind (0.985 → 1.012 → 1, 320ms, faint ring) under the same colour crossfade; your own tap presses it from the front (0.97). No chip, no text, but the two causes still read differently.', tradeoff: 'Says "not you", never "who". Pair with E when the name matters (a log, a notification).', spec: () => '320 ms keyframes [1, .985, 1.012, 1] · press spring 180 ms', render: (p) => <OriginF {...p} /> },
        ]} />

      <Demo id="pending" title="Pending → confirmed / failed" purpose="Between the tap and the hub's answer, show that we are waiting; on the answer, show which answer." principles={['causality', 'state']} inZiggy={['motion.css zm-pending', 'DeviceCard.jsx optimistic + revert', 'toast.didNotRespond']}
        recommend="E"
        variants={[
          { key: 'A', label: 'Breathe (today)', render: (p) => <PendingA {...p} /> },
          { key: 'B', label: 'Ring → check / cross', note: 'A ring draws to 90% around the icon (bounded, not a loop), then closes green with a check, or a red cross pops and the state line says "Didn\'t respond".', render: (p) => <PendingB {...p} /> },
          { key: 'C', label: 'Lean & commit / snap back', note: 'The tile leans halfway toward the new state; on success it commits; on failure it shakes back and the state line carries the reason and a Retry. No toast needed.', render: (p) => <PendingC {...p} /> },
          { key: 'D', label: 'Shimmer sweep', note: 'A light sweep crosses the tile while in flight. Borrowed from skeleton loading; reads as "provisional".', render: (p) => <PendingD {...p} /> },
          { key: 'E', label: 'Fill toward the answer', note: 'Recommended. The tint fills from the leading edge at the speed the hub usually answers (1.4s, linear, bounded); the ack completes it with a 2px green inset flash, a failure drains it back with a red edge and the state line changes. Waiting has a visible budget, success and failure are the same object going two ways, and nothing loops. It beats C because "how long" is shown, not implied.', tradeoff: 'The fill duration must come from a measured p50 latency per device kind, or it will lie for slow IR devices.', spec: () => 'fill 1400 ms linear · ack 160 ms + edge 550 ms · fail drain 320 ms ease-out', render: (p) => <PendingE {...p} /> },
          { key: 'F', label: 'Icon breathes, dots in the line', note: 'The quiet option. One breath on the icon (1→1.05→1, 1.2s, one cycle) and the state text becomes three dots that resolve into the answer. Only the fact that is unknown moves. For dense grids where E\'s fill on several tiles at once would be loud.', tradeoff: 'Failure is text-only (the line turns red); no shape change, so it is easy to miss at a glance.', spec: () => 'breath 1200 ms one cycle · dots 900 ms loop (bounded by the answer) · text 200 ms', render: (p) => <PendingF {...p} /> },
        ]} />

      <Demo id="card-controls" title="Card expand: Show controls" purpose="Controls belong to the tile. Either the tile grows to hold them, or the tile becomes the sheet." principles={['continuity', 'physical']} inZiggy={['Devices.jsx:2164 expanded control surface', 'motion/DeviceSheet.jsx']}
        knobs={[{ key: 'duration', label: 'Duration', min: 0.2, max: 0.9, step: 0.02, value: 0.42, unit: 'ms' }]}
        recommend="C"
        variants={[
          { key: 'A', label: 'Height only (today)', note: 'The card animates its own height; the neighbours jump.', render: (p) => <ExpandGrid {...p} variant="A" /> },
          { key: 'B', label: 'Span + FLIP siblings', note: 'The open card spans the row and grows on a spring; every neighbour slides to its new place.', render: (p) => <ExpandGrid {...p} variant="B" /> },
          { key: 'C', label: 'Tile becomes the sheet', note: 'Recommended. The tile itself (layoutId) morphs into the bottom sheet; its name travels; controls fade in after. Same object, new role, and the grid never reflows.', render: (p) => <ExpandGrid {...p} variant="C" /> },
          { key: 'D', label: 'Lid lifts', note: 'The tile\'s top half is a lid hinged at its top edge (rotateX −14°, perspective 800); it lifts to reveal controls that were "under" it, which fade up 100ms later. Closing lowers the lid faster (220ms) and the controls vanish first. A physical metaphor for "more of this thing".', tradeoff: 'A 3D tilt on a card with text inside; the lid\'s type goes slightly soft while tilted. The grid still reflows (siblings move), which C avoids.', spec: (k) => `lid spring ${Math.round(k.duration * 1000)} ms · controls +100 ms · close 220 ms`, render: (p) => <ExpandGrid {...p} variant="D" /> },
        ]} />

      <Demo id="icon-morphs" title="Icon morphs" purpose="A glyph that turns into its next state tells you the state changed without a colour or a word." principles={['state', 'continuity']} inZiggy={['MediaTransportRemote play/pause', 'LockControls', 'CoverControls', 'FanControls', 'DeviceCard sensor / camera / climate glyphs']}
        recommend="B"
        variants={[
          { key: 'A', label: 'Play/Pause · Lock · Blinds · Fan', note: 'Controls: MorphSVG between play and pause; a shackle that swings; slats that spread; a fan whose spin speed is the level.', render: (p) => <IconMorphs {...p} /> },
          { key: 'B', label: 'Sensors & rooms', note: 'Recommended as the first set to ship: these are the glyphs the dashboard shows all day. The door swings open on its hinge (HTML panel, rotateY −60°, mirrored in RTL); the camera\'s red dot blinks twice then holds and the lens ring breathes only while live; the snowflake spins in 180° on a spring while six arms draw (off retracts them in 140ms); the bulb\'s filament draws and glows gold. Each glyph carries its state; the colour becomes optional.', tradeoff: 'The camera ring is an ambient loop; it is earned by "streaming right now" but must stop the moment the stream does.', render: (p) => <IconMorphsB {...p} /> },
        ]} />

      <Demo id="sheet" title="Device sheet detents (interactive)" purpose="The sheet is the most complete gesture in the app. Tune it here." principles={['physical', 'continuity']} inZiggy={['motion/SheetSurface.jsx', 'motion/DeviceSheet.jsx DETENTS [0.72, 1]']}
        knobs={[
          { key: 'peek', label: 'Peek detent', min: 0.4, max: 0.9, step: 0.02, value: 0.72 },
          { key: 'elastic', label: 'Rubber-band past top', min: 0, max: 0.4, step: 0.02, value: 0.12 },
        ]}
        recommend="B"
        variants={[
          { key: 'A', label: 'Two detents + dismiss', note: 'Drag the sheet: it rests at the peek detent or the top; the corners square off as it reaches the top; a downward flick (or a release past 85%) dismisses; the backdrop follows the drag. Tap a tile to bring it back.', render: (p) => <SheetDetents {...p} variant="A" /> },
          { key: 'B', label: 'Page peeks beneath', note: 'Recommended. The list page behind scales to 0.94, rounds its corners and darkens as the sheet rises (the iOS modal grammar), and it all reverses as the sheet lowers. Every value is a useTransform of the sheet\'s live y, so the page follows your finger, not a timer. The sheet is on top of something, and that something is still there.', tradeoff: 'Scaling the whole page repaints it once per frame during the drag; keep the page a compositor layer (it already is, via transform).', spec: () => 'scale 1 → 0.965 (peek) → 0.94 (top) · radius 0 → 18 · dim 0 → 0.42', render: (p) => <SheetDetents {...p} variant="B" /> },
        ]} />
    </>
  )
}
