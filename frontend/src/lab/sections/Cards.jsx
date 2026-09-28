// Motion Lab — CARDS
// Expanding cards, list insert/remove, re-sort, cross-container travel.
import { useState, useRef, useEffect, useLayoutEffect, forwardRef } from 'react'
import { motion, AnimatePresence, LayoutGroup, useMotionValue, useTransform, animate } from 'framer-motion'
import { Demo } from '../ui/Demo'
import { SectionIntro } from '../ui/Section'
import { Icon, Page, Card, Button, useT } from '../ziggy/primitives'
import { useHaptic } from '../LabContext'
import { EASE } from '../time'
import { ROOMS, AUTOMATIONS, COPY } from '../mock/home'

/* ───────────────────────── 1. EXPANDING CARD ───────────────────────── */

const ALERTS = [
  { id: 'a1', sev: 'warning', title: { en: 'Balcony door open while the AC is on', he: 'דלת המרפסת פתוחה בזמן שהמזגן דולק' }, meta: 'ANOM-02 · 12m ago · Living Room', body: { en: 'The balcony door has been open for 12 minutes and the living room AC is cooling to 24°. Ziggy can turn the AC off, or wait.', he: 'דלת המרפסת פתוחה כבר 12 דקות והמזגן בסלון מקרר ל־24°. זיגי יכול לכבות את המזגן, או לחכות.' } },
  { id: 'a2', sev: 'info', title: { en: 'Motion in the kitchen at 02:14', he: 'תנועה במטבח ב־02:14' }, meta: 'ANOM-04 · 5h ago · Kitchen', body: { en: 'Motion during quiet hours. Nobody was expected in the kitchen; the light was on for 3 minutes.', he: 'תנועה בשעות השקט. אף אחד לא היה אמור להיות במטבח; האור דלק 3 דקות.' } },
  { id: 'a3', sev: 'critical', title: { en: 'Front door unlocked, nobody home', he: 'דלת הכניסה לא נעולה, אין אף אחד בבית' }, meta: 'ANOM-01 · just now · Entrance', body: { en: 'Everyone left at 08:40 and the front door is still unlocked. Ziggy can lock it now.', he: 'כולם יצאו ב־08:40 ודלת הכניסה עדיין לא נעולה. זיגי יכול לנעול עכשיו.' } },
]
const SEV = { critical: 'var(--err)', warning: 'var(--warn)', info: 'var(--info)' }

function AlertHead({ a, t, open }) {
  return (
    <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
      <span className="zl-row__icon" style={{ background: `color-mix(in srgb, ${SEV[a.sev]} 12%, var(--surface-2))`, color: SEV[a.sev] }}><Icon name="warning" size={18} /></span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="zl-row__title">{t(a.title)}</div>
        <div className="zl-footnote zl-mute zl-mono">{a.meta}</div>
      </div>
      <motion.span animate={{ rotate: open ? 180 : 0 }} style={{ color: 'var(--ink-mute)', display: 'grid' }}><Icon name="chevron-right" size={18} style={{ transform: 'rotate(90deg)' }} /></motion.span>
    </div>
  )
}
function AlertBody({ a, t }) {
  return (
    <div style={{ paddingTop: 12 }}>
      <p className="zl-subhead" style={{ margin: '0 0 12px', color: 'var(--ink-2)' }}>{t(a.body)}</p>
      <div className="zl-hstack"><Button variant="primary" style={{ height: 40 }}>{t({ en: 'Turn AC off', he: 'כיבוי מזגן' })}</Button><Button style={{ height: 40 }}>{t({ en: 'Snooze', he: 'השהיה' })}</Button></div>
    </div>
  )
}

function ExpandA({ knobs, tx }) {
  const [open, setOpen] = useState(null); const t = useT(); const h = useHaptic()
  return (
    <Page title={t({ en: 'Alerts', he: 'התראות' })}>
      <div className="zl-stack">
        {ALERTS.map(a => (
          <motion.div key={a.id} layout transition={tx({ duration: knobs.duration, ease: EASE.inOut })} className="zl-card zl-card--pad" style={{ borderInlineStart: `3px solid ${SEV[a.sev]}`, cursor: 'pointer', overflow: 'hidden' }} onClick={() => { setOpen(o => o === a.id ? null : a.id); h('selection') }}>
            <motion.div layout="position"><AlertHead a={a} t={t} open={open === a.id} /></motion.div>
            <AnimatePresence initial={false}>
              {open === a.id && <motion.div key="b" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} transition={tx({ duration: knobs.duration, ease: EASE.inOut })} style={{ overflow: 'hidden' }}><AlertBody a={a} t={t} /></motion.div>}
            </AnimatePresence>
          </motion.div>
        ))}
      </div>
    </Page>
  )
}

function ExpandB({ knobs, tx }) {
  const [open, setOpen] = useState(null); const t = useT(); const h = useHaptic()
  const spring = tx({ type: 'spring', duration: knobs.duration, bounce: knobs.bounce })
  return (
    <Page title={t({ en: 'Alerts', he: 'התראות' })}>
      <div className="zl-stack">
        {ALERTS.map(a => (
          <motion.div key={a.id} layout transition={spring} className="zl-card zl-card--pad" style={{ borderInlineStart: `3px solid ${SEV[a.sev]}`, cursor: 'pointer', overflow: 'hidden' }} onClick={() => { setOpen(o => o === a.id ? null : a.id); h('selection') }}>
            <motion.div layout="position"><AlertHead a={a} t={t} open={open === a.id} /></motion.div>
            <AnimatePresence initial={false}>
              {open === a.id && <motion.div key="b" layout initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0, transition: tx({ duration: 0.18, ease: EASE.out }) }} transition={spring} style={{ overflow: 'hidden' }}><AlertBody a={a} t={t} /></motion.div>}
            </AnimatePresence>
          </motion.div>
        ))}
      </div>
    </Page>
  )
}

function ExpandC({ knobs, tx }) {
  // layered depth: the open card lifts, siblings recede & dim
  const [open, setOpen] = useState(null); const t = useT(); const h = useHaptic()
  const spring = tx({ type: 'spring', duration: knobs.duration, bounce: 0 })
  return (
    <Page title={t({ en: 'Alerts', he: 'התראות' })}>
      <div className="zl-stack">
        {ALERTS.map(a => {
          const isOpen = open === a.id; const dim = open && !isOpen
          return (
            <motion.div key={a.id} layout transition={spring} animate={{ scale: isOpen ? 1.02 : dim ? 0.98 : 1, opacity: dim ? 0.55 : 1, boxShadow: isOpen ? 'var(--shadow-lg)' : 'var(--shadow-sm)', zIndex: isOpen ? 2 : 1 }}
              className="zl-card zl-card--pad" style={{ borderInlineStart: `3px solid ${SEV[a.sev]}`, cursor: 'pointer', overflow: 'hidden', position: 'relative' }} onClick={() => { setOpen(o => o === a.id ? null : a.id); h('selection') }}>
              <motion.div layout="position"><AlertHead a={a} t={t} open={isOpen} /></motion.div>
              <AnimatePresence initial={false}>
                {isOpen && <motion.div key="b" initial={{ opacity: 0, height: 0, y: -8 }} animate={{ opacity: 1, height: 'auto', y: 0 }} exit={{ opacity: 0, height: 0, y: -8, transition: tx({ duration: 0.18 }) }} transition={spring} style={{ overflow: 'hidden' }}><AlertBody a={a} t={t} /></motion.div>}
              </AnimatePresence>
            </motion.div>
          )
        })}
      </div>
    </Page>
  )
}

function ExpandD({ knobs, tx }) {
  // content choreography: background grows first; then body lines stagger in
  const [open, setOpen] = useState(null); const t = useT(); const h = useHaptic()
  const spring = tx({ type: 'spring', duration: knobs.duration, bounce: 0 })
  return (
    <Page title={t({ en: 'Alerts', he: 'התראות' })}>
      <div className="zl-stack">
        {ALERTS.map(a => {
          const isOpen = open === a.id
          return (
            <motion.div key={a.id} layout transition={spring} className="zl-card zl-card--pad" style={{ borderInlineStart: `3px solid ${SEV[a.sev]}`, cursor: 'pointer', overflow: 'hidden' }} onClick={() => { setOpen(o => o === a.id ? null : a.id); h('selection') }}>
              <motion.div layout="position"><AlertHead a={a} t={t} open={isOpen} /></motion.div>
              <AnimatePresence initial={false}>
                {isOpen && (
                  <motion.div key="b" initial={{ height: 0 }} animate={{ height: 'auto' }} exit={{ height: 0, opacity: 0, transition: tx({ duration: 0.16 }) }} transition={spring} style={{ overflow: 'hidden' }}>
                    <motion.div initial="hidden" animate="show" variants={{ show: { transition: tx({ staggerChildren: knobs.stagger, delayChildren: 0.08 }) } }} style={{ paddingTop: 12 }}>
                      <motion.p variants={{ hidden: { opacity: 0, y: 8 }, show: { opacity: 1, y: 0, transition: tx({ duration: 0.26, ease: EASE.out }) } }} className="zl-subhead" style={{ margin: '0 0 12px', color: 'var(--ink-2)' }}>{t(a.body)}</motion.p>
                      <motion.div variants={{ hidden: { opacity: 0, y: 8 }, show: { opacity: 1, y: 0, transition: tx({ duration: 0.26, ease: EASE.out }) } }} className="zl-hstack"><Button variant="primary" style={{ height: 40 }}>{t({ en: 'Turn AC off', he: 'כיבוי מזגן' })}</Button><Button style={{ height: 40 }}>{t({ en: 'Snooze', he: 'השהיה' })}</Button></motion.div>
                    </motion.div>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          )
        })}
      </div>
    </Page>
  )
}

function ExpandE({ knobs, tx }) {
  // "Unfold": the body is a flap hinged at the card's top edge; it unfolds
  // (rotateX -90 → 0) and its shadow lightens as it comes flat. Folding back
  // is faster (180ms).
  const [open, setOpen] = useState(null); const t = useT(); const h = useHaptic()
  const spring = tx({ type: 'spring', duration: knobs.duration, bounce: 0 })
  return (
    <Page title={t({ en: 'Alerts', he: 'התראות' })}>
      <div className="zl-stack">
        {ALERTS.map(a => {
          const isOpen = open === a.id
          return (
            <motion.div key={a.id} layout transition={spring} className="zl-card zl-card--pad" style={{ borderInlineStart: `3px solid ${SEV[a.sev]}`, cursor: 'pointer', overflow: 'visible' }} onClick={() => { setOpen(o => o === a.id ? null : a.id); h('selection') }}>
              <motion.div layout="position"><AlertHead a={a} t={t} open={isOpen} /></motion.div>
              <AnimatePresence initial={false}>
                {isOpen && (
                  <motion.div key="flap" initial={{ height: 0 }} animate={{ height: 'auto' }} exit={{ height: 0, transition: tx({ duration: 0.18, ease: EASE.out }) }} transition={spring} style={{ perspective: 900, overflow: 'visible' }}>
                    <motion.div initial={{ rotateX: -90, opacity: 0.4, boxShadow: '0 18px 28px -12px color-mix(in srgb, var(--ink) 45%, transparent)' }} animate={{ rotateX: 0, opacity: 1, boxShadow: '0 0px 0px 0px color-mix(in srgb, var(--ink) 0%, transparent)' }} exit={{ rotateX: -90, opacity: 0, transition: tx({ duration: 0.18, ease: EASE.out }) }} transition={spring}
                      style={{ transformOrigin: 'top center', transformStyle: 'preserve-3d', background: 'var(--surface)', borderRadius: 12 }}><AlertBody a={a} t={t} /></motion.div>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          )
        })}
      </div>
    </Page>
  )
}

function ExpandF({ knobs, tx, rtl }) {
  // "Focus mode": the tapped card grows to fill the stage (layoutId), with a
  // back affordance; siblings fade; closing shrinks it back into its slot.
  const [open, setOpen] = useState(null); const t = useT(); const h = useHaptic()
  const spring = tx({ type: 'spring', duration: knobs.duration, bounce: 0 })
  const focused = ALERTS.find(a => a.id === open)
  return (
    <div className="zl" style={{ position: 'absolute', inset: 0 }}>
      <LayoutGroup id="focus-cards">
        <Page title={t({ en: 'Alerts', he: 'התראות' })}>
          <div className="zl-stack">
            {ALERTS.map(a => (
              <motion.div key={a.id} layoutId={`focus-${a.id}`} animate={{ opacity: open && open !== a.id ? 0.35 : 1 }} transition={spring} className="zl-card zl-card--pad" style={{ borderInlineStart: `3px solid ${SEV[a.sev]}`, cursor: 'pointer', borderRadius: 16 }} onClick={() => { setOpen(a.id); h('selection') }}>
                <motion.div layout="position"><AlertHead a={a} t={t} open={false} /></motion.div>
              </motion.div>
            ))}
          </div>
        </Page>
        <AnimatePresence>
          {focused && (
            <motion.div key="focus" layoutId={`focus-${focused.id}`} transition={spring} className="zl-card" style={{ position: 'absolute', inset: 0, borderRadius: 0, borderInlineStart: `3px solid ${SEV[focused.sev]}`, zIndex: 5, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: tx({ duration: 0.1 }) }} transition={tx({ duration: 0.2, delay: 0.1 })} style={{ padding: '10px 12px 0' }}>
                <button className="zl-btn zl-btn--ghost" style={{ height: 36, paddingInlineStart: 4 }} onClick={() => { setOpen(null); h('light') }}><Icon name={rtl ? 'chevron-right' : 'chevron-left'} size={18} /> {t({ en: 'Alerts', he: 'התראות' })}</button>
              </motion.div>
              <div style={{ padding: '8px 16px 16px' }}>
                <motion.div layout="position"><AlertHead a={focused} t={t} open={true} /></motion.div>
                <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 6, transition: tx({ duration: 0.12 }) }} transition={tx({ duration: 0.26, delay: 0.14, ease: EASE.out })}><AlertBody a={focused} t={t} /></motion.div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </LayoutGroup>
    </div>
  )
}

/* ───────────────────────── 2. LIST INSERT / REMOVE ───────────────────────── */

function useAlertList() {
  const [items, setItems] = useState(ALERTS)
  const counter = useRef(10)
  const add = () => { const n = counter.current++; setItems(l => [{ id: 'n' + n, sev: ['info', 'warning', 'critical'][n % 3], title: { en: `New alert ${n}`, he: `התראה חדשה ${n}` }, meta: `ANOM-0${n % 9} · just now` }, ...l]) }
  const remove = (id) => setItems(l => l.filter(x => x.id !== id))
  return { items, add, remove }
}

function ListFrame({ children, onAdd, t }) {
  return (
    <Page title={t({ en: 'Alerts', he: 'התראות' })}>
      <div className="zl-hstack" style={{ marginBottom: 12 }}><Button variant="primary" style={{ height: 36 }} onClick={onAdd}>+ {t({ en: 'Simulate alert', he: 'דמה התראה' })}</Button><span className="zl-footnote zl-mute">{t({ en: 'Tap ✓ to clear one', he: 'הקש ✓ כדי לנקות' })}</span></div>
      {children}
    </Page>
  )
}

function ListA({ knobs, tx }) {
  const { items, add, remove } = useAlertList(); const t = useT(); const h = useHaptic()
  return (
    <ListFrame onAdd={add} t={t}>
      <div className="zl-stack">
        <AnimatePresence mode="popLayout" initial={false}>
          {items.map(a => (
            <motion.div key={a.id} layout initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.97 }} transition={tx({ duration: 0.24, ease: EASE.enter })} className="zl-card zl-card--pad" style={{ borderInlineStart: `3px solid ${SEV[a.sev]}`, display: 'flex', gap: 12, alignItems: 'center' }}>
              <div style={{ flex: 1 }}><div className="zl-row__title">{t(a.title)}</div><div className="zl-footnote zl-mute zl-mono">{a.meta}</div></div>
              <button className="zl-btn zl-btn--icon" style={{ width: 36, height: 36, borderRadius: 999 }} onClick={() => { remove(a.id); h('success') }}><Icon name="check" size={18} /></button>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </ListFrame>
  )
}

function ListB({ knobs, tx }) {
  const { items, add, remove } = useAlertList(); const t = useT(); const h = useHaptic()
  return (
    <ListFrame onAdd={add} t={t}>
      <AnimatePresence initial={false}>
        {items.map(a => (
          <motion.div key={a.id} layout initial={{ opacity: 0, height: 0, marginBottom: 0 }} animate={{ opacity: 1, height: 'auto', marginBottom: 12 }} exit={{ opacity: 0, height: 0, marginBottom: 0, transition: tx({ duration: 0.22, ease: EASE.inOut }) }} transition={tx({ type: 'spring', duration: knobs.duration, bounce: 0 })} style={{ overflow: 'hidden' }}>
            <div className="zl-card zl-card--pad" style={{ borderInlineStart: `3px solid ${SEV[a.sev]}`, display: 'flex', gap: 12, alignItems: 'center' }}>
              <div style={{ flex: 1 }}><div className="zl-row__title">{t(a.title)}</div><div className="zl-footnote zl-mute zl-mono">{a.meta}</div></div>
              <button className="zl-btn zl-btn--icon" style={{ width: 36, height: 36, borderRadius: 999 }} onClick={() => { remove(a.id); h('success') }}><Icon name="check" size={18} /></button>
            </div>
          </motion.div>
        ))}
      </AnimatePresence>
    </ListFrame>
  )
}

function SwipeRow({ a, t, onDismiss, tx, rtl }) {
  const x = useMotionValue(0)
  const bg = useTransform(x, [-120, 0, 120], ['var(--ok)', 'var(--surface-2)', 'var(--ok)'])
  const check = useTransform(x, (v) => Math.min(1, Math.abs(v) / 80))
  return (
    <motion.div layout style={{ position: 'relative', marginBottom: 12 }} exit={{ opacity: 0, height: 0, marginBottom: 0, transition: tx({ duration: 0.2 }) }}>
      <motion.div style={{ position: 'absolute', inset: 0, borderRadius: 16, background: bg, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 20px', color: '#fff' }}>
        <motion.span style={{ opacity: check, scale: check }}><Icon name="check" /></motion.span>
        <motion.span style={{ opacity: check, scale: check }}><Icon name="check" /></motion.span>
      </motion.div>
      <motion.div drag="x" dragConstraints={{ left: 0, right: 0 }} dragElastic={0.6} style={{ x, touchAction: 'pan-y' }}
        onDragEnd={(_, info) => { if (Math.abs(info.offset.x) > 120 || Math.abs(info.velocity.x) > 600) onDismiss(a.id, Math.sign(info.offset.x) || 1, info.velocity.x) }}
        className="zl-card zl-card--pad" >
        <div style={{ borderInlineStart: `3px solid ${SEV[a.sev]}`, paddingInlineStart: 12, marginInlineStart: -16 }}>
          <div className="zl-row__title">{t(a.title)}</div><div className="zl-footnote zl-mute zl-mono">{a.meta}</div>
        </div>
      </motion.div>
    </motion.div>
  )
}

function ListC({ knobs, tx, rtl }) {
  const { items, add, remove } = useAlertList(); const t = useT(); const h = useHaptic()
  return (
    <ListFrame onAdd={add} t={t}>
      <AnimatePresence initial={false}>
        {items.map(a => <SwipeRow key={a.id} a={a} t={t} tx={tx} rtl={rtl} onDismiss={(id) => { remove(id); h('success') }} />)}
      </AnimatePresence>
      <div className="ml-hint">swipe a row sideways to clear it · a flick counts</div>
    </ListFrame>
  )
}

function ListD({ knobs, tx }) {
  // "Fold away": a cleared row folds along its horizontal midline (rotateX → 90°)
  // while its height collapses; a new row unfolds in from -90°.
  const { items, add, remove } = useAlertList(); const t = useT(); const h = useHaptic()
  const spring = tx({ type: 'spring', duration: knobs.duration, bounce: 0 })
  const outer = { show: { height: 'auto', marginBottom: 12, transition: spring }, hidden: { height: 0, marginBottom: 0, transition: tx({ duration: 0.22, delay: 0.06, ease: EASE.out }) } }
  const inner = { show: { rotateX: 0, opacity: 1, transition: spring }, hidden: (deg) => ({ rotateX: deg, opacity: 0, transition: tx({ duration: 0.2, ease: EASE.out }) }) }
  return (
    <ListFrame onAdd={add} t={t}>
      <AnimatePresence initial={false} custom={90}>
        {items.map(a => (
          <motion.div key={a.id} layout custom={-90} variants={outer} initial="hidden" animate="show" exit="hidden" style={{ overflow: 'hidden', perspective: 800 }}>
            <motion.div variants={inner} custom={-90} className="zl-card zl-card--pad" style={{ borderInlineStart: `3px solid ${SEV[a.sev]}`, display: 'flex', gap: 12, alignItems: 'center', transformOrigin: 'center center', transformStyle: 'preserve-3d', backfaceVisibility: 'hidden' }}>
              <div style={{ flex: 1 }}><div className="zl-row__title">{t(a.title)}</div><div className="zl-footnote zl-mute zl-mono">{a.meta}</div></div>
              <button className="zl-btn zl-btn--icon" style={{ width: 36, height: 36, borderRadius: 999 }} onClick={() => { remove(a.id); h('success') }}><Icon name="check" size={18} /></button>
            </motion.div>
          </motion.div>
        ))}
      </AnimatePresence>
    </ListFrame>
  )
}

function AbsorbRow({ a, t, onClear, badgeRef, tx, spring }) {
  // the row's transform-origin is the badge's centre, so scaling toward 0.3
  // moves it toward the count; recomputed on every layout
  const ref = useRef(null)
  const origin = useMotionValue('50% 50%')
  useLayoutEffect(() => {
    const r = ref.current?.getBoundingClientRect(); const b = badgeRef.current?.getBoundingClientRect()
    if (r && b) origin.set(`${(b.left + b.width / 2 - r.left).toFixed(0)}px ${(b.top + b.height / 2 - r.top).toFixed(0)}px`)
  })
  return (
    <motion.div layout initial={{ height: 0, marginBottom: 0 }} animate={{ height: 'auto', marginBottom: 12 }} exit={{ height: 0, marginBottom: 0, transition: tx({ duration: 0.26, delay: 0.1, ease: EASE.out }) }} transition={spring} style={{ overflow: 'visible' }}>
      <motion.div ref={ref} initial={{ scale: 0.3, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.3, opacity: 0, transition: tx({ duration: 0.3, ease: EASE.out }) }} transition={spring} className="zl-card zl-card--pad" style={{ transformOrigin: origin, borderInlineStart: `3px solid ${SEV[a.sev]}`, display: 'flex', gap: 12, alignItems: 'center' }}>
        <div style={{ flex: 1 }}><div className="zl-row__title">{t(a.title)}</div><div className="zl-footnote zl-mute zl-mono">{a.meta}</div></div>
        <button className="zl-btn zl-btn--icon" style={{ width: 36, height: 36, borderRadius: 999 }} onClick={() => onClear(a.id)}><Icon name="check" size={18} /></button>
      </motion.div>
    </motion.div>
  )
}

function ListE({ knobs, tx }) {
  // "Absorbed by the count": the row shrinks toward the section's count badge,
  // which then rolls down by one; an insert grows out of the badge.
  const { items, add, remove } = useAlertList(); const t = useT(); const h = useHaptic()
  const spring = tx({ type: 'spring', duration: knobs.duration, bounce: 0 })
  const badgeRef = useRef(null)
  const prev = useRef(items.length); const dir = Math.sign(items.length - prev.current) || 1
  useEffect(() => {
    const d = Math.sign(items.length - prev.current); prev.current = items.length
    if (!badgeRef.current || !d) return
    // the badge squashes as the row arrives (a decrease waits for the shrink to land)
    const a = animate(badgeRef.current, { scale: [1, 1.25, 1] }, tx({ duration: 0.32, delay: d < 0 ? 0.22 : 0, ease: EASE.out }))
    return () => a.stop()
  }, [items.length]) // eslint-disable-line
  return (
    <ListFrame onAdd={() => { add(); h('warning') }} t={t}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', margin: '0 4px 10px' }}>
        <span className="zl-caption zl-mute" style={{ textTransform: 'uppercase', letterSpacing: '.06em' }}>{t({ en: 'Needs attention', he: 'דורש טיפול' })}</span>
        <motion.span ref={badgeRef} className="zl-mono" style={{ minWidth: 24, height: 24, padding: '0 8px', borderRadius: 999, background: items.length ? 'var(--err)' : 'var(--line-2)', color: '#fff', display: 'grid', placeItems: 'center', fontSize: 12, fontWeight: 700, overflow: 'hidden', transition: `background calc(200ms * var(--lab-speed,1))` }}>
          <AnimatePresence mode="popLayout" initial={false} custom={dir}>
            <motion.span key={items.length} custom={dir} variants={{ in: (d) => ({ y: d > 0 ? 12 : -12, opacity: 0 }), show: { y: 0, opacity: 1 }, out: (d) => ({ y: d > 0 ? -12 : 12, opacity: 0 }) }} initial="in" animate="show" exit="out" transition={tx({ duration: 0.2, delay: dir < 0 ? 0.24 : 0, ease: EASE.out })} style={{ display: 'inline-block' }}>{items.length}</motion.span>
          </AnimatePresence>
        </motion.span>
      </div>
      <AnimatePresence initial={false}>
        {items.map(a => <AbsorbRow key={a.id} a={a} t={t} tx={tx} spring={spring} badgeRef={badgeRef} onClear={(id) => { remove(id); h('success') }} />)}
      </AnimatePresence>
    </ListFrame>
  )
}

/* ───────────────────────── 3. RE-SORT ───────────────────────── */

function useRooms() {
  const [rooms, setRooms] = useState(ROOMS.slice(0, 6).map(r => ({ ...r })))
  const flip = (id) => setRooms(rs => rs.map(r => r.id === id ? { ...r, lightsOn: r.lightsOn > 0 ? 0 : 2 } : r))
  const sorted = [...rooms].sort((a, b) => (b.lightsOn > 0) - (a.lightsOn > 0))
  return { rooms: sorted, flip }
}

function SortTile({ r, t, onClick, layoutTx, lift }) {
  const on = r.lightsOn > 0
  return (
    <motion.button layout transition={layoutTx} whileTap={{ scale: 0.97 }} animate={lift ? { zIndex: on ? 2 : 1 } : {}} className="zl-tile zl-room" data-on={on ? 'true' : 'false'} style={{ minHeight: 120 }} onClick={onClick}>
      <div className="zl-tile__row"><span className="zl-tile__icon"><Icon name={r.icon} /></span>{on && <span className="zl-dot" data-state="occupied" />}</div>
      <div><div className="zl-tile__name">{t(r.name)}</div><div className="zl-tile__meta">{on ? t(COPY.lightsOn, r.lightsOn) : t(COPY.allOff)}</div></div>
    </motion.button>
  )
}

function SortA() {
  const { rooms, flip } = useRooms(); const t = useT()
  return (
    <Page title={t({ en: 'Rooms', he: 'חדרים' })}>
      <p className="zl-footnote zl-mute" style={{ marginTop: -8, marginBottom: 12 }}>{t({ en: 'Active rooms sort first. Tap a room to toggle its lights.', he: 'חדרים פעילים קודם. הקש על חדר כדי להדליק/לכבות.' })}</p>
      <div className="zl-grid2">{rooms.map(r => <SortTile key={r.id} r={r} t={t} onClick={() => flip(r.id)} layoutTx={{ duration: 0 }} />)}</div>
    </Page>
  )
}
function SortB({ knobs, tx }) {
  const { rooms, flip } = useRooms(); const t = useT(); const h = useHaptic()
  return (
    <Page title={t({ en: 'Rooms', he: 'חדרים' })}>
      <p className="zl-footnote zl-mute" style={{ marginTop: -8, marginBottom: 12 }}>{t({ en: 'Active rooms sort first. Tap a room to toggle its lights.', he: 'חדרים פעילים קודם. הקש על חדר כדי להדליק/לכבות.' })}</p>
      <LayoutGroup id="sort-b"><div className="zl-grid2">{rooms.map(r => <SortTile key={r.id} r={r} t={t} onClick={() => { flip(r.id); h('light') }} layoutTx={tx({ type: 'spring', duration: knobs.duration, bounce: knobs.bounce })} />)}</div></LayoutGroup>
    </Page>
  )
}
function SortC({ knobs, tx }) {
  // the promoted tile lifts above its siblings while it travels
  const { rooms, flip } = useRooms(); const t = useT(); const h = useHaptic()
  const [lifting, setLifting] = useState(null)
  return (
    <Page title={t({ en: 'Rooms', he: 'חדרים' })}>
      <p className="zl-footnote zl-mute" style={{ marginTop: -8, marginBottom: 12 }}>{t({ en: 'The room you touched rises over the others while it moves.', he: 'החדר שנגעת בו עולה מעל האחרים בזמן שהוא זז.' })}</p>
      <LayoutGroup id="sort-c">
        <div className="zl-grid2">
          {rooms.map(r => (
            <motion.div key={r.id} layout transition={tx({ type: 'spring', duration: knobs.duration, bounce: knobs.bounce })} onLayoutAnimationComplete={() => setLifting(l => l === r.id ? null : l)}
              animate={{ scale: lifting === r.id ? 1.04 : 1, boxShadow: lifting === r.id ? 'var(--shadow-lg)' : '0 0 0 rgba(0,0,0,0)' }} style={{ zIndex: lifting === r.id ? 3 : 1, position: 'relative', borderRadius: 16 }}>
              <SortTile r={r} t={t} onClick={() => { setLifting(r.id); flip(r.id); h('light') }} layoutTx={{ duration: 0 }} />
            </motion.div>
          ))}
        </div>
      </LayoutGroup>
    </Page>
  )
}

function SortD({ knobs, tx }) {
  // "Settle": on change every tile drops 6px and re-lands in its new order,
  // 30ms apart by new index; the touched tile lands last. FLIP does the move,
  // the y keyframe is the beat.
  const { rooms, flip } = useRooms(); const t = useT(); const h = useHaptic()
  const refs = useRef({})
  const [beat, setBeat] = useState({ n: 0, touched: null })
  useEffect(() => {
    if (!beat.n) return
    const anims = rooms.map((r, i) => {
      const el = refs.current[r.id]; if (!el) return null
      const delay = r.id === beat.touched ? rooms.length * 0.03 + 0.04 : i * 0.03
      return animate(el, { y: [0, 6, 0] }, tx({ duration: 0.34, delay, times: [0, 0.4, 1], ease: EASE.out }))
    }).filter(Boolean)
    return () => anims.forEach(a => a.stop())
  }, [beat]) // eslint-disable-line
  return (
    <Page title={t({ en: 'Rooms', he: 'חדרים' })}>
      <p className="zl-footnote zl-mute" style={{ marginTop: -8, marginBottom: 12 }}>{t({ en: 'Every tile drops and re-lands in its new place; the one you touched lands last.', he: 'כל אריח נופל ונוחת במקומו החדש; זה שנגעת בו נוחת אחרון.' })}</p>
      <LayoutGroup id="sort-d">
        <div className="zl-grid2">
          {rooms.map(r => (
            <motion.div key={r.id} ref={(el) => { refs.current[r.id] = el }} layout transition={tx({ type: 'spring', duration: knobs.duration, bounce: knobs.bounce })} style={{ borderRadius: 16 }}>
              <SortTile r={r} t={t} onClick={() => { flip(r.id); setBeat(b => ({ n: b.n + 1, touched: r.id })); h('light') }} layoutTx={{ duration: 0 }} />
            </motion.div>
          ))}
        </div>
      </LayoutGroup>
    </Page>
  )
}

/* ───────────────────────── 4. CROSS-CONTAINER TRAVEL ───────────────────────── */

const TASKS = [
  { id: 't1', text: { en: 'Change the AC filter', he: 'להחליף פילטר במזגן' }, done: false },
  { id: 't2', text: { en: 'Buy batteries for the door sensor', he: 'לקנות סוללות לחיישן הדלת' }, done: false },
  { id: 't3', text: { en: 'Pair the new bulb in the kids room', he: 'לצמד את הנורה החדשה בחדר הילדים' }, done: false },
  { id: 't4', text: { en: 'Water the balcony plants', he: 'להשקות את הצמחים במרפסת' }, done: true },
]

const TaskRow = forwardRef(function TaskRow({ task, t, onToggle, layoutId, tx, layoutTx }, ref) {
  return (
    <motion.div ref={ref} layout layoutId={layoutId} transition={layoutTx} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="zl-row" style={{ borderRadius: 12, border: '1px solid var(--line)', marginBottom: 8 }}>
      <button onClick={() => onToggle(task.id)} aria-pressed={task.done} style={{ width: 24, height: 24, borderRadius: 999, border: `2px solid ${task.done ? 'var(--ok)' : 'var(--line-3)'}`, background: task.done ? 'var(--ok)' : 'transparent', color: '#fff', display: 'grid', placeItems: 'center', cursor: 'pointer', transition: `background calc(200ms * var(--lab-speed,1)), border-color calc(200ms * var(--lab-speed,1))`, flex: 'none' }}>
        <motion.span animate={{ scale: task.done ? 1 : 0, opacity: task.done ? 1 : 0 }} transition={tx({ type: 'spring', duration: 0.3, bounce: 0.3 })} style={{ display: 'grid' }}><Icon name="check" size={14} strokeWidth={3} /></motion.span>
      </button>
      <span className="zl-row__title" style={{ fontWeight: 500, color: task.done ? 'var(--ink-mute)' : 'var(--ink)', textDecoration: task.done ? 'line-through' : 'none' }}>{t(task.text)}</span>
    </motion.div>
  )
})

function TravelDemo({ variant, knobs, tx }) {
  const [tasks, setTasks] = useState(TASKS); const t = useT(); const h = useHaptic()
  const toggle = (id) => { setTasks(ts => ts.map(x => x.id === id ? { ...x, done: !x.done } : x)); h('light') }
  const pending = tasks.filter(x => !x.done); const done = tasks.filter(x => x.done)
  const layoutTx = tx({ type: 'spring', duration: knobs.duration, bounce: 0 })
  const Section = ({ title, list }) => (
    <div style={{ marginBottom: 16 }}>
      <div className="zl-caption zl-mute" style={{ textTransform: 'uppercase', letterSpacing: '.06em', margin: '0 0 8px 4px' }}>{title} · <motion.span key={list.length} initial={{ y: -6, opacity: 0 }} animate={{ y: 0, opacity: 1 }} style={{ display: 'inline-block' }}>{list.length}</motion.span></div>
      <AnimatePresence mode={variant === 'A' ? 'popLayout' : 'sync'} initial={false}>
        {list.map(task => <TaskRow key={task.id} task={task} t={t} onToggle={toggle} layoutId={variant === 'B' ? `task-${task.id}` : undefined} tx={tx} layoutTx={layoutTx} />)}
      </AnimatePresence>
    </div>
  )
  return (
    <Page title={t({ en: 'Tasks', he: 'משימות' })}>
      <LayoutGroup id={`travel-${variant}`}>
        <Section title={t({ en: 'To do', he: 'לביצוע' })} list={pending} />
        <Section title={t({ en: 'Done', he: 'בוצע' })} list={done} />
      </LayoutGroup>
    </Page>
  )
}

function TravelC({ knobs, tx, ms, rtl }) {
  // "Check absorbs the row": the check circle expands to cover the row
  // (clip-path from the check's centre), the text becomes a compact chip that
  // flies (layoutId) to the Done header, the Done count rolls, and the row
  // re-expands in the Done list from that chip.
  const [tasks, setTasks] = useState(TASKS); const t = useT(); const h = useHaptic()
  const [transit, setTransit] = useState(null) // { id, phase: 'cover' | 'chip' }
  const timers = useRef([])
  useEffect(() => () => timers.current.forEach(clearTimeout), [])
  const later = (fn, n) => timers.current.push(setTimeout(fn, ms(n)))
  const spring = tx({ type: 'spring', duration: knobs.duration, bounce: 0 })
  const tick = (id) => {
    if (transit) return
    h('light')
    setTransit({ id, phase: 'cover' })
    later(() => { setTransit({ id, phase: 'chip' }); h('selection') }, 300)
    later(() => { setTasks(ts => ts.map(x => x.id === id ? { ...x, done: true } : x)); setTransit(null); h('success') }, 300 + knobs.duration * 1000 * 0.9)
  }
  const untick = (id) => { setTasks(ts => ts.map(x => x.id === id ? { ...x, done: false } : x)); h('light') }
  const pending = tasks.filter(x => !x.done && !(transit?.id === x.id && transit.phase === 'chip'))
  const done = tasks.filter(x => x.done)
  const inTransit = transit ? tasks.find(x => x.id === transit.id) : null
  const doneCount = done.length + (transit?.phase === 'chip' ? 1 : 0)
  const checkX = rtl ? 'calc(100% - 26px)' : '26px'
  // plain render helpers (not components): a component defined in render would remount and break the layoutId hand-off
  const chip = (task, extra) => <motion.span layoutId={`chip-${task.id}`} transition={spring} className="zl-chip" data-on="true" style={{ height: 26, maxWidth: 170, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis', display: 'inline-block', lineHeight: '26px', ...extra }}>{t(task.text)}</motion.span>
  const header = (title, count, extra) => (
    <div className="zl-caption zl-mute" style={{ textTransform: 'uppercase', letterSpacing: '.06em', margin: '0 0 8px 4px', display: 'flex', alignItems: 'center', gap: 8, minHeight: 26 }}>
      <span>{title} · </span>
      <span style={{ display: 'inline-grid', minWidth: 10, overflow: 'hidden', height: 14 }}><AnimatePresence mode="popLayout" initial={false}><motion.span key={count} initial={{ y: 10, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: -10, opacity: 0 }} transition={tx({ duration: 0.2, ease: EASE.out })} className="zl-mono" style={{ display: 'inline-block' }}>{count}</motion.span></AnimatePresence></span>
      {extra}
    </div>
  )
  return (
    <Page title={t({ en: 'Tasks', he: 'משימות' })}>
      <LayoutGroup id="travel-c">
        <div style={{ marginBottom: 16 }}>
          {header(t({ en: 'To do', he: 'לביצוע' }), pending.length)}
          <AnimatePresence initial={false}>
            {pending.map(task => {
              const covering = transit?.id === task.id && transit.phase === 'cover'
              return (
                <motion.div key={task.id} layout transition={spring} initial={{ opacity: 0, height: 0, marginBottom: 0 }} animate={{ opacity: 1, height: 'auto', marginBottom: 8 }} exit={{ opacity: 0, height: 0, marginBottom: 0, transition: tx({ duration: 0.22, ease: EASE.out }) }} style={{ overflow: 'hidden', borderRadius: 12 }}>
                  <div className="zl-row" style={{ position: 'relative', borderRadius: 12, border: '1px solid var(--line)' }}>
                    <button onClick={() => tick(task.id)} style={{ width: 24, height: 24, borderRadius: 999, border: '2px solid var(--line-3)', background: 'transparent', cursor: 'pointer', flex: 'none' }} />
                    <span className="zl-row__title" style={{ fontWeight: 500 }}>{t(task.text)}</span>
                    <AnimatePresence>
                      {covering && (
                        <motion.div key="cover" initial={{ clipPath: `circle(11px at ${checkX} 50%)` }} animate={{ clipPath: `circle(160% at ${checkX} 50%)` }} transition={tx({ duration: 0.32, ease: EASE.out })} style={{ position: 'absolute', inset: 0, background: 'var(--ok)', display: 'flex', alignItems: 'center', gap: 12, padding: '0 14px', color: '#fff' }}>
                          <span style={{ width: 24, height: 24, borderRadius: 999, background: '#fff', color: 'var(--ok)', display: 'grid', placeItems: 'center', flex: 'none' }}><Icon name="check" size={14} strokeWidth={3} /></span>
                          {chip(task, { background: 'color-mix(in srgb, #fff 22%, transparent)', color: '#fff', borderColor: 'transparent' })}
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                </motion.div>
              )
            })}
          </AnimatePresence>
        </div>
        <div>
          {header(t({ en: 'Done', he: 'בוצע' }), doneCount, transit?.phase === 'chip' && inTransit ? chip(inTransit) : null)}
          <AnimatePresence initial={false}>
            {done.map(task => (
              <motion.div key={task.id} layoutId={`chip-${task.id}`} layout transition={spring} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, height: 0, marginBottom: 0, transition: tx({ duration: 0.2 }) }} className="zl-row" style={{ borderRadius: 12, border: '1px solid var(--line)', marginBottom: 8, overflow: 'hidden' }}>
                <button onClick={() => untick(task.id)} style={{ width: 24, height: 24, borderRadius: 999, border: '2px solid var(--ok)', background: 'var(--ok)', color: '#fff', display: 'grid', placeItems: 'center', cursor: 'pointer', flex: 'none' }}><Icon name="check" size={14} strokeWidth={3} /></button>
                <motion.span layout="position" className="zl-row__title" style={{ fontWeight: 500, color: 'var(--ink-mute)', textDecoration: 'line-through' }}>{t(task.text)}</motion.span>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      </LayoutGroup>
    </Page>
  )
}

/* ───────────────────────── SECTION ───────────────────────── */

export default function Cards() {
  return (
    <>
      <SectionIntro
        title="Cards"
        lede="A card that grows, leaves, moves or changes list should do it as one object. The eye should never have to find it again."
        found={[
          'Anomaly and suggestion cards use `layout` + AnimatePresence popLayout, but the card only leaves after a full refetch replaces the array: one or two network round-trips after the tap.',
          'Rooms re-sort active-first on every state change; tiles jump position with zero animation (Dashboard.jsx:1146).',
          'A task toggled done, an anomaly changing severity, or a suggestion actioned moves between two separate AnimatePresence trees: exit + enter, never a travel.',
          '"Show controls" inside a device card animates its own height (220ms) while everything below it in the grid jumps.',
          'Actions.jsx wraps a plain <div> inside AnimatePresence popLayout, so card exits there do nothing.',
        ]}
      />

      <Demo id="card-expand" title="Expanding card" purpose="More detail about the same thing. The card grows; it is not replaced." principles={['continuity', 'hierarchy']} inZiggy={['Anomalies.jsx card', 'AutomationCard / TemplateCard disclosure', 'Devices.jsx "Show controls"']}
        knobs={[
          { key: 'duration', label: 'Duration', min: 0.15, max: 0.9, step: 0.02, value: 0.42, unit: 'ms' },
          { key: 'bounce', label: 'Bounce (B)', min: 0, max: 0.4, step: 0.02, value: 0.18 },
          { key: 'stagger', label: 'Stagger (D)', min: 0, max: 0.12, step: 0.01, value: 0.05, unit: 'ms' },
        ]}
        recommend="D"
        variants={[
          { key: 'A', label: 'Expand in place', note: 'Height animates with ease-in-out; siblings follow via layout. The baseline done right.', render: (p) => <ExpandA {...p} /> },
          { key: 'B', label: 'Spring expansion', note: 'Same, on a spring with a little overshoot. The card feels like it has mass; collapse is faster and flat.', render: (p) => <ExpandB {...p} /> },
          { key: 'C', label: 'Layered depth', note: 'The open card lifts (scale 1.02 + shadow) and the others recede and dim. Hierarchy: this one matters now.', tradeoff: 'Dimming siblings costs a paint on each; fine for ≤10 cards.', render: (p) => <ExpandC {...p} /> },
          { key: 'D', label: 'Content choreography', note: 'Recommended. The surface grows first; then the body text and the buttons arrive 50ms apart. The container is the cause, the content the effect. It stays the pick because it is the cheapest one that reads as choreography, and it composes with C.', render: (p) => <ExpandD {...p} /> },
          { key: 'E', label: 'Unfold', note: 'The body is a flap hinged at the card\'s top edge: it unfolds from −90° (perspective 900) while a shadow beneath it lightens as it comes flat; folding back is faster (180ms) and the height follows. A physical answer to "more of this": the detail was folded under the headline.', tradeoff: 'Text on a tilting plane is soft for a few frames; the 3D flap also means the card cannot clip overflow, so long bodies need care.', spec: (k) => `unfold spring ${Math.round(k.duration * 1000)} ms · fold 180 ms ease-out`, render: (p) => <ExpandE {...p} /> },
          { key: 'F', label: 'Focus mode', note: 'The tapped card grows to fill the stage (its rect animates to the full frame via layoutId) with a back affordance; siblings fade to 35%; closing shrinks it back into its slot. The card is the page. Best for alerts with actions, where the detail deserves the whole screen.', tradeoff: 'A navigation, not a disclosure: it needs a back gesture and a route, and the list scroll position must survive the round-trip.', spec: (k) => `grow spring ${Math.round(k.duration * 1000)} ms · body +140 ms · siblings 35%`, render: (p) => <ExpandF {...p} /> },
        ]} />

      <Demo id="list-remove" title="List insert / remove" purpose="When an alert is cleared, the list should close the gap; when one arrives, the list should make room." principles={['continuity', 'physical']} inZiggy={['Anomalies.jsx', 'Suggestions / SuggestedTab', 'Toast stack']}
        knobs={[{ key: 'duration', label: 'Gap-close duration (B, D, E)', min: 0.15, max: 0.8, step: 0.02, value: 0.4, unit: 'ms' }]}
        recommend="C"
        variants={[
          { key: 'A', label: 'Pop + shift (layout)', note: 'Removed card fades and shrinks 3%; the others slide up via layout. New cards fade up at the top.', render: (p) => <ListA {...p} /> },
          { key: 'B', label: 'Collapse height', note: 'The row folds to zero height as it fades, so the gap closes as the card leaves rather than after. Inserts unfold.', render: (p) => <ListB {...p} /> },
          { key: 'C', label: 'Swipe to clear', note: 'Recommended. Drag a row sideways; a green check grows under it; release past 120px or flick. It leaves with your velocity and the gap folds shut. It stays the pick because the gesture and the exit are one motion; D and E are for the tap path.', render: (p) => <ListC {...p} /> },
          { key: 'D', label: 'Fold away', note: 'A cleared row folds along its horizontal midline (rotateX → 90°, perspective 800) while its height collapses; a new row unfolds in from −90°. The row is a slip of paper being folded shut, and the gap closes as it does.', tradeoff: 'Cheap (one transform), but a fold reads as "put away", which is right for cleared alerts and wrong for deleted ones.', spec: (k) => `fold 200 ms ease-out · gap ${Math.round(k.duration * 1000)} ms spring · unfold spring`, render: (p) => <ListD {...p} /> },
          { key: 'E', label: 'Absorbed by the count', note: 'The row shrinks (scale → 0.3, opacity → 0) toward the section\'s count badge (its transform-origin is measured to the badge\'s centre each layout), then the badge squashes and rolls down by one; an insert grows out of the badge and the count rolls up. Continuity to the number: the row did not vanish, it became part of the count.', tradeoff: 'Needs a visible count in the header, and the origin measurement runs on every layout (cheap for ≤20 rows).', spec: (k) => `shrink 300 ms ease-out · gap ${Math.round(k.duration * 1000)} ms +100 ms · badge 320 ms`, render: (p) => <ListE {...p} /> },
        ]} />

      <Demo id="resort" title="Re-sort (active rooms first)" purpose="When a room becomes active it moves to the front. The move should be visible or not happen." principles={['continuity', 'causality']} inZiggy={['Dashboard.jsx sortedRooms', 'Rooms grid']}
        knobs={[
          { key: 'duration', label: 'Duration', min: 0.2, max: 1, step: 0.02, value: 0.5, unit: 'ms' },
          { key: 'bounce', label: 'Bounce', min: 0, max: 0.3, step: 0.02, value: 0.08 },
        ]}
        recommend="C"
        variants={[
          { key: 'A', label: 'Instant (today)', render: (p) => <SortA {...p} /> },
          { key: 'B', label: 'FLIP on a spring', note: 'Every tile travels to its new slot. Nothing teleports.', render: (p) => <SortB {...p} /> },
          { key: 'C', label: 'Promoted tile lifts', note: 'Recommended. The tile you touched rises above the others (scale + shadow) for the journey, then settles. Causality: you did that. It stays the pick because the touched tile is the story and it is the one that gets the emphasis.', render: (p) => <SortC {...p} /> },
          { key: 'D', label: 'Settle', note: 'A shuffle beat instead of a flight: on change every tile drops 6px and re-lands in its new order (FLIP for the move, a y keyframe [0, 6, 0] for the beat), 30ms apart by new index; the touched tile lands last. Reads as the grid re-dealing itself.', tradeoff: 'Every tile moves, so the touched one is not singled out; use when the re-sort is system-driven (a schedule) rather than your tap.', spec: (k) => `FLIP spring ${Math.round(k.duration * 1000)} ms · drop 340 ms, 30 ms stagger`, render: (p) => <SortD {...p} /> },
        ]} />

      <Demo id="travel" title="Cross-container travel" purpose="A task ticked off moves to Done. It should be the same row arriving there." principles={['continuity', 'causality']} inZiggy={['Tasks.jsx TaskGroup', 'Anomalies needsAttention ↔ earlierToday', 'Suggestions Pending ↔ History']}
        knobs={[{ key: 'duration', label: 'Travel duration', min: 0.2, max: 1, step: 0.02, value: 0.5, unit: 'ms' }]}
        recommend="B"
        variants={[
          { key: 'A', label: 'Exit + enter (today)', note: 'Two AnimatePresence trees; the row fades out of one and into the other. The count changes; the eye loses the row.', render: (p) => <TravelDemo {...p} variant="A" /> },
          { key: 'B', label: 'Shared layoutId travel', note: 'Recommended. The same row (layoutId) flies from To do to Done; the check springs in first, the travel follows. The count rolls. It stays the pick: one object, one move, nothing to learn.', render: (p) => <TravelDemo {...p} variant="B" /> },
          { key: 'C', label: 'Check absorbs the row', note: 'Three beats: the check circle expands to cover the row (clip-path circle from the check\'s centre, mirrored in RTL); the text becomes a compact chip that flies (layoutId) to the Done header while the Done count rolls; the row re-expands in the Done list from that chip. The tick is the cause, the chip is the row in transit, the count is where it landed.', tradeoff: 'Three timed phases (300ms + travel) make it the longest of the four and the most state to get right; only worth it where ticking is the page\'s main verb.', spec: (k) => `cover 320 ms ease-out · chip flight spring ${Math.round(k.duration * 1000)} ms · land spring`, render: (p) => <TravelC {...p} /> },
        ]} />
    </>
  )
}
