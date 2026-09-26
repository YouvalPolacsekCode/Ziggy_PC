// Motion Lab — PAGE TRANSITIONS
// List → detail, back, tab content switch, sheet → page promotion, swipe-back.
import { useState, useRef, useCallback, useEffect } from 'react'
import { motion, AnimatePresence, LayoutGroup, useMotionValue, useTransform, animate } from 'framer-motion'
import { Demo } from '../ui/Demo'
import { SectionIntro } from '../ui/Section'
import { Icon, Page, Card, Button, useT } from '../ziggy/primitives'
import { useHaptic } from '../LabContext'
import { EASE } from '../time'
import { ROOMS, DEVICES, COPY, devicesInRoom } from '../mock/home'

const PHOTO = {
  living_room: 'linear-gradient(135deg, #c9a27a 0%, #8b6a4e 55%, #4a3a2c 100%)',
  kitchen: 'linear-gradient(135deg, #d7d2c8 0%, #9aa39c 60%, #4c5651 100%)',
  bedroom: 'linear-gradient(135deg, #b9a8c9 0%, #6f5f86 60%, #2e2740 100%)',
  kids: 'linear-gradient(135deg, #f0c27b 0%, #e08a5a 60%, #7a3f2d 100%)',
  office: 'linear-gradient(135deg, #9bb7c9 0%, #5b7a8f 60%, #24343f 100%)',
  bathroom: 'linear-gradient(135deg, #cfe3e6 0%, #7fa9b0 60%, #33555b 100%)',
  balcony: 'linear-gradient(135deg, #f6d365 0%, #fda085 60%, #7a4a3a 100%)',
}

/* ───── shared screens ───── */

function RoomsScreen({ onOpen, layoutIds = false, groupId = '' }) {
  const t = useT()
  return (
    <Page title={t({ en: 'Rooms', he: 'חדרים' })}>
      <div className="zl-grid2">
        {ROOMS.slice(0, 6).map(r => (
          <button key={r.id} className="zl-tile zl-room" style={{ padding: 0, overflow: 'hidden', border: 0 }} onClick={(e) => onOpen(r, e)}>
            <motion.div layoutId={layoutIds ? `${groupId}-photo-${r.id}` : undefined} style={{ position: 'absolute', inset: 0, background: PHOTO[r.id], borderRadius: 16 }} />
            <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg, transparent 40%, rgba(0,0,0,.72))', borderRadius: 16 }} />
            <div style={{ position: 'absolute', insetInline: 12, bottom: 12, color: '#fff', textAlign: 'start' }}>
              <motion.div layoutId={layoutIds ? `${groupId}-name-${r.id}` : undefined} className="zl-subhead" style={{ fontWeight: 600 }}>{t(r.name)}</motion.div>
              <div style={{ fontSize: 12, opacity: 0.85 }}>{r.lightsOn > 0 ? t(COPY.lightsOn, r.lightsOn) : t(COPY.allOff)}</div>
            </div>
          </button>
        ))}
      </div>
    </Page>
  )
}

function RoomScreen({ room, onBack, layoutIds = false, groupId = '', contentDelay = 0, tx }) {
  const t = useT()
  const devs = devicesInRoom(room.id)
  return (
    <div className="zl zl-page">
      <motion.div layoutId={layoutIds ? `${groupId}-photo-${room.id}` : undefined} style={{ height: 160, background: PHOTO[room.id], borderRadius: '0 0 24px 24px', position: 'relative', flex: 'none' }}>
        <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg, rgba(0,0,0,.32), transparent 35%, rgba(0,0,0,.72))', borderRadius: '0 0 24px 24px' }} />
        <button onClick={onBack} style={{ position: 'absolute', top: 12, insetInlineStart: 12, width: 40, height: 40, borderRadius: 999, border: 0, background: 'rgba(255,255,255,.16)', backdropFilter: 'blur(20px)', color: '#fff', display: 'grid', placeItems: 'center', cursor: 'pointer' }}><Icon name="arrow-left" size={20} style={{ transform: 'var(--flip, none)' }} /></button>
        <div style={{ position: 'absolute', insetInline: 20, bottom: 16, color: '#fff' }}>
          <motion.div layoutId={layoutIds ? `${groupId}-name-${room.id}` : undefined} className="zl-large" style={{ fontSize: 28, lineHeight: '32px' }}>{t(room.name)}</motion.div>
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 0.85 }} transition={tx ? tx({ duration: 0.2, delay: contentDelay }) : undefined} className="zl-footnote zl-mono">{t(COPY.occupied)} · {room.temp}° · {r2(room)}</motion.div>
        </div>
      </motion.div>
      <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={tx ? tx({ duration: 0.3, delay: contentDelay, ease: EASE.out }) : undefined} className="zl-page__scroll">
        <div className="zl-stack">
          <Card style={{ display: 'flex', alignItems: 'center', gap: 12 }}><span className="zl-row__icon"><Icon name="lightbulb" /></span><div style={{ flex: 1 }}><div className="zl-row__title">{t({ en: 'Lights', he: 'אורות' })}</div><div className="zl-row__sub">{t(COPY.lightsOn, room.lightsOn)}</div></div><span className="zl-switch" data-state={room.lightsOn ? 'checked' : 'unchecked'}><span className="zl-switch__thumb" style={{ insetInlineStart: room.lightsOn ? 18 : 2 }} /></span></Card>
          {devs.map(d => <Card key={d.id} pad={false}><div className="zl-row" style={{ border: 0 }}><span className="zl-row__icon"><Icon name={{ light: 'lightbulb', climate: 'thermometer', media: 'tv', cover: 'blinds', sensor: 'radar', switch: 'power' }[d.kind]} /></span><div className="zl-row__main"><div className="zl-row__title">{t(d.name)}</div><div className="zl-row__sub">{d.on ? t(COPY.on) : d.kind === 'cover' ? `${d.position}%` : d.kind === 'sensor' ? t(COPY.occupied) : t(COPY.off)}</div></div></div></Card>)}
        </div>
      </motion.div>
    </div>
  )
}
const r2 = (room) => `${room.lightsOn} on · ${room.devices} devices`

/* ───── A: rise + fade, enter only (today) ───── */
function PushA({ tx }) {
  const [room, setRoom] = useState(null)
  const [dir, setDir] = useState('fwd')
  const h = useHaptic()
  return (
    <div className="zl" style={{ position: 'absolute', inset: 0 }}>
      {room ? (
        <motion.div key={'d' + room.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={tx({ duration: 0.34, ease: EASE.glide })} style={{ position: 'absolute', inset: 0 }}>
          <RoomScreen room={room} onBack={() => { setDir('back'); setRoom(null); h('medium') }} tx={tx} />
        </motion.div>
      ) : (
        <motion.div key="list" initial={dir === 'back' ? { opacity: 0, scale: 1.012 } : false} animate={{ opacity: 1, scale: 1 }} transition={tx({ duration: 0.26, ease: EASE.out })} style={{ position: 'absolute', inset: 0 }}>
          <RoomsScreen onOpen={(r) => { setDir('fwd'); setRoom(r) }} />
        </motion.div>
      )}
    </div>
  )
}

/* ───── B: iOS parallax push/pop ───── */
function PushB({ knobs, tx, rtl }) {
  const [room, setRoom] = useState(null)
  const h = useHaptic()
  const sign = rtl ? -1 : 1
  const push = tx({ duration: knobs.duration, ease: EASE.drawer })
  return (
    <div className="zl" style={{ position: 'absolute', inset: 0, overflow: 'hidden' }}>
      <AnimatePresence initial={false} custom={room ? 'fwd' : 'back'}>
        {room ? (
          <motion.div key={'d' + room.id} initial={{ x: `${100 * sign}%` }} animate={{ x: 0 }} exit={{ x: `${100 * sign}%` }} transition={push} style={{ position: 'absolute', inset: 0, zIndex: 2, boxShadow: '-12px 0 40px rgba(0,0,0,.18)', background: 'var(--bg)' }}>
            <RoomScreen room={room} onBack={() => { setRoom(null); h('medium') }} tx={tx} contentDelay={0.05} />
          </motion.div>
        ) : null}
        <motion.div key="list" initial={false} animate={{ x: room ? `${-knobs.parallax * 100 * sign}%` : 0 }} transition={push} style={{ position: 'absolute', inset: 0, zIndex: 1 }}>
          <RoomsScreen onOpen={(r) => setRoom(r)} />
          <motion.div animate={{ opacity: room ? 0.35 : 0 }} transition={push} style={{ position: 'absolute', inset: 0, background: '#000', pointerEvents: 'none' }} />
        </motion.div>
      </AnimatePresence>
    </div>
  )
}

/* ───── C: shared element (tile → hero) ───── */
function PushC({ knobs, tx }) {
  const [room, setRoom] = useState(null)
  const h = useHaptic()
  const spring = tx({ type: 'spring', duration: knobs.duration, bounce: knobs.bounce })
  return (
    <div className="zl" style={{ position: 'absolute', inset: 0, overflow: 'hidden' }}>
      <LayoutGroup id="push-c">
        <AnimatePresence initial={false} mode="popLayout">
          {room ? (
            <motion.div key={'d' + room.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={tx({ duration: 0.2 })} style={{ position: 'absolute', inset: 0, zIndex: 2, background: 'var(--bg)' }}>
              <motion.div layout transition={spring} style={{ position: 'absolute', inset: 0 }}>
                <RoomScreen room={room} onBack={() => { setRoom(null); h('medium') }} layoutIds groupId="c" tx={(t) => ({ ...tx(t), delay: (t.delay || 0) + 0.12 })} />
              </motion.div>
            </motion.div>
          ) : (
            <motion.div key="list" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={tx({ duration: 0.2 })} style={{ position: 'absolute', inset: 0, zIndex: 1 }}>
              <RoomsScreen onOpen={(r) => setRoom(r)} layoutIds groupId="c" />
            </motion.div>
          )}
        </AnimatePresence>
      </LayoutGroup>
      <style>{`#push-c [data-framer-layout] { }`}</style>
    </div>
  )
}

/* ───── D: container transform (tile grows into the page) ───── */
function PushD({ knobs, tx }) {
  const [room, setRoom] = useState(null)
  const [origin, setOrigin] = useState(null)
  const h = useHaptic()
  const open = (r, e) => {
    const stage = e.currentTarget.closest('.ml-stage__content').getBoundingClientRect()
    const rc = e.currentTarget.getBoundingClientRect()
    setOrigin({ x: rc.left - stage.left, y: rc.top - stage.top, w: rc.width, h: rc.height, W: stage.width, H: stage.height })
    setRoom(r)
  }
  const spring = tx({ type: 'spring', duration: knobs.duration, bounce: 0 })
  return (
    <div className="zl" style={{ position: 'absolute', inset: 0, overflow: 'hidden' }}>
      <div style={{ position: 'absolute', inset: 0 }}><RoomsScreen onOpen={open} /></div>
      <AnimatePresence>
        {room && origin && (
          <motion.div key={room.id}
            initial={{ clipPath: `inset(${origin.y}px ${origin.W - origin.x - origin.w}px ${origin.H - origin.y - origin.h}px ${origin.x}px round 16px)` }}
            animate={{ clipPath: 'inset(0px 0px 0px 0px round 0px)' }}
            exit={{ clipPath: `inset(${origin.y}px ${origin.W - origin.x - origin.w}px ${origin.H - origin.y - origin.h}px ${origin.x}px round 16px)`, transition: tx({ duration: knobs.duration * 0.7, ease: EASE.inOut }) }}
            transition={spring}
            style={{ position: 'absolute', inset: 0, zIndex: 3, background: 'var(--bg)' }}>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={tx({ duration: 0.18, delay: 0.1 })} style={{ position: 'absolute', inset: 0 }}>
              <RoomScreen room={room} onBack={() => { setRoom(null); h('medium') }} tx={tx} contentDelay={0.12} />
            </motion.div>
            <motion.div initial={{ opacity: 1 }} animate={{ opacity: 0 }} exit={{ opacity: 1 }} transition={tx({ duration: 0.2 })} style={{ position: 'absolute', inset: 0, background: PHOTO[room.id], pointerEvents: 'none' }} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

/* ───── E: blur crossfade ───── */
function PushE({ tx }) {
  const [room, setRoom] = useState(null)
  const h = useHaptic()
  const f = tx({ duration: 0.22, ease: EASE.out })
  return (
    <div className="zl" style={{ position: 'absolute', inset: 0, overflow: 'hidden' }}>
      <AnimatePresence initial={false}>
        {room ? (
          <motion.div key={'d' + room.id} initial={{ opacity: 0, filter: 'blur(3px)', scale: 1.02 }} animate={{ opacity: 1, filter: 'blur(0px)', scale: 1 }} exit={{ opacity: 0, filter: 'blur(3px)', scale: 1.02 }} transition={f} style={{ position: 'absolute', inset: 0, zIndex: 2, background: 'var(--bg)' }}>
            <RoomScreen room={room} onBack={() => { setRoom(null); h('medium') }} />
          </motion.div>
        ) : (
          <motion.div key="list" initial={{ opacity: 0, filter: 'blur(3px)', scale: 0.98 }} animate={{ opacity: 1, filter: 'blur(0px)', scale: 1 }} exit={{ opacity: 0, filter: 'blur(3px)', scale: 0.98 }} transition={f} style={{ position: 'absolute', inset: 0 }}>
            <RoomsScreen onOpen={(r) => setRoom(r)} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

/* ───────────────────────── TAB CONTENT ───────────────────────── */

const TAB_KEYS = ['controls', 'info']
function TabContent({ tab, t }) {
  return tab === 'controls' ? (
    <div className="zl-stack">
      <Card style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, padding: 24 }}>
        <div className="zl-large zl-mono" style={{ fontSize: 56 }}>24°</div>
        <div className="zl-footnote zl-mute">{t({ en: 'Cooling · now 25.4°', he: 'מקרר · עכשיו 25.4°' })}</div>
        <div className="zl-hstack">{['Cool', 'Heat', 'Fan', 'Dry'].map((m, i) => <span key={m} className="zl-chip" data-on={i === 0 ? 'true' : 'false'}>{m}</span>)}</div>
      </Card>
      <Button variant="primary">{t({ en: 'Turn off', he: 'כיבוי' })}</Button>
    </div>
  ) : (
    <div className="zl-stack">
      {[['Room', 'Living Room'], ['Brand', 'Tadiran'], ['Signal', 'Strong'], ['Firmware', '2.4.1'], ['Last seen', 'just now']].map(([k, v]) => <Card key={k} style={{ display: 'flex', justifyContent: 'space-between' }}><span className="zl-mute">{k}</span><span style={{ fontWeight: 500 }}>{v}</span></Card>)}
    </div>
  )
}

function TabsDemo({ variant, knobs, tx, rtl }) {
  const [tab, setTab] = useState('controls')
  const prev = useRef(0)
  const t = useT(); const h = useHaptic()
  const idx = TAB_KEYS.indexOf(tab)
  const dir = idx >= prev.current ? 1 : -1
  useEffect(() => { prev.current = idx }, [idx])
  const sign = rtl ? -1 : 1
  return (
    <Page title={t({ en: 'Living Room AC', he: 'מזגן סלון' })}>
      <LayoutGroup id={`tabs-${variant}`}>
        <div style={{ display: 'flex', background: 'var(--surface-2)', border: '1px solid var(--line)', borderRadius: 12, padding: 4, marginBottom: 16 }}>
          {TAB_KEYS.map(k => (
            <button key={k} onClick={() => { setTab(k); h('selection') }} style={{ position: 'relative', flex: 1, height: 40, border: 0, background: 'transparent', borderRadius: 9, cursor: 'pointer', color: tab === k ? 'var(--ink)' : 'var(--ink-mute)', fontWeight: 600, fontSize: 15 }}>
              {tab === k && <motion.span layoutId={`tab-pill-${variant}`} transition={tx({ type: 'spring', duration: 0.36, bounce: 0.1 })} style={{ position: 'absolute', inset: 0, borderRadius: 9, background: 'var(--surface)', boxShadow: 'var(--shadow-sm)', border: '0.5px solid var(--line)' }} />}
              <span style={{ position: 'relative' }}>{t({ controls: { en: 'Controls', he: 'בקרות' }, info: { en: 'Info', he: 'מידע' } }[k])}</span>
            </button>
          ))}
        </div>
      </LayoutGroup>
      {variant === 'A' && <TabContent tab={tab} t={t} />}
      {variant === 'B' && (
        <motion.div layout transition={tx({ type: 'spring', duration: knobs.duration, bounce: 0 })} style={{ position: 'relative', overflow: 'hidden' }}>
          <AnimatePresence initial={false} mode="popLayout" custom={dir * sign}>
            <motion.div key={tab} custom={dir * sign} initial={{ x: `${24 * dir * sign}px`, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: `${-24 * dir * sign}px`, opacity: 0 }} transition={tx({ duration: knobs.duration, ease: EASE.out })}>
              <TabContent tab={tab} t={t} />
            </motion.div>
          </AnimatePresence>
        </motion.div>
      )}
      {variant === 'C' && (
        <motion.div layout transition={tx({ type: 'spring', duration: knobs.duration, bounce: 0 })} style={{ position: 'relative' }}>
          <AnimatePresence initial={false} mode="popLayout">
            <motion.div key={tab} initial={{ opacity: 0, filter: 'blur(3px)', y: 4 }} animate={{ opacity: 1, filter: 'blur(0px)', y: 0 }} exit={{ opacity: 0, filter: 'blur(3px)', y: -4 }} transition={tx({ duration: knobs.duration * 0.8, ease: EASE.out })}>
              <TabContent tab={tab} t={t} />
            </motion.div>
          </AnimatePresence>
        </motion.div>
      )}
    </Page>
  )
}

/* ───────────────────────── SHEET → PAGE ───────────────────────── */

function DeviceList({ onOpen }) {
  const t = useT()
  return (
    <Page title={t({ en: 'Devices', he: 'מכשירים' })}>
      <div className="zl-grid2">
        {DEVICES.slice(0, 6).map(d => (
          <button key={d.id} className="zl-tile" data-on={d.on ? 'true' : 'false'} onClick={() => onOpen(d)}>
            <div className="zl-tile__row"><span className="zl-tile__icon"><Icon name={{ light: 'lightbulb', climate: 'thermometer', media: 'tv', cover: 'blinds', sensor: 'radar', switch: 'power' }[d.kind]} /></span></div>
            <div><div className="zl-tile__name">{t(d.name)}</div><div className="zl-tile__meta">{d.on ? t(COPY.on) : t(COPY.off)}</div></div>
          </button>
        ))}
      </div>
    </Page>
  )
}

function SheetBody({ dev, t }) {
  return (
    <div style={{ padding: '0 16px 16px' }}>
      <Card style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14, padding: 24 }}>
        <div style={{ width: 96, height: 96, borderRadius: 999, background: dev.on ? 'var(--accent)' : 'var(--surface-2)', color: dev.on ? 'var(--on-accent)' : 'var(--ink-mute)', display: 'grid', placeItems: 'center' }}><Icon name="power" size={36} /></div>
        <div style={{ width: '100%', height: 44, borderRadius: 14, background: 'var(--surface-3)', overflow: 'hidden' }}><div style={{ width: `${dev.brightness || 60}%`, height: '100%', background: 'var(--accent)' }} /></div>
      </Card>
    </div>
  )
}

function SheetPromote({ variant, knobs, tx }) {
  const [dev, setDev] = useState(null)
  const [full, setFull] = useState(false)
  const t = useT(); const h = useHaptic()
  const close = () => { setDev(null); setFull(false); h('light') }
  const spring = tx({ type: 'spring', stiffness: 400, damping: 30, mass: 0.8 })
  return (
    <div className="zl" style={{ position: 'absolute', inset: 0, overflow: 'hidden' }}>
      <DeviceList onOpen={(d) => { setDev(d); setFull(false) }} />
      <AnimatePresence>
        {dev && !full && <motion.div key="bd" className="zl-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={tx({ duration: 0.2 })} onClick={close} />}
        {dev && (
          <LayoutGroup id={`promote-${variant}`}>
            <motion.div key={'sheet' + dev.id} layout={variant === 'B'} className={full ? 'zl-page' : 'zl-sheet'} initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%', transition: tx({ duration: 0.24, ease: EASE.enter }) }} transition={variant === 'B' ? tx({ type: 'spring', duration: knobs.duration, bounce: 0 }) : spring}
              style={{ zIndex: 3, height: full ? '100%' : '72%', borderRadius: full ? 0 : undefined, background: 'var(--surface)' }}>
              {!full && <div className="zl-sheet__grabber" />}
              <motion.div layout="position" style={{ display: 'flex', alignItems: 'center', gap: 8, padding: full ? '16px 16px 8px' : '4px 16px 12px' }}>
                {full && <button onClick={close} className="zl-btn zl-btn--icon" style={{ borderRadius: 999, width: 40, height: 40 }}><Icon name="arrow-left" size={20} /></button>}
                <motion.div layout="position" className={full ? 'zl-title2' : 'zl-headline'} style={{ flex: 1 }}>{t(dev.name)}</motion.div>
                {!full && <button onClick={() => { setFull(true); h('medium') }} className="zl-btn zl-btn--ghost" style={{ height: 36 }}>{t({ en: 'Open details', he: 'פתיחת פרטים' })}</button>}
              </motion.div>
              <SheetBody dev={dev} t={t} />
              <AnimatePresence>
                {full && (
                  <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={tx({ duration: 0.28, delay: 0.1, ease: EASE.out })} style={{ padding: '0 16px' }}>
                    <div className="zl-stack">
                      {[['Room', 'Living Room'], ['Kind', 'Light'], ['Signal', 'Strong']].map(([k, v]) => <Card key={k} style={{ display: 'flex', justifyContent: 'space-between' }}><span className="zl-mute">{k}</span><span style={{ fontWeight: 500 }}>{v}</span></Card>)}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          </LayoutGroup>
        )}
      </AnimatePresence>
      {variant === 'A' && dev && !full && <div className="ml-hint">Tap "Open details": today the sheet holds 120ms then dissolves while the page fades in.</div>}
      {variant === 'B' && dev && !full && <div className="ml-hint">Tap "Open details": the sheet itself grows into the page; the title travels.</div>}
    </div>
  )
}

/* ───────────────────────── SWIPE BACK ───────────────────────── */

function SwipeBack({ knobs, tx, rtl }) {
  const [open, setOpen] = useState(true)
  const t = useT(); const h = useHaptic()
  const x = useMotionValue(0)
  const W = 390
  const sign = rtl ? -1 : 1
  const under = useTransform(x, (v) => (v * sign / W) * (knobs.parallax * W) * sign - knobs.parallax * W * sign)
  const scrim = useTransform(x, (v) => 0.35 * (1 - Math.abs(v) / W))
  const dragging = useRef(false)
  const start = useRef(0)
  const vel = useRef({ last: 0, t: 0, v: 0 })
  const onDown = (e) => {
    const stage = e.currentTarget.getBoundingClientRect()
    const edge = rtl ? stage.right - e.clientX : e.clientX - stage.left
    if (edge > 32) return
    dragging.current = true; start.current = e.clientX; vel.current = { last: e.clientX, t: performance.now(), v: 0 }
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  const onMove = (e) => {
    if (!dragging.current) return
    const dx = (e.clientX - start.current) * sign
    const now = performance.now(); const dt = Math.max(1, now - vel.current.t)
    vel.current.v = vel.current.v * 0.5 + ((e.clientX - vel.current.last) * sign / dt) * 500
    vel.current.last = e.clientX; vel.current.t = now
    x.set(dx > 0 ? dx * sign : dx * 0.18 * sign)
  }
  const onUp = () => {
    if (!dragging.current) return
    dragging.current = false
    const dx = x.get() * sign
    if (dx > W * 0.3 || vel.current.v > 500) {
      animate(x, W * sign, tx({ duration: 0.24, ease: EASE.out })).then(() => { setOpen(false); h('medium') })
    } else animate(x, 0, tx({ type: 'spring', duration: 0.36, bounce: 0.1 }))
  }
  useEffect(() => { if (open) x.set(0) }, [open, x])
  return (
    <div className="zl" style={{ position: 'absolute', inset: 0, overflow: 'hidden' }}>
      <motion.div style={{ x: open ? under : 0, position: 'absolute', inset: 0 }}>
        <RoomsScreen onOpen={() => { setOpen(true) }} />
        <motion.div style={{ opacity: open ? scrim : 0, position: 'absolute', inset: 0, background: '#000', pointerEvents: 'none' }} />
      </motion.div>
      {open && (
        <motion.div style={{ x, position: 'absolute', inset: 0, zIndex: 2, background: 'var(--bg)', boxShadow: '-12px 0 40px rgba(0,0,0,.18)', touchAction: 'pan-y' }}
          onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
          <RoomScreen room={ROOMS[0]} onBack={() => { animate(x, W * sign, tx({ duration: 0.24, ease: EASE.out })).then(() => setOpen(false)) }} />
          <div className="ml-hint">drag from the {rtl ? 'right' : 'left'} edge · commit past 30% or a flick</div>
        </motion.div>
      )}
    </div>
  )
}

/* ───────────────────────── SECTION ───────────────────────── */

export default function PageTransitions() {
  return (
    <>
      <SectionIntro
        title="Page transitions"
        lede="A page change is a change of context. The new page should come from somewhere, and the old one should go somewhere. Today every route is enter-only: the old page vanishes in the same commit the new one mounts."
        found={[
          'Forward: 340ms fade + 8px rise on the new page; back: 260ms fade + 1.2% scale. No exit anywhere (AppShell.jsx:306-333 records two failed exit handshakes that black-screened the app).',
          'Room tile → room hero is a WAAPI FLIP (morph.js), deliberately not layoutId; 560ms in, 460ms back, gated on a 700ms freshness window.',
          'Device detail is presented as a sheet over the list (72%/100% detents); promoting to the page holds 120ms then dissolves 160ms; the page fades in underneath.',
          'Swipe-back exists on detail routes (30% or 500px/s) but the under-page does not move; the seam after commit snaps.',
          'The Controls/Info tab switch on a device page is a hard subtree swap; the page height jumps.',
          'A cold visit to a lazy route plays the page-enter on an empty 60vh placeholder, then the content pops in without motion.',
        ]}
      />

      <Demo id="push" title="List → detail (push / pop)" purpose="Where did this page come from, and how do I get back?" inZiggy={['AppShell.jsx [data-motion-enter]', 'motion.css zm-page-in / zm-page-back', 'morph.js']}
        knobs={[
          { key: 'duration', label: 'Duration', min: 0.2, max: 0.9, step: 0.02, value: 0.42, unit: 'ms' },
          { key: 'bounce', label: 'Bounce (C)', min: 0, max: 0.3, step: 0.02, value: 0 },
          { key: 'parallax', label: 'Under-page parallax (B)', min: 0, max: 0.5, step: 0.05, value: 0.3 },
        ]}
        recommend="C"
        variants={[
          { key: 'A', label: 'Rise + fade (today)', note: 'Enter only. Nothing leaves. Back is a 1.2% scale settle.', render: (p) => <PushA {...p} /> },
          { key: 'B', label: 'iOS parallax push', note: 'The detail slides in from the trailing edge over the list, which recedes 30% and dims. Pop reverses. Spatial: detail is "to the right" of the list.', tradeoff: 'Needs both pages mounted for ~400ms. Two-page exit handshake is the thing that once black-screened the app; this version has no `mode="wait"` and both pages are absolutely positioned.', render: (p) => <PushB {...p} /> },
          { key: 'C', label: 'Shared element (tile → hero)', note: 'The tile\'s photo and name ARE the hero\'s photo and name (layoutId). Everything else fades behind the travel. Bidirectional by construction.', tradeoff: 'framer layoutId across routes needs a LayoutGroup above the router and both screens in one AnimatePresence; the app chose a FLIP to avoid the handshake.', render: (p) => <PushC {...p} /> },
          { key: 'D', label: 'Container transform', note: 'The tile\'s rectangle grows to fill the screen (clip-path inset), the photo fills it, then the page content fades in. Material-style; one object throughout.', tradeoff: 'clip-path animates on the compositor, but the page underneath must stay mounted.', render: (p) => <PushD {...p} /> },
          { key: 'E', label: 'Blur crossfade', note: 'Both pages crossfade with a 3px blur and a 2% scale, 220ms. No spatial claim; the blur hides the double exposure.', render: (p) => <PushE {...p} /> },
        ]} />

      <Demo id="tabs" title="Tab content switch" purpose="Same page, different facet. The content should move sideways, not vanish." inZiggy={['DeviceDetail.jsx Controls/Info', 'Actions.jsx Automatic/On-demand']}
        knobs={[{ key: 'duration', label: 'Duration', min: 0.12, max: 0.6, step: 0.02, value: 0.26, unit: 'ms' }]}
        recommend="B"
        variants={[
          { key: 'A', label: 'Cut (today)', note: 'The pill slides; the content does not.', render: (p) => <TabsDemo {...p} variant="A" /> },
          { key: 'B', label: 'Directional slide + height', note: 'Content slides 24px in the direction of the tab change; the container animates its height so the page below does not jump.', render: (p) => <TabsDemo {...p} variant="B" /> },
          { key: 'C', label: 'Blur crossfade', note: 'No direction; 3px blur crossfade with a 4px rise. Quieter, still tells you something changed.', render: (p) => <TabsDemo {...p} variant="C" /> },
        ]} />

      <Demo id="promote" title="Sheet → page promotion" purpose="A sheet that becomes the page should grow into it, not be replaced by it." inZiggy={['motion/DeviceSheet.jsx', 'SheetSurface.jsx handoff', 'App.jsx _TRAIL_MS']}
        knobs={[{ key: 'duration', label: 'Grow duration (B)', min: 0.2, max: 0.8, step: 0.02, value: 0.42, unit: 'ms' }]}
        recommend="B"
        variants={[
          { key: 'A', label: 'Dissolve handoff (today)', note: 'Tap a device, then "Open details". The sheet is replaced by the page.', render: (p) => <SheetPromote {...p} variant="A" /> },
          { key: 'B', label: 'Sheet grows into the page', note: 'The same panel animates to full height; corners square off; the title travels from the sheet header to the page title; extra sections fade in below.', tradeoff: 'The sheet and the page must be one component tree (or share layoutIds). Today they are separate chunks.', render: (p) => <SheetPromote {...p} variant="B" /> },
        ]} />

      <Demo id="swipe-back" title="Swipe back with an under-page" purpose="The page under your thumb should reveal the page you came from, already moving." inZiggy={['gestures.js useSwipeBack', 'AppShell.jsx:216']}
        knobs={[{ key: 'parallax', label: 'Under-page parallax', min: 0, max: 0.5, step: 0.05, value: 0.3 }]}
        variants={[{ key: 'A', label: 'Edge drag + parallax', note: 'Drag from the leading edge. The list underneath slides from −30% to 0 and brightens as you go. Commit past 30% or a 500px/s flick; otherwise it springs back.', render: (p) => <SwipeBack {...p} /> }]} />
    </>
  )
}
