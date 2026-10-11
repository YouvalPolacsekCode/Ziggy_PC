# Port notes — Navigation + Pages (extracted 2026-10-10 from feat/motion-lab)

Everything is read. Report below.

---

# 0. How the lab passes `tx` / `ms`, and what each pick is built on

**`Demo` builds the prop bag** — `/Users/YouvalPolacsek/ziggy_pc/.claude/worktrees/motion-lab/frontend/src/lab/ui/Demo.jsx:69-82`

```jsx
  const props = useMemo(() => ({
    knobs: knobValues, replayKey, replay,
    rtl: lab.rtl, reduced: lab.reduced, speed: lab.speed, tx: lab.tx, ms: lab.ms, stage,
  }), [knobValues, replayKey, replay, lab.rtl, lab.reduced, lab.speed, lab.tx, lab.ms, stage])

  const spec = variant?.spec ? variant.spec(knobValues) : fmtSpec(knobValues)

  const renderStage = (v, key) => (
    <Stage kind={stage} height={height} bare={bare} activeNav={activeNav}>
      <div key={`${v.key}-${key}`} className="ml-stage__content" dir={lab.dir}>
        {v.render(props)}
      </div>
    </Stage>
  )
```

`knobValues` is seeded from the knob descriptors' `value` field (`Demo.jsx:53`) and each variant is re-mounted on variant change / Replay (`Demo.jsx:110`, the `key` on `:78`).

**`tx` and `ms` come from LabContext** — `/Users/YouvalPolacsek/ziggy_pc/.claude/worktrees/motion-lab/frontend/src/lab/LabContext.jsx:51-55`

```jsx
    // scale a framer-motion transition by the lab speed
    tx: (t) => scaleTransition(t, speed),
    // ms → ms scaled (for setTimeout choreography)
    ms: (n) => n / speed,
```

`scaleTransition` is `/Users/YouvalPolacsek/ziggy_pc/.claude/worktrees/motion-lab/frontend/src/lab/time.js:16-38` (multiplies duration/delay/stagger by `1/speed`; for `type:'spring'` divides stiffness by k² and damping by k; `{duration,bounce}` springs just scale duration). `LabContext.jsx:59` also wraps everything in `<MotionConfig reducedMotion={reduced ? 'always' : 'never'}>`.

**Port rule:** `tx({...})` is *only* a time-scaler for the lab's speed slider. In production every `tx({ ... })` becomes the bare transition object `{ ... }`, with the easing arrays taken from `src/motion/motion.js:20-26` (`EASE.out/glide/inOut/drawer/std`) or `src/lib/motion.js:15-16` (`EASE_STANDARD`, `EASE_ENTER`). Note the lab's `EASE` (`time.js:46-55`) has **three extra curves not in production `motion.js`**: `enter: [0.16,1,0.3,1]` (= `EASE_ENTER` in `src/lib/motion.js:16`), `standard: [0.2,0,0,1]` (= `EASE_STANDARD` in `src/lib/motion.js:15`), and `linear`. `ms(n)` becomes a plain `n`.

**Technique per pick (all seven are framer-motion; no GSAP anywhere in either section file):**

| Pick | Technique |
|---|---|
| nav-active **H** Depth | framer-motion `animate` on two nested `motion.span` (no layout/layoutId, no CSS) |
| more-menu **C** Fan out | framer-motion `AnimatePresence` + per-item `delay` stagger |
| nav-scroll **B** Condense | framer-motion `animate={{height}}` **+ one CSS transition** on the label opacity (`Navigation.jsx:538`, reads `--lab-speed`) |
| sidebar **C** Accent bar | framer-motion `layoutId` (shared-layout projection) |
| push **B** iOS parallax | framer-motion `AnimatePresence` (no `mode`) + `animate`/`exit` on `x` |
| tabs **C** Blur crossfade | framer-motion `AnimatePresence mode="popLayout"` + `layout` height spring |
| swipe-back **C** Rubber-band | framer-motion `useMotionValue`/`useTransform`/`animate` imperative, raw pointer events |

`gsap` is imported only in `LabContext.jsx:5,39` for the global timeline timescale — irrelevant to these picks.

---

# 1. nav-active → variant **H "Depth"** → `BottomNav.jsx`

## 1a. Lab implementation

`/Users/YouvalPolacsek/ziggy_pc/.claude/worktrees/motion-lab/frontend/src/lab/sections/Navigation.jsx:320-341`

```jsx
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
```

**⚠️ Knob discrepancy — flag this in the plan.** `NavH` destructures only `{ tx }`: it **ignores `knobs` entirely** and hardcodes `duration: 0.42, bounce: 0.15`. The owner's recorded knobs (duration 0.45 / bounce 0.18 / stretch 0.6) were never read by this variant — `stretch` is `NavB`-only (`Navigation.jsx:104`), and `duration`/`bounce` only reach A/B/C/D. The declared knob defaults are `/Users/YouvalPolacsek/ziggy_pc/.claude/worktrees/motion-lab/frontend/src/lab/sections/Navigation.jsx:699-703`:

```jsx
        knobs={[
          { key: 'duration', label: 'Duration', min: 0.15, max: 0.9, step: 0.02, value: 0.42, unit: 'ms' },
          { key: 'bounce', label: 'Bounce', min: 0, max: 0.4, step: 0.02, value: 0.18 },
          { key: 'stretch', label: 'Stretch (B)', min: 0, max: 1, step: 0.05, value: 0.6 },
        ]}
```

and the variant descriptor + its own spec string is `Navigation.jsx:713`:

```jsx
          { key: 'H', label: 'Depth', note: 'No travelling object. The active icon comes forward (scale 1.16, up 2px, soft shadow) while the others recede to 94% and 65%. Hierarchy through depth rather than position.', spec: () => 'spring 420 ms · bounce 0.15', render: (p) => <NavH {...p} /> },
```

So the port target is **`{ type:'spring', duration: 0.45, bounce: 0.18 }`** (owner's slider) applied where the lab hardcodes 0.42/0.15, and the filter sub-transition stays a tween `{ duration: 0.24, ease: EASE.out }` for the reason in the inline comment (a bouncy spring drives blur radius negative).

**Lab helper dependencies for this variant:**
- `NavShell` — `Navigation.jsx:55-68` (the `renderItem(tab, isActive)` contract, `data-cell`, `aria-current`, `useHaptic()`):

```jsx
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
```
- `TABS` — `Navigation.jsx:13`; `PageBody` — `Navigation.jsx:43-53`; `Icon`/`useT` — `frontend/src/lab/ziggy/primitives.jsx:32-45,95-105`; `useHaptic` — `LabContext.jsx:79-87`; `EASE.out` — `time.js:47`.
- CSS classes: `.zl-nav` / `.zl-nav__item` / `.zl-nav__item[aria-current="page"]` — `/Users/YouvalPolacsek/ziggy_pc/.claude/worktrees/motion-lab/frontend/src/lab/ziggy/ziggy.css:82-94` (56px bar, 11px label, `color: var(--accent-text)` when current).

**Production equivalents to swap in:** `useHaptic()` → `haptic('light')` from `src/motion/motion.js:104-108` (already wired, `BottomNav.jsx:71,375`); `useT()` → `useT()` from `src/lib/i18n` (already wired, `BottomNav.jsx:6,148`); `Icon` → `ZIcon` (`BottomNav.jsx:11,74`) / lucide `MoreHorizontal` (`BottomNav.jsx:97`); `tx({type:'spring',...})` → literal spring object (framer-motion is already a dependency and is used in `Actions.jsx:3`, but **`BottomNav.jsx` currently imports no framer-motion at all** — porting H adds that import, or forces a CSS-transition rewrite).

## 1b. Production landing site

**(i) `NAV_HL_SURFACE = null` and the whole "why there is no travelling pill" rationale** — `/Users/YouvalPolacsek/ziggy_pc/.claude/worktrees/motion-lab/frontend/src/components/layout/BottomNav.jsx:127-140`

```jsx
// ── On the sliding tab highlight ─────────────────────────────────────────
// The sidebar gets one (see Sidebar.jsx) because `.z-nav-item.active` already
// DRAWS a surface — var(--surface-2) on a 0.5px var(--line) border at
// var(--r-ctl) — so the highlight can take that exact surface over and
// travel with it, leaving the resting sidebar pixel-identical.
//
// This bar has no such surface. In this design an active tab is an ink-weight
// icon and an ink label on the bare glass; there is nothing behind it (see
// Tab above). A travelling pill here would therefore not be a hand-over, it
// would be a new resting surface — a design change, which this layer does not
// make. So the bar keeps its own active treatment and the highlight is not
// drawn. Set NAV_HL_SURFACE to 'var(--surface-2)' to opt the bar into the
// sidebar's treatment; the measurement below already has the geometry.
const NAV_HL_SURFACE = null
```

Variant H is the one pick that **does not need this constant flipped** — Depth has no travelling object, so `NAV_HL_SURFACE` can stay `null` and the highlight element + measurement can be deleted or left dead.

**(ii) The highlight element (dead while `NAV_HL_SURFACE` is null)** — `BottomNav.jsx:343-369`

```jsx
          <div
            ref={gridRef}
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(5, minmax(0, 1fr))',
              alignItems: 'stretch',
              height: ROW_H, maxWidth: 480, margin: '0 auto', padding: '0 4px',
              // Containing block for the highlight only. Nothing moves.
              ...(motionOn && NAV_HL_SURFACE ? { position: 'relative' } : null),
            }}
          >
            {motionOn && NAV_HL_SURFACE && hl && (
              <div
                data-motion-nav-hl
                aria-hidden="true"
                style={{
                  position: 'absolute', left: 0, top: 0,
                  width: hl.w, height: hl.h,
                  transform: `translate3d(${hl.x}px, ${hl.y}px, 0)`,
                  background: NAV_HL_SURFACE,
                  border: '0.5px solid var(--line)',
                  borderRadius: 'var(--r-ctl)',
                  boxSizing: 'border-box',
                  pointerEvents: 'none',
                }}
              />
            )}
```

Its motion lives in `/Users/YouvalPolacsek/ziggy_pc/.claude/worktrees/motion-lab/frontend/src/motion/motion.css:274-276`:

```css
[data-motion="on"] [data-motion-nav-hl] {
  transition: transform 320ms var(--m-out), width 320ms var(--m-out), height 320ms var(--m-out), opacity 200ms var(--m-std);
}
```
plus the reduced-motion neutralisations at `motion.css:367-368` and `:375`.

**(iii) The measurement machinery** (two consumers: More-menu `transform-origin`, and the dead highlight) — `BottomNav.jsx:168-221`

```jsx
  // ── Measurement ──────────────────────────────────────────────────────
  // Two consumers: the More menu's transform-origin (so it grows out of the
  // tab you pressed) and, if NAV_HL_SURFACE is ever given a value, the
  // travelling highlight's rectangle. Re-measured on resize, orientation
  // change and language change — RTL reverses which cell is where, and a
  // longer label re-flows the row.
  const gridRef = useRef(null)
  const moreCellRef = useRef(null)
  const [hl, setHl] = useState(null)          // { x, y, w, h } in grid coords
  const [moreOriginX, setMoreOriginX] = useState(null)

  const activeIndex = (() => {
    const i = PRIMARY_TABS.findIndex(p => (
      p.to === '/' ? location.pathname === '/' : location.pathname.startsWith(p.to)
    ))
    if (i !== -1) return i
    if (isMoreActive) return PRIMARY_TABS.length
    return -1                                  // a route with no tab — hide it
  })()

  useLayoutEffect(() => {
    if (!motionOn) { setHl(null); setMoreOriginX(null); return }
    const measure = () => {
      const grid = gridRef.current
      if (!grid) return
      const more = moreCellRef.current
      if (more) setMoreOriginX(more.offsetLeft + more.offsetWidth / 2 + grid.getBoundingClientRect().left)
      // Nothing draws the highlight in this design (see NAV_HL_SURFACE), so
      // measuring it would only cost a second render pass per navigation.
      if (!NAV_HL_SURFACE) return
      // Query by attribute rather than child index — the highlight itself is
      // a child of the grid, so positional indexing would be off by one.
      const cell = grid.querySelectorAll('[data-motion-nav-cell]')[activeIndex]
      if (activeIndex < 0 || !cell) { setHl(null); return }
      // offsetLeft is physical, so this is already correct in RTL, where the
      // grid reverses the cell order.
      setHl({
        x: cell.offsetLeft,
        y: cell.offsetTop,
        w: cell.offsetWidth,
        h: cell.offsetHeight,
      })
    }
    measure()
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null
    if (ro && gridRef.current) ro.observe(gridRef.current)
    window.addEventListener('resize', measure)
    window.addEventListener('orientationchange', measure)
    return () => {
      ro?.disconnect()
      window.removeEventListener('resize', measure)
      window.removeEventListener('orientationchange', measure)
    }
  }, [motionOn, activeIndex, rtl, lang, moreItems.length, connected])
```

**(iv) THE ACTUAL PORT SITE — the active-tab inline swaps** — `BottomNav.jsx:61-84`, with `:74-79` the exact lines the owner pointed at:

```jsx
function Tab({ to, name, label, motionOn }) {
  const location = useLocation()
  const active = to === '/' ? location.pathname === '/' : location.pathname.startsWith(to)
  return (
    <NavLink
      to={to}
      style={{ ...TAB_CELL, textDecoration: 'none' }}
      aria-current={active ? 'page' : undefined}
      // The only signal that arrives before the route does. Nothing else about
      // the tap changes.
      onClick={motionOn ? () => haptic('light') : undefined}
      data-motion-nav-cell={motionOn ? 'true' : undefined}
    >
      <ZIcon name={name} size={26} stroke={active ? 2 : 1.6} color={active ? 'var(--ink)' : 'var(--ink-mute)'} />
      <span style={{
        ...TAB_LABEL,
        fontWeight: active ? 600 : 500,
        color: active ? 'var(--ink)' : 'var(--ink-mute)',
      }}>
        {label}
      </span>
    </NavLink>
  )
}
```

Those three lines (`stroke`, `fontWeight`, `color`) are what "changes in one frame" today — they are the cut variant H replaces with scale/opacity/y/drop-shadow. Note the lab icon is 22px at stroke 2.2/1.7; production is **26px at stroke 2/1.6** (`:74`).

**The second, identical landing site** is the More cell, which must get the same treatment or the 5th tab will not participate — `BottomNav.jsx:86-107`:

```jsx
function MoreTab({ active, onClick, expanded, label, motionOn, cellRef }) {
  return (
    <button
      ref={cellRef}
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-expanded={expanded}
      data-motion-nav-cell={motionOn ? 'true' : undefined}
      style={{ ...TAB_CELL, background: 'transparent', border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}
    >
      <MoreHorizontal size={26} strokeWidth={active ? 2 : 1.6} color={active ? 'var(--ink)' : 'var(--ink-mute)'} />
      <span style={{
        ...TAB_LABEL,
        fontWeight: active ? 600 : 500,
        color: active ? 'var(--ink)' : 'var(--ink-mute)',
      }}>
        {label}
      </span>
    </button>
  )
}
```

Geometry constants that constrain the scale-up (an icon at 1.16× inside a 56px cell): `ROW_H = 56` / `BAR_BG` — `BottomNav.jsx:38-42`; `TAB_LABEL` — `:48-53`; `TAB_CELL` (`padding: '4px 4px 0'`, `gap: 4`) — `:54-59`. Call sites: `BottomNav.jsx:370-380`.

**Hooks / store fields / i18n involved:** `data-motion-nav-cell` (emitted `:72`, `:94`; consumed by the measurement at `:200` and by `Sidebar.jsx:42`); `aria-current="page"` (`:68`); `motionOn` from `useMotionOn()` (`:7,149`, `src/motion/flag.js`); `useAuthStore().role` (`:4,145`); `useFeature('task_tracking')` (`:5,158`); `useIsRTL()`/`useLang()`/`useT()` (`:6,146-148`). i18n keys for the five labels: `nav.home`, `nav.rooms`, `nav.devices`, `nav.automations`, `nav.more` — `PRIMARY_TABS` at `BottomNav.jsx:26-31`, `t('nav.more')` at `:377`; strings at `frontend/src/lib/i18n/en.js:141-144,159` and `frontend/src/lib/i18n/he.js:139,157`.

---

# 2. more-menu → variant **C "Fan out"** → `BottomNav.jsx` More menu + `motion.css`

## 2a. Lab implementation

`/Users/YouvalPolacsek/ziggy_pc/.claude/worktrees/motion-lab/frontend/src/lab/sections/Navigation.jsx:410-435`

```jsx
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
```

Knobs **are** wired here, so the owner's values resolve exactly: enter = `{ type:'spring', duration: 0.32, bounce: 0.12, delay: i * 0.04 }`; exit = `{ duration: 0.12, delay: (n-1-i) * 0.03 }` (reverse order, **hardcoded 30ms**, not the stagger knob); backdrop = `{ duration: 0.16 }` in, same out. Declared knobs — `Navigation.jsx:717-721`:

```jsx
        knobs={[
          { key: 'duration', label: 'Duration', min: 0.15, max: 0.7, step: 0.02, value: 0.32, unit: 'ms' },
          { key: 'bounce', label: 'Bounce', min: 0, max: 0.4, step: 0.02, value: 0.12 },
          { key: 'stagger', label: 'Stagger (C)', min: 0, max: 0.1, step: 0.005, value: 0.04, unit: 'ms' },
        ]}
```

Variant descriptor — `Navigation.jsx:726`:
```jsx
          { key: 'C', label: 'Fan out', note: 'Three cards fan up out of the tab, 40ms apart; they retract in reverse order. More expressive; still under 400ms total.', render: (p) => <MoreC {...p} /> },
```

**Lab dependencies:** `MORE_ITEMS` (`Navigation.jsx:345-349`) — three items (`alerts`/`people`/`settings`), i.e. the same cardinality as production minus People plus Tasks; `MoreFrame` (`Navigation.jsx:351-369`) which owns the open state, the nav row and the `data-more-trigger` marker:

```jsx
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
```
plus lab CSS classes `.zl-backdrop`, `.zl-card`, `.zl-row__title`, `.ml-hint` (`frontend/src/lab/ziggy/ziggy.css`, `frontend/src/lab/lab.css`) and `var(--shadow-md)`.

**The port's central problem:** `MoreC` depends on `AnimatePresence` for its reverse-order retract — and production deliberately removed `AnimatePresence` from this exact element.

## 2b. Production landing site

**(i) The AnimatePresence-stall comment and the whole popover** — `/Users/YouvalPolacsek/ziggy_pc/.claude/worktrees/motion-lab/frontend/src/components/layout/BottomNav.jsx:234-304`

```jsx
      {/* Plain conditional, NO AnimatePresence. The previous version used
          framer-motion's exit cycle, which stalled on cold-start when the
          /devices lazy chunk blocked the JS thread mid-animation, leaving
          the backdrop visibly stuck (blurred screen, all bottom-nav taps
          blocked). Plain conditional unmounts both elements synchronously
          the moment showMore flips to false — no animation state machine
          that can fail to complete. */}
      {showMore && (
        <>
          <div
            className="fixed inset-0 z-40 md:hidden"
            data-motion-more-backdrop={motionOn ? 'true' : undefined}
            style={{ background: 'var(--scrim)', backdropFilter: 'blur(4px)', WebkitBackdropFilter: 'blur(4px)' }}
            onClick={() => setShowMore(false)}
          />
          <div
            className="fixed left-0 right-0 z-50 md:hidden"
            data-motion-more={motionOn ? 'true' : undefined}
            style={{
              // Mirror the bottom-nav's gesture-bar floor so the popover
              // sits the same distance above the bar on both 3-button and
              // gesture-nav Android (and on iOS).
              bottom: `calc(${ROW_H}px + max(env(safe-area-inset-bottom, 0px), 8px) + 12px)`,
              paddingLeft: 'max(12px, env(safe-area-inset-left, 0px))',
              paddingRight: 'max(12px, env(safe-area-inset-right, 0px))',
              // With motion on the enter comes from motion.css instead, which
              // grows the menu out of the More tab rather than lifting it off
              // the bar. Both are enter-only; an inline `animation` would win
              // over the stylesheet, so it is dropped rather than layered.
              ...(motionOn ? null : { animation: 'ziggy-sheet-in var(--dur-enter) var(--ease-enter)' }),
              // The wrapper's left edge is the viewport's, so the measured
              // centre is already local to it. Inert until the CSS enter
              // animation applies a transform.
              ...(motionOn && moreOriginX != null
                ? { transformOrigin: `${Math.round(moreOriginX)}px 100%` }
                : null),
            }}
          >
            {!motionOn && <style>{`@keyframes ziggy-sheet-in { from { transform: translateY(12px); opacity: 0 } to { transform: none; opacity: 1 } }`}</style>}
            <div style={{
              background: 'var(--surface)', border: '0.5px solid var(--line)',
              borderRadius: 'var(--r-sheet)', boxShadow: 'var(--shadow-lg)',
              padding: 8, display: 'grid',
              gridTemplateColumns: `repeat(${moreItems.length}, 1fr)`, gap: 8,
            }}>
              {moreItems.map(({ to, Icon, label }) => {
                const active = location.pathname.startsWith(to)
                return (
                  <button
                    key={to}
                    onClick={() => { setShowMore(false); navigate(to) }}
                    style={{
                      background: active ? 'var(--surface-2)' : 'transparent',
                      border: active ? '0.5px solid var(--line)' : '0.5px solid transparent',
                      cursor: 'pointer', borderRadius: 'var(--r-card)', minHeight: 64,
                      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6,
                      padding: '12px 8px', fontFamily: 'inherit',
                    }}
                  >
                    <Icon size={24} strokeWidth={active ? 2 : 1.6} color={active ? 'var(--ink)' : 'var(--ink-mute)'} />
                    <span style={{ fontSize: 12, fontWeight: active ? 600 : 500, color: active ? 'var(--ink)' : 'var(--ink-mute)' }}>
                      {label}
                    </span>
                  </button>
                )
              })}
            </div>
          </div>
        </>
      )}
```

Structural mismatch to resolve in the plan: production is **one card containing a horizontal grid** (`gridTemplateColumns: repeat(n, 1fr)`, `:278`), while lab C is **n separate cards stacked `column-reverse`** with `transformOrigin: '100% 100%'`. The fan-out therefore needs the production popover's single `<div>` card broken into per-item cards, or the stagger applied to the grid children with the card chrome moved onto each child.

**(ii) The `motion.css` rules the owner cited** — `/Users/YouvalPolacsek/ziggy_pc/.claude/worktrees/motion-lab/frontend/src/motion/motion.css:291-308`

```css
/* ── More menu ───────────────────────────────────────────────────────────
 * Enter only. The popover stays a plain conditional (see BottomNav's comment
 * about AnimatePresence stalling and trapping taps), so there is no exit
 * animation and no unmount to wait on — both elements still disappear the
 * frame showMore flips to false. transform-origin is set inline, at the
 * measured centre of the More tab, so the menu grows out of the thing you
 * pressed. */

[data-motion="on"] [data-motion-more] {
  animation: zm-more-in 200ms var(--m-out) backwards;
}
@keyframes zm-more-in {
  from { opacity: 0; transform: scale(0.96); }
  to   { opacity: 1; transform: none; }
}
[data-motion="on"] [data-motion-more-backdrop] {
  animation: zm-fade-in 160ms var(--m-std) backwards;
}
```
Reduced-motion override: `motion.css:369` → `[data-motion-more] { animation: zm-fade-in 140ms var(--m-out) backwards; }`. `--m-out` / `--m-std` are defined at `motion.css:26-27`; `zm-fade-in` at `:378-381`.

**(iii) State and the defensive force-close that an exit animation must survive** — `BottomNav.jsx:150-156`

```jsx
  const [showMore, setShowMore] = useState(false)

  // Force-close the More menu on any route change. Defensive against
  // framer-motion's AnimatePresence stalling its exit cycle when a heavy
  // lazy route (e.g. /devices) mounts mid-animation — without this, the
  // backdrop can get stuck over the whole viewport, blocking taps.
  useEffect(() => { setShowMore(false) }, [location.pathname])
```

Also relevant: items list + feature gate at `BottomNav.jsx:32-36` (`MORE_BASE`) and `:158-166`; `isTucked` is suppressed while the menu is open (`:231`); `useOverlayOpen` matches `[data-motion-sheet]`, **not** `[data-motion-more]` (`:112-125`), so the fan-out's own exit does not register as an overlay.

**i18n keys:** `nav.alerts`, `nav.tasks`, `nav.settings` (`BottomNav.jsx:33-35`; `en.js:149-151`, `he.js` equivalents). **Store fields:** `useFeature('task_tracking')` (`:158`) decides whether the menu has 2 or 3 items, so the stagger's `i`/`n` are dynamic. **Data hooks:** `data-motion-more`, `data-motion-more-backdrop`, plus `moreOriginX` (`:176,194,268-270`) which is the `transform-origin` the fan already wants (`transformOrigin: '100% 100%'` in lab is a corner; production has a measured px origin).

---

# 3. nav-scroll → variant **B "Condense"** (+ "more padding up top") → `gestures.js useScrollChrome`, `BottomNav` `data-tucked`

## 3a. Lab implementation

**What condenses is the bottom nav, not a header.** `/Users/YouvalPolacsek/ziggy_pc/.claude/worktrees/motion-lab/frontend/src/lab/sections/Navigation.jsx:556-565`

```jsx
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
```

The `nav-scroll` Demo declares **no knobs at all** (`Navigation.jsx:730-737`), so 56→38px and `{ type:'spring', duration: 0.4, bounce: 0 }` are hardcoded; variant descriptor at `:734`:

```jsx
          { key: 'B', label: 'Condense', note: 'The bar shrinks to icons only (56→38px). Navigation stays reachable while reading. Uses the unconsumed `scrolled` signal. Still the recommendation: it changes the least while keeping every tab under the thumb.', tradeoff: 'Animates height: one layout property, on a fixed element, so nothing else reflows.', render: (p) => <ScrollB {...p} /> },
```

**The label fade is CSS, not framer** — `StaticNav`, `Navigation.jsx:530-543` (note `opacity: labels ? 1 : 0` with a CSS transition reading `--lab-speed`; `iconOnly` is an unused alternate path):

```jsx
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
```

**The scroll signal** — `ScrollFrame`, `Navigation.jsx:508-528`. This is the lab's stand-in for `useScrollChrome`, and its thresholds (`|d| > 6`, `top > 60`, `top <= 0 → 'up'`) are the same numbers as production:

```jsx
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
```

**Where "more padding up top" lands in the lab's own geometry** (so you can read the owner's note against it): `.zl-page__scroll { padding: 16px 16px 90px }` — `frontend/src/lab/ziggy/ziggy.css:28` — overridden to `paddingBottom: 100` inline at `Navigation.jsx:513`, with the page title at `.zl-page__title { margin: 6px 0 14px }` (`ziggy.css:30`). The lab's top padding is 16px + 6px of title margin; the note asks for more than that above the first content, which in production maps to the page container paddings listed below.

## 3b. Production landing sites

**(i) `useScrollChrome` — the `scrolled` return value is the unconsumed signal variant B wants** — `/Users/YouvalPolacsek/ziggy_pc/.claude/worktrees/motion-lab/frontend/src/motion/gestures.js:322-346`

```js
// ── Scroll chrome ───────────────────────────────────────────────────────
// Reports whether a scroller has passed an edge (so a bar can condense) and
// whether the person is scrolling down (tuck the tab bar away) or up (bring
// it back). Always returns at the top of the page.

export function useScrollChrome(ref, { edge = 72, onDirection } = {}) {
  const [scrolled, setScrolled] = useState(false)
  const last = useRef(0)

  const onScroll = useCallback(() => {
    const el = ref?.current
    if (!el) return
    const top = el.scrollTop
    setScrolled(top > edge)
    const delta = top - last.current
    if (Math.abs(delta) > 6) {
      if (delta > 0 && top > 60) onDirection?.('down')
      else if (delta < 0) onDirection?.('up')
      last.current = top
    }
    if (top <= 0) onDirection?.('up')
  }, [ref, edge, onDirection])

  return { scrolled, onScroll }
}
```

`scrolled` has exactly **one consumer in the whole app — none**: the only call site destructures `onScroll` only. `/Users/YouvalPolacsek/ziggy_pc/.claude/worktrees/motion-lab/frontend/src/components/layout/AppShell.jsx:219-222`

```jsx
  // Bottom-nav tuck. onDirection fires 'up' whenever the scroller is back at
  // the top, so the bar always returns there.
  const { onScroll } = useScrollChrome(mainRef, {
    onDirection: useCallback((dir) => setNavTucked(dir === 'down'), []),
  })
```
with `const [navTucked, setNavTucked] = useState(false)` at `AppShell.jsx:164`, the handler attached at `AppShell.jsx:284` (`onScroll={motionOn ? onScroll : undefined}`), and the reset-per-route at `AppShell.jsx:248`.

**(ii) `data-tucked` — the behaviour being replaced** — `BottomNav.jsx:223-231` (gating) and `:306-322` (hooks):

```jsx
  // ── Tuck ─────────────────────────────────────────────────────────────
  // Never while a modal or sheet is up, never while the More menu is open,
  // never while the offline strip is showing (it is the bar's own message and
  // must not walk off with it). Reduced motion is handled in motion.css,
  // which pins the bar in place even when this says tucked — an OS setting
  // that can flip mid-session is better answered by the media query than by a
  // value captured at render.
  const overlayOpen = useOverlayOpen(motionOn)
  const isTucked = motionOn && tucked && !overlayOpen && !showMore && connected !== false
```

```jsx
      <nav
        className="fixed bottom-0 left-0 right-0 z-30 md:hidden"
        // Tuck hooks. The transform lives in motion.css; with the flag off
        // neither attribute is emitted and the bar has no transition at all.
        data-motion-nav={motionOn ? 'true' : undefined}
        data-tucked={motionOn ? (isTucked ? 'true' : 'false') : undefined}
```
Prop threading: `AppShell.jsx:343` → `<BottomNav connected={connected} tucked={motionOn && navTucked} />`; signature `BottomNav.jsx:142`.

The transform itself — `motion.css:263-273`:

```css
/* ── Bottom nav ──────────────────────────────────────────────────────────
 * Tucks away as you scroll down, returns as you scroll up. The sliding
 * highlight is drawn by the component; this is only its motion. */

[data-motion="on"] [data-motion-nav] {
  transition: transform 240ms var(--m-out), opacity 200ms var(--m-std);
}
[data-motion="on"] [data-motion-nav][data-tucked="true"] {
  transform: translate3d(0, calc(100% + 12px), 0);
  opacity: 0;
}
```
Reduced-motion pins: `motion.css:366` and `:374`.

**(iii) Second consumer of `data-tucked` that a condense must be reconciled with** — the chat bubble rides the tuck via a sibling selector. `AppShell.jsx:65-71`:

```js
const CHAT_BUBBLE_TUCK_CSS = `
@media (prefers-reduced-motion: no-preference) {
  [data-motion="on"] [data-motion-nav][data-tucked="true"] ~ .z-chat-bubble {
    opacity: 0;
    pointer-events: none;
  }
}`
```
(rationale `AppShell.jsx:42-64`; injected at `AppShell.jsx:347`). If `data-tucked="true"` becomes "condensed" rather than "gone", the bubble must stop hiding — and its own CSS offset `inset-block-end: calc(var(--nav-h) + max(var(--safe-bottom), 8px) + 16px)` (`frontend/src/components/chat/chatBubble.css:12`) is keyed to `--nav-h`.

**(iv) The geometry that must move when 56 → 38, and the "more padding up top" target.** `BottomNav.jsx:38-42`:

```jsx
// Bar geometry — flat row, no notch / FAB. Bar height matches the CSS
// --nav-h variable so pb-nav math stays in sync. 56 = 8 top + 26 icon +
// 4 gap + 11 label + 7 bottom, on the 4px grid.
const ROW_H  = 56
```
is mirrored in CSS — `/Users/YouvalPolacsek/ziggy_pc/.claude/worktrees/motion-lab/frontend/src/index.css:39-63`:

```css
 * --nav-h: bottom-nav row height. Mirrors BottomNav ROW_H so pb-nav,
 *   chat-composer math, and toast spacing all derive from one source.
...
  /* Shell geometry — kept in sync with the JS constants in BottomNav.jsx
     (ROW_H) and Sidebar.jsx (width). Change them together. */
  --nav-h: 56px;
  --sidebar-w: 240px;
...
  --nav-clearance: calc(var(--nav-h) + max(var(--safe-bottom), 8px) + 8px);
```
and consumed by `.pb-nav` — `index.css:585-586`:
```css
  .pb-nav { padding-bottom: var(--nav-clearance); }
  @media (min-width: 768px) { .pb-nav { padding-bottom: 0; } }
```
`.pb-nav` is on `<main>` (`AppShell.jsx:285`). `ROW_H` is also used for the More popover's `bottom:` (`BottomNav.jsx:257`) and for the safe-area floor sibling (`BottomNav.jsx:384-398`).

**There is no page header inside `AppShell.jsx`** — `<main>` contains only `<ConnectionStatus />` (`:304`) and the keyed enter wrapper (`:334-336`), and its only top spacing is `paddingTop: 'var(--safe-top)'` (`AppShell.jsx:286-298`):

```jsx
        style={{
          background: 'var(--bg)',
          // Safe-area top here, NOT on the outer wrapper, so sidebar can stay
          // flush at viewport top on desktop while mobile main content clears
          // the status bar on iOS PWA (black-translucent) and Android cutouts.
          paddingTop: 'var(--safe-top)',
          ...
          scrollbarGutter: 'stable',
        }}
```
Page headers (the `<h1 class="z-display">` + the top padding the owner's note is about) live per page:
- `frontend/src/pages/DeviceDetail.jsx:1099` → `padding: '24px 20px 24px'`, title at `:1140-1146`
- `frontend/src/pages/Devices.jsx:2627` → `padding: '24px 20px 16px'`
- `frontend/src/pages/Rooms.jsx:663` → `padding: '24px 20px 24px'`

So "add more padding up top" is a change to `var(--safe-top)` + those per-page `24px` tops (or a new `--page-pt` token in `index.css`), not to anything in `AppShell.jsx` itself.

---

# 4. sidebar → variant **C "Accent bar"** → `Sidebar.jsx` NavGroup + `motion.css:274-289`

## 4a. Lab implementation

The variant-C element is a single line: `/Users/YouvalPolacsek/ziggy_pc/.claude/worktrees/motion-lab/frontend/src/lab/sections/Navigation.jsx:651`

```jsx
                  {isActive && variant === 'C' && <motion.span layoutId={`side-bar-${variant}`} transition={spring} style={{ position: 'absolute', insetInlineStart: 0, top: 8, bottom: 8, width: 3, borderRadius: 3, background: 'var(--accent)' }} />}
```

`spring` is knob-driven and the owner's values resolve exactly — `Navigation.jsx:635` → `const spring = tx({ type: 'spring', duration: knobs.duration, bounce: knobs.bounce })`, with declared defaults `duration 0.4` / `bounce 0.1` at `Navigation.jsx:741-742`. Variant descriptor at `:748`:

```jsx
          { key: 'C', label: 'Accent bar', note: 'No filled pill. A 3px accent bar travels along the leading edge; the row stays quiet.', render: (p) => <SidebarDemo {...p} variant="C" /> },
```

Full host component (note the `LayoutGroup id={`side-${variant}`}` at `:642` that scopes the `layoutId`, the row button that provides the `position: relative` containing block at `:649`, and that **in variant C the icon and label get no animation** — the `motion.span` at `:665` only animates for variant B and the label `x` at `:669` only for E, which is what the note means by "the row stays quiet") — `Navigation.jsx:632-679`:

```jsx
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
```

`SIDE` (5 items, same as production `PRIMARY`) — `Navigation.jsx:624-630`. Lab item geometry: `height: 40`, `padding: '0 12px'`, `borderRadius: 10`, `gap: 2` between rows.

**Dependencies to replace:** framer-motion `LayoutGroup` + `layoutId` (production uses a hand-measured `translate3d` + CSS transition instead — see below), `useHaptic`, `useT`, `Icon`, `var(--accent)`.

## 4b. Production landing site

`/Users/YouvalPolacsek/ziggy_pc/.claude/worktrees/motion-lab/frontend/src/components/layout/Sidebar.jsx:50-118` — the whole `NavGroup`, measurement included. The accent bar replaces the `background`/`border` block at `:97-112`:

```jsx
// A nav group whose active surface slides between its items instead of
// teleporting. The highlight draws EXACTLY what `.z-nav-item.active` draws —
// var(--surface-2) on a 0.5px var(--line) border at var(--r-ctl) — and
// motion.css suppresses the item's own background while the highlight is
// present (data-motion-hl), so this is a hand-over, not a second surface, and
// the resting sidebar is pixel-identical either way.
function NavGroup({ items, t, motionOn, ...navProps }) {
  const location = useLocation()
  const navRef = useRef(null)
  const [hl, setHl] = useState(null)
  const lang = useLang()

  const activeIndex = items.findIndex(p => (
    p.to === '/' ? location.pathname === '/' : location.pathname.startsWith(p.to)
  ))

  useLayoutEffect(() => {
    if (!motionOn) { setHl(null); return }
    const measure = () => {
      const nav = navRef.current
      if (!nav) return
      const cell = nav.querySelectorAll('[data-motion-nav-cell]')[activeIndex]
      if (activeIndex < 0 || !cell) { setHl(null); return }
      setHl({ y: cell.offsetTop, h: cell.offsetHeight })
    }
    measure()
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null
    if (ro && navRef.current) ro.observe(navRef.current)
    window.addEventListener('resize', measure)
    return () => { ro?.disconnect(); window.removeEventListener('resize', measure) }
    // lang is in here because a longer label can wrap an item to a second line.
  }, [motionOn, activeIndex, items.length, lang])

  return (
    <nav
      ref={navRef}
      data-motion-nav-group={motionOn ? 'true' : undefined}
      // Only hand the active surface over once the highlight actually exists,
      // so a failed measurement can never leave the active item looking
      // inactive.
      data-motion-hl={motionOn && hl ? 'true' : undefined}
      style={{
        display: 'flex', flexDirection: 'column', gap: 4,
        ...(motionOn ? { position: 'relative' } : null),
      }}
      {...navProps}
    >
      {motionOn && hl && (
        <div
          data-motion-nav-hl
          aria-hidden="true"
          style={{
            position: 'absolute', left: 0, right: 0, top: 0,
            height: hl.h,
            transform: `translate3d(0, ${hl.y}px, 0)`,
            background: 'var(--surface-2)',
            border: '0.5px solid var(--line)',
            borderRadius: 'var(--r-ctl)',
            boxSizing: 'border-box',
            pointerEvents: 'none',
          }}
        />
      )}
      {items.map(p => (
        <NavItem key={p.to} to={p.to} Icon={p.Icon} label={t(p.labelKey)} inMotionGroup={motionOn} />
      ))}
    </nav>
  )
}
```

**Two `NavGroup` instances** must both be handled — `Sidebar.jsx:179` (PRIMARY) and `:185` (SECONDARY); each has its own independent `hl`, so an accent bar travels within a group but jumps between groups (today's pill has the same property).

**`NavItem`** (the row whose leading edge the bar sits on; `position: relative` is added only in a motion group) — `Sidebar.jsx:32-48`:

```jsx
function NavItem({ to, Icon, label, inMotionGroup }) {
  const location = useLocation()
  const active = to === '/' ? location.pathname === '/' : location.pathname.startsWith(to)
  return (
    <NavLink
      to={to}
      className={`z-nav-item ${active ? 'active' : ''}`}
      // position: relative only lifts the item into the same paint layer as
      // the highlight travelling behind it. Nothing moves.
      style={{ textDecoration: 'none', ...(inMotionGroup ? { position: 'relative' } : null) }}
      data-motion-nav-cell={inMotionGroup ? 'true' : undefined}
    >
      <Icon size={18} strokeWidth={active ? 2 : 1.75} color={active ? 'var(--ink)' : 'var(--ink-mute)'} style={{ flexShrink: 0 }} />
      <span style={{ flex: 1 }}>{label}</span>
    </NavLink>
  )
}
```

**`motion.css:274-289` — both halves the owner cited.** `:274-276` is the travel transition (shared with the bottom nav's dead highlight, so changing the duration here changes both):

```css
[data-motion="on"] [data-motion-nav-hl] {
  transition: transform 320ms var(--m-out), width 320ms var(--m-out), height 320ms var(--m-out), opacity 200ms var(--m-std);
}

/* Sidebar: the active surface moves to the sliding highlight, which draws the
 * SAME values the active item drew (var(--surface-2) on a 0.5px var(--line)
 * border, radius 8). Handing it over rather than doubling it is what keeps
 * the resting sidebar pixel-identical. Only applies once the highlight has
 * actually been measured (data-motion-hl). */
[data-motion="on"] [data-motion-nav-group][data-motion-hl="true"] .z-nav-item.active {
  background: transparent;
  border-color: transparent;
}
[data-motion="on"] [data-motion-nav-group][data-motion-hl="true"] .z-nav-item.active:hover {
  background: transparent;
}
```

**Port note the plan must state:** variant C is "no filled pill", so the hand-over at `:283-289` becomes **wrong in the other direction** — today the rule *suppresses* `.z-nav-item.active`'s surface because the highlight draws it. An accent bar draws no surface, so either (a) the suppression rules are dropped and the active row keeps its `--surface-2` pill *plus* a bar (not what C shows), or (b) the suppression stays and `.z-nav-item.active`'s resting surface is removed from the design — which is the resting-appearance change `motion.css`'s header (`motion.css:1-20`) and `flag.js:17-20` forbid for this layer. Flag that explicitly: variant C cannot be a feel-only port.

Also: the `hl` state only carries `{ y, h }` (`Sidebar.jsx:73`) — enough for a 3px bar; `width`/`x` are not measured in the sidebar (unlike `BottomNav.jsx:204-209`). RTL comes for free only if the bar uses `insetInlineStart` like the lab (`Navigation.jsx:651`); the production highlight hardcodes `left: 0, right: 0` (`Sidebar.jsx:102`).

**i18n keys:** `nav.home`, `nav.rooms`, `nav.askZiggy`, `nav.devices`, `nav.automations` (`Sidebar.jsx:18-24`), `nav.alerts`, `nav.tasks`, `nav.settings` (`:26-30`), `nav.opsConsole` (`:193`) — `en.js:141-158`. **Store fields:** `useUIStore()` theme (`:129`), `useAuthStore().role` + `hasRole(role,'super_admin')` (`:130,133`), `useFeature('task_tracking')` (`:134-137`), `useLang()` in the measure deps (`:60,81`), `useMotionOn()` (`:132`). **Geometry:** `--sidebar-w: 240px` (`index.css:58`), consumed at `Sidebar.jsx:145`; rows are `.z-nav-item` (class in `index.css`), container `gap: 4` (`:92`).

---

# 5. push → variant **B "iOS parallax push"** → `AppShell.jsx` page wrapper + `motion.css:144-188`

## 5a. Lab implementation (verbatim)

`/Users/YouvalPolacsek/ziggy_pc/.claude/worktrees/motion-lab/frontend/src/lab/sections/PageTransitions.jsx:99-122`

```jsx
/* ───── B: iOS parallax push/pop ───── */
function PushB({ knobs, tx, rtl }) {
  const [room, setRoom] = useState(null)
  const h = useHaptic()
  const sign = rtl ? -1 : 1
  const push = tx({ duration: knobs.duration, ease: EASE.drawer })
  const pop = tx({ duration: knobs.duration * 0.85, ease: EASE.out })
  return (
    <div className="zl" style={{ position: 'absolute', inset: 0, overflow: 'hidden' }}>
      <AnimatePresence initial={false}>
        {room ? (
          <motion.div key={'d' + room.id} initial={{ x: `${100 * sign}%` }} animate={{ x: 0, transition: push }} exit={{ x: `${100 * sign}%`, transition: pop }}
            style={{ position: 'absolute', inset: 0, zIndex: 2, boxShadow: `${-12 * sign}px 0 24px rgba(0,0,0,.18)`, background: 'var(--bg)' }}>
            <RoomScreen room={room} onBack={() => { setRoom(null); h('medium') }} tx={tx} contentDelay={0.05} />
          </motion.div>
        ) : null}
        <motion.div key="list" initial={false} animate={{ x: room ? `${-knobs.parallax * 100 * sign}%` : 0 }} transition={room ? push : pop} style={{ position: 'absolute', inset: 0, zIndex: 1 }}>
          <RoomsScreen onOpen={(r) => setRoom(r)} />
          <motion.div animate={{ opacity: room ? 0.35 : 0 }} transition={room ? push : pop} style={{ position: 'absolute', inset: 0, background: '#000', pointerEvents: 'none' }} />
        </motion.div>
      </AnimatePresence>
    </div>
  )
}
```

Knobs resolve to the owner's values: `duration 0.42`, `parallax 0.3`; `bounce` is unused by B (the knob is labelled "Bounce (C)"). Declared knobs — `PageTransitions.jsx:618-622`:

```jsx
        knobs={[
          { key: 'duration', label: 'Duration', min: 0.2, max: 0.9, step: 0.02, value: 0.42, unit: 'ms' },
          { key: 'bounce', label: 'Bounce (C)', min: 0, max: 0.3, step: 0.02, value: 0 },
          { key: 'parallax', label: 'Under-page parallax (B)', min: 0, max: 0.5, step: 0.05, value: 0.3 },
        ]}
```
Variant descriptor, including the lab's own statement of the handshake avoidance — `PageTransitions.jsx:626`:

```jsx
          { key: 'B', label: 'iOS parallax push', note: 'The detail slides in from the trailing edge over the list, which recedes 30% and dims to 35%; a 12px shadow rides the incoming edge. Pop reverses, 15% faster. Spatial: detail is "to the right" of the list.', tradeoff: 'Needs both pages mounted for ~400ms. Two-page exit handshake is the thing that once black-screened the app; this version has no `mode="wait"` and both pages are absolutely positioned.', render: (p) => <PushB {...p} /> },
```

### Exactly how it keeps BOTH pages mounted without `mode="wait"` — and how it reads direction

**Mounting.** The list is **not** an `AnimatePresence` branch that swaps. It is a *permanently mounted* child, `key="list"`, that lives inside the `AnimatePresence` alongside the conditional detail (`:115`). Since its key never changes and it is never removed, `AnimatePresence` never runs an exit on it; it just re-renders with a new `animate` target. The *only* presence-managed child is the detail (`:109-114`), which mounts on `room != null` and exits on `room == null`. With no `mode` prop, `AnimatePresence` defaults to `"sync"`: the entering detail and (on back) the exiting detail render *at the same time* as the list, so there is never a frame with nothing on screen. There is no exit→enter handshake to drop because **nothing waits on anything** — the list's recede is a plain `animate` on a mounted element, not an `exit`.

**Stacking without normal flow.** Both layers are `position: 'absolute', inset: 0` (`:111` detail, `:115` list) with explicit `zIndex: 2` / `zIndex: 1`, inside a parent that is `position:'absolute', inset:0, overflow:'hidden'` (`:107`). This is the specific cure for the second failure recorded in production (`AppShell.jsx:312-316`: "both old and new motion.divs render simultaneously as siblings in normal flow, stacking vertically. The new page lands below the viewport"). Absolute positioning means simultaneous siblings **overlay** instead of stacking; `overflow:hidden` clips the 100% offsets.

**Direction.** It does **not** read router history. Direction is purely the presence/absence of local state plus writing direction:
- `sign = rtl ? -1 : 1` (`:103`), from the lab `rtl` prop (`LabContext.jsx:47`, `dir === 'rtl'`).
- forward/back is `room ? … : …` — ternaries at `:115` (`x: room ? -parallax*100*sign : 0`), `:115` transition (`room ? push : pop`), and `:117` (scrim `opacity: room ? 0.35 : 0`). Enter is always `x: 100*sign` → `0`; exit is always `0` → `x: 100*sign`.
- `push` vs `pop` asymmetry: `pop = duration * 0.85` with `EASE.out` instead of `EASE.drawer` (`:104-105`), i.e. back is 15% faster — matching the production doctrine at `motion.css:47-50`.
- Per-transition overrides are attached **inside** the variant objects (`animate={{ x: 0, transition: push }}`, `exit={{ x: …, transition: pop }}`, `:110`) so the entering and exiting copies can use different curves in the same `AnimatePresence`.
- Shadow direction also flips with `sign`: `boxShadow: \`${-12 * sign}px 0 24px rgba(0,0,0,.18)\`` (`:111`).

**Content choreography:** `contentDelay={0.05}` (`:112`) is threaded into `RoomScreen`, which uses it at `PageTransitions.jsx:65` (`tx({ duration: 0.2, delay: contentDelay })` on the meta line) and `:68` (`tx({ duration: 0.3, delay: contentDelay, ease: EASE.out })` on the scroll body, `opacity 0→1`, `y 14→0`).

**Lab dependencies:** `RoomsScreen` (`:32-53`) and `RoomScreen` (`:55-76`) — shared screens taking `tx`, `layoutIds`, `contentDelay`, `heroBg`, `style`; `useHaptic` (`h('medium')` on back, `:112`); `EASE.drawer` / `EASE.out` (`time.js:50,47` ≡ production `motion.js:24,21` and `CSS_EASE.drawer/out` `motion.js:32,29`); CSS classes `.zl`, `.zl-page`, `.zl-page__scroll`, `.zl-grid2`, `.zl-tile`, `.zl-room` (`frontend/src/lab/ziggy/ziggy.css`); `PHOTO` gradients (`:12-20`).

## 5b. Production landing site

**(i) The page wrapper — the one element to replace** — `/Users/YouvalPolacsek/ziggy_pc/.claude/worktrees/motion-lab/frontend/src/components/layout/AppShell.jsx:334-336`

```jsx
        {motionOn ? (
          <div data-motion-enter={enterBack ? 'back' : true} key={location.pathname}>{routed}</div>
        ) : routed}
```

**(ii) The rationale / two failed exit handshakes** — `AppShell.jsx:306-333`

```jsx
        {/* No page-transition wrapper.
            Two prior attempts at a transition both failed:
              - mode="wait" + motion.div: AnimatePresence's exit→enter
                handshake can be dropped if the parent re-renders mid-
                transition (WS connect/disconnect, store updates fanning out,
                sibling ToastContainer animating). Result: new motion.div
                mounts stuck at `opacity: 0`, page goes black.
              - No mode="wait" + motion.div: both old and new motion.divs
                render simultaneously as siblings in normal flow, stacking
                vertically. The new page lands below the viewport, the old
                fades out, and the visible area goes blank.
            Pages just snap in — 0.15s of animation isn't worth a recurring
            black-screen failure mode. ErrorBoundary keyed on pathname still
            resets per-route.

            The motion layer does NOT reintroduce one. The enter below is a
            keyed CSS animation on a wrapper that mounts with the new route —
            no AnimatePresence, no exit, no handshake that can be dropped, and
            nothing that can leave a page stuck at opacity: 0. With the flag
            off the wrapper is not rendered at all.

            The attribute carries the direction. It stays `data-motion-enter`
            with a VALUE rather than becoming a second attribute because
            morph.js does `el.closest('[data-motion-enter]')` to cancel the
            page enter when a shared-element morph runs — that lookup has to
            keep finding the wrapper in both directions. Forward renders the
            literal `true` a bare JSX data attribute has always produced, so
            a PUSH is byte-for-byte the DOM it was. */}
```

**(iii) Where production already computes direction (reuse this, do not re-derive)** — `AppShell.jsx:166-206`, the pinned-per-history-entry `enterDir` and the reason `useNavigationType()` cannot be used here:

```jsx
  // THE DIRECTION DOES NOT COME FROM useNavigationType() HERE, AND CANNOT.
  // AppShell renders under App.jsx's `<Routes location={...}>` — the
  // background-location pattern the device sheet needs — and react-router
  // wraps a location-prop Routes in a LocationContext whose navigationType is
  // the literal Action.Pop (react-router/dist, `if (locationArg &&
  // renderedMatches)`). So down here the hook answers POP for every
  // navigation including plain forward ones, which was measured on the dev
  // server before this was written: forward to /rooms reported POP. The
  // history idx is the signal that survives that, and it is strictly better
  // anyway — it tells the browser's FORWARD button (idx rises) apart from its
  // back button, which navigationType calls POP either way.
  //
  // The first load of the app is the entry the shell started on: its key never
  // changes, so the branch below never runs and a cold start can only ever be
  // an arrival. That is the "POP on first load" trap, closed by construction
  // rather than by a flag that has to be set at the right moment.
  const enterDir = useRef({ key: location.key, idx: historyIdx(), back: false })
  if (enterDir.current.key !== location.key) {
    const idx = historyIdx()
    const prev = enterDir.current.idx
    enterDir.current = {
      key: location.key,
      idx,
      back: idx !== null && prev !== null && idx < prev,
    }
  }
  const enterBack = enterDir.current.back
```
with `historyIdx()` at `AppShell.jsx:35-40`. This `enterBack` boolean is the production substitute for the lab's `room ? … : …` ternary; `rtl` for `sign` is already in scope at `AppShell.jsx:162` (`useIsRTL()`).

**(iv) Why a two-page port is structurally hard here:** `routed` is a *single* `<Outlet/>` under one `Suspense` + `ErrorBoundary`, created at `AppShell.jsx:265-271`:

```jsx
  const routed = (
    <Suspense fallback={<div aria-hidden style={{ minHeight: '60vh' }} />}>
      <ErrorBoundary label={`route:${location.pathname}`} key={location.pathname} fullHeight={false}>
        <Outlet />
      </ErrorBoundary>
    </Suspense>
  )
```
To keep both pages mounted, the lab's pattern needs an `AnimatePresence` around a keyed wrapper whose child is the `Outlet` for *that* location — i.e. `App.jsx`'s `<Routes location={...}>` must be fed the outgoing location for the exiting copy. Note `<main>` (`AppShell.jsx:282-298`) is the scroller with `overflow-y-auto` + `.pb-nav` and is **not** `position: relative`; the lab requires an `overflow:hidden` relatively-positioned stage with two `position:absolute; inset:0` children. Also note `motion.css:388` — `[data-pressing] :is([style*="position: fixed"], .fixed) { transform: none; }` — the hygiene rule about a transform trapping fixed children (`motion.css:383-388`); transforming `<main>` makes it the containing block for anything fixed inside a page.

**(v) The CSS this replaces** — `/Users/YouvalPolacsek/ziggy_pc/.claude/worktrees/motion-lab/frontend/src/motion/motion.css:144-188`

```css
/* ── Page enter ──────────────────────────────────────────────────────────
 * A quiet rise, no exit animation. There is deliberately no exit handshake
 * here: AppShell's own comment records two attempts at an exit-based page
 * transition that black-screened the app when the handshake was dropped. */

[data-motion="on"] [data-motion-enter] {
  animation: zm-page-in var(--m-dur-page) var(--m-glide) backwards;
}
@keyframes zm-page-in {
  from { opacity: 0; transform: translate3d(0, 8px, 0); }
  to   { opacity: 1; transform: none; }
}

/* Back is not an arrival.
 *
 * Every navigation used to play the rise above, so returning to a page you
 * had just left said "here is something new" about somewhere you had already
 * been. That mismatch is the thing that reads as "not smooth" going back —
 * the direction is wrong, not the frame rate. A return should read as the
 * world receding to where you already were: the page comes back TOWARD you,
 * a hair oversized, and settles. Same two properties, opposite story.
 *
 * 1.2%, and no travel at all. On a 390px phone that is ~5px of growth across
 * the whole page, on a 1440px desktop ~17px — the same order as the forward
 * 8px rise, so neither direction shouts louder than the other. Past roughly
 * 2% a full-bleed hero photograph visibly pushes past its own edges on a wide
 * screen, and the wrapper is the whole routed page, so whatever it does the
 * hero does too.
 *
 * --m-out, not --m-glide. The comment on --m-glide says it exists for
 * movement across a distance and that a strong ease-out is right for a 4px
 * press; 1.2% of scale is nearer the press than the journey, so the decisive
 * ease-out is the curve that settles it. Glide's held middle speed would just
 * stretch a non-move.
 *
 * Enter-only, like everything else here: this is still the one keyed wrapper
 * mounting with the new route, with no exit and no handshake to drop. */

[data-motion="on"] [data-motion-enter="back"] {
  animation: zm-page-back var(--m-dur-page-back) var(--m-out) backwards;
}
@keyframes zm-page-back {
  from { opacity: 0; transform: scale3d(1.012, 1.012, 1); }
  to   { opacity: 1; transform: none; }
}
```
Tokens: `--m-dur-page: calc(340ms * var(--m-scale))`, `--m-dur-page-back: calc(260ms * var(--m-scale))`, `--m-glide`, `--m-drawer` — `motion.css:34-51`. Reduced-motion collapse of both directions (with the specificity note): `motion.css:346-356`.

**(vi) Other `data-motion-enter` consumers that a rewrite must not break:** `morph.js:196` (`el.closest?.('[data-motion-enter]')`, cancelling the page enter while a shared-element morph runs, comment at `morph.js:189-196`) and `morph.js:331-333` (`pageEnterProps()` emits `'data-motion-enter': 'true'` with an `animationDelay`). Also `AppShell.jsx:242-254` explicitly clears `<main>`'s transform before paint on every route change:

```jsx
  // Motion: land every route with the bar shown and <main> untransformed.
  // A committed swipe-back leaves main translated off-screen (that IS the
  // exit), and the gesture hook only clears it when it unbinds — which does
  // not happen when one detail route replaces another. Clearing here, before
  // paint, means the new page can never arrive off-screen.
  useLayoutEffect(() => {
    setNavTucked(false)
    const el = mainRef.current
    if (!el) return
    el.style.transition = ''
    el.style.transform = ''
    el.style.willChange = ''
  }, [location.pathname])
```
— i.e. today `<main>`'s transform channel is owned by `useSwipeBack` + this reset. A parallax push that animates the same element is a third writer.

---

# 6. tabs → variant **C "Blur crossfade"** → `DeviceDetail.jsx` + `Actions.jsx`

## 6a. Lab implementation

`/Users/YouvalPolacsek/ziggy_pc/.claude/worktrees/motion-lab/frontend/src/lab/sections/PageTransitions.jsx:365-373`

```jsx
      {variant === 'C' && (
        <motion.div layout transition={tx({ type: 'spring', duration: knobs.duration, bounce: 0 })} style={{ position: 'relative' }}>
          <AnimatePresence initial={false} mode="popLayout">
            <motion.div key={tab} initial={{ opacity: 0, filter: 'blur(3px)', y: 4 }} animate={{ opacity: 1, filter: 'blur(0px)', y: 0 }} exit={{ opacity: 0, filter: 'blur(3px)', y: -4 }} transition={tx({ duration: knobs.duration * 0.8, ease: EASE.out })}>
              <TabContent tab={tab} t={t} />
            </motion.div>
          </AnimatePresence>
        </motion.div>
      )}
```

Knob: `duration` default `0.26` (the owner's value) — `PageTransitions.jsx:636` → `knobs={[{ key: 'duration', label: 'Duration', min: 0.12, max: 0.6, step: 0.02, value: 0.26, unit: 'ms' }]}`. So: crossfade = `{ duration: 0.26 * 0.8 = 0.208, ease: EASE.out }`, height spring = `{ type:'spring', duration: 0.26, bounce: 0 }`. Variant descriptor — `:641`:

```jsx
          { key: 'C', label: 'Blur crossfade', note: 'No direction; 3px blur crossfade with a 4px rise. Quieter, still tells you something changed.', render: (p) => <TabsDemo {...p} variant="C" /> },
```

**Mechanism notes for the port:** `mode="popLayout"` takes the exiting copy out of flow so the two panes overlap instead of stacking; the outer `motion.div layout` animates the container's height so the page below does not jump; no `custom`/direction is used (unlike B/D at `:324-328` and `:338-342`).

**Host component, including the segmented pill the lab animates with `layoutId`** — `PageTransitions.jsx:330-385` (header portion):

```jsx
function TabsDemo({ variant, knobs, tx, rtl }) {
  const [tab, setTab] = useState('controls')
  const prev = useRef(0)
  const t = useT(); const h = useHaptic()
  const idx = TAB_KEYS.indexOf(tab)
  const dir = idx >= prev.current ? 1 : -1
  useEffect(() => { prev.current = idx }, [idx])
  const sign = rtl ? -1 : 1
  const axis = {
    enter: (d) => ({ x: 30 * d, opacity: 0 }),
    center: { x: 0, opacity: 1, transition: tx({ duration: 0.21, delay: 0.09, ease: EASE.standard }) },
    exit: (d) => ({ x: -30 * d, opacity: 0, transition: tx({ duration: 0.09, ease: EASE.standard }) }),
  }
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
```

Note the lab's pill is a `layoutId` spring `{ duration: 0.36, bounce: 0.1 }` (hardcoded, **not** the 0.26 knob) and the tap fires `h('selection')`. `TAB_KEYS = ['controls','info']` (`:304`); `TabContent` (`:305-320`) returns a **single** subtree per tab — the structural precondition the production sites do not satisfy.

**Dependencies:** framer-motion `AnimatePresence`+`motion`+`LayoutGroup`, `Page` primitive (`primitives.jsx:95-105`), `useHaptic`, `useT`, `EASE.out`, lab `Card`/`Button`/`.zl-chip`/`.zl-stack`.

## 6b. Production landing site #1 — `DeviceDetail.jsx`

**The segmented control** (`:1172-1204`, the owner's range) — pure CSS colour transitions, no pill, no content animation:

```jsx
      {/* ── Tab switcher (only when there's something to control). Segmented
            control: 44px buttons, active = surface + hairline, no inversion. ── */}
      {hasControls && (
        <div role="tablist" style={{
          display: 'flex', gap: 4, padding: 3, marginBottom: 12,
          background: 'var(--surface-2)', borderRadius: 'var(--r-card)',
        }}>
          {[
            { id: 'controls', label: t('deviceDetail.tabControls') },
            { id: 'data',     label: t('deviceDetail.tabInfo') },
          ].map(tab => {
            const active = activeTab === tab.id
            return (
              <button
                key={tab.id}
                role="tab"
                aria-selected={active}
                onClick={() => setActiveTab(tab.id)}
                style={{
                  flex: 1, minHeight: 40, padding: '0 12px', borderRadius: 'var(--r-ctl)',
                  background: active ? 'var(--surface)' : 'transparent',
                  color: active ? 'var(--ink)' : 'var(--ink-mute)',
                  border: '0.5px solid ' + (active ? 'var(--line)' : 'transparent'),
                  cursor: 'pointer',
                  fontFamily: 'inherit', fontSize: 13, fontWeight: 600,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                  transition: 'background var(--dur-state) var(--ease-standard), color var(--dur-state) var(--ease-standard), border-color var(--dur-state) var(--ease-standard)',
                }}
              >
                {tab.label}
              </button>
            )
          })}
        </div>
      )}
```
Note: `onClick` fires **no haptic** here (the lab fires `h('selection')`), and there is no `layoutId` pill — the active state is an inline `background`/`border` swap with a `var(--dur-state)` transition.

**State and the gates** — `DeviceDetail.jsx:584` and `:1088-1092`:

```jsx
  const [activeTab, setActiveTab] = useState('controls')
```
```jsx
  // Tabs: every device gets Control + Info now (sensors get the SensorRemote
  // as their Control view, which is read-only but still useful).
  const hasControls   = facts.meta.controllable || facts.kind !== KIND.UNKNOWN
  const showControls  = !hasControls || activeTab === 'controls'
  const showData      = !hasControls || activeTab === 'data'
```

**⚠️ The blocker the plan must call out:** the tab bodies are **not two subtrees** — they are **15 sibling conditional blocks** interleaved at the page's top level, all direct children of the page container opened at `DeviceDetail.jsx:1099` (`<div style={{ maxWidth: 'var(--page-max-w-narrow)', margin: '0 auto', padding: '24px 20px 24px' }}>`):

```
DeviceDetail.jsx:1219  {showControls && !facts.isAvailable && !onExit && ( …recovery affordance… )}
DeviceDetail.jsx:1253  {showControls && ( <> …DeviceRemote card, CameraPanel, entity-id footer… </> )}   // ends :1307
DeviceDetail.jsx:1320  {showData && ( …identity card… )}
DeviceDetail.jsx:1375  {showData && hasDiagnostics && ( … )}
DeviceDetail.jsx:1412  {showData && ( … )}
DeviceDetail.jsx:1425  {showData && ha_device && (ha_device.manufacturer || ha_device.model) && ( … )}
DeviceDetail.jsx:1438  {showData && facts.linkedIr && ( … )}
DeviceDetail.jsx:1480  {showData && facts.capabilities.size > 0 && ( … )}
DeviceDetail.jsx:1494  {showData && usefulSiblings.length > 0 && ( … )}
DeviceDetail.jsx:1533  {showData && automations_using.length > 0 && ( … )}
DeviceDetail.jsx:1562  {showData && ( … )}
DeviceDetail.jsx:1630  {showData && group && ( … )}
DeviceDetail.jsx:1724  {showData && <WhoCanUse entityId={entityId} />}
DeviceDetail.jsx:1727  {showData && ( <Card className="p-4"> …danger zone… )}
```

So porting variant C requires first wrapping `:1219-1307` in one `<motion.div key="controls">` and `:1320`-onward `showData` blocks in one `<motion.div key="data">`, inside one `AnimatePresence mode="popLayout"` with an outer `layout` container — and note `showControls`/`showData` are *both* true when `!hasControls` (`:1091-1092`), which would make two keyed children live simultaneously; that case must be special-cased or both keys will mount.

**i18n keys:** `deviceDetail.tabControls`, `deviceDetail.tabInfo` — `en.js:541-542` (`'Controls'`, `'Info'`), `he.js:539-540` (`'בקרות'`, `'מידע'`). Framer-motion is **not currently imported** in `DeviceDetail.jsx` (grep for `motion.`/`AnimatePresence` returns nothing).

## 6c. Production landing site #2 — `Actions.jsx`

Already uses `AnimatePresence mode="wait"` + `FADE_UP`, which is the thing to replace. Imports at `/Users/YouvalPolacsek/ziggy_pc/.claude/worktrees/motion-lab/frontend/src/pages/Actions.jsx:3,13`:

```jsx
import { motion, AnimatePresence } from 'framer-motion'
…
import { FADE_UP } from '../lib/motion'
```

Tab state — `Actions.jsx:51`: `const [tab, setTab] = useState('automations')`.

**The tab bar** — `Actions.jsx:452-477`:

```jsx
      {/* Tab switcher — two tabs on one conceptual line: what runs
          automatically (Automations) vs what you trigger (Routines). Library
          and Suggested moved into the Automations tab as a modal + inline
          nudges; Quick-asks split out to Chat/Dashboard chips. */}
      <div role="tablist" style={{ display: 'flex', gap: 4, padding: 4, background: 'var(--surface-2)', borderRadius: 'var(--r-ctl)', marginBottom: 20, overflowX: 'auto' }}>
        {[
          { id: 'automations', label: t('automations.tabAutomatic'),  count: enabled },
          { id: 'routines',    label: t('automations.tabOnDemand'),   count: routines.length },
        ].map(tabDef => {
          const active = tab === tabDef.id
          return (
            <button key={tabDef.id} role="tab" aria-selected={active} onClick={() => setTab(tabDef.id)} style={{
              flex: '1 0 auto', minHeight: 40, padding: '0 16px', borderRadius: 'var(--r-ctl)', fontFamily: 'inherit', cursor: 'pointer',
              background: active ? 'var(--surface)' : 'transparent',
              border: `0.5px solid ${active ? 'var(--line)' : 'transparent'}`,
              fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap',
              color: active ? 'var(--ink)' : 'var(--ink-mute)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              transition: 'background var(--dur-state) var(--ease-standard), color var(--dur-state) var(--ease-standard)',
            }}>
              {tabDef.label}
              {tabDef.count > 0 && <span className="z-mono" style={{ fontSize: 12, fontWeight: 500, color: 'var(--ink-faint)' }}>{tabDef.count}</span>}
            </button>
          )
        })}
      </div>
```

**The exact lines variant C replaces** — `Actions.jsx:479-483`, `:583-593`:

```jsx
      <AnimatePresence mode="wait">

      {/* ─── Automations tab ─── */}
      {tab === 'automations' && (
        <motion.div key="automations" {...FADE_UP}>
```
```jsx
        </motion.div>
      )}

      {/* ─── Routines tab ─── */}
      {tab === 'routines' && (
        <motion.div key="routines" {...FADE_UP}>
          <RoutinesListPanel embedded />
        </motion.div>
      )}

      </AnimatePresence>
```

`FADE_UP` is `/Users/YouvalPolacsek/ziggy_pc/.claude/worktrees/motion-lab/frontend/src/lib/motion.js:26-31`:

```js
export const FADE_UP = {
  initial: { opacity: 0, y: 6 },
  animate: { opacity: 1, y: 0 },
  exit:    { opacity: 0, y: -4 },
  transition: T_ENTER,
}
```
with `T_ENTER = { duration: 0.24, ease: EASE_ENTER }` (`lib/motion.js:22`, `DUR_ENTER = 0.24` at `:13`, `EASE_ENTER = [0.16,1,0.3,1]` at `:16`). Lab C wants `{ duration: 0.208, ease: EASE.out = [0.23,1,0.32,1] }` plus `filter: blur(3px)` and `y: ±4`, under `mode="popLayout"` not `mode="wait"`, inside a `layout` height spring.

**Gotcha inside the Automations branch:** there is a **nested** `AnimatePresence mode="popLayout"` around the automations list (`Actions.jsx:521-565`) and a `layoutKey` string recomputed from the tab (`Actions.jsx:160-163`):

```jsx
  // in a slide. Keyed on the counts the user changes (a delete, the tab), a
  const layoutKey = `${tab}|${smartRoomGroups.length}|${visibleAutomations.length}`
```
threaded into `CircadianGroupRow`/`ClimateGroupRow`/`SmartRoomGroupRow`/`AutomationCard` (`:525,537,549,559`). Switching the outer mode to `popLayout` while a nested `popLayout` is live, plus adding an outer `layout` container, needs checking against that.

**i18n keys:** `automations.tabAutomatic`, `automations.tabOnDemand` — `en.js:927-928` (`'Automatic'`, `'On-demand'`), `he.js:922-923`. Also `automations.tabSuggested` (`en.js:946`) for the modal title at `Actions.jsx:656`.

---

# 7. swipe-back → variant **C "Rubber-band edge"** → `gestures.js useSwipeBack` + `AppShell.jsx`

## 7a. Lab implementation (full, variant-C lines marked)

`/Users/YouvalPolacsek/ziggy_pc/.claude/worktrees/motion-lab/frontend/src/lab/sections/PageTransitions.jsx:514-597`

```jsx
/* ───────────────────────── SWIPE BACK ───────────────────────── */

// variant A: parallax under-page · B: depth reveal · C: rubber-band onset then A
function SwipeBack({ knobs, tx, rtl, variant = 'A' }) {
  const [open, setOpen] = useState(true)
  const t = useT(); const h = useHaptic()
  const x = useMotionValue(0)
  const peel = useMotionValue(1)
  const W = 390
  const sign = rtl ? -1 : 1
  const PEEL = 32
  const prog = useTransform(x, (v) => Math.min(1, Math.max(0, (v * sign) / W)))
  const under = useTransform(prog, (p) => (p - 1) * knobs.parallax * W * sign)
  const scrim = useTransform(prog, (p) => 0.35 * (1 - p))
  const underScale = useTransform(prog, (p) => 0.94 + 0.06 * p)
  const depthScrim = useTransform(prog, (p) => 0.4 * (1 - p))
  const depthShadow = useTransform(prog, (p) => `0 0 24px rgba(0,0,0,${(0.08 + 0.24 * Math.min(1, p * 3)).toFixed(3)})`)
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
    if (variant === 'C') {
      // the first 32px stretch the leading edge; only then does the page travel
      if (dx <= 0) { x.set(dx * 0.18 * sign); peel.set(1); return }
      if (dx <= PEEL) { x.set(0); peel.set(1 + 0.04 * (dx / PEEL)); return }
      const travel = dx - PEEL
      x.set(travel * sign)
      peel.set(1 + 0.04 * Math.max(0, 1 - travel / 48))
      return
    }
    x.set(dx > 0 ? dx * sign : dx * 0.18 * sign)
  }
  const commit = () => {
    animate(peel, 1, tx({ duration: 0.16, ease: EASE.out }))
    return animate(x, W * sign, tx({ duration: 0.24, ease: EASE.out })).then(() => { setOpen(false); h('medium') })
  }
  const onUp = () => {
    if (!dragging.current) return
    dragging.current = false
    const dx = x.get() * sign
    if (dx > W * 0.3 || vel.current.v > 500) commit()
    else {
      animate(x, 0, tx({ type: 'spring', duration: 0.36, bounce: 0.1 }))
      animate(peel, 1, tx({ type: 'spring', duration: 0.3, bounce: 0.2 }))
    }
  }
  useEffect(() => { if (open) { x.set(0); peel.set(1) } }, [open, x, peel])
  const hint = {
    A: `drag from the ${rtl ? 'right' : 'left'} edge · commit past 30% or a flick`,
    B: `drag from the ${rtl ? 'right' : 'left'} edge · the list comes forward from behind`,
    C: `drag from the ${rtl ? 'right' : 'left'} edge · the first 32px peel, then it travels`,
  }[variant]
  const underStyle = variant === 'B'
    ? { scale: open ? underScale : 1, position: 'absolute', inset: 0, transformOrigin: '50% 50%' }
    : { x: open ? under : 0, position: 'absolute', inset: 0 }
  const pageShadow = variant === 'B' ? depthShadow : `${-12 * sign}px 0 40px rgba(0,0,0,.18)`
  return (
    <div className="zl" style={{ position: 'absolute', inset: 0, overflow: 'hidden' }}>
      <motion.div style={underStyle}>
        <RoomsScreen onOpen={() => { setOpen(true) }} />
        <motion.div style={{ opacity: open ? (variant === 'B' ? depthScrim : scrim) : 0, position: 'absolute', inset: 0, background: '#000', pointerEvents: 'none' }} />
      </motion.div>
      {open && (
        <motion.div style={{ x, scaleX: variant === 'C' ? peel : 1, transformOrigin: rtl ? '0% 50%' : '100% 50%', position: 'absolute', inset: 0, zIndex: 2, background: 'var(--bg)', boxShadow: pageShadow, touchAction: 'pan-y' }}
          onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
          <RoomScreen room={ROOMS[0]} onBack={() => { commit() }} />
          <div className="ml-hint">{hint}</div>
        </motion.div>
      )}
    </div>
  )
}
```

Knob: `parallax` default `0.3` (the owner's value) — `PageTransitions.jsx:655` → `knobs={[{ key: 'parallax', label: 'Under-page parallax (A, C)', min: 0, max: 0.5, step: 0.05, value: 0.3 }]}`. Variant descriptor — `:660`:

```jsx
          { key: 'C', label: 'Rubber-band edge', note: 'The first 32px of drag stretch the page\'s leading edge (scaleX 1→1.04 from the trailing edge) before it starts to move: a physical peel that tells the finger the gesture was recognised. Then it behaves like A.', tradeoff: '32px of "recognised but not yet moving" is felt as resistance on a fast flick.', render: (p) => <SwipeBack {...p} variant="C" /> },
```

**C-specific summary for the implementer:** a second motion value `peel` (`:521`) drives `scaleX` on the dragged page (`:589`) with `transformOrigin: rtl ? '0% 50%' : '100% 50%'` (the *trailing* edge, so the leading edge stretches). `PEEL = 32` (`:524`). Three regimes in `onMove` (`:547-555`): wrong direction → `x = dx*0.18*sign`, `peel = 1`; `0 < dx ≤ 32` → `x = 0`, `peel = 1 + 0.04*(dx/32)`; `dx > 32` → `x = (dx-32)*sign`, `peel = 1 + 0.04*max(0, 1 - travel/48)` (the stretch relaxes over the next 48px). Release: `peel` returns on a spring `{duration:0.3, bounce:0.2}` (`:569`) or a 160ms tween on commit (`:559`). Commit thresholds and the under-page parallax are identical to A: `dx > W*0.3 || v > 500` (`:566`), under-page `x = (p-1)*0.3*W*sign` (`:526`), scrim `0.35*(1-p)` (`:527`), page shadow `-12*sign px 0 40px rgba(0,0,0,.18)` (`:581`), `touchAction: 'pan-y'` (`:589`).

**Dependencies:** framer-motion `useMotionValue`/`useTransform`/`animate` + `motion.div` (imperative, no `AnimatePresence`), `useHaptic` (`h('medium')` on commit, `:560`), `EASE.out`, `RoomsScreen`/`RoomScreen`, a local hand-rolled velocity EMA (`:533,544-546`), `W = 390` hardcoded (production reads `r.width`).

## 7b. Production landing site

**(i) `useSwipeBack`** — `/Users/YouvalPolacsek/ziggy_pc/.claude/worktrees/motion-lab/frontend/src/motion/gestures.js:59-166`. Constants `:67-69`:

```js
const COMMIT_FRACTION = 0.3
const COMMIT_VELOCITY = 500
const EDGE = 32
```

```js
export function useSwipeBack(ref, onBack, { enabled = true, rtl = false } = {}) {
  const state = useRef(null)
  const vel = useRef(makeVelocityTracker())

  useEffect(() => {
    const el = ref.current
    if (!el || !enabled || !isMotionOn()) return
    const sign = rtl ? -1 : 1

    const paint = (dx) => {
      el.style.transition = 'none'
      el.style.transform = dx ? `translate3d(${dx}px,0,0)` : ''
      el.style.willChange = dx ? 'transform' : ''
    }
    const settle = (dx, ms, then) => {
      el.style.transition = `transform ${ms}ms ${CSS_EASE.out}`
      el.style.transform = dx ? `translate3d(${dx}px,0,0)` : 'translate3d(0,0,0)'
      // `transitionend` can fire more than once (one event per property) and
      // the timeout is a fallback for when it does not fire at all, so the
      // completion MUST be idempotent. Without this guard a committed swipe
      // called navigate(-1) twice and went back two entries — off the end of
      // the app's history and onto a blank page.
      let finished = false
      let timer = null
      const finish = () => {
        if (finished) return
        finished = true
        clearTimeout(timer)
        el.removeEventListener('transitionend', finish)
        el.style.transition = ''
        el.style.willChange = ''
        if (!then) el.style.transform = ''
        then?.()
      }
      el.addEventListener('transitionend', finish)
      timer = setTimeout(finish, ms + 80)
    }

    const down = (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return
      const r = el.getBoundingClientRect()
      const fromEdge = rtl ? r.right - e.clientX : e.clientX - r.left
      if (fromEdge > EDGE) return
      // Never start over something the person is actually using.
      if (e.target.closest?.('button, a, input, select, textarea, [role="slider"], [role="button"], [data-no-swipe]')) return
      state.current = { x0: e.clientX, y0: e.clientY, locked: null, w: r.width }
      vel.current.start(e.clientX)
    }

    const move = (e) => {
      const s = state.current
      if (!s) return
      const dx = (e.clientX - s.x0) * sign
      const dy = e.clientY - s.y0
      if (s.locked === null) {
        if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return
        // Direction lock: a mostly-vertical start belongs to the scroller.
        s.locked = Math.abs(dx) > Math.abs(dy)
        if (!s.locked) { state.current = null; return }
        el.setPointerCapture?.(e.pointerId)
      }
      vel.current.move(e.clientX)
      // Resist the wrong direction rather than refusing it outright.
      const travel = dx < 0 ? dx * 0.18 : dx
      paint(travel * sign)
      e.preventDefault()
    }

    const up = () => {
      const s = state.current
      if (!s) return
      state.current = null
      if (s.locked !== true) return
      const dx = (parseFloat(el.style.transform.replace(/[^-\d.]/g, '')) || 0) * sign
      const v = vel.current.get() * sign
      if (dx > s.w * COMMIT_FRACTION || v > COMMIT_VELOCITY) {
        settle(s.w * sign, 240, () => onBack?.())
      } else {
        settle(0, 200)
      }
    }

    el.addEventListener('pointerdown', down, { passive: true })
    el.addEventListener('pointermove', move, { passive: false })
    el.addEventListener('pointerup', up, { passive: true })
    el.addEventListener('pointercancel', up, { passive: true })
    return () => {
      el.removeEventListener('pointerdown', down)
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
      el.removeEventListener('pointercancel', up)
      el.style.transform = ''
      el.style.transition = ''
    }
  }, [ref, onBack, enabled, rtl])
}
```

**Port-critical differences from the lab:**
1. Production writes **`el.style.transform = translate3d(dx,0,0)` as a string** and later **re-parses it** to recover `dx` (`:144`: `parseFloat(el.style.transform.replace(/[^-\d.]/g,''))`). Adding `scaleX(peel)` to that string **breaks the parse** — the regex would swallow the scale digits. Port must store `dx` in the `state` ref (or a separate motion value) before adding a second transform function. Same hazard in `useSheetDetents` (`:222`, `:245`), though that is a different element.
2. Production has **no `peel` channel and no `transform-origin`**; the element is `<main>` (a scroller), so a `scaleX` on it scales the entire page content and its scrollbar gutter (`AppShell.jsx:297`).
3. Production has **no under-page at all** — nothing to apply `knobs.parallax 0.3` to. The lab's `under`/`scrim` transforms (`:526-527`) have no production counterpart; a parallax needs the second mounted page from pick #5. This makes picks #5 and #7 a single piece of work.
4. Production **direction-locks** (`:125-131`) and **refuses to start on a control** (`:115`); the lab does neither. Keep both.
5. Velocity: production `makeVelocityTracker()` (`src/motion/motion.js:129-145`, EMA `v*0.5 + (Δ/dt)*0.5`, returns px/s via `*1000`) vs the lab's inline `v*0.5 + (Δ/dt)*500` (`:545`). Use the production tracker.
6. Settle timings: production `240ms CSS_EASE.out` on commit, `200ms` on cancel (`:147-149`), both CSS transitions with the idempotent `transitionend`+timeout guard (`:88-106`). The lab uses `animate(x, …)` 240ms commit and a **spring** `{duration:0.36, bounce:0.1}` cancel (`:568`) — a spring cannot be expressed as a CSS `transition`, so porting the cancel either keeps 200ms ease-out or moves this hook to framer-motion `animate()` and gives up the string-transform contract.
7. `EDGE = 32` already equals the lab's `PEEL = 32` by coincidence — the peel consumes exactly the edge width.

**(ii) `AppShell.jsx:216`** — the single call site:

```jsx
  useSwipeBack(mainRef, onBack, { enabled: motionOn && isDetail && !isChatRoute, rtl })
```
with the preceding comment and `onBack` at `AppShell.jsx:208-215`:

```jsx
  // Swipe back: the <main> scroller follows the finger from the leading edge
  // and commits past 30% of the width or on a 500px/s flick. The hook
  // direction-locks, refuses to start on top of a control, and springs back
  // below the threshold, so the gesture is always cancellable.
  const onBack = useCallback(() => {
    haptic('medium')
    navigate(-1)
  }, [navigate])
```
`isDetail` comes from `DETAIL_RE` — `AppShell.jsx:24-25`:
```js
// Routes that are "one level in" — the ones where a back gesture has an
// obvious meaning. Everything else keeps the plain behaviour.
const DETAIL_RE = /^\/(?:rooms|devices|remote|ir-walk|settings)\/[^/]+/
```
(tested at `:163`), `rtl` at `:162`, `motionOn` at `:161`, `mainRef` at `:152` → attached `:283`.

**(iii) `AppShell.jsx:247-254`** — the per-route transform reset that is the current "exit", quoted in full in §5b(vi) above. A peel adds `scaleX`/`transform-origin`/`willChange` to the set of properties this must clear.

Target element styles that constrain the port — `AppShell.jsx:282-298`: `<main>` is `flex-1 min-w-0 overflow-y-auto scrollbar-thin pb-nav`, `paddingTop: var(--safe-top)`, `scrollbarGutter: 'stable'`, and carries `onScroll` (pick #3's `useScrollChrome`). No `position: relative`, no `overflow-x: hidden` on an ancestor other than the flex row at `:279`.

---

# Cross-cutting notes for the plan

1. **Knob fidelity.** Only three picks actually read the owner's knobs: more-menu C (0.32 / 0.12 / 0.04 — exact), sidebar C (0.4 / 0.1 — exact), push B (0.42 duration / 0.3 parallax — exact; `bounce` unused), tabs C (0.26 — exact), swipe-back C (0.3 parallax — exact). **nav-active H ignores knobs** (hardcoded 0.42/0.15 at `Navigation.jsx:325`; `stretch 0.6` belongs to variant B only). **nav-scroll B has no knobs at all** (hardcoded 56→38px, spring 0.4/0 at `Navigation.jsx:560`).
2. **Three picks fight an explicit production decision**, each documented in-code: more-menu C needs `AnimatePresence` (`BottomNav.jsx:235-241`, `:152-156`, `motion.css:291-297`); push B needs both pages mounted (`AppShell.jsx:306-333`, `motion.css:144-147`); sidebar C removes the surface the hand-over rule at `motion.css:283-289` depends on.
3. **`src/motion/motion.js` has no `enter`/`standard` curves.** The lab's `EASE.enter [0.16,1,0.3,1]` and `EASE.standard [0.2,0,0,1]` exist only in `src/lib/motion.js:15-16` and as the `--ease-enter`/`--ease-standard` CSS tokens aliased at `motion.css:26-27`. Any port using them must import from `src/lib/motion.js` or add them to `src/motion/motion.js:20-34` (both `EASE` and `CSS_EASE`).
4. **Everything must stay gated.** `useMotionOn()` / `isMotionOn()` (`src/motion/flag.js`) and the `[data-motion="on"]` scope; `flag.js:17-20` states the resting-appearance equivalence requirement (SSIM 1.000000 with the layer off) that pick #4 in particular threatens.
5. **Reduced motion** has explicit per-hook overrides that each port must extend: `motion.css:343-376` (nav tuck `:366,374`, nav-hl `:368,375`, more menu `:369`, page enter both directions `:352-356` with the specificity note at `:346-351`).
