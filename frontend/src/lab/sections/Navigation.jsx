// Motion Lab — NAVIGATION
// The bottom nav (phone) and sidebar (desktop) active state, the More menu,
// and the nav's behaviour on scroll.
import { useState, useRef, useEffect, useLayoutEffect, useCallback, useId } from 'react'
import { motion, AnimatePresence, LayoutGroup, useMotionValue, useSpring, useTransform, animate } from 'framer-motion'
import { Demo } from '../ui/Demo'
import { SectionIntro } from '../ui/Section'
import { Icon, Page, Card, useT } from '../ziggy/primitives'
import { useHaptic } from '../LabContext'
import { EASE, cssEase } from '../time'
import { NAV, ROOMS, COPY } from '../mock/home'

const TABS = NAV.slice(0, 4).concat([{ key: 'more', label: { en: 'More', he: 'עוד' }, icon: 'settings' }])

const clamp01 = (v) => Math.max(0, Math.min(1, v))
const smooth = (v) => v * v * (3 - 2 * v)

function useMeasuredCells(active, deps = []) {
  // measures the active cell's rect relative to the nav (RTL-safe)
  const navRef = useRef(null)
  const [rect, setRect] = useState(null)
  useLayoutEffect(() => {
    const nav = navRef.current
    if (!nav) return
    const cell = nav.querySelector(`[data-cell="${active}"]`)
    if (!cell) return
    const n = nav.getBoundingClientRect(); const c = cell.getBoundingClientRect()
    setRect({ x: c.left - n.left, w: c.width, y: c.top - n.top, h: c.height })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, ...deps])
  return [navRef, rect]
}

// physical (left-based) centre of a cell, so it is correct in both directions
function measureCentre(nav, key) {
  if (!nav) return null
  const cell = nav.querySelector(`[data-cell="${key}"]`)
  if (!cell) return null
  const n = nav.getBoundingClientRect(); const c = cell.getBoundingClientRect()
  return c.left - n.left + c.width / 2
}

function PageBody({ tab }) {
  const t = useT()
  const titles = { home: COPY.greeting, rooms: { en: 'Rooms', he: 'חדרים' }, devices: { en: 'Devices', he: 'מכשירים' }, actions: { en: 'Actions', he: 'פעולות' }, more: { en: 'More', he: 'עוד' } }
  return (
    <Page title={t(titles[tab] || titles.home)}>
      <div className="zl-stack">
        {ROOMS.slice(0, 4).map(r => <Card key={r.id}><div className="zl-row__title">{t(r.name)}</div><div className="zl-row__sub">{r.lightsOn > 0 ? t(COPY.lightsOn, r.lightsOn) : t(COPY.allOff)}</div></Card>)}
      </div>
    </Page>
  )
}

function NavShell({ active, onChange, children, renderItem, navRef, style }) {
  const t = useT(); const h = useHaptic()
  return (
    <nav ref={navRef} className="zl zl-nav" style={style}>
      {children}
      {TABS.map((tab, i) => (
        <button key={tab.key} data-cell={tab.key} className="zl-nav__item" aria-current={active === tab.key ? 'page' : undefined}
          onClick={() => { if (active !== tab.key) { h('light'); onChange(tab.key, i) } }}>
          {renderItem ? renderItem(tab, active === tab.key) : (<><Icon name={tab.icon} size={22} strokeWidth={active === tab.key ? 2.2 : 1.7} /><span>{t(tab.label)}</span></>)}
        </button>
      ))}
    </nav>
  )
}

/* A — sliding pill (layoutId) */
function NavA({ knobs, tx }) {
  const [active, setActive] = useState('home')
  const t = useT()
  return (
    <div className="zl" style={{ position: 'absolute', inset: 0 }}>
      <PageBody tab={active} />
      <LayoutGroup id="nav-a">
        <NavShell active={active} onChange={setActive}
          renderItem={(tab, isActive) => (
            <>
              {isActive && <motion.span layoutId="nav-a-pill" transition={tx({ type: 'spring', duration: knobs.duration, bounce: knobs.bounce })} style={{ position: 'absolute', top: 6, width: 56, height: 30, borderRadius: 999, background: 'var(--accent-2)' }} />}
              <span style={{ position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
                <Icon name={tab.icon} size={22} strokeWidth={isActive ? 2.2 : 1.7} />
                <span>{t(tab.label)}</span>
              </span>
            </>
          )} />
      </LayoutGroup>
    </div>
  )
}

/* B — elastic indicator: ONE object. A single 0→1 progress spring drives both
   edges: the leading edge leaves first and reaches the new centre, the
   trailing edge follows `lag` behind, so the bar stretches from the old
   centre to the new one and then contracts onto it. Overshoot past 1 moves
   the whole bar together, so a bouncy spring still reads as one mass. */
function NavB({ knobs, tx, reduced, rtl }) {
  const [active, setActive] = useState('home')
  const [navRef, rect] = useMeasuredCells(active, [rtl])
  const p = useMotionValue(1)
  const seg = useRef({ from: null, to: null })
  const lagRef = useRef(0)
  lagRef.current = Math.min(0.5, knobs.stretch * 0.5)
  const lastActive = useRef(null)

  const geom = useTransform(p, (pv) => {
    const { from, to } = seg.current
    if (from == null) return { left: -100, width: 28 }
    const lag = lagRef.current
    const den = Math.max(0.001, 1 - lag)
    const over = Math.max(0, pv - 1)
    const lead = smooth(clamp01(pv / den)) + over
    const trail = smooth(clamp01((pv - lag) / den)) + over
    const d = to - from
    const a = from + d * lead, b = from + d * trail
    const lo = Math.min(a, b), hi = Math.max(a, b)
    return { left: lo - 14, width: hi - lo + 28 }
  })
  const left = useTransform(geom, (g) => g.left)
  const width = useTransform(geom, (g) => g.width)

  useEffect(() => {
    if (!rect) return
    const centre = rect.x + rect.w / 2
    const changed = lastActive.current !== null && lastActive.current !== active
    lastActive.current = active
    if (!changed || reduced) { seg.current = { from: centre, to: centre }; p.set(1); return }
    // start from where the bar visually is now (its centre), so a mid-flight tap does not jump
    const g = geom.get()
    seg.current = { from: g.left + g.width / 2, to: centre }
    p.set(0)
    const ctrl = animate(p, 1, tx({ type: 'spring', duration: knobs.duration, bounce: knobs.bounce }))
    return () => ctrl.stop()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rect])

  return (
    <div className="zl" style={{ position: 'absolute', inset: 0 }}>
      <PageBody tab={active} />
      <NavShell navRef={navRef} active={active} onChange={setActive}>
        <motion.span style={{ position: 'absolute', top: 0, left, width, height: 3, borderRadius: 3, background: 'var(--accent)' }} />
      </NavShell>
    </div>
  )
}

/* C — icon lifts and the label appears only for the active item */
function NavC({ knobs, tx }) {
  const [active, setActive] = useState('home')
  const t = useT()
  return (
    <div className="zl" style={{ position: 'absolute', inset: 0 }}>
      <PageBody tab={active} />
      <NavShell active={active} onChange={setActive}
        renderItem={(tab, isActive) => (
          <motion.span animate={{ y: isActive ? -3 : 3 }} transition={tx({ type: 'spring', duration: knobs.duration, bounce: knobs.bounce })} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
            <motion.span animate={{ scale: isActive ? 1.18 : 1, color: isActive ? 'var(--accent-text)' : 'var(--ink-mute)' }} transition={tx({ type: 'spring', duration: knobs.duration, bounce: knobs.bounce })} style={{ display: 'grid' }}>
              <Icon name={tab.icon} size={22} strokeWidth={isActive ? 2.3 : 1.7} />
            </motion.span>
            <motion.span animate={{ opacity: isActive ? 1 : 0, y: isActive ? 0 : 4 }} transition={tx({ duration: 0.18, ease: EASE.out })} style={{ fontSize: 11, fontWeight: 600, height: 13 }}>{t(tab.label)}</motion.span>
          </motion.span>
        )} />
    </div>
  )
}

/* D — magnetic indicator: follows a hovering pointer / pan with a spring, snaps on tap */
function NavD({ knobs, tx }) {
  const [active, setActive] = useState('home')
  const [navRef, rect] = useMeasuredCells(active)
  const raw = useMotionValue(0)
  const x = useSpring(raw, tx({ stiffness: 320, damping: 26, mass: 0.6 }))
  const hovering = useRef(false)
  useEffect(() => { if (rect && !hovering.current) raw.set(rect.x + rect.w / 2 - 28) }, [rect, raw])
  return (
    <div className="zl" style={{ position: 'absolute', inset: 0 }}>
      <PageBody tab={active} />
      <NavShell navRef={navRef} active={active} onChange={setActive}
        style={{ touchAction: 'none' }}>
        <motion.span style={{ x, position: 'absolute', top: 6, left: 0, width: 56, height: 30, borderRadius: 999, background: 'var(--accent-2)', pointerEvents: 'none' }} />
        <span style={{ position: 'absolute', inset: 0 }}
          onPointerMove={(e) => { hovering.current = true; const n = navRef.current.getBoundingClientRect(); raw.set(Math.max(4, Math.min(n.width - 60, e.clientX - n.left - 28))) }}
          onPointerLeave={() => { hovering.current = false; if (rect) raw.set(rect.x + rect.w / 2 - 28) }}
          onPointerUp={(e) => { const n = navRef.current.getBoundingClientRect(); const idx = Math.floor(((e.clientX - n.left) / n.width) * TABS.length); const dirIdx = navRef.current.closest('[dir=rtl]') ? TABS.length - 1 - idx : idx; const tab = TABS[Math.max(0, Math.min(TABS.length - 1, dirIdx))]; hovering.current = false; setActive(tab.key) }}
          onPointerDown={(e) => e.currentTarget.setPointerCapture(e.pointerId)} />
      </NavShell>
      <div className="ml-hint" style={{ bottom: 62 }}>hover / drag along the bar, release to choose</div>
    </div>
  )
}

/* E — minimal Apple: no travel; icon fill crossfades and the label weight changes */
function NavE({ knobs, tx }) {
  const [active, setActive] = useState('home')
  const t = useT()
  return (
    <div className="zl" style={{ position: 'absolute', inset: 0 }}>
      <PageBody tab={active} />
      <NavShell active={active} onChange={setActive}
        renderItem={(tab, isActive) => (
          <>
            <span style={{ position: 'relative', width: 24, height: 24, display: 'grid', placeItems: 'center' }}>
              <motion.span animate={{ opacity: isActive ? 0 : 1 }} transition={tx({ duration: 0.16 })} style={{ position: 'absolute' }}><Icon name={tab.icon} size={22} strokeWidth={1.7} /></motion.span>
              <motion.span animate={{ opacity: isActive ? 1 : 0, scale: isActive ? 1 : 0.9 }} transition={tx({ duration: 0.16, ease: EASE.out })} style={{ position: 'absolute', color: 'var(--accent-text)' }}><Icon name={tab.icon} size={22} strokeWidth={2.4} fill="var(--accent-2)" /></motion.span>
            </span>
            <span style={{ fontWeight: isActive ? 600 : 500, transition: `color calc(160ms * var(--lab-speed,1))` }}>{t(tab.label)}</span>
          </>
        )} />
    </div>
  )
}

/* F — liquid pill: a gooey SVG layer under the tabs. The old spot shrinks
   while the new one grows and a small drop travels between them; the
   blur + alpha-threshold filter fuses them into one mass that pinches off. */
function NavF({ tx, reduced, rtl }) {
  const [active, setActive] = useState('home')
  const navRef = useRef(null)
  const gooId = 'goo' + useId().replace(/[^a-zA-Z0-9]/g, '')
  const p = useMotionValue(1)
  const from = useMotionValue(-100)
  const to = useMotionValue(-100)
  const prevKey = useRef('home')

  useLayoutEffect(() => {
    const nav = navRef.current
    const a = measureCentre(nav, prevKey.current); const b = measureCentre(nav, active)
    if (a == null || b == null) return
    const same = prevKey.current === active
    prevKey.current = active
    if (same || reduced) { from.set(b); to.set(b); p.set(1); return }
    // if a previous trip is mid-flight, depart from where the drop is now
    const cur = from.get() + (to.get() - from.get()) * clamp01(p.get())
    from.set(cur); to.set(b); p.set(0)
    const ctrl = animate(p, 1, tx({ duration: 0.46, ease: EASE.glide }))
    return () => ctrl.stop()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, rtl])

  const rOld = useTransform(p, (v) => 14 * (1 - clamp01(v)))
  const rNew = useTransform(p, (v) => 14 * clamp01(v))
  const cxDrop = useTransform([from, to, p], ([f, t, v]) => f + (t - f) * clamp01(v))
  const rDrop = useTransform(p, (v) => 7 * Math.sin(Math.PI * clamp01(v)))

  return (
    <div className="zl" style={{ position: 'absolute', inset: 0 }}>
      <PageBody tab={active} />
      <NavShell navRef={navRef} active={active} onChange={setActive}>
        <svg aria-hidden style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none', overflow: 'visible' }}>
          <defs>
            <filter id={gooId} filterUnits="userSpaceOnUse" x="0" y="0" width="100%" height="100%">
              <feGaussianBlur in="SourceGraphic" stdDeviation="6" result="blur" />
              <feColorMatrix in="blur" type="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 18 -7" />
            </filter>
          </defs>
          <g filter={`url(#${gooId})`} fill="var(--accent-2)">
            <motion.circle cx={from} cy={21} r={rOld} />
            <motion.circle cx={cxDrop} cy={21} r={rDrop} />
            <motion.circle cx={to} cy={21} r={rNew} />
          </g>
        </svg>
      </NavShell>
    </div>
  )
}

/* G — underline writes: a 2px line at the top of the bar. The tip draws from
   the old tab to the new one like a pen stroke; then the tail retracts. */
function NavG({ tx, reduced, rtl }) {
  const [active, setActive] = useState('home')
  const navRef = useRef(null)
  const t = useT()
  const L = useMotionValue(-100)
  const R = useMotionValue(-100)
  const prevKey = useRef('home')

  useLayoutEffect(() => {
    const nav = navRef.current
    const b = measureCentre(nav, active)
    if (b == null) return
    const same = prevKey.current === active
    prevKey.current = active
    if (same || reduced) { L.set(b - 14); R.set(b + 14); return }
    const goingRight = b > (L.get() + R.get()) / 2
    const tip = goingRight ? R : L
    const tail = goingRight ? L : R
    let cancelled = false
    let retract
    const draw = animate(tip, goingRight ? b + 14 : b - 14, tx({ duration: 0.38, ease: EASE.out }))
    draw.then(() => {
      if (cancelled) return
      retract = animate(tail, goingRight ? b - 14 : b + 14, tx({ duration: 0.2, ease: EASE.out }))
    })
    return () => { cancelled = true; draw.stop(); retract?.stop() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, rtl])

  return (
    <div className="zl" style={{ position: 'absolute', inset: 0 }}>
      <PageBody tab={active} />
      <NavShell navRef={navRef} active={active} onChange={setActive}
        renderItem={(tab, isActive) => (
          <>
            <Icon name={tab.icon} size={22} strokeWidth={isActive ? 2.2 : 1.7} />
            <span style={{ position: 'relative', display: 'grid', height: 13 }}>
              <motion.span animate={{ opacity: isActive ? 0 : 1 }} transition={tx({ duration: 0.2 })} style={{ gridArea: '1 / 1', fontWeight: 500 }}>{t(tab.label)}</motion.span>
              <motion.span animate={{ opacity: isActive ? 1 : 0 }} transition={tx({ duration: 0.2 })} style={{ gridArea: '1 / 1', fontWeight: 700 }}>{t(tab.label)}</motion.span>
            </span>
          </>
        )}>
        <svg aria-hidden style={{ position: 'absolute', top: -1, left: 0, width: '100%', height: 4, pointerEvents: 'none', overflow: 'visible' }}>
          <motion.line x1={L} x2={R} y1={1} y2={1} stroke="var(--accent)" strokeWidth={2} strokeLinecap="round" />
        </svg>
      </NavShell>
    </div>
  )
}

/* H — depth: no travelling object. The active tab comes forward, the
   others recede. Hierarchy is stated in z, not in x. */
function NavH({ tx }) {
  const [active, setActive] = useState('home')
  const t = useT()
  const spring = tx({ type: 'spring', duration: 0.42, bounce: 0.15 })
  return (
    <div className="zl" style={{ position: 'absolute', inset: 0 }}>
      <PageBody tab={active} />
      <NavShell active={active} onChange={setActive}
        renderItem={(tab, isActive) => (
          <motion.span animate={{ scale: isActive ? 1 : 0.94, opacity: isActive ? 1 : 0.65 }} transition={spring} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
            {/* the shadow gets a tween: a bouncy spring would push the blur radius below 0, which the browser rejects */}
            <motion.span animate={{ scale: isActive ? 1.16 : 1, y: isActive ? -2 : 0, filter: isActive ? 'drop-shadow(0 4px 5px rgba(0,0,0,.22))' : 'drop-shadow(0 0px 0px rgba(0,0,0,0))' }} transition={{ ...spring, filter: tx({ duration: 0.24, ease: EASE.out }) }} style={{ display: 'grid' }}>
              <Icon name={tab.icon} size={22} strokeWidth={isActive ? 2.2 : 1.7} />
            </motion.span>
            <span style={{ fontWeight: isActive ? 600 : 500 }}>{t(tab.label)}</span>
          </motion.span>
        )} />
    </div>
  )
}

/* ───────────────────────── MORE MENU ───────────────────────── */

const MORE_ITEMS = [
  { key: 'alerts', icon: 'bell', label: { en: 'Alerts', he: 'התראות' } },
  { key: 'people', icon: 'users', label: { en: 'People', he: 'אנשים' } },
  { key: 'settings', icon: 'settings', label: { en: 'Settings', he: 'הגדרות' } },
]

function MoreFrame({ open, setOpen, children, hint }) {
  const t = useT(); const h = useHaptic()
  return (
    <div className="zl" style={{ position: 'absolute', inset: 0 }}>
      <PageBody tab="home" />
      {children}
      <nav className="zl-nav">
        {TABS.map(tab => (
          <button key={tab.key} data-cell={tab.key} className="zl-nav__item" aria-current={tab.key === 'home' ? 'page' : undefined}
            onClick={() => { h('light'); if (tab.key === 'more') setOpen(o => !o) }}>
            {tab.key === 'more' && open ? <span data-more-trigger style={{ display: 'contents' }} /> : null}
            <Icon name={tab.icon} size={22} strokeWidth={tab.key === 'home' ? 2.2 : 1.7} /><span>{t(tab.label)}</span>
          </button>
        ))}
      </nav>
      <div className="ml-hint" style={{ bottom: 62 }}>{hint}</div>
    </div>
  )
}

function MoreA({ knobs, tx }) {
  // today: enter only, exit is a cut
  const [open, setOpen] = useState(false)
  const t = useT()
  return (
    <MoreFrame open={open} setOpen={setOpen} hint="Tap More. Opening animates; closing cuts (as shipped).">
      {open && <div className="zl-backdrop" onClick={() => setOpen(false)} style={{ animation: `mlFade calc(160ms * var(--lab-speed,1)) ${cssEase('std')}` }} />}
      {open && (
        <div className="zl-card" style={{ position: 'absolute', bottom: 64, insetInlineEnd: 8, width: 200, padding: 6, transformOrigin: '90% 100%', animation: `mlMoreIn calc(200ms * var(--lab-speed,1)) ${cssEase('out')}` }}>
          {MORE_ITEMS.map(m => <button key={m.key} className="zl-row" style={{ width: '100%', border: 0, background: 'transparent', cursor: 'pointer', borderRadius: 10 }} onClick={() => setOpen(false)}><Icon name={m.icon} size={18} /><span className="zl-row__title" style={{ fontWeight: 500 }}>{t(m.label)}</span></button>)}
        </div>
      )}
      <style>{`@keyframes mlMoreIn{from{opacity:0;transform:scale(.96)}to{opacity:1;transform:none}}@keyframes mlFade{from{opacity:0}}`}</style>
    </MoreFrame>
  )
}

function MoreB({ knobs, tx }) {
  // origin-aware, with an exit that is faster than the enter
  const [open, setOpen] = useState(false)
  const t = useT()
  return (
    <MoreFrame open={open} setOpen={setOpen} hint="Opens from the More tab's corner; closes back into it, faster.">
      <AnimatePresence>
        {open && (
          <>
            <motion.div key="bd" className="zl-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={tx({ duration: 0.16 })} onClick={() => setOpen(false)} />
            <motion.div key="menu" className="zl-card" initial={{ opacity: 0, scale: 0.92, y: 6 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.94, y: 4, transition: tx({ duration: 0.12, ease: EASE.out }) }}
              transition={tx({ type: 'spring', duration: knobs.duration, bounce: knobs.bounce })}
              style={{ position: 'absolute', bottom: 64, insetInlineEnd: 8, width: 200, padding: 6, transformOrigin: '90% 100%' }}>
              {MORE_ITEMS.map(m => <button key={m.key} className="zl-row" style={{ width: '100%', border: 0, background: 'transparent', cursor: 'pointer', borderRadius: 10 }} onClick={() => setOpen(false)}><Icon name={m.icon} size={18} /><span className="zl-row__title" style={{ fontWeight: 500 }}>{t(m.label)}</span></button>)}
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </MoreFrame>
  )
}

function MoreC({ knobs, tx }) {
  // the items fan out of the trigger, staggered; the trigger's icon rotates into an X
  const [open, setOpen] = useState(false)
  const t = useT()
  return (
    <MoreFrame open={open} setOpen={setOpen} hint="Items fan out of the tab one by one; closing reverses the order.">
      <AnimatePresence>
        {open && (
          <>
            <motion.div key="bd" className="zl-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={tx({ duration: 0.16 })} onClick={() => setOpen(false)} />
            <div key="stack" style={{ position: 'absolute', bottom: 66, insetInlineEnd: 12, display: 'flex', flexDirection: 'column-reverse', gap: 8, alignItems: 'flex-end' }}>
              {MORE_ITEMS.map((m, i) => (
                <motion.button key={m.key} className="zl-card" initial={{ opacity: 0, y: 16, scale: 0.9 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 12, scale: 0.9, transition: tx({ duration: 0.12, delay: (MORE_ITEMS.length - 1 - i) * 0.03 }) }}
                  transition={tx({ type: 'spring', duration: knobs.duration, bounce: knobs.bounce, delay: i * knobs.stagger })}
                  onClick={() => setOpen(false)}
                  style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', cursor: 'pointer', transformOrigin: '100% 100%', boxShadow: 'var(--shadow-md)' }}>
                  <span className="zl-row__title" style={{ fontWeight: 500 }}>{t(m.label)}</span><Icon name={m.icon} size={18} />
                </motion.button>
              ))}
            </div>
          </>
        )}
      </AnimatePresence>
    </MoreFrame>
  )
}

/* D — the More tab cell IS the sheet. Its surface (layoutId) grows upward into
   a small sheet anchored at the bottom; the settings glyph turns 45° into an
   X; items arrive after the surface has; closing reverses into the tab. */
// Each copy mounts in the OTHER state and rotates 45° into its own, so the
// gear turns into the X on open and the X turns back on close. `fromOther`
// is false on first paint so the page does not open with a stray rotation.
function MoreIconMorph({ open, tx, fromOther = true }) {
  const f = tx({ duration: 0.2, ease: EASE.out })
  const gear = { rotate: open ? 45 : 0, opacity: open ? 0 : 1 }
  const x = { rotate: open ? 0 : -45, opacity: open ? 1 : 0 }
  const gearFrom = { rotate: open ? 0 : 45, opacity: open ? 1 : 0 }
  const xFrom = { rotate: open ? -45 : 0, opacity: open ? 0 : 1 }
  return (
    <span style={{ position: 'relative', width: 24, height: 24, display: 'grid', placeItems: 'center' }}>
      <motion.span initial={fromOther ? gearFrom : false} animate={gear} transition={f} style={{ position: 'absolute', display: 'grid' }}><Icon name="settings" size={22} strokeWidth={1.7} /></motion.span>
      <motion.span initial={fromOther ? xFrom : false} animate={x} transition={f} style={{ position: 'absolute', display: 'grid' }}><Icon name="x" size={22} strokeWidth={2} /></motion.span>
    </span>
  )
}

function MoreD({ tx }) {
  const [open, setOpen] = useState(false)
  const touched = useRef(false)
  const t = useT(); const h = useHaptic()
  const grow = tx({ type: 'spring', duration: 0.42, bounce: 0.1 })
  const shrink = tx({ duration: 0.18, ease: EASE.out })
  const toggle = () => { touched.current = true; h(open ? 'light' : 'medium'); setOpen(o => !o) }
  return (
    <div className="zl" style={{ position: 'absolute', inset: 0 }}>
      <PageBody tab="home" />
      <LayoutGroup id="more-d">
        <nav className="zl-nav">
          {TABS.map(tab => {
            const isMore = tab.key === 'more'
            return (
              <button key={tab.key} data-cell={tab.key} className="zl-nav__item" aria-current={tab.key === 'home' ? 'page' : undefined}
                onClick={() => { if (isMore) toggle(); else h('light') }}>
                {isMore && !open && <motion.span layoutId="more-d-surface" transition={shrink} style={{ position: 'absolute', inset: '8px 10px', borderRadius: 12, background: 'var(--surface-2)' }} />}
                <span style={{ position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
                  {isMore && !open ? <motion.span layoutId="more-d-icon" transition={shrink} style={{ display: 'grid' }}><MoreIconMorph open={false} tx={tx} fromOther={touched.current} /></motion.span> : <Icon name={tab.icon} size={22} strokeWidth={tab.key === 'home' ? 2.2 : 1.7} />}
                  <span>{t(tab.label)}</span>
                </span>
              </button>
            )
          })}
        </nav>
        <AnimatePresence>
          {open && (
            <>
              <motion.div key="bd" className="zl-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: tx({ duration: 0.14 }) }} transition={tx({ duration: 0.2 })} onClick={toggle} style={{ zIndex: 2 }} />
              <motion.div key="sheet" layoutId="more-d-surface" transition={grow}
                style={{ position: 'absolute', bottom: 0, insetInline: 8, height: 224, zIndex: 3, borderRadius: '20px 20px 0 0', background: 'var(--surface)', boxShadow: 'var(--shadow-lg)', border: '0.5px solid var(--line)', overflow: 'hidden' }}>
                <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 4, transition: tx({ duration: 0.1 }) }} transition={tx({ duration: 0.22, delay: 0.12, ease: EASE.out })} style={{ padding: '14px 10px 0' }}>
                  {MORE_ITEMS.map(m => <button key={m.key} className="zl-row" style={{ width: '100%', border: 0, background: 'transparent', cursor: 'pointer', borderRadius: 10 }} onClick={toggle}><Icon name={m.icon} size={18} /><span className="zl-row__title" style={{ fontWeight: 500 }}>{t(m.label)}</span></button>)}
                </motion.div>
                <button onClick={toggle} aria-label="Close" style={{ position: 'absolute', bottom: 0, insetInlineEnd: 0, width: 78, height: 56, border: 0, background: 'transparent', color: 'var(--ink)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 2, cursor: 'pointer', fontSize: 11, fontWeight: 500 }}>
                  <motion.span layoutId="more-d-icon" transition={grow} style={{ display: 'grid' }}><MoreIconMorph open tx={tx} /></motion.span>
                  <motion.span initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: tx({ duration: 0.1 }) }} transition={tx({ duration: 0.16, delay: 0.12 })}>{t({ en: 'Close', he: 'סגור' })}</motion.span>
                </button>
              </motion.div>
            </>
          )}
        </AnimatePresence>
      </LayoutGroup>
      <div className="ml-hint" style={{ bottom: 62 }}>Tap More: the tab itself grows into the sheet; the gear turns into an X.</div>
    </div>
  )
}

/* ───────────────────────── NAV ON SCROLL ───────────────────────── */

function ScrollFrame({ children, onScrollDir }) {
  const t = useT()
  const last = useRef(0)
  return (
    <div className="zl" style={{ position: 'absolute', inset: 0 }}>
      <div className="zl-page__scroll" style={{ position: 'absolute', inset: 0, paddingBottom: 100 }} onScroll={(e) => {
        const top = e.currentTarget.scrollTop
        const d = top - last.current
        if (top <= 0) onScrollDir('up', top)
        else if (Math.abs(d) > 6) onScrollDir(d > 0 ? 'down' : 'up', top)
        last.current = top
      }}>
        <h1 className="zl-title2 zl-page__title">{t({ en: 'Devices', he: 'מכשירים' })}</h1>
        <div className="zl-stack">
          {Array.from({ length: 14 }).map((_, i) => <Card key={i}><div className="zl-row__title">{t(ROOMS[i % ROOMS.length].name)}</div><div className="zl-row__sub">{t(COPY.lightsOn, (i % 3) + 1)}</div></Card>)}
        </div>
      </div>
      {children}
    </div>
  )
}

function StaticNav({ style, labels = true, iconOnly = false, children }) {
  const t = useT()
  return (
    <nav className="zl zl-nav" style={style}>
      {children}
      {TABS.map(tab => (
        <button key={tab.key} className="zl-nav__item" aria-current={tab.key === 'devices' ? 'page' : undefined}>
          <Icon name={tab.icon} size={22} strokeWidth={tab.key === 'devices' ? 2.2 : 1.7} />
          {!iconOnly && <span style={{ opacity: labels ? 1 : 0, transition: `opacity calc(160ms * var(--lab-speed,1))` }}>{t(tab.label)}</span>}
        </button>
      ))}
    </nav>
  )
}

function ScrollA({ tx }) {
  const [tucked, setTucked] = useState(false)
  return (
    <ScrollFrame onScrollDir={(d, top) => setTucked(d === 'down' && top > 60)}>
      <motion.div animate={{ y: tucked ? '110%' : '0%' }} transition={tx({ duration: 0.26, ease: tucked ? EASE.inOut : EASE.out })} style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 56 }}>
        <StaticNav />
      </motion.div>
    </ScrollFrame>
  )
}

function ScrollB({ tx }) {
  const [condensed, setCondensed] = useState(false)
  return (
    <ScrollFrame onScrollDir={(d, top) => setCondensed(d === 'down' && top > 60)}>
      <motion.div animate={{ height: condensed ? 38 : 56 }} transition={tx({ type: 'spring', duration: 0.4, bounce: 0 })} style={{ position: 'absolute', left: 0, right: 0, bottom: 0, overflow: 'hidden' }}>
        <StaticNav labels={!condensed} style={{ height: '100%' }} />
      </motion.div>
    </ScrollFrame>
  )
}

function ScrollC({ tx }) {
  const [away, setAway] = useState(false)
  return (
    <ScrollFrame onScrollDir={(d, top) => setAway(d === 'down' && top > 60)}>
      <motion.div animate={{ opacity: away ? 0.35 : 1, filter: away ? 'blur(2px)' : 'blur(0px)', scale: away ? 0.98 : 1 }} transition={tx({ duration: 0.3, ease: EASE.out })} style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 56, pointerEvents: away ? 'none' : 'auto' }}>
        <StaticNav />
      </motion.div>
    </ScrollFrame>
  )
}

/* D — collapse to a pill: the bar's surface (layoutId) condenses into one
   floating pill at the bottom centre that shows the current tab and a live
   line. Tap it, or scroll up, and the same surface grows back into the bar. */
function ScrollD({ tx }) {
  const [collapsed, setCollapsed] = useState(false)
  const t = useT(); const h = useHaptic()
  const current = TABS[0]
  const condense = tx({ type: 'spring', duration: 0.5, bounce: 0.14 })
  const expand = tx({ type: 'spring', duration: 0.42, bounce: 0.06 })
  const fadeIn = tx({ duration: 0.16, delay: 0.14 })
  const fadeOut = tx({ duration: 0.1 })
  return (
    <ScrollFrame onScrollDir={(d, top) => setCollapsed(d === 'down' && top > 60)}>
      <LayoutGroup id="scroll-d">
        <AnimatePresence initial={false}>
          {collapsed ? (
            <motion.div key="pill" style={{ position: 'absolute', bottom: 12, insetInline: 0, display: 'flex', justifyContent: 'center', pointerEvents: 'none' }}>
              <motion.button layoutId="scroll-d-surface" transition={condense} onClick={() => { h('light'); setCollapsed(false) }} className="zl"
                style={{ pointerEvents: 'auto', height: 40, padding: '0 16px 0 12px', borderRadius: 999, border: '0.5px solid var(--line)', background: 'color-mix(in srgb, var(--surface) 92%, transparent)', backdropFilter: 'blur(14px)', boxShadow: 'var(--shadow-md)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, color: 'var(--ink)', fontSize: 13, fontWeight: 500, overflow: 'hidden' }}>
                <motion.span initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: fadeOut }} transition={fadeIn} style={{ display: 'flex', alignItems: 'center', gap: 8, whiteSpace: 'nowrap' }}>
                  <span style={{ color: 'var(--accent-text)', display: 'grid' }}><Icon name={current.icon} size={18} strokeWidth={2.2} /></span>
                  <span>{t(current.label)}</span>
                  <span className="zl-mute">·</span>
                  <span className="zl-mute">{t(COPY.lightsOn, 2)}</span>
                </motion.span>
              </motion.button>
            </motion.div>
          ) : (
            <motion.nav key="bar" layoutId="scroll-d-surface" transition={expand} className="zl zl-nav" style={{ borderRadius: 0 }}>
              {TABS.map(tab => (
                <motion.button key={tab.key} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: fadeOut }} transition={fadeIn} className="zl-nav__item" aria-current={tab.key === current.key ? 'page' : undefined}>
                  <Icon name={tab.icon} size={22} strokeWidth={tab.key === current.key ? 2.2 : 1.7} />
                  <span>{t(tab.label)}</span>
                </motion.button>
              ))}
            </motion.nav>
          )}
        </AnimatePresence>
      </LayoutGroup>
      <div className="ml-hint" style={{ bottom: 62, pointerEvents: 'none' }}>scroll down · tap the pill to bring the bar back</div>
    </ScrollFrame>
  )
}

/* ───────────────────────── SIDEBAR ───────────────────────── */

const SIDE = [
  { key: 'home', icon: 'house', label: { en: 'Home', he: 'בית' } },
  { key: 'rooms', icon: 'layout-grid', label: { en: 'Rooms', he: 'חדרים' } },
  { key: 'chat', icon: 'sparkles', label: { en: 'Ask Ziggy', he: 'שאל את זיגי' } },
  { key: 'devices', icon: 'lightbulb', label: { en: 'Devices', he: 'מכשירים' } },
  { key: 'actions', icon: 'zap', label: { en: 'Actions', he: 'פעולות' } },
]

function SidebarDemo({ knobs, tx, variant, rtl }) {
  const [active, setActive] = useState('home')
  const t = useT(); const h = useHaptic()
  const spring = tx({ type: 'spring', duration: knobs.duration, bounce: knobs.bounce })
  // D: the highlight is quick; a blurred copy follows on a softer spring and fades, leaving the path
  const hlSpring = tx({ type: 'spring', stiffness: 380, damping: 32, mass: 1 })
  const trailSpring = tx({ type: 'spring', stiffness: 120, damping: 18, mass: 1 })
  const inward = rtl ? -6 : 6
  return (
    <div className="zl" style={{ position: 'absolute', inset: 0, display: 'flex' }}>
      <LayoutGroup id={`side-${variant}`}>
        <aside style={{ width: 240, borderInlineEnd: '1px solid var(--line)', padding: 12, background: 'var(--bg)' }}>
          <div className="zl-headline" style={{ padding: '8px 12px 16px', display: 'flex', alignItems: 'center', gap: 8 }}><span className="ml-brand__mark" style={{ width: 22, height: 22, fontSize: 12 }}>Z</span> Ziggy</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {SIDE.map(item => {
              const isActive = item.key === active
              return (
                <button key={item.key} onClick={() => { setActive(item.key); h('light') }} style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 10, height: 40, padding: '0 12px', borderRadius: 10, border: 0, background: 'transparent', color: isActive ? 'var(--ink)' : 'var(--ink-mute)', fontWeight: isActive ? 600 : 500, fontSize: 15, cursor: 'pointer', textAlign: 'start' }}>
                  {isActive && (variant === 'A' || variant === 'B') && <motion.span layoutId={`side-hl-${variant}`} transition={variant === 'A' ? tx({ duration: 0.32, ease: EASE.enter }) : spring} style={{ position: 'absolute', inset: 0, borderRadius: 10, background: 'var(--surface-2)', border: '0.5px solid var(--line)' }} />}
                  {isActive && variant === 'C' && <motion.span layoutId={`side-bar-${variant}`} transition={spring} style={{ position: 'absolute', insetInlineStart: 0, top: 8, bottom: 8, width: 3, borderRadius: 3, background: 'var(--accent)' }} />}
                  {isActive && variant === 'D' && (
                    <>
                      <motion.span key={`trail-${active}`} layoutId="side-trail-D" initial={{ opacity: 0.5 }} animate={{ opacity: 0 }} transition={{ ...trailSpring, opacity: tx({ duration: 0.5, delay: 0.25, ease: EASE.out }) }} style={{ position: 'absolute', inset: 0, borderRadius: 10, background: 'var(--accent-2)', filter: 'blur(6px)', pointerEvents: 'none' }} />
                      <motion.span layoutId="side-hl-D" transition={hlSpring} style={{ position: 'absolute', inset: 0, borderRadius: 10, background: 'var(--surface-2)', border: '0.5px solid var(--line)' }} />
                    </>
                  )}
                  {variant === 'E' && <motion.span initial={false} animate={{ scale: isActive ? 1 : 0, opacity: isActive ? 1 : 0 }} transition={spring} style={{ position: 'absolute', insetInlineStart: 2, top: 17, width: 6, height: 6, borderRadius: 999, background: 'var(--accent)' }} />}
                  {variant === 'E' ? (
                    <span style={{ position: 'relative', width: 20, height: 20, display: 'grid', placeItems: 'center' }}>
                      <motion.span initial={false} animate={{ opacity: isActive ? 0 : 1 }} transition={tx({ duration: 0.16 })} style={{ position: 'absolute', display: 'grid' }}><Icon name={item.icon} size={20} strokeWidth={1.7} /></motion.span>
                      <motion.span initial={false} animate={{ opacity: isActive ? 1 : 0, scale: isActive ? 1 : 0.9 }} transition={tx({ duration: 0.16, ease: EASE.out })} style={{ position: 'absolute', display: 'grid', color: 'var(--accent-text)' }}><Icon name={item.icon} size={20} strokeWidth={2.2} fill="var(--accent-2)" /></motion.span>
                    </span>
                  ) : (
                    <motion.span animate={variant === 'B' ? { scale: isActive ? 1.1 : 1, x: isActive ? 2 : 0 } : {}} transition={spring} style={{ position: 'relative', display: 'grid' }}>
                      <Icon name={item.icon} size={20} strokeWidth={isActive ? 2.2 : 1.7} />
                    </motion.span>
                  )}
                  <motion.span initial={false} animate={{ x: variant === 'E' && isActive ? inward : 0 }} transition={spring} style={{ position: 'relative' }}>{t(item.label)}</motion.span>
                </button>
              )
            })}
          </div>
        </aside>
      </LayoutGroup>
      <div style={{ flex: 1, position: 'relative' }}><PageBody tab={active === 'chat' ? 'home' : active} /></div>
    </div>
  )
}

/* ───────────────────────── SECTION ───────────────────────── */

export default function Navigation() {
  return (
    <>
      <SectionIntro
        title="Navigation"
        lede="Navigation motion answers one question: where am I now, and how did I get here? The active state should be one object that moves, not two states that swap."
        found={[
          'Phone bottom nav: the active tab changes stroke width, colour and font weight in one frame. NAV_HL_SURFACE is null, so the indicator element never renders (BottomNav.jsx:140).',
          'Desktop sidebar: a highlight slides between items in 320ms (motion.css:274), but the icon stroke and label weight still cut.',
          'The More menu enters with a 200ms scale but closes as a cut, deliberately, after an AnimatePresence stall trapped taps on cold start (BottomNav.jsx:235-241).',
          'The nav tucks away on scroll-down (translate) and returns at the top; "condense" was never built.',
          'Haptic light fires on every tab tap: the only signal that arrives before the route does.',
        ]}
      />

      <Demo id="nav-active" title="Nav active state" purpose="Which item is current, and that it MOVED there. One object, one journey." principles={['continuity', 'hierarchy', 'restraint']} inZiggy={['components/layout/BottomNav.jsx', 'motion.css [data-motion-nav-hl]']}
        knobs={[
          { key: 'duration', label: 'Duration', min: 0.15, max: 0.9, step: 0.02, value: 0.42, unit: 'ms' },
          { key: 'bounce', label: 'Bounce', min: 0, max: 0.4, step: 0.02, value: 0.18 },
          { key: 'stretch', label: 'Stretch (B)', min: 0, max: 1, step: 0.05, value: 0.55 },
        ]}
        recommend="C"
        variants={[
          { key: 'A', label: 'Sliding pill', note: 'A tinted pill travels between tabs (layoutId). Familiar; the pill is a clear object.', render: (p) => <NavA {...p} /> },
          { key: 'B', label: 'Elastic indicator', note: 'One bar, one spring. The leading edge leaves first and lands on the new centre; the trailing edge follows and contracts onto it, so the bar bridges the two tabs mid-flight. Communicates the distance travelled.', tradeoff: 'Reads as playful; keep stretch ≤0.6 for a home app. A bouncy spring overshoots the whole bar, not just one edge.', render: (p) => <NavB {...p} /> },
          { key: 'C', label: 'Icon lifts, label appears', note: 'The active icon rises and grows; its label surfaces beneath it. No travelling object; the tab itself acknowledges. Still the recommendation: a tab switch happens dozens of times a day, and this is the only variant that stays quiet at that frequency while still marking the change.', render: (p) => <NavC {...p} /> },
          { key: 'D', label: 'Magnetic indicator', note: 'The pill follows a hovering pointer or a pan along the bar with a spring, then snaps to the chosen tab. Desktop delight, mobile gesture.', tradeoff: 'Competes with the swipe-back edge gesture on phones.', render: (p) => <NavD {...p} /> },
          { key: 'E', label: 'Minimal (Apple)', note: 'No travel at all. The outline glyph crossfades into a filled one in 160ms; label weight changes. A tab switch is not a moment.', render: (p) => <NavE {...p} /> },
          { key: 'F', label: 'Liquid pill', note: 'Continuity taken literally: the indicator is one fluid mass. The old spot shrinks as the new one grows and a drop travels between them; a gooey filter fuses them so the blob pinches off like liquid.', tradeoff: 'An SVG filter layer under the bar: cheap at this size, but blur + colour-matrix is not free on a low-end hub tablet.', spec: () => '460 ms · ease glide · feGaussianBlur 6 · alpha 18/−7', render: (p) => <NavF {...p} /> },
          { key: 'G', label: 'Underline writes', note: 'A 2px line at the top of the bar draws from the old tab to the new one like handwriting, then the tail retracts. The stroke shows the route; the label weight crossfades.', spec: () => 'draw 380 ms ease-out · retract 200 ms ease-out · label weight 200 ms', render: (p) => <NavG {...p} /> },
          { key: 'H', label: 'Depth', note: 'No travelling object. The active icon comes forward (scale 1.16, up 2px, soft shadow) while the others recede to 94% and 65%. Hierarchy through depth rather than position.', spec: () => 'spring 420 ms · bounce 0.15', render: (p) => <NavH {...p} /> },
        ]} />

      <Demo id="more-menu" title="More menu" purpose="A menu should come from where it was asked for, and go back there faster than it came." principles={['causality', 'continuity', 'restraint']} inZiggy={['BottomNav.jsx:227-270 MoreTab']}
        knobs={[
          { key: 'duration', label: 'Duration', min: 0.15, max: 0.7, step: 0.02, value: 0.32, unit: 'ms' },
          { key: 'bounce', label: 'Bounce', min: 0, max: 0.4, step: 0.02, value: 0.12 },
          { key: 'stagger', label: 'Stagger (C)', min: 0, max: 0.1, step: 0.005, value: 0.04, unit: 'ms' },
        ]}
        recommend="D"
        variants={[
          { key: 'A', label: 'Enter only (today)', render: (p) => <MoreA {...p} /> },
          { key: 'B', label: 'Origin-aware + fast exit', note: 'transform-origin at the More tab. Exit 120ms vs enter ~320ms. The stall that motivated the cut was a Suspense chunk blocking the thread; in the lab the menu is not gated on a lazy route.', render: (p) => <MoreB {...p} /> },
          { key: 'C', label: 'Fan out', note: 'Three cards fan up out of the tab, 40ms apart; they retract in reverse order. More expressive; still under 400ms total.', render: (p) => <MoreC {...p} /> },
          { key: 'D', label: 'Tab becomes the sheet', note: 'The More cell itself is the surface: it grows upward into a small bottom sheet (layoutId), the gear turns 45° into an X, and the items arrive 120ms after the surface has. Closing reverses into the tab in 180ms. Recommended: the thing you tapped is the thing that opened, which is the strongest cause-and-effect the nav can show.', tradeoff: 'Needs the tab cell and the sheet in one LayoutGroup; the sheet must not be a lazy chunk or the cell would grow into nothing.', spec: () => 'grow spring 420 ms bounce 0.10 · items +120 ms · close 180 ms ease-out', render: (p) => <MoreD {...p} /> },
        ]} />

      <Demo id="nav-scroll" title="Nav on scroll" purpose="Scrolling down is reading; the chrome should get out of the way without vanishing." principles={['restraint', 'state', 'continuity']} inZiggy={['gestures.js useScrollChrome', 'motion.css [data-motion-nav][data-tucked]']}
        recommend="B"
        variants={[
          { key: 'A', label: 'Tuck away (today)', note: 'The bar slides fully off. Returns on any scroll-up or at the top.', render: (p) => <ScrollA {...p} /> },
          { key: 'B', label: 'Condense', note: 'The bar shrinks to icons only (56→38px). Navigation stays reachable while reading. Uses the unconsumed `scrolled` signal. Still the recommendation: it changes the least while keeping every tab under the thumb.', tradeoff: 'Animates height: one layout property, on a fixed element, so nothing else reflows.', render: (p) => <ScrollB {...p} /> },
          { key: 'C', label: 'Recede', note: 'The bar stays in place but fades and blurs to 35%. No layout change, no travel. Reads as depth: the content came forward.', render: (p) => <ScrollC {...p} /> },
          { key: 'D', label: 'Collapse to a pill', note: 'The nav is one object that changes size. On scroll-down the whole bar condenses into a floating pill at the bottom centre showing the current tab and a live line; tap it or scroll up and the same surface grows back into the bar (layoutId).', tradeoff: 'Introduces a second nav state users must learn, and the live line is a new information surface, not just chrome.', spec: () => 'condense spring 500 ms bounce 0.14 · expand spring 420 ms · content +140 ms', render: (p) => <ScrollD {...p} /> },
        ]} />

      <Demo id="sidebar" title="Sidebar active highlight" purpose="Desktop: the highlight already slides. What should the icon do?" principles={['continuity', 'hierarchy', 'restraint']} inZiggy={['components/layout/Sidebar.jsx NavGroup', 'motion.css:274-289']} stage="desktop" height={520}
        knobs={[
          { key: 'duration', label: 'Duration', min: 0.15, max: 0.8, step: 0.02, value: 0.4, unit: 'ms' },
          { key: 'bounce', label: 'Bounce', min: 0, max: 0.35, step: 0.02, value: 0.1 },
        ]}
        recommend="E"
        variants={[
          { key: 'A', label: 'Slide (today)', note: '320ms ease-out highlight; icon and label cut.', render: (p) => <SidebarDemo {...p} variant="A" /> },
          { key: 'B', label: 'Spring + icon nudge', note: 'Highlight on a spring; the active icon grows 10% and nudges 2px inward with it.', render: (p) => <SidebarDemo {...p} variant="B" /> },
          { key: 'C', label: 'Accent bar', note: 'No filled pill. A 3px accent bar travels along the leading edge; the row stays quiet.', render: (p) => <SidebarDemo {...p} variant="C" /> },
          { key: 'D', label: 'Ink trail', note: 'The highlight moves on a quick spring; a blurred copy follows on a softer one and fades, leaving a short trail that shows the path taken.', tradeoff: 'Two projected elements per change plus a blur filter. Fine on desktop, where this lives.', spec: () => 'highlight spring 380/32 · trail spring 120/18 · trail fades 500 ms after 250 ms', render: (p) => <SidebarDemo {...p} variant="D" /> },
          { key: 'E', label: 'Row opens', note: 'No pill at all. The active row\'s label slides 6px inward, its glyph fills, and an accent dot appears at the leading edge. Other rows do not move. Recommended: it answers the question the slide cannot (what the icon does) without adding a second moving object next to a highlight that already travels.', spec: (k) => `spring ${Math.round(k.duration * 1000)} ms · bounce ${k.bounce.toFixed(2)} · fill 160 ms`, render: (p) => <SidebarDemo {...p} variant="E" /> },
        ]} />
    </>
  )
}
