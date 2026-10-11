// Motion Lab — FEEDBACK
// Toasts, inline success/error, connection banner, empty → first item,
// loading → content, destructive confirmation, the success moment.
import { useState, useRef, useEffect } from 'react'
import { motion, AnimatePresence, LayoutGroup, useMotionValue, useTransform, animate } from 'framer-motion'
import { Demo } from '../ui/Demo'
import { SectionIntro } from '../ui/Section'
import { Icon, Page, Card, Button, useT } from '../ziggy/primitives'
import { useHaptic } from '../LabContext'
import { EASE, cssEase } from '../time'
import { ROOMS, COPY } from '../mock/home'

/* ───────────────────────── 1. TOAST ───────────────────────── */

const TOAST_MSGS = { success: COPY.toastLightOn, error: COPY.toastFailed, info: COPY.toastPhysical, saved: COPY.toastSaved }
const KIND_DOT = { success: 'var(--ok)', error: 'var(--err)', info: 'var(--info)' }

function useToasts(ms) {
  const [toasts, setToasts] = useState([])
  const n = useRef(0)
  const push = (kind) => {
    const id = ++n.current
    setToasts(ts => [...ts, { id, kind: kind === 'saved' ? 'success' : kind, msg: TOAST_MSGS[kind] }])
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
  const dot = KIND_DOT[toast.kind]
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
  // Sonner-style: newest on top of the pile (z-order), older ones tuck behind it
  // and peek 12px out at 95% / 90%; hover or press fans them out; swipe to dismiss.
  const { toasts, push, remove } = useToasts(ms); const t = useT(); const h = useHaptic()
  const [expanded, setExpanded] = useState(false)
  const collapseTimer = useRef(null)
  const list = [...toasts].reverse()
  const fan = () => { clearTimeout(collapseTimer.current); setExpanded(true) }
  const unfan = () => setExpanded(false)
  // touch has no hover: a press fans the stack and it folds back 2s after the finger lifts
  const pressEnd = () => { clearTimeout(collapseTimer.current); collapseTimer.current = setTimeout(unfan, ms(2000)) }
  useEffect(() => () => clearTimeout(collapseTimer.current), [])
  return (
    <Page title={t({ en: 'Rooms', he: 'חדרים' })}>
      <ToastButtons push={push} t={t} />
      <div style={{ position: 'absolute', left: 16, right: 16, bottom: 20, height: 220, pointerEvents: 'none' }} onPointerEnter={fan} onPointerLeave={unfan} onPointerDown={fan} onPointerUp={pressEnd}>
        <AnimatePresence>
          {list.map((x, idx) => {
            const visible = idx < 3
            // transform-origin is the TOP edge so scaling keeps the 12px peek exact: y lifts the top by 12px per level, scale shrinks downward behind the newest.
            return (
              <motion.div key={x.id} layout initial={{ opacity: 0, y: 24, scale: 0.98 }}
                animate={{ opacity: visible ? 1 : 0, y: expanded ? -idx * 60 : -idx * 12, scale: expanded ? 1 : 1 - idx * 0.05, zIndex: 10 - idx }}
                exit={{ opacity: 0, y: 12, scale: 0.96, transition: tx({ duration: 0.16, ease: EASE.out }) }}
                transition={tx({ type: 'spring', duration: knobs.duration, bounce: 0 })}
                drag="x" dragConstraints={{ left: 0, right: 0 }} dragElastic={0.5} onDragEnd={(_, info) => { if (Math.abs(info.offset.x) > 90 || Math.abs(info.velocity.x) > 500) { remove(x.id); h('light') } }}
                style={{ position: 'absolute', left: 0, right: 0, bottom: 0, transformOrigin: 'top center', pointerEvents: 'auto', touchAction: 'pan-y' }}>
                <ToastItem toast={x} t={t} onClose={() => remove(x.id)} />
              </motion.div>
            )
          })}
        </AnimatePresence>
      </div>
      <p className="zl-footnote zl-mute">Newest on top; older ones tuck behind, peeking 12px at 95%/90%. Hover or press to fan them out. Swipe sideways to dismiss with velocity. Exit 160ms.</p>
    </Page>
  )
}

function ToastC({ ms, tx, knobs }) {
  // origin-aware: the toast grows out of the control that caused it, and the
  // status dot's colour travels with it as the toast's leading dot.
  const t = useT(); const h = useHaptic()
  const [phase, setPhase] = useState('idle') // idle | toast
  const [on, setOn] = useState(false)
  const timer = useRef(null)
  const fire = () => { setOn(v => !v); h('light'); setPhase('toast'); clearTimeout(timer.current); timer.current = setTimeout(() => setPhase('idle'), ms(2600)) }
  const dotColor = on ? 'var(--accent)' : 'var(--line-3)'
  return (
    <Page title={t({ en: 'Living Room', he: 'סלון' })}>
      <LayoutGroup id="toast-c">
        <div className="zl-grid2">
          <div className="zl-tile" data-on={on ? 'true' : 'false'} style={{ minHeight: 120, position: 'relative' }} onClick={fire}>
            <div className="zl-tile__row"><span className="zl-tile__icon"><Icon name="lightbulb" /></span>
              {phase === 'idle' && <motion.span layoutId="toast-c-pill" style={{ width: 8, height: 8, borderRadius: 999, background: dotColor }} />}
            </div>
            <div><div className="zl-tile__name">{t({ en: 'Ceiling Light', he: 'תאורת תקרה' })}</div><div className="zl-tile__meta">{on ? t(COPY.on) : t(COPY.off)}</div></div>
          </div>
        </div>
        <AnimatePresence>
          {phase === 'toast' && (
            <motion.div key="t" layoutId="toast-c-pill" transition={tx({ type: 'spring', duration: knobs.duration, bounce: 0 })} className="zl-toast" style={{ position: 'absolute', left: 16, right: 16, bottom: 20, borderRadius: 14 }} exit={{ opacity: 0, y: 6, transition: tx({ duration: 0.16 }) }}>
              <motion.span initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={tx({ duration: 0.16, delay: 0.14 })} style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%' }}>
                <span style={{ width: 8, height: 8, borderRadius: 999, background: dotColor, flex: 'none' }} />
                <span style={{ flex: 1 }}>{on ? t(COPY.toastLightOn) : t({ en: 'Living Room lights off', he: 'אורות הסלון כבו' })}</span>
                <button className="zl-toast__action" onClick={(e) => { e.stopPropagation(); fire() }}>{t(COPY.undo)}</button>
              </motion.span>
            </motion.div>
          )}
        </AnimatePresence>
      </LayoutGroup>
      <p className="zl-footnote zl-mute" style={{ marginTop: 12 }}>Tap the tile. Its status dot grows into the toast (layoutId) and keeps its colour as the toast's leading dot, so the message is visibly caused by the thing you touched. Undo is on the toast.</p>
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

function ToastE({ ms, tx }) {
  // Ziggy pill (island): one persistent home for every system message. A 36px
  // "Z" pill at the top centre expands on a spring to carry the message + action,
  // contracts 2.6s later; a second event while open morphs the content in place.
  const t = useT(); const h = useHaptic()
  const [msg, setMsg] = useState(null) // { id, kind, msg }
  const timer = useRef(null); const n = useRef(0)
  useEffect(() => () => clearTimeout(timer.current), [])
  const push = (kind) => {
    const id = ++n.current
    setMsg({ id, kind: kind === 'saved' ? 'success' : kind, msg: TOAST_MSGS[kind] })
    h(kind === 'error' ? 'warning' : 'light')
    clearTimeout(timer.current); timer.current = setTimeout(() => setMsg(null), ms(2600))
  }
  const spring = tx({ type: 'spring', duration: 0.5, bounce: 0.18 })
  return (
    <div className="zl zl-page">
      <div style={{ height: 56, display: 'flex', justifyContent: 'center', alignItems: 'flex-start', paddingTop: 10, flex: 'none' }}>
        <motion.div layout transition={spring} className="zl-toast" style={{ minHeight: 36, height: msg ? 'auto' : 36, padding: msg ? '6px 8px 6px 12px' : '0 10px', borderRadius: 999, boxShadow: 'var(--shadow-lg)', maxWidth: 'calc(100% - 32px)', alignItems: 'center' }}>
          <AnimatePresence mode="popLayout" initial={false}>
            {msg ? (
              <motion.div key={msg.id} initial={{ opacity: 0, filter: 'blur(2px)' }} animate={{ opacity: 1, filter: 'blur(0px)' }} exit={{ opacity: 0, filter: 'blur(2px)' }} transition={tx({ duration: 0.18, ease: EASE.out })}
                style={{ display: 'flex', alignItems: 'center', gap: 10, whiteSpace: 'nowrap', fontSize: 14, fontWeight: 500 }}>
                <span style={{ width: 8, height: 8, borderRadius: 999, background: KIND_DOT[msg.kind], flex: 'none' }} />
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 220 }}>{t(msg.msg)}</span>
                <button className="zl-toast__action" style={{ marginInlineStart: 4, height: 24, padding: '0 8px', borderRadius: 999, background: 'color-mix(in srgb, currentColor 14%, transparent)' }} onClick={() => setMsg(null)}>{t(msg.kind === 'error' ? COPY.retry : COPY.undo)}</button>
              </motion.div>
            ) : (
              <motion.div key="z" initial={{ opacity: 0, filter: 'blur(2px)' }} animate={{ opacity: 1, filter: 'blur(0px)' }} exit={{ opacity: 0, filter: 'blur(2px)' }} transition={tx({ duration: 0.16, ease: EASE.out })}
                style={{ width: 16, height: 36, display: 'grid', placeItems: 'center', fontWeight: 800, fontSize: 15, letterSpacing: '-0.02em' }}>Z</motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      </div>
      <div className="zl-page__scroll" style={{ paddingTop: 0 }}>
        <h1 className="zl-title2 zl-page__title">{t({ en: 'Rooms', he: 'חדרים' })}</h1>
        <ToastButtons push={push} t={t} />
        <div className="zl-stack">{ROOMS.slice(0, 3).map(r => <Card key={r.id}><div className="zl-row__title">{t(r.name)}</div><div className="zl-row__sub">{r.lightsOn ? t(COPY.lightsOn, r.lightsOn) : t(COPY.allOff)}</div></Card>)}</div>
        <p className="zl-footnote zl-mute" style={{ marginTop: 12 }}>Fire two events quickly. The pill is always there; a message expands it (layout spring) and a second one morphs the content with a 2px blur crossfade. Nothing pops from nowhere.</p>
      </div>
    </div>
  )
}

function ToastF({ ms, tx }) {
  // Inline under the tile: no overlay. A one-line confirmation slides out from
  // under the tile that caused it (height 0→32, y −8→0), with Undo; folds back after 2.4s.
  const t = useT(); const h = useHaptic()
  const [on, setOn] = useState(false)
  const [note, setNote] = useState(null) // { id, on }
  const timer = useRef(null); const n = useRef(0)
  useEffect(() => () => clearTimeout(timer.current), [])
  const fire = () => {
    const next = !on; setOn(next); h('light')
    setNote({ id: ++n.current, on: next })
    clearTimeout(timer.current); timer.current = setTimeout(() => setNote(null), ms(2400))
  }
  return (
    <Page title={t({ en: 'Living Room', he: 'סלון' })}>
      <div className="zl-grid2" style={{ alignItems: 'start' }}>
        <div>
          <div className="zl-tile" data-on={on ? 'true' : 'false'} style={{ minHeight: 120, position: 'relative', zIndex: 1 }} onClick={fire}>
            <div className="zl-tile__row"><span className="zl-tile__icon"><Icon name="lightbulb" /></span><span style={{ width: 8, height: 8, borderRadius: 999, background: on ? 'var(--accent)' : 'var(--line-3)', transition: 'background calc(200ms * var(--lab-speed,1))' }} /></div>
            <div><div className="zl-tile__name">{t({ en: 'Ceiling Light', he: 'תאורת תקרה' })}</div><div className="zl-tile__meta">{on ? t(COPY.on) : t(COPY.off)}</div></div>
          </div>
          <AnimatePresence initial={false}>
            {note && (
              <motion.div key="note" initial={{ height: 0, opacity: 0, y: -8 }} animate={{ height: 32, opacity: 1, y: 0 }} exit={{ height: 0, opacity: 0, y: -8, transition: tx({ duration: 0.18, ease: EASE.out }) }} transition={tx({ type: 'spring', duration: 0.42, bounce: 0 })}
                style={{ overflow: 'hidden', marginTop: 6 }}>
                <div style={{ height: 32, display: 'flex', alignItems: 'center', gap: 8, padding: '0 10px', borderRadius: 10, background: 'var(--surface-2)', border: '0.5px solid var(--line)', fontSize: 13, fontWeight: 500 }}>
                  <span style={{ width: 6, height: 6, borderRadius: 999, background: 'var(--ok)', flex: 'none' }} />
                  <AnimatePresence mode="popLayout" initial={false}>
                    <motion.span key={note.id} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={tx({ duration: 0.14 })} style={{ flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {note.on ? t({ en: 'Turned on', he: 'נדלק' }) : t({ en: 'Turned off', he: 'כבה' })}
                    </motion.span>
                  </AnimatePresence>
                  <button className="zl-toast__action" style={{ color: 'var(--accent-text)', fontSize: 13 }} onClick={fire}>{t(COPY.undo)}</button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
        <div className="zl-tile" style={{ minHeight: 120, opacity: 0.5 }}>
          <div className="zl-tile__row"><span className="zl-tile__icon"><Icon name="tv" /></span></div>
          <div><div className="zl-tile__name">{t({ en: 'Living Room TV', he: 'טלוויזיה' })}</div><div className="zl-tile__meta">{t(COPY.off)}</div></div>
        </div>
      </div>
      <p className="zl-footnote zl-mute" style={{ marginTop: 16 }}>Tap the tile. The confirmation unfolds from under it, in the layout, with Undo; it folds back after 2.4s. Feedback attached to its cause.</p>
    </Page>
  )
}

/* ───────────────────────── 2. CONNECTION BANNER ───────────────────────── */

// Edge-glow shadows need literal colour (framer cannot interpolate var() inside box-shadow).
const GLOW = {
  online: { boxShadow: 'inset 0 0 0px rgba(61,138,95,0)' },
  offline: { boxShadow: ['inset 0 0 40px rgba(194,69,48,0.42)', 'inset 0 0 26px rgba(194,69,48,0.16)'] },
  reconnecting: { boxShadow: ['inset 0 0 40px rgba(176,120,32,0.42)', 'inset 0 0 26px rgba(176,120,32,0.16)'] },
  back: { boxShadow: ['inset 0 0 48px rgba(61,138,95,0.55)', 'inset 0 0 48px rgba(61,138,95,0)'] },
}

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
  const glowTransition = status === 'back' ? tx({ duration: 1.2, ease: EASE.out, times: [0, 1] })
    : status === 'online' ? tx({ duration: 0.3 })
    : tx({ duration: 1.8, repeat: Infinity, repeatType: 'mirror', ease: 'easeInOut' }) // a breathing loop is the one place in-out belongs
  return (
    <div className="zl zl-page">
      {variant === 'D' && <motion.div animate={GLOW[status]} transition={glowTransition} style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 5 }} />}
      {variant === 'A' && show && <div style={{ animation: `mlBannerIn calc(240ms * var(--lab-speed,1)) ${cssEase('enter')}` }}>{Banner}</div>}
      {variant === 'B' && (
        <div style={{ display: 'grid', gridTemplateRows: show ? '1fr' : '0fr', transition: `grid-template-rows calc(340ms * var(--lab-speed,1)) ${cssEase('glide')}` }}>
          <div style={{ overflow: 'hidden' }}><motion.div animate={{ y: show ? 0 : -8, opacity: show ? 1 : 0 }} transition={tx({ duration: 0.2 })}>{Banner}</motion.div></div>
        </div>
      )}
      <div className="zl-page__scroll" style={{ position: 'relative' }}>
        <h1 className="zl-title2 zl-page__title" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {t({ en: 'Rooms', he: 'חדרים' })}
          {(variant === 'C' || variant === 'D') && (
            <motion.span animate={{ background: status === 'online' ? 'var(--ok)' : status === 'back' ? 'var(--ok)' : status === 'offline' ? 'var(--err)' : 'var(--warn)', scale: status === 'online' ? 1 : [1, 1.3, 1] }} transition={status === 'online' ? tx({ duration: 0.3 }) : tx({ duration: 1.2, repeat: Infinity })} style={{ width: 8, height: 8, borderRadius: 999, display: 'inline-block' }} />
          )}
        </h1>
        {variant === 'C' && (
          <AnimatePresence>{show && <motion.div key="l" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} transition={tx({ duration: 0.24 })} className="zl-footnote" style={{ color: color, marginTop: -8, marginBottom: 12, overflow: 'hidden' }}>{text}</motion.div>}</AnimatePresence>
        )}
        <div className="zl-hstack" style={{ marginBottom: 12 }}><Button style={{ height: 36 }} onClick={drop}>{t({ en: 'Drop connection', he: 'נתק' })}</Button><Button style={{ height: 36 }} onClick={restore}>{t({ en: 'Restore', he: 'שחזר' })}</Button></div>
        <div className="zl-stack">{ROOMS.slice(0, 4).map(r => <Card key={r.id}><div className="zl-row__title">{t(r.name)}</div><div className="zl-row__sub">{r.lightsOn ? t(COPY.lightsOn, r.lightsOn) : t(COPY.allOff)}</div></Card>)}</div>
        {variant === 'D' && <p className="zl-footnote zl-mute" style={{ marginTop: 12 }}>Drop the connection. The phone's edges glow red, then amber, breathing; restore flashes green once and fades. The page never reflows.</p>}
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

// Where the six dots float while the page is empty, relative to the empty block's icon centre.
const DOT_SCATTER = [[-58, -20], [-22, -36], [20, -28], [54, -8], [30, 24], [-16, 30]]
const DOT_DRIFT = [2.4, 2.9, 2.2, 3.1, 2.6, 2.8]

function EmptyConstellation({ tx, ms }) {
  // Six faint dots are the empty state. On Add they converge onto the corners
  // and mid-edges of the first tile's slot, lines draw between them, the outline
  // fills, and the real tile fades in on top. The empty state assembles into content.
  const t = useT(); const h = useHaptic()
  const [rooms, setRooms] = useState([])
  const [phase, setPhase] = useState('empty') // empty | converge | draw | fill | list
  const areaRef = useRef(null)
  const [W, setW] = useState(358)
  const timers = useRef([])
  useEffect(() => { if (areaRef.current) setW(areaRef.current.getBoundingClientRect().width) }, [])
  useEffect(() => () => timers.current.forEach(clearTimeout), [])
  const later = (fn, at) => timers.current.push(setTimeout(fn, ms(at)))

  // geometry in px inside the scroll box (16px padding; title 6+28+14 → grid starts at y=64)
  const cell = { x: 16, y: 64, w: (W - 44) / 2, h: 120 }
  const outline = [[cell.x, cell.y], [cell.x + cell.w / 2, cell.y], [cell.x + cell.w, cell.y], [cell.x + cell.w, cell.y + cell.h], [cell.x + cell.w / 2, cell.y + cell.h], [cell.x, cell.y + cell.h]]
  const ec = { x: W / 2, y: 64 + 48 + 32 } // empty block's icon centre
  const add = () => {
    if (phase === 'list') { setRooms(r => [...r, ROOMS[r.length % ROOMS.length]]); h('success'); return }
    if (phase !== 'empty') return
    h('light'); setPhase('converge')
    later(() => setPhase('draw'), 240)
    later(() => setPhase('fill'), 480)
    later(() => { setPhase('list'); setRooms([ROOMS[0]]); h('success') }, 700)
  }
  const reset = () => { timers.current.forEach(clearTimeout); setRooms([]); setPhase('empty') }
  const converged = phase !== 'empty'
  const copyVisible = phase === 'empty' || phase === 'converge' || phase === 'draw'
  return (
    <div className="zl zl-page">
      <div className="zl-page__scroll" ref={areaRef} style={{ position: 'relative' }}>
        <h1 className="zl-title2 zl-page__title">{t({ en: 'Rooms', he: 'חדרים' })}</h1>
        {phase !== 'list' ? (
          <div style={{ textAlign: 'center', padding: '48px 24px' }}>
            <div style={{ height: 64, marginBottom: 16 }} />
            <motion.div animate={{ opacity: copyVisible ? 1 : 0, y: copyVisible ? 0 : 6 }} transition={tx({ duration: 0.2, ease: EASE.out })}>
              <div className="zl-headline">{t(COPY.noRooms)}</div>
              <div className="zl-subhead zl-mute" style={{ margin: '4px 0 16px' }}>{t(COPY.noRoomsHint)}</div>
              <Button variant="primary" onClick={add}><Icon name="plus" size={18} /> {t(COPY.addRoom)}</Button>
            </motion.div>
          </div>
        ) : (
          <div>
            <div className="zl-grid2">
              <AnimatePresence initial={false}>
                {rooms.map((r, i) => (
                  <motion.div key={r.id + i} layout initial={i === 0 ? { opacity: 0 } : { opacity: 0, scale: 0.9, y: 8 }} animate={{ opacity: 1, scale: 1, y: 0 }} transition={i === 0 ? tx({ duration: 0.18, ease: EASE.out }) : tx({ type: 'spring', duration: 0.5, bounce: 0.15 })} className="zl-tile zl-room" style={{ minHeight: 120 }}>
                    <div className="zl-tile__row"><span className="zl-tile__icon"><Icon name={r.icon} /></span></div>
                    <div><div className="zl-tile__name">{t(r.name)}</div><div className="zl-tile__meta">0 {t({ en: 'devices', he: 'מכשירים' })}</div></div>
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
            <div className="zl-hstack" style={{ marginTop: 12 }}><Button style={{ height: 36 }} onClick={add}><Icon name="plus" size={16} /> {t(COPY.addRoom)}</Button><Button variant="ghost" style={{ height: 36 }} onClick={reset}>{t({ en: 'Reset', he: 'איפוס' })}</Button></div>
          </div>
        )}
        {phase !== 'list' && (
          <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none', overflow: 'visible' }}>
            {/* the outline fills to become the tile */}
            <motion.rect x={cell.x} y={cell.y} width={cell.w} height={cell.h} rx={16} fill="var(--surface)" stroke="var(--line)" strokeWidth={0.5}
              initial={false} animate={{ opacity: phase === 'fill' ? 1 : 0 }} transition={tx({ duration: 0.18, ease: EASE.out })} />
            {/* lines draw between consecutive dots once they have arrived */}
            {(phase === 'draw' || phase === 'fill') && outline.map(([x1, y1], i) => {
              const [x2, y2] = outline[(i + 1) % 6]
              return <motion.line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke="var(--accent)" strokeWidth={1.5} strokeLinecap="round"
                initial={{ pathLength: 0, opacity: 1 }} animate={{ pathLength: 1, opacity: phase === 'fill' ? 0 : 1 }}
                transition={{ pathLength: tx({ duration: 0.2, delay: i * 0.04, ease: EASE.out }), opacity: tx({ duration: 0.16, delay: 0.1 }) }} />
            })}
            {DOT_SCATTER.map(([dx, dy], i) => (
              <motion.circle key={i} r={converged ? 3 : 4} fill={converged ? 'var(--accent)' : 'var(--ink-ghost)'}
                initial={false}
                animate={converged
                  ? { cx: outline[i][0], cy: outline[i][1], opacity: phase === 'fill' ? 0 : 1 }
                  : { cx: ec.x + dx, cy: [ec.y + dy, ec.y + dy - 5, ec.y + dy], opacity: 0.9 }}
                transition={converged
                  ? { cx: tx({ type: 'spring', duration: 0.42, bounce: 0.1 }), cy: tx({ type: 'spring', duration: 0.42, bounce: 0.1 }), opacity: tx({ duration: 0.16 }) }
                  : { cy: { duration: DOT_DRIFT[i], repeat: Infinity, repeatType: 'mirror', ease: 'easeInOut' }, cx: tx({ duration: 0.3 }), opacity: tx({ duration: 0.3 }) }}
                style={{ transition: 'fill calc(200ms * var(--lab-speed,1))' }} />
            ))}
          </svg>
        )}
      </div>
    </div>
  )
}

/* ───────────────────────── 4. LOADING → CONTENT ───────────────────────── */

function LoadingDemo({ variant, tx, ms, replayKey, rtl }) {
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
    const id = setTimeout(() => setPhase('ready'), ms(variant === 'D' ? 900 : 1400))
    return () => clearTimeout(id)
  }, [variant, replayKey]) // eslint-disable-line
  const Skel = ({ i }) => <div className="zl-skel" style={{ height: 136, borderRadius: 16, opacity: 0.6 }} />
  // D: the sweep is a 40%-wide band travelling 140% of the grid width in 400ms.
  // A card settles the moment the band's centre passes its column centre (+30ms per row for the tilt).
  const SWEEP = 0.4
  const scanDelay = (i) => {
    const c = i % 2, r = Math.floor(i / 2)
    const col = rtl ? 1 - c : c
    const centre = (col + 0.5) * 50 // % of grid width
    return SWEEP * ((centre + 20) / 140) + r * 0.03
  }
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
      {variant === 'D' && (
        <>
          <div style={{ position: 'relative' }}>
            <div className="zl-grid2">
              {[0, 1, 2, 3].map(i => (
                <div key={i} style={{ position: 'relative', minHeight: 136 }}>
                  <AnimatePresence>{phase === 'loading' && <motion.div key="s" exit={{ opacity: 0 }} transition={tx({ duration: 0.16, delay: scanDelay(i) })} style={{ position: 'absolute', inset: 0 }}><Skel i={i} /></motion.div>}</AnimatePresence>
                  {phase === 'ready' && <motion.div initial={{ opacity: 0, y: 6, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={tx({ type: 'spring', duration: 0.42, bounce: 0.08, delay: scanDelay(i) })}><RoomCardStatic r={ROOMS[i]} t={t} /></motion.div>}
                </div>
              ))}
            </div>
            {phase === 'ready' && (
              <div style={{ position: 'absolute', inset: -8, overflow: 'hidden', pointerEvents: 'none', borderRadius: 20 }}>
                <motion.div initial={{ x: rtl ? '250%' : '-100%' }} animate={{ x: rtl ? '-100%' : '250%' }} transition={tx({ duration: SWEEP, ease: 'linear' })}
                  style={{ position: 'absolute', top: '-20%', bottom: '-20%', left: 0, width: `${SWEEP * 100}%`, background: 'linear-gradient(100deg, rgba(255,255,255,0) 0%, rgba(255,255,255,0.55) 50%, rgba(255,255,255,0) 100%)', transform: 'skewX(-8deg)', mixBlendMode: 'screen' }} />
              </div>
            )}
          </div>
          <p className="zl-footnote zl-mute" style={{ marginTop: 12 }}>{t({ en: 'One light sweep; each card settles as the sweep passes it.', he: 'סריקת אור אחת; כל כרטיס מתייצב כשהאור עובר עליו.' })}</p>
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

function SlideToConfirm({ tx, rtl, onConfirm, label }) {
  // drag the red knob to 92% of the track to confirm; release early springs back
  const h = useHaptic()
  const ref = useRef(null)
  const [max, setMax] = useState(240)
  const [done, setDone] = useState(false)
  useEffect(() => { if (ref.current) setMax(ref.current.getBoundingClientRect().width - 48 - 8) }, [])
  const sign = rtl ? -1 : 1
  const x = useMotionValue(0)
  const prog = useTransform(x, v => Math.min(1, Math.max(0, (v * sign) / max)))
  const labelOp = useTransform(prog, [0, 0.45], [1, 0])
  const trail = useTransform(prog, p => `${p * 100}%`)
  return (
    <div ref={ref} style={{ position: 'relative', height: 56, borderRadius: 28, background: 'color-mix(in srgb, var(--err) 10%, var(--surface))', border: '1px solid color-mix(in srgb, var(--err) 40%, transparent)', overflow: 'hidden', marginBottom: 8 }}>
      <motion.div style={{ position: 'absolute', insetBlock: 0, insetInlineStart: 0, width: trail, background: 'color-mix(in srgb, var(--err) 28%, transparent)' }} />
      <motion.span style={{ opacity: labelOp, position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, color: 'var(--err-text)', fontWeight: 600, fontSize: 15, pointerEvents: 'none' }}>
        {label} <Icon name={rtl ? 'chevron-left' : 'chevron-right'} size={16} />
      </motion.span>
      <motion.div drag={done ? false : 'x'} dragConstraints={{ left: rtl ? -max : 0, right: rtl ? 0 : max }} dragElastic={0} dragMomentum={false}
        onDragEnd={() => {
          if (prog.get() >= 0.92) { setDone(true); h('heavy'); animate(x, max * sign, tx({ type: 'spring', duration: 0.25, bounce: 0 })); onConfirm() }
          else animate(x, 0, tx({ type: 'spring', duration: 0.42, bounce: 0.2 }))
        }}
        style={{ x, position: 'absolute', top: 3, insetInlineStart: 3, width: 48, height: 48, borderRadius: 999, background: 'var(--err)', color: '#fff', display: 'grid', placeItems: 'center', touchAction: 'pan-y', cursor: 'grab', boxShadow: 'var(--shadow-sm)' }}>
        <Icon name={done ? 'check' : rtl ? 'arrow-left' : 'arrow-right'} size={20} />
      </motion.div>
    </div>
  )
}

function ConfirmDemo({ variant, tx, ms, rtl }) {
  const t = useT(); const h = useHaptic()
  const [open, setOpen] = useState(false)
  const [armed, setArmed] = useState(false)
  const [deleted, setDeleted] = useState(false)
  useEffect(() => { if (open && variant === 'B') { setArmed(false); const id = setTimeout(() => setArmed(true), ms(500)); return () => clearTimeout(id) } }, [open, variant]) // eslint-disable-line
  const confirm = () => { setOpen(false); setDeleted(true); h('heavy'); setTimeout(() => setDeleted(false), ms(2000)) }
  const confirmSlow = () => { setTimeout(() => { setOpen(false); setDeleted(true); setTimeout(() => setDeleted(false), ms(2000)) }, ms(280)) }
  const question = t({ en: 'Remove "Balcony light at sunset"? This can\'t be undone.', he: 'להסיר את «אור מרפסת בשקיעה»? אי אפשר לבטל את זה.' })
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
                <div className="zl-subhead zl-mute" style={{ marginBottom: 16 }}>{question}</div>
                <div className="zl-hstack" style={{ justifyContent: 'flex-end' }}><Button onClick={() => setOpen(false)}>{t({ en: 'Cancel', he: 'ביטול' })}</Button><Button variant="primary" style={{ background: 'var(--err)', color: '#fff' }} onClick={confirm}>{t({ en: 'Remove', he: 'הסרה' })}</Button></div>
              </motion.div>
            ) : (
              <motion.div key="sheet" initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%', transition: tx({ duration: 0.22, ease: EASE.enter }) }} transition={tx({ type: 'spring', stiffness: 400, damping: 30, mass: 0.8 })} className="zl-sheet" style={{ padding: '8px 16px 24px' }}>
                <div className="zl-sheet__grabber" />
                <div className="zl-subhead zl-mute" style={{ textAlign: 'center', margin: '8px 0 14px' }}>{question}</div>
                {variant === 'C' ? (
                  <SlideToConfirm tx={tx} rtl={rtl} onConfirm={confirmSlow} label={t({ en: 'Slide to remove', he: 'החלק להסרה' })} />
                ) : (
                  <motion.button onClick={armed ? confirm : undefined} animate={{ opacity: armed ? 1 : 0.4, scale: armed ? 1 : 0.98 }} transition={tx({ duration: 0.3, ease: EASE.out })} className="zl-btn" style={{ width: '100%', height: 50, background: 'var(--err)', color: '#fff', border: 0, borderRadius: 14, marginBottom: 8, cursor: armed ? 'pointer' : 'default' }}>{t({ en: 'Remove', he: 'הסרה' })}</motion.button>
                )}
                <Button style={{ width: '100%', height: 50, borderRadius: 14 }} onClick={() => setOpen(false)}>{t({ en: 'Cancel', he: 'ביטול' })}</Button>
              </motion.div>
            )}
          </>
        )}
      </AnimatePresence>
    </div>
  )
}

/* ───────────────────────── 6. SUCCESS MOMENT ───────────────────────── */

function CheckPath({ tx, draw, delay = 0.12, size = 30 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'block' }}>
      <motion.path d="M5 12.5l4.5 4.5L19 7.5" initial={draw ? { pathLength: 0 } : false} animate={{ pathLength: 1 }} transition={tx({ duration: 0.36, delay, ease: EASE.out })} />
    </svg>
  )
}

function SuccessDemo({ variant, tx, ms }) {
  // Everything animates on mount; Replay remounts the variant.
  const t = useT(); const h = useHaptic()
  const [phase, setPhase] = useState('draw') // draw | next (D only)
  useEffect(() => {
    if (variant === 'A') return
    const ids = [setTimeout(() => h('success'), ms(120))]
    if (variant === 'D') ids.push(setTimeout(() => setPhase('next'), ms(1100)))
    return () => ids.forEach(clearTimeout)
  }, [variant]) // eslint-disable-line
  const disc = { width: 64, height: 64, borderRadius: 999, background: 'color-mix(in srgb, var(--ok) 16%, var(--surface))', color: 'var(--ok-text)', display: 'grid', placeItems: 'center', position: 'relative' }
  const title = t({ en: 'Living Room is ready', he: 'הסלון מוכן' })
  const sub = t({ en: '7 devices found, 3 lights, 1 AC.', he: 'נמצאו 7 מכשירים, 3 אורות, מזגן אחד.' })
  return (
    <div className="zl zl-page">
      <LayoutGroup id="success">
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16, padding: 24, textAlign: 'center' }}>
          {variant === 'A' && (
            <div style={disc}><Icon name="check" size={30} strokeWidth={2.6} /></div>
          )}
          {variant === 'B' && (
            <motion.div initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={tx({ type: 'spring', duration: 0.5, bounce: 0.3 })} style={disc}>
              <CheckPath tx={tx} draw />
            </motion.div>
          )}
          {variant === 'C' && (
            <motion.div initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={tx({ type: 'spring', duration: 0.5, bounce: 0.3 })} style={disc}>
              <motion.span initial={{ scale: 1, opacity: 0.7 }} animate={{ scale: 2, opacity: 0 }} transition={tx({ duration: 0.6, delay: 0.12, ease: EASE.out })} style={{ position: 'absolute', inset: 0, borderRadius: 999, border: '2px solid var(--ok)', pointerEvents: 'none' }} />
              <CheckPath tx={tx} draw />
            </motion.div>
          )}
          {variant === 'D' && (
            <div style={{ height: 64, display: 'grid', placeItems: 'center' }}>
              <AnimatePresence>
                {phase === 'draw' && (
                  <motion.div key="disc" initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.6, opacity: 0, transition: tx({ duration: 0.18, ease: EASE.out }) }} transition={tx({ type: 'spring', duration: 0.5, bounce: 0.3 })} style={disc}>
                    <motion.span layoutId="success-check" style={{ display: 'grid' }}><CheckPath tx={tx} draw /></motion.span>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          )}
          <div>
            {variant === 'A' ? (
              <div className="zl-title3">{title}</div>
            ) : (
              <motion.div className="zl-title3" initial={{ y: variant === 'C' ? 8 : 0, opacity: variant === 'A' ? 1 : 0 }} animate={{ y: 0, opacity: 1 }} transition={tx({ duration: 0.3, delay: 0.26, ease: EASE.out })}>{title}</motion.div>
            )}
            <motion.div className="zl-subhead zl-mute" initial={variant === 'A' ? false : { opacity: 0 }} animate={{ opacity: 1 }} transition={tx({ duration: 0.3, delay: 0.4 })} style={{ marginTop: 4 }}>{sub}</motion.div>
          </div>
        </div>
        <div style={{ padding: '0 16px 24px', display: 'flex', justifyContent: 'center' }}>
          {variant === 'D' ? (
            <motion.button layout transition={tx({ type: 'spring', duration: 0.55, bounce: 0.12 })}
              animate={{ backgroundColor: phase === 'next' ? 'var(--accent)' : 'var(--surface-2)', color: phase === 'next' ? 'var(--on-accent)' : 'var(--ink-mute)' }}
              style={{ width: phase === 'next' ? '100%' : 48, height: 48, borderRadius: 14, border: 0, fontWeight: 600, fontSize: 15, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, overflow: 'hidden' }}>
              {phase === 'next' && <motion.span layoutId="success-check" transition={tx({ type: 'spring', duration: 0.55, bounce: 0.12 })} style={{ display: 'grid' }}><CheckPath tx={tx} draw={false} size={18} /></motion.span>}
              {phase === 'next' && <motion.span initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={tx({ duration: 0.2, delay: 0.25 })}>{t({ en: 'Continue', he: 'המשך' })}</motion.span>}
            </motion.button>
          ) : (
            <Button variant="primary" style={{ width: '100%' }}>{t({ en: 'Continue', he: 'המשך' })}</Button>
          )}
        </div>
      </LayoutGroup>
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
          'Success screens (onboarding Done, pairing Found, bundle SUCCESS) show a static tinted disc with a check: stamped, not earned.',
        ]}
      />

      <Demo id="toast" activeNav="rooms" title="Toast" purpose="Confirmation should come from the cause, stack without chaos, and leave faster than it came." principles={['causality', 'continuity', 'restraint']} inZiggy={['components/ui/Toast.jsx', 'stores/uiStore.js addToast', 'AutomationCard Run']}
        knobs={[{ key: 'duration', label: 'Spring duration (B, C)', min: 0.2, max: 0.9, step: 0.02, value: 0.45, unit: 'ms' }]}
        recommend="D"
        variants={[
          { key: 'A', label: 'Rise + fade (today)', render: (p) => <ToastA {...p} /> },
          { key: 'B', label: 'Stack (Sonner)', note: 'Newest on top; older tuck behind, peeking exactly 12px at 95/90% (scaled from the top edge so the peek stays 12px); hover or press fans out; swipe to dismiss. Exit 160ms.', spec: (k) => `enter spring ${Math.round(k.duration * 1000)} ms bounce 0 · peek 12 px · scale .95/.90 from top · fan 60 px · exit 160 ms ease-out`, render: (p) => <ToastB {...p} /> },
          { key: 'C', label: 'Origin-aware + undo', note: 'The tile\'s status dot becomes the toast (layoutId) and its colour rides along as the toast\'s leading dot. Cause → effect is visible. Undo on the toast; tapping it reverses the tile.', spec: (k) => `layoutId spring ${Math.round(k.duration * 1000)} ms bounce 0 · content fades in 160 ms after 140 ms · exit 160 ms`, render: (p) => <ToastC {...p} /> },
          { key: 'D', label: 'Morphing button (no toast)', note: 'Recommended. Run → Running… → Done ✓ inside the button that was pressed. The outcome stays where the action was; nothing new appears on the page. For the cases that truly need a message, E is the home.', render: (p) => <ToastD {...p} /> },
          { key: 'E', label: 'Ziggy pill (island)', note: 'A persistent 36 px "Z" pill at the top centre. An event expands it on a layout spring (500 ms, bounce .18) to carry the message and its action; it contracts after 2.6 s; a second event while open morphs the content with a 2 px blur crossfade. One home for every system message, like Dynamic Island: nothing pops from nowhere.', tradeoff: 'A persistent element costs 36 px of every screen and must never cover a title; it earns that only if it also becomes the voice/thinking indicator.', spec: () => 'layout spring 500 ms bounce .18 · content blur 2 px 180 ms · auto-contract 2.6 s', render: (p) => <ToastE {...p} /> },
          { key: 'F', label: 'Inline under the tile', note: 'No overlay. A one-line confirmation unfolds from under the tile that caused it (height 0→32, y −8→0) with Undo, and folds back after 2.4 s. Feedback attached to its cause, in the layout.', tradeoff: 'It shifts the tile below by 38 px; in a dense grid that reflow is the price of locality.', spec: () => 'unfold spring 420 ms bounce 0 · fold 180 ms ease-out · auto-fold 2.4 s', render: (p) => <ToastF {...p} /> },
        ]} />

      <Demo id="banner" title="Connection banner" purpose="Offline is a state of the whole page. Entering it should push, leaving it should settle green first." principles={['state', 'hierarchy', 'restraint']} inZiggy={['components/ui/ConnectionStatus.jsx', 'SystemHealthBanner.jsx', 'BottomNav offline strip']}
        recommend="B"
        variants={[
          { key: 'A', label: 'Slide in, cut out (today)', note: 'Drop the connection, then restore. Watch the page jump on restore.', render: (p) => <BannerDemo {...p} variant="A" /> },
          { key: 'B', label: 'Push + "Back online"', note: 'Recommended. grid-template-rows 0fr→1fr pushes the content down smoothly; the strip recolours red→amber→green ("Back online") and then folds away. One layout animation, on purpose: a hub going away deserves to displace something.', render: (p) => <BannerDemo {...p} variant="B" /> },
          { key: 'C', label: 'Title dot', note: 'No banner at all: a dot beside the page title pulses red/amber and a one-line note unfolds under it. Nothing reflows.', tradeoff: 'Less visible; may be too quiet for a hub going away.', render: (p) => <BannerDemo {...p} variant="C" /> },
          { key: 'D', label: 'Edge glow', note: 'No banner: the phone\'s edges take a red (offline) or amber (reconnecting) inset glow that breathes slowly, with a small dot beside the title; restore flashes a green glow once and fades. The whole page is in a state, and nothing reflows.', tradeoff: 'An inset shadow over the full page is a compositor cost on low-end Android; and colour alone is not accessible, hence the dot.', spec: () => 'inset 0 0 40px · breathe 1.8 s mirror · restore flash 48 px fades 1.2 s', render: (p) => <BannerDemo {...p} variant="D" /> },
        ]} />

      <Demo id="empty" title="Empty → first item" purpose="The empty state is a promise. When the first item arrives, the promise should turn into it." principles={['continuity', 'causality']} inZiggy={['Rooms.jsx empty state', 'Devices / Actions / Tasks empties']}
        recommend="B"
        variants={[
          { key: 'A', label: 'Swap', render: (p) => <EmptyDemo {...p} variant="A" /> },
          { key: 'B', label: 'Reveal + icon becomes the card', note: 'Recommended. Empty state reveals in three beats (icon, copy, button). Add a room: the empty-state icon flies into the first tile\'s icon slot (layoutId); the tile grows around it. One shared element, no choreography to maintain.', render: (p) => <EmptyDemo {...p} variant="B" /> },
          { key: 'C', label: 'Constellation', note: 'The empty state is six faint dots drifting. On Add they converge onto the corners of the first tile\'s slot, lines draw between them, the outline fills and the real tile fades in on top; the copy fades last. Playful but earned: the empty state literally assembles into the content, ~700 ms.', tradeoff: 'Hand-placed geometry (tile slot at y=64) that must track the real layout; a one-time delight, so it must never replay on every visit.', spec: () => 'converge spring 420 ms → lines 200 ms stagger 40 → fill 180 ms → tile 180 ms · total ~700 ms', render: (p) => <EmptyConstellation {...p} /> },
        ]} />

      <Demo id="loading" title="Loading → content" purpose="Content should replace its placeholder in place, or arrive as it truly arrives." principles={['causality', 'continuity']} inZiggy={['Rooms.jsx skeleton (4 tiles)', 'Devices.jsx 6 bars', 'DataState.jsx (unused)']}
        recommend="C"
        variants={[
          { key: 'A', label: 'Pop (today)', render: (p) => <LoadingDemo {...p} variant="A" /> },
          { key: 'B', label: 'Crossfade in place', note: 'Each skeleton fades and shrinks 2% as its card rises into the same slot, 40ms apart.', render: (p) => <LoadingDemo {...p} variant="B" /> },
          { key: 'C', label: 'Contextual arrival', note: 'Recommended. Rooms land one by one as the hub reports them (real order, real timing), each settling on a small spring. Honest about what is known when; D is the better choice only when everything arrives at once.', render: (p) => <LoadingDemo {...p} variant="C" /> },
          { key: 'D', label: 'Scan and settle', note: 'One light sweep passes over the skeletons in 400 ms, and each card settles in exactly when the sweep reaches its column (delay from column centre, +30 ms per row for the tilt). Arrival is caused by the scan, and the sweep runs the other way in RTL.', tradeoff: 'A sweep implies "checked", which is a lie when data was already there; use only on a true fetch.', spec: () => 'sweep 400 ms linear, 40% band · col 0 at 128 ms, col 1 at 271 ms · settle spring 420 ms bounce .08', render: (p) => <LoadingDemo {...p} variant="D" /> },
        ]} />

      <Demo id="confirm" title="Destructive confirmation" purpose="Deleting should cost a beat of attention, and the thing deleted should visibly leave." principles={['hierarchy', 'causality', 'physical']} inZiggy={['Actions.jsx confirm modal', 'DeviceDetail DeleteDeviceModal', '10× window.confirm']}
        recommend="B"
        variants={[
          { key: 'A', label: 'Centred dialog (today)', render: (p) => <ConfirmDemo {...p} variant="A" /> },
          { key: 'B', label: 'Action sheet, armed after 500ms', note: 'Recommended. A bottom sheet with the destructive button dimmed for half a second (prevents the double-tap accident), then live. On confirm the card folds out of the list; heavy haptic. Cheapest to build on the existing sheet.', render: (p) => <ConfirmDemo {...p} variant="B" /> },
          { key: 'C', label: 'Swipe to confirm', note: 'Inside the sheet, the delete button becomes a track: drag the knob to 92% to confirm, release early and it springs back; the label fades under the knob. The card folds out on confirm. Unlike a hold, a slip cannot complete it.', tradeoff: 'Slower than an armed tap and unfamiliar on web; reserve for the cascading deletes (remove device → HA).', spec: () => 'threshold 92% · spring back 420 ms bounce .2 · commit 250 ms · sheet closes 280 ms later', render: (p) => <ConfirmDemo {...p} variant="C" /> },
        ]} />

      <Demo id="success" title="Success moment" purpose="A rare outcome deserves one earned moment. Show the check being drawn, not stamped." principles={['hierarchy', 'continuity', 'state']} inZiggy={['onboarding DoneStep', 'PairingWizard found', 'BundlePreviewCard SUCCESS']}
        recommend="B"
        variants={[
          { key: 'A', label: 'Static disc (today)', note: 'A 64 px ok-tinted disc with a check. It is simply there when the screen appears.', render: (p) => <SuccessDemo {...p} variant="A" /> },
          { key: 'B', label: 'Check draws', note: 'Recommended. The disc lands on a spring (0.8→1, bounce .3) and the check path draws itself over 360 ms after a 120 ms beat, with a success haptic. Two elements, one sequence, no ring: enough to feel earned without becoming a celebration.', spec: () => 'disc spring 500 ms bounce .3 · check pathLength 0→1 360 ms delay 120 ms · haptic success', render: (p) => <SuccessDemo {...p} variant="B" /> },
          { key: 'C', label: 'Ring bloom', note: 'As the check draws, a ring expands from the disc\'s edge and fades, and the title rises 8 px beneath it. More ceremony: right for the once-per-home onboarding Done, too much for every paired bulb.', tradeoff: 'Three moving parts; the ring reads as celebratory, so keep it for one-time outcomes.', spec: () => 'ring 1→2 600 ms ease-out · title y 8→0 300 ms delay 260 ms', render: (p) => <SuccessDemo {...p} variant="C" /> },
          { key: 'D', label: 'Check becomes the next thing', note: 'After drawing, the check shrinks and flies (layoutId) into the Continue button, which grows from a 48 px pill to full width. Continuity into the next step: the success is not a screen you leave, it is the button you press.', tradeoff: 'The auto-advance at 1.1 s must not race a user who is already tapping; the button is live throughout.', spec: () => 'draw as B · 1.1 s → check layoutId spring 550 ms bounce .12 · button width 48→100% layout spring', render: (p) => <SuccessDemo {...p} variant="D" /> },
        ]} />
    </>
  )
}
