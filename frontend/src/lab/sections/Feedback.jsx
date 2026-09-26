// Motion Lab — FEEDBACK
// Toasts, inline success/error, connection banner, empty → first item,
// loading → content, destructive confirmation.
import { useState, useRef, useEffect } from 'react'
import { motion, AnimatePresence, LayoutGroup, useMotionValue } from 'framer-motion'
import { Demo } from '../ui/Demo'
import { SectionIntro } from '../ui/Section'
import { Icon, Page, Card, Button, useT } from '../ziggy/primitives'
import { useHaptic } from '../LabContext'
import { EASE, cssEase } from '../time'
import { ROOMS, COPY } from '../mock/home'

/* ───────────────────────── 1. TOAST ───────────────────────── */

function useToasts(ms) {
  const [toasts, setToasts] = useState([])
  const n = useRef(0)
  const push = (kind) => {
    const id = ++n.current
    const msgs = { success: COPY.toastLightOn, error: COPY.toastFailed, info: COPY.toastPhysical, saved: COPY.toastSaved }
    setToasts(ts => [...ts, { id, kind: kind === 'saved' ? 'success' : kind, msg: msgs[kind] }])
    setTimeout(() => setToasts(ts => ts.filter(t => t.id !== id)), ms(kind === 'error' ? 6000 : 3200))
  }
  const remove = (id) => setToasts(ts => ts.filter(t => t.id !== id))
  return { toasts, push, remove }
}

function ToastButtons({ push, t }) {
  return (
    <div className="zl-hstack" style={{ flexWrap: 'wrap', marginBottom: 12 }}>
      <Button style={{ height: 36 }} onClick={() => push('success')}>{t({ en: 'Success', he: 'הצלחה' })}</Button>
      <Button style={{ height: 36 }} onClick={() => push('error')}>{t({ en: 'Error', he: 'שגיאה' })}</Button>
      <Button style={{ height: 36 }} onClick={() => push('info')}>{t({ en: 'Info', he: 'מידע' })}</Button>
    </div>
  )
}

function ToastItem({ toast, t, onClose, children }) {
  const dot = { success: 'var(--ok)', error: 'var(--err)', info: 'var(--info)' }[toast.kind]
  return (
    <div className={`zl-toast zl-toast--${toast.kind}`}>
      <span style={{ width: 8, height: 8, borderRadius: 999, background: dot, flex: 'none' }} />
      <span style={{ flex: 1 }}>{t(toast.msg)}</span>
      {children}
      {toast.kind === 'error' && <button className="zl-toast__action">{t(COPY.retry)}</button>}
      <button onClick={onClose} style={{ background: 'transparent', border: 0, color: 'inherit', opacity: 0.6, cursor: 'pointer', display: 'grid' }}><Icon name="x" size={16} /></button>
    </div>
  )
}

function ToastA({ ms, tx }) {
  const { toasts, push, remove } = useToasts(ms); const t = useT()
  return (
    <Page title={t({ en: 'Rooms', he: 'חדרים' })}>
      <ToastButtons push={push} t={t} />
      <div style={{ position: 'absolute', left: 16, right: 16, bottom: 20, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <AnimatePresence>
          {toasts.map(x => <motion.div key={x.id} initial={{ opacity: 0, y: 8, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -4, scale: 0.98 }} transition={tx({ duration: 0.24, ease: EASE.enter })}><ToastItem toast={x} t={t} onClose={() => remove(x.id)} /></motion.div>)}
        </AnimatePresence>
      </div>
      <p className="zl-footnote zl-mute">Today: 240ms rise in, 240ms rise out (exit no faster than enter), newest appended below, no layout on removal.</p>
    </Page>
  )
}

function ToastB({ ms, tx, knobs }) {
  // Sonner-style: newest on top, older ones scale down and peek; hover/press expands; swipe to dismiss
  const { toasts, push, remove } = useToasts(ms); const t = useT(); const h = useHaptic()
  const [expanded, setExpanded] = useState(false)
  const list = [...toasts].reverse()
  return (
    <Page title={t({ en: 'Rooms', he: 'חדרים' })}>
      <ToastButtons push={push} t={t} />
      <div style={{ position: 'absolute', left: 16, right: 16, bottom: 20, height: 200, pointerEvents: 'none' }} onPointerEnter={() => setExpanded(true)} onPointerLeave={() => setExpanded(false)}>
        <AnimatePresence>
          {list.map((x, i) => {
            const idx = i; const visible = idx < 3
            return (
              <motion.div key={x.id} layout initial={{ opacity: 0, y: 24, scale: 0.98 }}
                animate={{ opacity: visible ? 1 : 0, y: expanded ? -idx * 60 : -idx * 12, scale: expanded ? 1 : 1 - idx * 0.05, zIndex: 10 - idx }}
                exit={{ opacity: 0, y: 12, scale: 0.96, transition: tx({ duration: 0.16, ease: EASE.out }) }}
                transition={tx({ type: 'spring', duration: knobs.duration, bounce: 0 })}
                drag="x" dragConstraints={{ left: 0, right: 0 }} dragElastic={0.5} onDragEnd={(_, info) => { if (Math.abs(info.offset.x) > 90 || Math.abs(info.velocity.x) > 500) { remove(x.id); h('light') } }}
                style={{ position: 'absolute', left: 0, right: 0, bottom: 0, transformOrigin: 'bottom center', pointerEvents: 'auto', touchAction: 'pan-y' }}>
                <ToastItem toast={x} t={t} onClose={() => remove(x.id)} />
              </motion.div>
            )
          })}
        </AnimatePresence>
      </div>
      <p className="zl-footnote zl-mute">Newest on top; older ones tuck behind at 95%/90%. Hover (or press) to fan them out. Swipe sideways to dismiss with velocity. Exit 160ms.</p>
    </Page>
  )
}

function ToastC({ ms, tx, knobs }) {
  // origin-aware: the toast grows out of the control that caused it
  const t = useT(); const h = useHaptic()
  const [phase, setPhase] = useState('idle') // idle | toast
  const [on, setOn] = useState(false)
  const timer = useRef(null)
  const fire = () => { setOn(v => !v); h('light'); setPhase('toast'); clearTimeout(timer.current); timer.current = setTimeout(() => setPhase('idle'), ms(2600)) }
  return (
    <Page title={t({ en: 'Living Room', he: 'סלון' })}>
      <LayoutGroup id="toast-c">
        <div className="zl-grid2">
          <div className="zl-tile" data-on={on ? 'true' : 'false'} style={{ minHeight: 120, position: 'relative' }} onClick={fire}>
            <div className="zl-tile__row"><span className="zl-tile__icon"><Icon name="lightbulb" /></span>
              {phase === 'idle' && <motion.span layoutId="toast-c-pill" style={{ width: 8, height: 8, borderRadius: 999, background: on ? 'var(--accent)' : 'var(--line-2)' }} />}
            </div>
            <div><div className="zl-tile__name">{t({ en: 'Ceiling Light', he: 'תאורת תקרה' })}</div><div className="zl-tile__meta">{on ? t(COPY.on) : t(COPY.off)}</div></div>
          </div>
        </div>
        <AnimatePresence>
          {phase === 'toast' && (
            <motion.div key="t" layoutId="toast-c-pill" transition={tx({ type: 'spring', duration: knobs.duration, bounce: 0 })} className="zl-toast" style={{ position: 'absolute', left: 16, right: 16, bottom: 20, borderRadius: 14 }} exit={{ opacity: 0, y: 6, transition: tx({ duration: 0.16 }) }}>
              <motion.span initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={tx({ duration: 0.16, delay: 0.14 })} style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%' }}>
                <span style={{ width: 8, height: 8, borderRadius: 999, background: 'var(--ok)' }} />
                <span style={{ flex: 1 }}>{on ? t(COPY.toastLightOn) : t({ en: 'Living Room lights off', he: 'אורות הסלון כבו' })}</span>
                <button className="zl-toast__action" onClick={(e) => { e.stopPropagation(); fire() }}>{t(COPY.undo)}</button>
              </motion.span>
            </motion.div>
          )}
        </AnimatePresence>
      </LayoutGroup>
      <p className="zl-footnote zl-mute" style={{ marginTop: 12 }}>Tap the tile. Its status dot grows into the toast (layoutId), so the message is visibly caused by the thing you touched. Undo is on the toast.</p>
    </Page>
  )
}

function ToastD({ ms, tx }) {
  // no toast: the button morphs Run → Running… → Done ✓
  const t = useT(); const h = useHaptic()
  const [state, setState] = useState('idle') // idle | running | done
  const run = () => { if (state !== 'idle') return; setState('running'); h('light'); setTimeout(() => { setState('done'); h('success'); setTimeout(() => setState('idle'), ms(1800)) }, ms(1600)) }
  const label = { idle: t(COPY.run), running: t(COPY.running), done: t(COPY.done) }[state]
  return (
    <Page title={t({ en: 'On-demand', he: 'לפי דרישה' })}>
      <Card style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <span className="zl-row__icon" style={{ fontSize: 18 }}>🌙</span>
        <div style={{ flex: 1 }}><div className="zl-row__title">{t({ en: 'Good Night', he: 'לילה טוב' })}</div><div className="zl-row__sub">4 {t({ en: 'steps', he: 'שלבים' })}</div></div>
        <motion.button onClick={run} layout animate={{ backgroundColor: state === 'done' ? 'var(--ok)' : state === 'running' ? 'var(--surface-2)' : 'var(--accent)', color: state === 'done' ? '#fff' : state === 'running' ? 'var(--ink-mute)' : 'var(--on-accent)' }} transition={tx({ type: 'spring', duration: 0.4, bounce: 0 })}
          style={{ height: 40, padding: '0 16px', borderRadius: 999, border: 0, fontWeight: 600, fontSize: 14, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, overflow: 'hidden' }}>
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.span key={state} initial={{ opacity: 0, y: 8, filter: 'blur(2px)' }} animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }} exit={{ opacity: 0, y: -8, filter: 'blur(2px)' }} transition={tx({ duration: 0.18, ease: EASE.out })} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              {state === 'running' && <motion.span animate={{ rotate: 360 }} transition={{ duration: 0.8, repeat: Infinity, ease: 'linear' }} style={{ display: 'grid' }}><Icon name="refresh" size={14} /></motion.span>}
              {state === 'done' && <Icon name="check" size={14} strokeWidth={3} />}
              {state === 'idle' && <Icon name="play" size={14} />}
              {label}
            </motion.span>
          </AnimatePresence>
        </motion.button>
      </Card>
      <p className="zl-footnote zl-mute" style={{ marginTop: 12 }}>Tap Run. The button is the feedback: it becomes "Running…" (with a spinner), then "Done ✓" in green, then returns. The outcome lives where the action was. No toast.</p>
    </Page>
  )
}

/* ───────────────────────── 2. CONNECTION BANNER ───────────────────────── */

function BannerDemo({ variant, tx, ms }) {
  const t = useT(); const h = useHaptic()
  const [status, setStatus] = useState('online') // online | offline | reconnecting | back
  const timer = useRef(null)
  const drop = () => { setStatus('offline'); h('warning'); clearTimeout(timer.current); timer.current = setTimeout(() => setStatus('reconnecting'), ms(1800)) }
  const restore = () => { setStatus('back'); h('success'); clearTimeout(timer.current); timer.current = setTimeout(() => setStatus('online'), ms(1400)) }
  const show = status !== 'online'
  const color = { offline: 'var(--err)', reconnecting: 'var(--warn)', back: 'var(--ok)' }[status]
  const text = { offline: t({ en: "You're offline", he: 'אין חיבור' }), reconnecting: t({ en: 'Reconnecting to Ziggy…', he: 'מתחבר לזיגי…' }), back: t({ en: 'Back online', he: 'החיבור חזר' }) }[status]
  const Banner = (
    <div style={{ background: color, color: 'var(--on-accent)', padding: '8px 16px', fontSize: 13, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8, transition: `background calc(300ms * var(--lab-speed,1))` }}>
      <Icon name={status === 'back' ? 'wifi' : 'wifi-off'} size={14} /><span>{text}</span>
    </div>
  )
  return (
    <div className="zl zl-page">
      {variant === 'A' && show && <div style={{ animation: `mlBannerIn calc(240ms * var(--lab-speed,1)) ${cssEase('enter')}` }}>{Banner}</div>}
      {variant === 'B' && (
        <div style={{ display: 'grid', gridTemplateRows: show ? '1fr' : '0fr', transition: `grid-template-rows calc(340ms * var(--lab-speed,1)) ${cssEase('glide')}` }}>
          <div style={{ overflow: 'hidden' }}><motion.div animate={{ y: show ? 0 : -8, opacity: show ? 1 : 0 }} transition={tx({ duration: 0.2 })}>{Banner}</motion.div></div>
        </div>
      )}
      <div className="zl-page__scroll" style={{ position: 'relative' }}>
        <h1 className="zl-title2 zl-page__title" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {t({ en: 'Rooms', he: 'חדרים' })}
          {variant === 'C' && (
            <motion.span animate={{ background: status === 'online' ? 'var(--ok)' : status === 'back' ? 'var(--ok)' : status === 'offline' ? 'var(--err)' : 'var(--warn)', scale: status === 'online' ? 1 : [1, 1.3, 1] }} transition={status === 'online' ? tx({ duration: 0.3 }) : tx({ duration: 1.2, repeat: Infinity })} style={{ width: 8, height: 8, borderRadius: 999, display: 'inline-block' }} />
          )}
        </h1>
        {variant === 'C' && (
          <AnimatePresence>{show && <motion.div key="l" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} transition={tx({ duration: 0.24 })} className="zl-footnote" style={{ color: color, marginTop: -8, marginBottom: 12, overflow: 'hidden' }}>{text}</motion.div>}</AnimatePresence>
        )}
        <div className="zl-hstack" style={{ marginBottom: 12 }}><Button style={{ height: 36 }} onClick={drop}>{t({ en: 'Drop connection', he: 'נתק' })}</Button><Button style={{ height: 36 }} onClick={restore}>{t({ en: 'Restore', he: 'שחזר' })}</Button></div>
        <div className="zl-stack">{ROOMS.slice(0, 4).map(r => <Card key={r.id}><div className="zl-row__title">{t(r.name)}</div><div className="zl-row__sub">{r.lightsOn ? t(COPY.lightsOn, r.lightsOn) : t(COPY.allOff)}</div></Card>)}</div>
      </div>
      <style>{`@keyframes mlBannerIn{from{transform:translateY(-100%);opacity:0}}`}</style>
    </div>
  )
}

/* ───────────────────────── 3. EMPTY → FIRST ITEM ───────────────────────── */

function EmptyDemo({ variant, tx }) {
  const t = useT(); const h = useHaptic()
  const [rooms, setRooms] = useState([])
  const add = () => { setRooms(r => [...r, ROOMS[r.length % ROOMS.length]]); h('success') }
  const reset = () => setRooms([])
  return (
    <Page title={t({ en: 'Rooms', he: 'חדרים' })}>
      <LayoutGroup id={`empty-${variant}`}>
        <AnimatePresence mode="popLayout" initial={false}>
          {rooms.length === 0 ? (
            <motion.div key="empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: tx({ duration: 0.16 }) }} style={{ textAlign: 'center', padding: '48px 24px' }}>
              <motion.div layoutId={variant === 'B' ? 'empty-icon' : undefined} initial={variant === 'B' ? { scale: 0.8 } : false} animate={{ scale: 1 }} transition={tx({ type: 'spring', duration: 0.5, bounce: 0.2 })} style={{ width: 64, height: 64, borderRadius: 20, background: 'var(--surface-2)', display: 'grid', placeItems: 'center', margin: '0 auto 16px', color: 'var(--ink-mute)' }}><Icon name="house" size={28} /></motion.div>
              <motion.div initial={variant === 'B' ? { opacity: 0, y: 8 } : false} animate={{ opacity: 1, y: 0 }} transition={tx({ duration: 0.3, delay: 0.1, ease: EASE.out })} className="zl-headline">{t(COPY.noRooms)}</motion.div>
              <motion.div initial={variant === 'B' ? { opacity: 0, y: 8 } : false} animate={{ opacity: 1, y: 0 }} transition={tx({ duration: 0.3, delay: 0.18, ease: EASE.out })} className="zl-subhead zl-mute" style={{ margin: '4px 0 16px' }}>{t(COPY.noRoomsHint)}</motion.div>
              <motion.div initial={variant === 'B' ? { opacity: 0, y: 8 } : false} animate={{ opacity: 1, y: 0 }} transition={tx({ duration: 0.3, delay: 0.26, ease: EASE.out })}><Button variant="primary" onClick={add}><Icon name="plus" size={18} /> {t(COPY.addRoom)}</Button></motion.div>
            </motion.div>
          ) : (
            <motion.div key="list" initial={{ opacity: variant === 'B' ? 1 : 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={tx({ duration: 0.2 })}>
              <div className="zl-grid2">
                <AnimatePresence initial={false}>
                  {rooms.map((r, i) => (
                    <motion.div key={r.id + i} layout initial={{ opacity: 0, scale: 0.9, y: 8 }} animate={{ opacity: 1, scale: 1, y: 0 }} transition={tx({ type: 'spring', duration: 0.5, bounce: 0.15 })} className="zl-tile zl-room" style={{ minHeight: 120 }}>
                      <div className="zl-tile__row"><motion.span layoutId={variant === 'B' && i === 0 ? 'empty-icon' : undefined} className="zl-tile__icon" transition={tx({ type: 'spring', duration: 0.6, bounce: 0.1 })}><Icon name={r.icon} /></motion.span></div>
                      <div><div className="zl-tile__name">{t(r.name)}</div><div className="zl-tile__meta">0 {t({ en: 'devices', he: 'מכשירים' })}</div></div>
                    </motion.div>
                  ))}
                </AnimatePresence>
              </div>
              <div className="zl-hstack" style={{ marginTop: 12 }}><Button style={{ height: 36 }} onClick={add}><Icon name="plus" size={16} /> {t(COPY.addRoom)}</Button><Button variant="ghost" style={{ height: 36 }} onClick={reset}>{t({ en: 'Reset', he: 'איפוס' })}</Button></div>
            </motion.div>
          )}
        </AnimatePresence>
      </LayoutGroup>
    </Page>
  )
}

/* ───────────────────────── 4. LOADING → CONTENT ───────────────────────── */

function LoadingDemo({ variant, tx, ms, replayKey }) {
  const t = useT()
  const [phase, setPhase] = useState('loading')
  const [arrived, setArrived] = useState(0)
  useEffect(() => {
    setPhase('loading'); setArrived(0)
    if (variant === 'C') {
      const ids = ROOMS.slice(0, 4).map((_, i) => setTimeout(() => setArrived(n => n + 1), ms(500 + i * 380 + Math.random() * 200)))
      const done = setTimeout(() => setPhase('ready'), ms(2400))
      return () => { ids.forEach(clearTimeout); clearTimeout(done) }
    }
    const id = setTimeout(() => setPhase('ready'), ms(1400))
    return () => clearTimeout(id)
  }, [variant, replayKey]) // eslint-disable-line
  const Skel = ({ i }) => <div className="zl-skel" style={{ height: 136, borderRadius: 16, opacity: 0.6 }} />
  return (
    <Page title={t({ en: 'Rooms', he: 'חדרים' })}>
      {variant === 'A' && <div className="zl-grid2">{phase === 'loading' ? [0, 1, 2, 3].map(i => <Skel key={i} i={i} />) : ROOMS.slice(0, 4).map(r => <RoomCardStatic key={r.id} r={r} t={t} />)}</div>}
      {variant === 'B' && (
        <div className="zl-grid2">
          {[0, 1, 2, 3].map(i => (
            <div key={i} style={{ position: 'relative', minHeight: 136 }}>
              <AnimatePresence>{phase === 'loading' && <motion.div key="s" exit={{ opacity: 0, scale: 0.98 }} transition={tx({ duration: 0.22, delay: i * 0.04 })} style={{ position: 'absolute', inset: 0 }}><Skel i={i} /></motion.div>}</AnimatePresence>
              {phase === 'ready' && <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={tx({ duration: 0.3, delay: i * 0.04, ease: EASE.out })}><RoomCardStatic r={ROOMS[i]} t={t} /></motion.div>}
            </div>
          ))}
        </div>
      )}
      {variant === 'C' && (
        <>
          <div className="zl-grid2">
            {[0, 1, 2, 3].map(i => (
              <div key={i} style={{ position: 'relative', minHeight: 136 }}>
                <AnimatePresence>{arrived <= i && <motion.div key="s" exit={{ opacity: 0 }} transition={tx({ duration: 0.2 })} style={{ position: 'absolute', inset: 0 }}><Skel i={i} /></motion.div>}</AnimatePresence>
                {arrived > i && <motion.div initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} transition={tx({ type: 'spring', duration: 0.45, bounce: 0.1 })}><RoomCardStatic r={ROOMS[i]} t={t} /></motion.div>}
              </div>
            ))}
          </div>
          <p className="zl-footnote zl-mute" style={{ marginTop: 12 }}>{t({ en: 'Rooms arrive as the hub reports them.', he: 'חדרים מגיעים כשהרכזת מדווחת.' })}</p>
        </>
      )}
    </Page>
  )
}
function RoomCardStatic({ r, t }) {
  return (
    <div className="zl-tile zl-room" style={{ minHeight: 136 }}>
      <div className="zl-tile__row"><span className="zl-tile__icon"><Icon name={r.icon} /></span><span className="zl-dot" data-state={r.occupancy} /></div>
      <div><div className="zl-tile__name">{t(r.name)}</div><div className="zl-tile__meta">{r.lightsOn ? t(COPY.lightsOn, r.lightsOn) : t(COPY.allOff)} · {r.temp ?? '–'}°</div></div>
    </div>
  )
}

/* ───────────────────────── 5. DESTRUCTIVE CONFIRM ───────────────────────── */

function ConfirmDemo({ variant, tx, ms }) {
  const t = useT(); const h = useHaptic()
  const [open, setOpen] = useState(false)
  const [armed, setArmed] = useState(false)
  const [deleted, setDeleted] = useState(false)
  useEffect(() => { if (open && variant === 'B') { setArmed(false); const id = setTimeout(() => setArmed(true), ms(500)); return () => clearTimeout(id) } }, [open, variant]) // eslint-disable-line
  const confirm = () => { setOpen(false); setDeleted(true); h('heavy'); setTimeout(() => setDeleted(false), ms(2000)) }
  return (
    <div className="zl zl-page">
      <div className="zl-page__scroll">
        <h1 className="zl-title2 zl-page__title">{t({ en: 'Actions', he: 'פעולות' })}</h1>
        <AnimatePresence>
          {!deleted && (
            <motion.div key="card" exit={{ opacity: 0, height: 0, scale: 0.96 }} transition={tx({ duration: 0.3, ease: EASE.inOut })} className="zl-card zl-card--pad" style={{ display: 'flex', alignItems: 'center', gap: 12, overflow: 'hidden' }}>
              <span className="zl-row__icon"><Icon name="sun" /></span>
              <div style={{ flex: 1 }}><div className="zl-row__title">{t({ en: 'Balcony light at sunset', he: 'אור מרפסת בשקיעה' })}</div><div className="zl-row__sub">{t({ en: 'Automatic · ran yesterday', he: 'אוטומטי · רץ אתמול' })}</div></div>
              <button className="zl-btn zl-btn--icon" style={{ width: 36, height: 36, color: 'var(--err-text)' }} onClick={() => setOpen(true)}><Icon name="x" size={18} /></button>
            </motion.div>
          )}
        </AnimatePresence>
        {deleted && <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="zl-footnote zl-mute" style={{ marginTop: 8 }}>{t({ en: 'Removed.', he: 'הוסר.' })}</motion.div>}
      </div>
      <AnimatePresence>
        {open && (
          <>
            <motion.div key="bd" className="zl-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={tx({ duration: 0.2 })} onClick={() => setOpen(false)} style={{ backdropFilter: 'blur(8px)' }} />
            {variant === 'A' ? (
              <motion.div key="dlg" initial={{ opacity: 0, scale: 0.98, y: 8 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.98, y: 8 }} transition={tx({ duration: 0.24, ease: EASE.enter })} className="zl-card zl-card--pad" style={{ position: 'absolute', left: 24, right: 24, top: '35%', borderRadius: 24, padding: 20 }}>
                <div className="zl-title3" style={{ marginBottom: 6 }}>{t({ en: 'Remove this?', he: 'להסיר?' })}</div>
                <div className="zl-subhead zl-mute" style={{ marginBottom: 16 }}>{t({ en: 'Remove "Balcony light at sunset"? This can\'t be undone.', he: 'להסיר את «אור מרפסת בשקיעה»? אי אפשר לבטל את זה.' })}</div>
                <div className="zl-hstack" style={{ justifyContent: 'flex-end' }}><Button onClick={() => setOpen(false)}>{t({ en: 'Cancel', he: 'ביטול' })}</Button><Button variant="primary" style={{ background: 'var(--err)', color: '#fff' }} onClick={confirm}>{t({ en: 'Remove', he: 'הסרה' })}</Button></div>
              </motion.div>
            ) : (
              <motion.div key="sheet" initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%', transition: tx({ duration: 0.22, ease: EASE.enter }) }} transition={tx({ type: 'spring', stiffness: 400, damping: 30, mass: 0.8 })} className="zl-sheet" style={{ padding: '8px 16px 24px' }}>
                <div className="zl-sheet__grabber" />
                <div className="zl-subhead zl-mute" style={{ textAlign: 'center', margin: '8px 0 14px' }}>{t({ en: 'Remove "Balcony light at sunset"? This can\'t be undone.', he: 'להסיר את «אור מרפסת בשקיעה»? אי אפשר לבטל את זה.' })}</div>
                <motion.button onClick={armed ? confirm : undefined} animate={{ opacity: armed ? 1 : 0.4, scale: armed ? 1 : 0.98 }} transition={tx({ duration: 0.3, ease: EASE.out })} className="zl-btn" style={{ width: '100%', height: 50, background: 'var(--err)', color: '#fff', border: 0, borderRadius: 14, marginBottom: 8, cursor: armed ? 'pointer' : 'default' }}>{t({ en: 'Remove', he: 'הסרה' })}</motion.button>
                <Button style={{ width: '100%', height: 50, borderRadius: 14 }} onClick={() => setOpen(false)}>{t({ en: 'Cancel', he: 'ביטול' })}</Button>
              </motion.div>
            )}
          </>
        )}
      </AnimatePresence>
    </div>
  )
}

/* ───────────────────────── SECTION ───────────────────────── */

export default function Feedback() {
  return (
    <>
      <SectionIntro
        title="Feedback"
        lede="Feedback answers: did it work, and where should I look? The best feedback lives where the action was. A toast is the fallback, not the default."
        found={[
          'Toasts: 240ms rise in, 240ms out (exit no faster than enter), newest appended below, no layout on removal, no undo anywhere. 190 error toasts vs 119 success.',
          'The connection banner slides in over 240ms and is removed with return null; being sticky, it reflows the whole page in one frame. "Back online" copy exists in i18n and is never shown.',
          'Every skeleton pops straight to content; DataState (the canonical four-state wrapper) has zero consumers.',
          'No empty state animates in; no empty state becomes the first item.',
          'Destructive actions use a centred Radix dialog (same 240ms in and out) or window.confirm in 10 places. No hold, no action sheet, no arming delay.',
          'Run on an automation card gives no busy state; the outcome arrives as a WS toast seconds later.',
        ]}
      />

      <Demo id="toast" title="Toast" purpose="Confirmation should come from the cause, stack without chaos, and leave faster than it came." inZiggy={['components/ui/Toast.jsx', 'stores/uiStore.js addToast', 'AutomationCard Run']}
        knobs={[{ key: 'duration', label: 'Spring duration (B, C)', min: 0.2, max: 0.9, step: 0.02, value: 0.45, unit: 'ms' }]}
        recommend="D"
        variants={[
          { key: 'A', label: 'Rise + fade (today)', render: (p) => <ToastA {...p} /> },
          { key: 'B', label: 'Stack (Sonner)', note: 'Newest on top; older tuck behind at 95/90%; hover fans out; swipe to dismiss. Exit 160ms.', render: (p) => <ToastB {...p} /> },
          { key: 'C', label: 'Origin-aware + undo', note: 'The tile\'s status dot becomes the toast (layoutId). Cause → effect is visible. Undo on the toast; tapping it reverses the tile.', render: (p) => <ToastC {...p} /> },
          { key: 'D', label: 'Morphing button (no toast)', note: 'Run → Running… → Done ✓ inside the button that was pressed. The outcome stays where the action was.', render: (p) => <ToastD {...p} /> },
        ]} />

      <Demo id="banner" title="Connection banner" purpose="Offline is a state of the whole page. Entering it should push, leaving it should settle green first." inZiggy={['components/ui/ConnectionStatus.jsx', 'SystemHealthBanner.jsx', 'BottomNav offline strip']}
        recommend="B"
        variants={[
          { key: 'A', label: 'Slide in, cut out (today)', note: 'Drop the connection, then restore. Watch the page jump on restore.', render: (p) => <BannerDemo {...p} variant="A" /> },
          { key: 'B', label: 'Push + "Back online"', note: 'grid-template-rows 0fr→1fr pushes the content down smoothly; the strip recolours red→amber→green ("Back online") and then folds away. One layout animation, on purpose.', render: (p) => <BannerDemo {...p} variant="B" /> },
          { key: 'C', label: 'Title dot', note: 'No banner at all: a dot beside the page title pulses red/amber and a one-line note unfolds under it. Nothing reflows.', tradeoff: 'Less visible; may be too quiet for a hub going away.', render: (p) => <BannerDemo {...p} variant="C" /> },
        ]} />

      <Demo id="empty" title="Empty → first item" purpose="The empty state is a promise. When the first item arrives, the promise should turn into it." inZiggy={['Rooms.jsx empty state', 'Devices / Actions / Tasks empties']}
        recommend="B"
        variants={[
          { key: 'A', label: 'Swap', render: (p) => <EmptyDemo {...p} variant="A" /> },
          { key: 'B', label: 'Reveal + icon becomes the card', note: 'Empty state reveals in three beats (icon, copy, button). Add a room: the empty-state icon flies into the first tile\'s icon slot (layoutId); the tile grows around it.', render: (p) => <EmptyDemo {...p} variant="B" /> },
        ]} />

      <Demo id="loading" title="Loading → content" purpose="Content should replace its placeholder in place, or arrive as it truly arrives." inZiggy={['Rooms.jsx skeleton (4 tiles)', 'Devices.jsx 6 bars', 'DataState.jsx (unused)']}
        recommend="C"
        variants={[
          { key: 'A', label: 'Pop (today)', render: (p) => <LoadingDemo {...p} variant="A" /> },
          { key: 'B', label: 'Crossfade in place', note: 'Each skeleton fades and shrinks 2% as its card rises into the same slot, 40ms apart.', render: (p) => <LoadingDemo {...p} variant="B" /> },
          { key: 'C', label: 'Contextual arrival', note: 'Rooms land one by one as the hub reports them (real order, real timing), each settling on a small spring. Honest about what is known when.', render: (p) => <LoadingDemo {...p} variant="C" /> },
        ]} />

      <Demo id="confirm" title="Destructive confirmation" purpose="Deleting should cost a beat of attention, and the thing deleted should visibly leave." inZiggy={['Actions.jsx confirm modal', 'DeviceDetail DeleteDeviceModal', '10× window.confirm']}
        recommend="B"
        variants={[
          { key: 'A', label: 'Centred dialog (today)', render: (p) => <ConfirmDemo {...p} variant="A" /> },
          { key: 'B', label: 'Action sheet, armed after 500ms', note: 'A bottom sheet with the destructive button dimmed for half a second (prevents the double-tap accident), then live. On confirm the card folds out of the list; heavy haptic.', render: (p) => <ConfirmDemo {...p} variant="B" /> },
        ]} />
    </>
  )
}
