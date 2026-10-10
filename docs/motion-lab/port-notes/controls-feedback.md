# Port notes — Controls + Feedback (extracted 2026-10-10 from feat/motion-lab)

# Port report — Motion Lab → production

Paths are absolute under `/Users/YouvalPolacsek/ziggy_pc/.claude/worktrees/motion-lab/`.

---

## Lab helper layer (applies to every pick)

Every lab variant receives `{ knobs, replayKey, replay, rtl, reduced, speed, tx, ms, stage }` from `Demo`.

`frontend/src/lab/ui/Demo.jsx:48-72`
```jsx
export function Demo({ id, title, purpose, principles = [], inZiggy = [], variants = [], knobs = [], stage = 'phone', height, wide = false, children, recommend, section, bare = false, activeNav }) {
  const [replayKey, setReplayKey] = useState(0)
  const [knobValues, setKnobValues] = useState(() => Object.fromEntries(knobs.map(k => [k.key, k.value])))
  ...
    knobs: knobValues, replayKey, replay,
    rtl: lab.rtl, reduced: lab.reduced, speed: lab.speed, tx: lab.tx, ms: lab.ms, stage,
```

`frontend/src/lab/LabContext.jsx:50-55` — `tx` / `ms` are **pure lab speed-scaling** and have NO production equivalent. Port rule: delete them.
```js
    // scale a framer-motion transition by the lab speed
    tx: (t) => scaleTransition(t, speed),
    // ms → ms scaled (for setTimeout choreography)
    ms: (n) => n / speed,
```
- `tx({...})` → pass the transition literal directly, or wrap in `safe()` from `frontend/src/motion/motion.js:81-83`.
- `ms(n)` → plain `n`.
- `cssEase('out'|'inOut'|...)` (`frontend/src/lab/time.js:68-71`) → `CSS_EASE.out` / `CSS_EASE.inOut` from `frontend/src/motion/motion.js:28-34` (identical cubic-beziers).
- `EASE.out/inOut/...` (`frontend/src/lab/time.js:46-55`) → `EASE` in `frontend/src/motion/motion.js:20-26` (identical values; the lab has extra `enter`, `std`, `standard`, `linear`; `EASE_ENTER` lives in `frontend/src/lib/motion.js:16`).
- `SPRING.snappy/gentle/calm/press/detent` (`lab/time.js:77-83`) → byte-identical to `frontend/src/motion/motion.js:46-52`.
- `useHaptic()` (`frontend/src/lab/LabContext.jsx:79-87`) → `haptic(kind)` from `frontend/src/motion/motion.js:104-108`. Patterns are identical (`lab` 83 vs `motion.js:91-99`). Lab additionally dispatches a `lab:haptic` CustomEvent — drop it.
- `useT()` + `COPY` (`frontend/src/lab/ziggy/primitives.jsx:38-45`, `frontend/src/lab/mock/home.js`) → `useT()` / `t as i18nT` from `frontend/src/lib/i18n`.
- `Icon name=` (`primitives.jsx:32-35`) → direct `lucide-react` imports.
- `Button`, `Card`, `Page`, `Tile`, `Row`, `Chip`, `Dot` (`primitives.jsx:47-105`) → `frontend/src/components/ui/Button.jsx`, `.z-card` / `.z-chip` / `.z-btn-primary` / `.z-btn-secondary` classes.
- `zl-*` classes from `frontend/src/lab/ziggy/ziggy.css` (`.zl-large:15`, `.zl-mono:23`, `.zl-chip:126-127`, `.zl-skel:130`) → `.z-display` / `.z-mono` / `.z-chip` / inline skeleton divs.
- `--lab-speed` CSS var (used in CSS-driven variants) → delete.

---

# 1. Brightness variant B — "Light well + room glow" (grow 10)

## 1a. Lab implementation

`frontend/src/lab/sections/Controls.jsx:395-428` (verbatim)
```jsx
function BrightnessB({ knobs, tx }) {
  // vertical light well + ambient glow; the room "receives" the brightness
  const t = useT(); const h = useHaptic()
  const [pct, setPct] = useState(45)
  const [held, setHeld] = useState(false)
  const ref = useRef(null)
  const lastTick = useRef(45)
  const set = (clientY) => {
    const r = ref.current.getBoundingClientRect()
    const p = Math.round(Math.min(100, Math.max(0, (1 - (clientY - r.top) / r.height) * 100)))
    setPct(p)
    if (Math.abs(p - lastTick.current) >= 5) { lastTick.current = p; h('selection') }
  }
  const glow = useSpring(pct, tx({ stiffness: 120, damping: 20 }))
  useEffect(() => { glow.set(pct) }, [pct, glow])
  const bg = useTransform(glow, [0, 100], ['rgba(201,100,66,0)', 'rgba(201,100,66,0.35)'])
  return (
    <motion.div className="zl" style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16, background: bg }}>
      <div style={{ textAlign: 'center' }}>
        <div className="zl-title3">{t({ en: 'Ceiling Light', he: 'תאורת תקרה' })}</div>
        <div className="zl-large zl-mono" style={{ fontSize: 44 }}>{pct}<span className="zl-title3 zl-mute">%</span></div>
      </div>
      <motion.div ref={ref} animate={{ width: held ? 108 : 96 }} transition={tx({ type: 'spring', duration: 0.3, bounce: 0.1 })}
        onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); setHeld(true); set(e.clientY) }}
        onPointerMove={(e) => held && set(e.clientY)}
        onPointerUp={() => setHeld(false)} onPointerCancel={() => setHeld(false)}
        style={{ position: 'relative', height: 300, borderRadius: 32, background: 'var(--surface-3)', overflow: 'hidden', touchAction: 'none', cursor: 'ns-resize', boxShadow: 'var(--shadow-md)' }}>
        <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: `${pct}%`, background: 'linear-gradient(to top, var(--accent), var(--accent-3))', transition: held ? 'none' : `height calc(0.2s * var(--lab-speed,1)) ${cssEase('out')}` }} />
        <div style={{ position: 'absolute', left: 0, right: 0, bottom: 20, display: 'grid', placeItems: 'center', color: pct > 12 ? 'var(--on-accent)' : 'var(--ink-mute)' }}><Icon name="lightbulb" size={28} /></div>
      </motion.div>
      <p className="zl-footnote zl-mute">Drag up and down. The page glows with the bulb: the room shows the effect, not just the number.</p>
    </motion.div>
  )
}
```

Knob declaration — `frontend/src/lab/sections/Controls.jsx:1181-1186`
```jsx
      <Demo id="brightness" title="Brightness" purpose="A continuous value under a finger. Never hide the number under the thumb; let the room show the effect." principles={['continuity', 'physical', 'hierarchy']} inZiggy={['components/ui/Slider.jsx', 'gestures.js useScrub', 'DeviceSheet.jsx']}
        knobs={[{ key: 'grow', label: 'Grow while held (A)', min: 0, max: 24, step: 1, value: 10, unit: 'px', digits: 0 }]}
        recommend="B"
```
Note: `grow: 10` is consumed **only by `BrightnessA`** (`Controls.jsx:382` → `animate={{ height: held ? 56 + knobs.grow : 56 }}`). `BrightnessB` hardcodes `width: held ? 108 : 96` (a +12.5% swell).

Lab dependencies to replace: `useHaptic` → `haptic('selection')`; `tx` → literal; `cssEase('out')` → `CSS_EASE.out`; `--lab-speed` → drop; `useT`/`Icon`/`zl-*` → production equivalents.

## 1b. Production landing site

`frontend/src/components/ui/DeviceControls.jsx:111-226` — `BrightnessLamp`, the full current component (well 128×184, level slide, handle growth). Exact code that must change:

**Signature / dimensions — `:114`**
```jsx
function BrightnessLamp({ value, onChange, onCommit, onTap, isOn, accentColor = 'var(--gold)', width = 128, height = 184 }) {
```

**Level-slide duration constants — `:85-99`**
```js
// shorter settle — it is a correction, not an event.
const POWER_OFF_MS = 260
const POWER_ON_MS = 300
const VALUE_MS = 180
// Grab and release, matching Slider.jsx.
const HOLD_IN = 160
const HOLD_OUT = 130
...
const BAR_GROW = 1.12
// How much a held thumb swells. 28px × 1.08 is ~1px of radius, the amount
// that reads as a grip on a knob this size.
const THUMB_GROW = 1.08
```

**Power-edge duration selection — `:123-131`**
```jsx
  const prevOn = useRef(isOn)
  const powerEdge = prevOn.current !== isOn
  useEffect(() => { prevOn.current = isOn })
  const levelMs = powerEdge ? (isOn ? POWER_ON_MS : POWER_OFF_MS) : VALUE_MS
```

**Drag math (vertical relative-drag, already the lab's gesture) — `:133-165`**
```jsx
  const onPointerDown = (e) => {
    e.currentTarget.setPointerCapture?.(e.pointerId)
    gesture.current = { ptr: e.pointerId, startY: e.clientY, startValue: pct, moved: false }
    detent.current = null
    setDragging(true)
  }
  const onPointerMove = (e) => {
    const g = gesture.current
    if (g.ptr !== e.pointerId || !trackRef.current) return
    const dy = g.startY - e.clientY
    if (!g.moved && Math.abs(dy) < 3) return
    g.moved = true
    const h = trackRef.current.offsetHeight
    const delta = (dy / Math.max(1, h)) * 100
    const next = Math.max(1, Math.min(100, Math.round(g.startValue + delta)))
    // One tick per 5% of brightness, never one per frame.
    if (isMotionOn()) detentTick(detent, next, 5)
    onChange(next)
  }
  const onPointerUp = (e) => { ... if (moved) { onCommit?.(pct) } else { onTap?.() } }
```
Detent step is already 5% — matches the lab's `>= 5` tick (`detentTick` at `:74-80`).

**The well element + its data-attribute hooks — `:167-187`**
```jsx
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
      <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-0.035em', color: 'var(--ink)', lineHeight: 1 }}>
        {isOn ? `${pct}%` : t('deviceControls.off')}
      </div>
      <div
        ref={trackRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        data-scrubbing={feel && dragging ? 'true' : undefined}
        data-motion-grow="well"
        data-motion-hold={feel && dragging ? 'true' : undefined}
        style={{
          position: 'relative', width, height, borderRadius: 16,
          background: 'var(--surface-3)', overflow: 'hidden',
          border: '0.5px solid var(--line)',
          cursor: 'pointer', userSelect: 'none', WebkitUserSelect: 'none', touchAction: 'none',
        }}
      >
```

**Fill + handle (the "handle growth") — `:193-222`**
```jsx
        {(isOn || feel) && (
          <>
            <div style={{
              position: 'absolute', left: 0, right: 0, bottom: 0,
              height: `${isOn || !feel ? pct : 0}%`,
              background: accentColor,
              transition: dragging ? 'none'
                : feel ? `height ${levelMs}ms ${CSS_EASE.out}` : 'height 0.18s',
            }} />
            <div style={{
              position: 'absolute', left: '22%', right: '22%',
              bottom: `${isOn || !feel ? pct : 0}%`,
              height: 4, marginBottom: -2,
              background: 'var(--ink)',
              borderRadius: 2,
              ...(feel ? {
                transform: dragging ? 'scaleY(1.5) scaleX(1.12)' : 'scaleY(1) scaleX(1)',
                opacity: isOn ? 1 : 0,
              } : null),
              transition: dragging
                ? (feel ? `transform ${HOLD_IN}ms ${CSS_EASE.out}` : 'none')
                : feel
                  ? `bottom ${levelMs}ms ${CSS_EASE.out}, opacity ${levelMs}ms ${CSS_EASE.out}, transform ${HOLD_OUT}ms ${CSS_EASE.out}`
                  : 'bottom 0.18s',
            }} />
          </>
        )}
```

**The existing well-growth CSS the lab's `width: 96→108` would duplicate** — `frontend/src/motion/controls.css:55-62, 90-95`
```css
[data-motion="on"] [data-motion-grow][data-motion-grow] {
  transform-origin: center center;
  transition: transform 130ms var(--m-out);
}
[data-motion="on"] [data-motion-hold="true"] [data-motion-grow][data-motion-grow],
[data-motion="on"] [data-motion-hold="true"][data-motion-grow][data-motion-grow] {
  transition-duration: 160ms;
}
...
/* The brightness well is 128px wide and its cross-axis is horizontal; it
   only needs to swell under the hand, not double. */
[data-motion="on"] [data-motion-hold="true"] [data-motion-grow="well"][data-motion-grow],
[data-motion="on"] [data-motion-hold="true"][data-motion-grow="well"][data-motion-grow] {
  transform: scaleX(1.045);
}
```
Reduced-motion kill switch for it: `frontend/src/motion/controls.css:160-163, 172-175`.

**Where a "room glow" could attach** — the `BrightnessLamp` call site and its container, `frontend/src/components/ui/DeviceControls.jsx:744-757`:
```jsx
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, paddingTop: 4, maxWidth: 320, width: '100%', margin: '0 auto' }}>
      {/* Brightness lamp — tap to toggle, hold + vertical drag for brightness */}
      <div style={{ display: 'flex', justifyContent: 'center' }}>
        <BrightnessLamp
          value={brightness}
          onChange={setBrightness}
          onCommit={commitBri}
          onTap={() => onService(isOn ? 'turn_off' : 'turn_on', {})}
          isOn={isOn}
          accentColor={livePreviewColor}
        />
      </div>
```
The live tint the glow would read from already exists — `DeviceControls.jsx:722-731`:
```jsx
  const livePreviewRgb = lightRgb({
    rgb_color: currentRgb,
    color_temp_kelvin: colorTemp,
    color_mode: entity.color_mode,
  })
  const livePreviewColor = livePreviewRgb
    ? `rgb(${livePreviewRgb[0]}, ${livePreviewRgb[1]}, ${livePreviewRgb[2]})`
    : 'var(--gold)'
```
Commit path (lock-aware, do not break) — `DeviceControls.jsx:705-718`. Page-level containers above this: the device sheet (`frontend/src/motion/DeviceSheet.jsx`, `SheetSurface.jsx`, `sheet.css`) and `frontend/src/pages/DeviceDetail.jsx:1253` (`{showControls && (`).

---

# 2. Temperature variant A — "Rolling digits" (0.4)

## 2a. Lab implementation (full)

`frontend/src/lab/sections/Controls.jsx:651-660` — the rolling-digit component, verbatim:
```jsx
function RollingDigit({ value, tx, dur }) {
  // each digit rolls vertically to its new value (odometer)
  return (
    <span style={{ display: 'inline-block', position: 'relative', height: '1em', width: '0.62em', overflow: 'hidden', verticalAlign: 'top' }}>
      <motion.span animate={{ y: `-${value}em` }} transition={tx({ type: 'spring', duration: dur, bounce: 0.1 })} style={{ display: 'block' }}>
        {Array.from({ length: 10 }).map((_, i) => <span key={i} style={{ display: 'block', height: '1em', lineHeight: '1em', textAlign: 'center' }}>{i}</span>)}
      </motion.span>
    </span>
  )
}
```

`frontend/src/lab/sections/Controls.jsx:683-695` — `TempA`, the host:
```jsx
function TempA({ knobs, tx }) {
  const [v, setV] = useState(24)
  const d = String(v).split('')
  return (
    <TempFrame hint="Digits roll like an odometer. Direction tells you up or down.">
      <div className="zl-large zl-mono" style={{ fontSize: 72, lineHeight: 1, display: 'flex', alignItems: 'flex-start' }}>
        {d.map((c, i) => <RollingDigit key={i} value={Number(c)} tx={tx} dur={knobs.duration} />)}
        <span className="zl-title2 zl-mute" style={{ marginTop: 6 }}>°</span>
      </div>
      <Stepper value={v} onChange={setV} />
    </TempFrame>
  )
}
```

Supporting lab-only pieces: `TempFrame` (`:662-671`), `Stepper` (`:673-681`, which does `whileTap={{ scale: 0.92 }}` + `h('selection')`).

Knob — `frontend/src/lab/sections/Controls.jsx:1193-1197`
```jsx
      <Demo id="temperature" title="Temperature target" purpose="A number that changes by steps should move like a number, not be replaced like a word." principles={['state', 'physical', 'continuity']} inZiggy={['DeviceControls.jsx (climate stepper)', 'Smart Climate cards']}
        knobs={[{ key: 'duration', label: 'Roll duration (A, E)', min: 0.15, max: 0.9, step: 0.02, value: 0.4, unit: 'ms' }]}
        recommend="E"
```

**Correction to the brief:** there is **no `dir="ltr"` island** in the lab's rolling digits. `grep 'dir="ltr"' frontend/src/lab/sections/Controls.jsx` → no matches. The digits are laid out with `display: 'flex'`, so under the lab's RTL mode the digit order reverses; the production port must add `dir="ltr"` (or `unicodeBidi`/`flexDirection: 'row'` pinning) itself. Note that `display: 'flex'` on the container also makes `verticalAlign: 'top'` on the digit span inert.

Lab deps: `tx` (drop), `zl-large zl-mono` → `.z-display .z-mono`, `useHaptic` in `Stepper`, `useT` in `TempFrame`.

## 2b. Production landing sites (three)

### (i) ClimateControls stepper + Dial label — `frontend/src/components/ui/DeviceControls.jsx:918-938`
The big `{displayTemp}°` appears **twice**: once as the `Dial` label, once as the stepper readout.
```jsx
      {/* Dial */}
      <div style={{ display: 'flex', justifyContent: 'center' }}>
        <Dial
          size={220}
          value={Math.max(0, dialPct)}
          max={100}
          label={`${displayTemp}°`}
          sublabel={currentTemp ? `${_hvacLabel(t, hvacMode).toUpperCase()} · ${currentTemp}° ${t('deviceControls.tempNow')}` : _hvacLabel(t, hvacMode).toUpperCase()}
          color="var(--info)"
          trackColor="var(--line)"
        />
      </div>

      {/* Temp stepper below dial */}
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 20 }}>
        <button onClick={() => adjustTemp(-step)} className="z-icon-btn" aria-label={t('deviceControls.hvacCool')}><Minus size={20} strokeWidth={1.75} /></button>
        <span className="z-mono" style={{ fontSize: 26, fontWeight: 700, color: 'var(--ink)', letterSpacing: '-0.04em', minWidth: 56, textAlign: 'center' }}>{displayTemp}°</span>
        <button onClick={() => adjustTemp(step)} className="z-icon-btn" aria-label={t('deviceControls.hvacHeat')}><Plus size={20} strokeWidth={1.75} /></button>
      </div>
```
`Dial`'s label render is `frontend/src/components/ui/DeviceControls.jsx:241`:
```jsx
        <div style={{ fontSize: Math.round(size * 0.22), fontWeight: 700, letterSpacing: '-0.04em', color: 'var(--ink)', lineHeight: 1 }}>{label}</div>
```
Store/haptic path already present — `DeviceControls.jsx:901-911`:
```jsx
  const displayTemp = targetTemp ?? currentTemp ?? 22
  const dialPct = ((displayTemp - minTemp) / (maxTemp - minTemp)) * 100

  const adjustTemp = (delta) => {
    const base = targetTemp ?? currentTemp ?? 22
    const next = Math.round(Math.min(maxTemp, Math.max(minTemp, base + delta)) * 10) / 10
    // One impact per degree that actually moved — at the end of the range the
    // number doesn't change, and neither should your thumb feel one.
    if (isMotionOn() && next !== base) haptic('medium')
    onService('set_temperature', { temperature: next })
  }
```
Caveat: `displayTemp` can carry one decimal (`Math.round(x*10)/10`) and `target_temp_step` may be 0.5 — `String(v).split('')` would yield a `.` token the lab's `RollingDigit` cannot render.

### (ii) ACRemote big `{n}°` — `frontend/src/components/device/remotes/ACRemote.jsx:320-335`
(The brief's "~:325" is the `z-display` line.)
```jsx
  return (
    <div style={{ width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
      {arrowBtn(upOk, ChevronUp, onUp, i18nT('remote.tempUpAria'))}
      <div style={{ textAlign: 'center' }}>
        <div className="z-display z-mono" style={{ color: 'var(--ink)' }}>
          {temp != null ? `${Math.round(temp)}°` : '—'}
        </div>
        <div className="z-mono" style={{ fontSize: 13, color: 'var(--ink-mute)', marginTop: 4 }}>
          {hvacLabel}
          {currentTemp != null ? ` · ${Math.round(currentTemp)}°${i18nT('remote.now')}` : ''}
        </div>
      </div>
      {arrowBtn(downOk, ChevronDown, onDown, i18nT('remote.tempDownAria'))}
    </div>
  )
}
```
Value source — `ACRemote.jsx:83-84` (`facts.targetTemp ?? entity._irDevice.ac_memory.temp`); props threading at `ACRemote.jsx:126-135`. `TempStepper` here is `ACRemote.jsx:281-335`. Already `Math.round`ed → safe for digit splitting.

### (iii) CompactAcStepper — `frontend/src/pages/Devices.jsx:311-323`
```jsx
  return (
    <div onClick={(e) => e.stopPropagation()}
      data-pending={pending ? 'true' : undefined}
      style={{ display: 'flex', alignItems: 'center', gap: 3, flexShrink: 0 }}>
      {arrow(downOk, 'down', () => fire('temp_down'), t('devices.cooler'))}
      <span className="z-mono" style={{
        fontSize: 10.5, color: 'var(--ink)', minWidth: 22, textAlign: 'center', fontWeight: 600,
      }}>
        {memTemp != null ? `${Math.round(memTemp)}°` : '—'}
      </span>
      {arrow(upOk, 'up', () => fire('temp_up'), t('devices.warmer'))}
    </div>
  )
```
Value source `Devices.jsx:274` (`entity?._irDevice?.ac_memory?.temp`); in-flight hook `data-pending` (CSS at `frontend/src/motion/motion.css:331-335`); mounted at `Devices.jsx:2067-2069`. At 10.5px the odometer travel is ~10px — note the scale mismatch.

### (iv) DeviceCard TempStepper — `frontend/src/components/device/DeviceCard.jsx:129-150`
```jsx
function TempStepper({ facts, onCommand }) {
  // Surface IR ac_memory temp as fallback for entities without HA target_temp.
  const irMemTemp = facts.entity?._irDevice?.ac_memory?.temp ?? null
  const t = facts.targetTemp ?? irMemTemp ?? facts.currentTemp
  const upOk   = commandAvailable(facts.entity, 'temp_up')
  const downOk = commandAvailable(facts.entity, 'temp_down')
  return (
    <div onClick={(e) => e.stopPropagation()} style={{
      display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0,
      background: 'var(--surface-2)', border: '0.5px solid var(--line)', borderRadius: 'var(--r-ctl)',
      padding: 2,
    }}>
      <button onClick={() => downOk && onCommand('temp_down')} aria-label={i18nT('deviceCard.cooler')} disabled={!downOk}
        title={downOk ? '' : 'temp_down not learned'} style={iconBtn(40, !downOk)}><ArrowDown size={18} /></button>
      <span className="z-mono" style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)', minWidth: 40, textAlign: 'center' }}>
        {t != null ? `${Math.round(t)}°` : '—'}
      </span>
      <button onClick={() => upOk && onCommand('temp_up')} aria-label={i18nT('deviceCard.warmer')} disabled={!upOk}
        title={upOk ? '' : 'temp_up not learned'} style={iconBtn(40, !upOk)}><ArrowUp size={18} /></button>
    </div>
  )
}
```
Mount: `frontend/src/components/device/DeviceCard.jsx:293`
```jsx
          {facts.capabilities.has('temp') && <TempStepper facts={facts} onCommand={onCommand} />}
```

---

# 3. Segment variant C — "Icon morph hero" (0.36, bounce 0.14, inOut)

## 3a. Lab implementation

`frontend/src/lab/sections/Controls.jsx:922-943` (verbatim)
```jsx
function SegC({ knobs, tx }) {
  // the mode ICON morphs: one big glyph crossfades with a rotate/scale so it reads as the same object changing role
  const t = useT(); const h = useHaptic()
  const [mode, setMode] = useState('cool')
  const m = MODES.find(x => x.key === mode)
  return (
    <SegFrame hint="The hero icon turns into the next mode's icon (scale + rotate + 2px blur crossfade), while the chips below just re-colour.">
      <div style={{ position: 'relative', width: 96, height: 96, display: 'grid', placeItems: 'center' }}>
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.div key={mode} initial={{ opacity: 0, scale: 0.6, rotate: -40, filter: 'blur(3px)' }} animate={{ opacity: 1, scale: 1, rotate: 0, filter: 'blur(0px)' }} exit={{ opacity: 0, scale: 0.6, rotate: 40, filter: 'blur(3px)' }}
            transition={tx({ type: 'spring', duration: knobs.duration, bounce: knobs.bounce })}
            style={{ position: 'absolute', color: mode === 'cool' ? 'var(--info)' : mode === 'heat' ? 'var(--accent)' : 'var(--ink-2)' }}>
            <Icon name={m.icon} size={64} strokeWidth={1.6} />
          </motion.div>
        </AnimatePresence>
      </div>
      <div className="zl-hstack">
        {MODES.map(x => <button key={x.key} className="zl-chip" data-on={mode === x.key ? 'true' : 'false'} onClick={() => { setMode(x.key); h('selection') }} style={{ cursor: 'pointer', transition: 'background 160ms, color 160ms' }}>{t(x.label)}</button>)}
      </div>
    </SegFrame>
  )
}
```

Mode table + colours — `frontend/src/lab/sections/Controls.jsx:857-863`
```jsx
const MODES = [
  { key: 'cool', icon: 'snowflake', label: { en: 'Cool', he: 'קירור' } },
  { key: 'heat', icon: 'flame', label: { en: 'Heat', he: 'חימום' } },
  { key: 'fan', icon: 'fan', label: { en: 'Fan', he: 'מאוורר' } },
  { key: 'dry', icon: 'droplets', label: { en: 'Dry', he: 'ייבוש' } },
]
const MODE_COLOR = { cool: 'var(--info)', heat: 'var(--accent)', fan: 'var(--ink)', dry: 'var(--ink)' }
```
(`SegC` inlines its own colour ternary and ignores `MODE_COLOR`.) `SegFrame` is `:865-874`.

Knobs — `frontend/src/lab/sections/Controls.jsx:1205-1211`
```jsx
        knobs={[
          { key: 'duration', label: 'Duration', min: 0.15, max: 0.8, step: 0.02, value: 0.36, unit: 'ms' },
          { key: 'bounce', label: 'Bounce (A, C)', min: 0, max: 0.4, step: 0.02, value: 0.14 },
          { key: 'ease', label: 'Ease (B)', type: 'ease', value: 'inOut' },
        ]}
```
Note: `knobs.ease` (`inOut`) is consumed by **`SegB` only** (`Controls.jsx:914`, `cssEase(knobs.ease)`). `SegC` is a spring and never reads `ease`.

Lab deps: `tx`, `useHaptic`, `Icon`, `useT`, `.zl-chip` / `.zl-hstack`. The `filter: 'blur(3px)'` animation is the one non-transform/opacity property in this variant.

## 3b. Production landing sites

### (i) ACRemote mode chips (Power / Snowflake / Flame / Wind)
Icon map — `frontend/src/components/device/remotes/ACRemote.jsx:23, 41-49`
```jsx
import { ChevronUp, ChevronDown, Power, Snowflake, Flame, Wind, Zap, Sparkles, ChevronRight } from 'lucide-react'
...
const HVAC_MODE_ICONS = {
  off:      Power,
  cool:     Snowflake,
  heat:     Flame,
  auto:     null,
  heat_cool:null,
  fan_only: Wind,
  dry:      null,
}
```
Tints the hero glyph would reuse — `ACRemote.jsx:62-73`
```jsx
const TINT_BY_MODE = {
  cool:     'var(--info)',
  heat:     'var(--warn)',
  dry:      'var(--ink-2)',
  fan_only: 'var(--ink-mute)',
  auto:     'var(--ok)',
  heat_cool:'var(--ok)',
  off:      'var(--ink-faint)',
}
```
`accent` is derived at `ACRemote.jsx:79`: `const accent = TINT_BY_MODE[facts.hvacMode] || 'var(--info)'`.

The chip row itself — `ACRemote.jsx:339-361` (`ModeRow`):
```jsx
function ModeRow({ items, current, renderLabel, isEnabled, onPick }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'center', width: '100%' }}>
      {items.map((m) => {
        const active  = current === m
        const enabled = isEnabled ? isEnabled(m) : true
        const Icon    = HVAC_MODE_ICONS[m]
        return (
          <button key={m}
            onClick={() => enabled && onPick(m)}
            disabled={!enabled}
            aria-pressed={active}
            title={enabled ? '' : i18nT('remote.notLearned', { name: renderLabel(m) })}
            className="z-chip"
            style={chipStyle({ active, enabled })}>
            {Icon ? <Icon size={18} strokeWidth={1.75} /> : null}
            {renderLabel(m)}
          </button>
        )
      })}
    </div>
  )
}
```
Chip style (the "chips just recolour" half, already a 200ms colour transition) — `ACRemote.jsx:211-226`:
```jsx
function chipStyle({ active = false, enabled = true } = {}) {
  return {
    minHeight: 40, padding: '0 16px', boxSizing: 'border-box',
    background: 'var(--surface-2)',
    color: active ? 'var(--ink)' : 'var(--ink-2)',
    border: '0.5px solid ' + (active ? 'var(--ink)' : 'var(--line)'),
    fontWeight: active ? 600 : 500,
    cursor: enabled ? 'pointer' : 'not-allowed',
    fontFamily: 'inherit', textTransform: 'capitalize',
    opacity: enabled ? 1 : 0.4,
    transition: 'border-color var(--dur-state) var(--ease-standard), color var(--dur-state) var(--ease-standard)',
  }
}
```
Mount site (where the hero glyph slots in, above the chips) — `ACRemote.jsx:122-146`:
```jsx
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24, alignItems: 'center' }}>

      {/* Temperature stepper — ▲ / temp / ▼ */}
      <TempStepper ... />

      {/* Mode chips */}
      {modes.length > 0 && (
        <ModeRow
          items={modes}
          current={facts.hvacMode}
          renderLabel={(m) => HVAC_MODE_LABELS[m] || m}
          isEnabled={(m) => commandAvailable(entity, 'set_hvac_mode', { mode: m })}
          onPick={(m) => fire('set_hvac_mode', { mode: m })}
        />
      )}
```
i18n labels — `ACRemote.jsx:51-60` (`acRemote.hvac.*` keys, resolved through a Proxy).

Second HVAC chip row, in `DeviceControls.jsx:940-958` (different icon map at `:876-883` using `ArrowUpDown` / `Droplets`):
```jsx
      {/* HVAC mode chips */}
      {hvacModes.length > 0 && (
        <div>
          <span className="z-eyebrow" style={{ display: 'block', marginBottom: 8 }}>{t('deviceControls.mode')}</span>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
            {hvacModes.map(mode => {
              const Icon = (HVAC_MODE_META[mode] || {}).Icon
              const active = hvacMode === mode
              return (
                <button key={mode} onClick={() => setMode('set_hvac_mode', { hvac_mode: mode })}
                  aria-pressed={active} className={CHIP_CLS} style={{ ...chipStyle(active), gap: 6, textTransform: 'none' }}>
                  {Icon && <Icon size={16} strokeWidth={1.75} />}
                  {_hvacLabel(t, mode)}
                </button>
              )
            })}
          </div>
        </div>
      )}
```
with `setMode` at `DeviceControls.jsx:913-916` (`haptic('light')`) and `chipStyle` at `:21-26`.

### (ii) Actions.jsx Automatic / On-demand tablist — `frontend/src/pages/Actions.jsx:456-477`
```jsx
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
No icons here — the lab variant's "hero glyph" has nothing to morph; this tablist is the target of lab variant D, not C. Panels below already use `AnimatePresence mode="wait"` + `FADE_UP` (`Actions.jsx:478-482`).

### (iii) DeviceDetail Controls / Info pill — `frontend/src/pages/DeviceDetail.jsx:1170-1204`
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
Gate flags at `DeviceDetail.jsx:1090-1092`. Also icon-less.

---

# 4. Hold-delete variant A — "Clip-path fill" (hold 1.2)

## 4a. Lab implementation

`frontend/src/lab/sections/Controls.jsx:1006-1032` (verbatim)
```jsx
function HoldDeleteA({ knobs, tx }) {
  const t = useT(); const h = useHaptic()
  const [state, setState] = useState('idle') // idle | holding | deleted
  const timer = useRef(null)
  const start = () => { if (state === 'deleted') return; setState('holding'); timer.current = setTimeout(() => { setState('deleted'); h('success') }, knobs.hold * 1000 / 1) }
  const stop = () => { if (state === 'holding') { clearTimeout(timer.current); setState('idle') } }
  return (
    <div className="zl" style={{ padding: 16, paddingTop: 40, display: 'flex', flexDirection: 'column', gap: 16, alignItems: 'center' }}>
      <HoldCard />
      <AnimatePresence mode="wait">
        {state !== 'deleted' ? (
          <motion.button key="btn" exit={{ opacity: 0, scale: 0.96 }} transition={tx({ duration: 0.16 })}
            onPointerDown={start} onPointerUp={stop} onPointerLeave={stop} onPointerCancel={stop}
            style={{ position: 'relative', overflow: 'hidden', height: 48, padding: '0 22px', borderRadius: 12, border: '1px solid var(--err)', background: 'var(--surface)', color: 'var(--err-text)', fontWeight: 600, fontSize: 15, cursor: 'pointer', touchAction: 'none', transform: state === 'holding' ? 'scale(0.97)' : 'scale(1)', transition: 'transform 160ms cubic-bezier(0.23,1,0.32,1)' }}>
            <span style={{ position: 'absolute', inset: 0, background: 'var(--err)', clipPath: state === 'holding' ? 'inset(0 0 0 0)' : 'inset(0 100% 0 0)', transition: state === 'holding' ? `clip-path calc(${knobs.hold}s * var(--lab-speed,1)) linear` : `clip-path calc(0.2s * var(--lab-speed,1)) ${cssEase('out')}` }} />
            <span style={{ position: 'relative', mixBlendMode: state === 'holding' ? 'normal' : undefined }}>{t({ en: 'Hold to delete', he: 'החזק למחיקה' })}</span>
          </motion.button>
        ) : (
          <motion.div key="done" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={tx({ duration: 0.2, ease: EASE.out })} className="zl-hstack" style={{ color: 'var(--ink-mute)' }}>
            <Icon name="check" size={18} /> {t({ en: 'Deleted', he: 'נמחק' })} · <button className="zl-btn zl-btn--ghost" style={{ height: 32 }} onClick={() => setState('idle')}>{t(COPY.undo)}</button>
          </motion.div>
        )}
      </AnimatePresence>
      <p className="zl-footnote zl-mute" style={{ textAlign: 'center', maxWidth: 280 }}>Slow where the user is deciding (linear fill), fast where the system responds (200ms snap-back).</p>
    </div>
  )
}
```
`HoldCard` (the at-stake row) — `Controls.jsx:995-1004`.

Knob — `frontend/src/lab/sections/Controls.jsx:1219-1223`
```jsx
      <Demo id="hold-delete" title="Hold to delete" purpose="Destruction should cost a second of intent, without a dialog." principles={['causality', 'physical', 'hierarchy']} inZiggy={['Actions (delete automation)', 'Devices (remove device — cascades to HA)']}
        knobs={[{ key: 'hold', label: 'Hold time', min: 0.6, max: 2.5, step: 0.1, value: 1.2, unit: 's', digits: 1 }]}
        recommend="B"
        variants={[
          { key: 'A', label: 'Clip-path fill', note: 'A linear fill across the button while held; snap-back in 200 ms on release. Only the button knows what is happening.', spec: (k) => `fill linear ${k.hold.toFixed(1)} s · snap-back 200 ms ease-out`, render: (p) => <HoldDeleteA {...p} /> },
```
Notes: the clip-path is **physical-direction** (`inset(0 100% 0 0)` = from the left always) — needs logical handling for RTL. `useT`/`COPY.undo` → i18n. `cssEase('out')` → `CSS_EASE.out`. `h('success')` → `haptic('success')`.

## 4b. Production landing sites (four)

### (i) Actions.jsx delete confirm modal (maxWidth 380) — `frontend/src/pages/Actions.jsx:720-732`
```jsx
      {/* Delete confirmation — shared by every delete path (card, view, wizard). */}
      <Modal open={!!confirmState} onClose={() => { const r = confirmState?.resolve; setConfirmState(null); r?.(false) }} title={t('automations.confirmDelete.title')} maxWidth={380}>
        {confirmState && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: '4px 2px' }} dir="auto">
            <p className="z-body" style={{ margin: 0, color: 'var(--ink-2)' }} dir="auto">{t('automations.confirmDelete.body', { name: confirmState.label })}</p>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button type="button" onClick={() => { const r = confirmState.resolve; setConfirmState(null); r(false) }} className="z-btn-secondary">{t('common.cancel')}</button>
              {/* Destructive = the --err family, never the brand accent. */}
              <button type="button" onClick={() => { const r = confirmState.resolve; setConfirmState(null); r(true) }} className="z-btn-primary" style={{ background: 'var(--err)', color: 'var(--on-accent)' }}>{t('automations.confirmDelete.confirm')}</button>
            </div>
          </div>
        )}
      </Modal>
```
The promise plumbing a hold-button would have to satisfy — `Actions.jsx:85-86, 399-402`:
```jsx
  const [confirmState,      setConfirmState]      = useState(null)   // { label, resolve }
...
  const confirmDelete = (label) => new Promise((resolve) => setConfirmState({ label, resolve }))
...
  const handleDelete = async (id) => {
    const a = automations.find(x => x.id === id)
    if (!await confirmDelete(a?.name || t('automations.thisAction'))) return
    try { await removeAutomation(id); addToast(t('automations.deleted'), 'success') }
    catch { addToast(t('automations.failedToDelete'), 'error') }
  }
```
Other `confirmDelete()` callers on the same modal: `Actions.jsx:278` (circadian), `:291` (smart room), `:333` (smart climate).

### (ii) DeviceDetail delete device
Entry button — `frontend/src/pages/DeviceDetail.jsx:1753-1761`
```jsx
        <button
          onClick={() => setShowDelete(true)}
          className="w-full flex items-center gap-3 hover:bg-surface-2 transition-colors"
          style={{ minHeight: 40, padding: '8px 12px', borderRadius: 'var(--r-ctl)', fontSize: 15, color: 'var(--err-text)', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', textAlign: 'start' }}
        >
          <Trash2 size={18} strokeWidth={1.75} /> {t('deviceDetail.deleteDevice')}
        </button>
```
The modal — `frontend/src/pages/DeviceDetail.jsx:271-316`, confirm button at `:299-313`:
```jsx
      <div style={{ display: 'flex', gap: 8 }}>
        <button onClick={onClose} disabled={deleting} className="z-btn-secondary" style={{ flex: 1 }}>{t('common.cancel')}</button>
        <button
          onClick={() => onConfirm(alsoDeleteDevice)}
          disabled={deleting}
          className="z-btn-primary"
          style={{
            flex: 1, cursor: deleting ? 'default' : 'pointer',
            background: 'var(--err)', color: 'var(--on-accent)',
            opacity: deleting ? 0.6 : 1,
          }}
        >
          {deleting ? t('deviceDetail.deleting') : t('common.delete')}
        </button>
      </div>
```
Mount — `DeviceDetail.jsx:1793-1801`. Note the extra `alsoDeleteDevice` checkbox (`:283-298`) that a hold-only button cannot carry on its own.

### (iii) Rooms.jsx delete room — `DESTRUCTIVE_BTN`
Style token — `frontend/src/pages/Rooms.jsx:406-415`
```jsx
// Destructive confirm button — the --err family, never the brand accent.
// Same geometry as .z-btn-secondary (17px, 12/20, min-height 44).
const DESTRUCTIVE_BTN = {
  background: 'color-mix(in srgb, var(--err) 10%, var(--surface))',
  color: 'var(--err-text)',
  border: '0.5px solid color-mix(in srgb, var(--err) 40%, var(--line))',
  borderRadius: 'var(--r-ctl)', padding: '12px 20px', minHeight: 40,
  fontFamily: 'inherit', fontSize: 15, fontWeight: 600, cursor: 'pointer',
}
```
Consumer — `frontend/src/pages/Rooms.jsx:436-450`
```jsx
export function RoomDeleteConfirm({ room, onClose, onConfirm }) {
  const t = useT()
  return (
    <Modal open={!!room} onClose={onClose} title={t('rooms.deleteRoomTitle')}>
      <p className="z-subhead" style={{ marginBottom: 16, lineHeight: 1.5 }}>
        {t('rooms.deleteRoomLong', { name: room?.name || '' })}
      </p>
      <div style={{ display: 'flex', gap: 8 }}>
        <button onClick={onClose} className="z-btn-secondary" style={{ flex: 1 }}>{t('common.cancel')}</button>
        <button onClick={() => onConfirm(room)} style={{ flex: 1, ...DESTRUCTIVE_BTN }}>{t('common.delete')}</button>
      </div>
    </Modal>
  )
}
```
Second consumer (reset-all) — `frontend/src/pages/Rooms.jsx:889-894`
```jsx
      <Modal open={confirmReset} onClose={() => !resetting && setConfirmReset(false)} title={t('rooms.resetAllTitle')}>
        <p className="z-subhead" style={{ marginBottom: 16, lineHeight: 1.5 }}>
          {t('rooms.resetAllLong')}
        </p>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => setConfirmReset(false)} disabled={resetting} className="z-btn-secondary" style={{ flex: 1 }}>{t('common.cancel')}</button>
          <button onClick={handleResetAll} disabled={resetting} style={{ flex: 1, ...DESTRUCTIVE_BTN, cursor: resetting ? 'wait' : 'pointer' }}>
```
Mounts: `Rooms.jsx:879-883` (`confirmDelete` state at `:541`, handler at `:635`) and `Rooms.jsx:1723-1727` (`deleteRoom_` state at `:1187`). Row trigger: `Rooms.jsx:278`, menu item `Rooms.jsx:1522`.

### (iv) DeviceControls two-tap confirm — `frontend/src/components/ui/DeviceControls.jsx:1486-1506`
```jsx
            const needsConfirm = action.confirm || meta.safetyLevel === 'double_confirm'

            if (needsConfirm && confirming === key) {
              return (
                <div key={key} className="flex gap-2 w-full">
                  <button
                    onClick={() => { onService(action.service, {}); setConfirming(null) }}
                    className="flex-1 min-h-[44px] px-3 rounded-[10px] bg-err text-on-accent text-subhead font-semibold transition-colors"
                  >
                    {t('deviceControls.confirmAction', { label: action.label })}
                  </button>
                  <button
                    onClick={() => setConfirming(null)}
                    className="w-11 min-h-[44px] rounded-[10px] bg-surface-2 text-ink-mute hover:bg-surface-3 transition-colors inline-flex items-center justify-center"
                    aria-label={t('deviceControls.presetCancel')}
                  >
                    <X size={16} strokeWidth={1.75} />
                  </button>
                </div>
              )
            }
```
The arming tap that would be replaced — `DeviceControls.jsx:1515-1522`:
```jsx
            return (
              <button
                key={key}
                onClick={() => needsConfirm ? setConfirming(key) : onService(action.service, {})}
                // Only the power actions take the ring; the rest of this row
                // is ordinary commands, and a ring on everything says nothing.
                {...(key === 'turn_on' || key === 'turn_off' || key === 'toggle' ? { 'data-motion-ring': '' } : null)}
```

---

# 5. Toast variant D — "Morphing button (no toast)" (0.45)

## 5a. Lab implementation (full)

`frontend/src/lab/sections/Feedback.jsx:143-169` (verbatim)
```jsx
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
```
Labels — `frontend/src/lab/mock/home.js:91-93`
```js
  run: { en: 'Run', he: 'הפעל' },
  running: { en: 'Running…', he: 'מפעיל…' },
  done: { en: 'Done', he: 'בוצע' },
```
Knob — `frontend/src/lab/sections/Feedback.jsx:715-717` (`duration: 0.45`), but note it is read by **B and C only**; `ToastD` hardcodes `0.4` spring and `0.18` text swap.

Lab deps: `tx`, `ms`, `useHaptic`, `Page`/`Card`/`Icon`/`COPY`, `EASE.out`. The spinner `rotate: 360 / repeat: Infinity` is the only decorative loop here — must be `safe()`-gated for reduced motion (`frontend/src/motion/motion.js:81`).

## 5b. Production landing sites

### Button component — no `loading` prop exists
`frontend/src/components/ui/Button.jsx:1-37` (full file above) — `variants` (`:4-10`), `sizes` (`:12-17`), and `Button` (`:19-37`). There is no `loading`, `busy`, `state` or icon slot; the only transition is `:27`:
```jsx
        transition: 'background var(--dur-press) var(--ease-standard), transform var(--dur-press) var(--ease-standard)',
```

### Toast component + store API (what the morph replaces)
`frontend/src/components/ui/Toast.jsx:23-61` — `Toast` item (enter `opacity/y 8/scale .98`, exit `y -4`, `DUR_ENTER`/`EASE_ENTER` from `frontend/src/lib/motion.js:13,16`); `:63-89` — `ToastContainer` (fixed, `zIndex: 60`, anchored above `--nav-h`).

`frontend/src/stores/uiStore.js:45-68` — `addToast(message, type = 'info', duration, detail)`, dedupe window, 7000ms for `error` / 3000ms otherwise; `:78-87` `toastError`; `:88` `removeToast`. Toast list field: `toasts: []` at `:37`.

### Button-triggered toasts to convert
1. **Actions.jsx Run (card)** — `frontend/src/pages/Actions.jsx:562`
```jsx
                  onTrigger={async id => { try { await triggerAutomation(id); addToast(t('automations.triggered'), 'success') } catch (e) { addToast(e?.userMessage || t('automations.failedToTrigger'), 'error') } }} />
```
   **Actions.jsx Run (view modal)** — `frontend/src/pages/Actions.jsx:739`
```jsx
          onTrigger={async (id) => { try { await triggerAutomation(id); addToast(t('automations.triggered'), 'success') } catch (e) { addToast(e?.userMessage || t('automations.failedToTrigger'), 'error') } }}
```
   The button itself is the ▶ icon in `frontend/src/components/automations/AutomationCard.jsx:76`:
```jsx
    { onClick: () => onTrigger(automation.id), color: 'var(--ink-mute)', title: t('automations.view.runNow'), path: <path d="M6 4l14 8-14 8V4z" fill="currentColor" stroke="none"/> },
```
   and the full-width one in `frontend/src/components/automations/AutomationViewModal.jsx:90`. i18n: `'automations.triggered': 'Triggered'` (`frontend/src/lib/i18n/en.js:962`).

2. **Routines.jsx Run now** — handler `frontend/src/pages/Routines.jsx:700`
```jsx
  const handleRun    = async r => { try { await runRoutine(r.id) } catch { addToast('Failed to run', 'error') } }
```
   (no success toast today — pure silence, so the morph is the only feedback). Buttons: `Routines.jsx:512` (icon row) and `:584-587`:
```jsx
        <button onClick={() => { onRun(routine); onClose?.() }} className="z-btn-secondary" style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
          <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><path d="M5 3l14 9-14 9V3z"/></svg>
          Run now
        </button>
```
   Hardcoded English strings here (`'Run now'`, `'Edit'`, `'Deleted'`, `'Failed to run'`) — no i18n keys.

3. **QuickAsks.jsx card fire** — handler `frontend/src/pages/QuickAsks.jsx:222-225`
```jsx
  const handleFire = async (qa) => {
    try { await sendDirectIntent(qa.intent, qa.params || {}); addToast(translateNamePhrase(qa.label, lang), 'success') }
    catch (e) { addToast(e.message || t('quickAsks.failedFire'), 'error') }
  }
```
   The card is the button — `QuickAsks.jsx:274-288`:
```jsx
              <motion.div
                key={qa.id}
                role="button"
                tabIndex={0}
                onClick={(e) => { if (e.target.closest('[data-qa-stop]')) return; handleFire(qa) }}
                onKeyDown={(e) => { if (e.key === 'Enter') handleFire(qa) }}
                initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.97 }}
                transition={T_ENTER}
                style={{
                  padding: 12, borderRadius: 'var(--r-card)',
                  background: 'var(--surface)', border: '0.5px solid var(--line)',
                  display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
                  gap: 12, minHeight: 120, cursor: 'pointer',
                }}
              >
```

4. **Tasks.jsx save/add/edit** — `frontend/src/pages/Tasks.jsx:346-350`
```jsx
  const handleToggle      = async (task) => { try { await update(task.id, { done: !(task.done || task.completed) }) } catch { addToast(t('tasks.failedToUpdate'), 'error') } }
  const handleUpdateItems = async (id, items) => { try { await update(id, { items }) } catch { addToast(t('tasks.failedToUpdateShort'), 'error') } }
  const handleDelete      = async (id) => { try { await remove(id); addToast(t('tasks.taskDeleted'), 'success') } catch { addToast(t('tasks.failedToDeleteShort'), 'error') } }
  const handleAdd         = async (data) => { try { await add(data); addToast(t('tasks.taskAdded'), 'success') } catch { addToast(t('tasks.failedToAddShort'), 'error') } }
  const handleEdit        = async (id, data) => { try { await update(id, data); addToast(t('tasks.taskUpdated'), 'success'); setEditTask(null) } catch { addToast(t('tasks.failedToUpdate'), 'error') } }
```

5. **Suggestions accept** — `frontend/src/pages/Suggestions.jsx:224-226`
```jsx
  const handleAccept  = async (id) => { try { await accept(id);     addToast(t('suggestions.toastAccepted'), 'success') } catch { addToast(t('suggestions.toastFailed'), 'error') } }
  const handleReject  = async (id) => { try { await reject(id);     addToast(t('suggestions.toastDismissed'), 'success')          } catch { addToast(t('suggestions.toastFailed'), 'error') } }
  const handleSnooze  = async (id, days) => { try { await snooze(id, days); addToast(t('suggestions.toastSnoozed', { n: days }), 'success') } catch { addToast(t('suggestions.toastFailed'), 'error') } }
```
   Also the in-page nudge path — `frontend/src/pages/Actions.jsx:491-492`.

Existing "in-flight" affordance already shipped and reusable instead of a new spinner: `data-pending` (`frontend/src/pages/Devices.jsx:313`) + `frontend/src/motion/motion.css:331-335`:
```css
[data-motion="on"] [data-pending="true"] { animation: zm-pending 1.1s ease-in-out infinite; }
@keyframes zm-pending {
  0%, 100% { opacity: 1; }
  50%      { opacity: 0.62; }
}
```

---

# 6. Banner variant B — "Push + Back online"

## 6a. Lab implementation

`frontend/src/lab/sections/Feedback.jsx:273-316` — `BannerDemo` (variant B is lines 294-298; `GLOW` at `:266-271` is variant D only).
```jsx
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
```
The B branch itself — `frontend/src/lab/sections/Feedback.jsx:294-298`
```jsx
      {variant === 'B' && (
        <div style={{ display: 'grid', gridTemplateRows: show ? '1fr' : '0fr', transition: `grid-template-rows calc(340ms * var(--lab-speed,1)) ${cssEase('glide')}` }}>
          <div style={{ overflow: 'hidden' }}><motion.div animate={{ y: show ? 0 : -8, opacity: show ? 1 : 0 }} transition={tx({ duration: 0.2 })}>{Banner}</motion.div></div>
        </div>
      )}
```
For comparison, the A branch (= what production does today) — `Feedback.jsx:293, 313`:
```jsx
      {variant === 'A' && show && <div style={{ animation: `mlBannerIn calc(240ms * var(--lab-speed,1)) ${cssEase('enter')}` }}>{Banner}</div>}
...
      <style>{`@keyframes mlBannerIn{from{transform:translateY(-100%);opacity:0}}`}</style>
```
Lab deps: `tx`, `ms`, `useHaptic`, `Icon`, `useT`, `cssEase('glide')` → `CSS_EASE.glide`, `--lab-speed` → drop. The drop/restore buttons (`Feedback.jsx:309`) are demo-only. The copy strings are inline `{en, he}` and must come from i18n in production.

## 6b. Production landing site

`frontend/src/components/ui/ConnectionStatus.jsx:1-65` — full file. The three-state model, debounce, and the exact code to change:
```jsx
const DEBOUNCE_MS = 2_000

export function ConnectionStatus() {
  const { status } = useNetworkStatus()
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    if (status === 'online') {
      setVisible(false)
      return
    }
    const t = setTimeout(() => setVisible(true), DEBOUNCE_MS)
    return () => clearTimeout(t)
  }, [status])

  if (!visible || status === 'online') return null

  const isOffline = status === 'offline'
  const bg = isOffline ? 'var(--err)' : 'var(--warn)'
  const text = isOffline ? i18nT('status.offline') : i18nT('status.reconnecting')

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: 'sticky', top: 0, zIndex: 10,
        background: bg, color: 'var(--on-accent)',
        fontSize: 13, fontWeight: 500, textAlign: 'center', padding: '8px 16px',
        animation: 'ziggy-banner-in var(--dur-enter) var(--ease-enter)',
      }}
    >
      <style>{`@keyframes ziggy-banner-in {
        from { transform: translateY(-100%); opacity: 0; }
        to   { transform: translateY(0);     opacity: 1; }
      }`}</style>
      {text}
    </div>
  )
}
```
`return null` at `:38` is the hard cut the lab variant replaces; `status.backOnline` is never referenced in this file (the lab's third colour/third message has no production consumer).

`frontend/src/hooks/useNetworkStatus.js:30-56` — the state source. There is **no `back` / transient-recovered state**; the port must add one:
```js
export function useNetworkStatus() {
  const wsConnected = useWsConnected()
  const [online, setOnline] = useState(_readOnline())
  ...
  let status
  if (wsConnected) status = 'online'
  else if (!online) status = 'offline'
  else status = 'connecting'

  return { online, wsConnected, status }
}
```
State names differ from the lab: production `connecting` vs lab `reconnecting`.

**i18n keys (all three already exist; `backOnline` is dead code today)**
`frontend/src/lib/i18n/en.js:135-138`
```js
  'status.offline':         "You're offline",
  'status.reconnecting':    'Reconnecting to Ziggy…',
  'status.backOnline':      'Back online',
```
`frontend/src/lib/i18n/he.js:133-136`
```js
  'status.offline':         'אין חיבור',
  'status.reconnecting':    'מתחבר לזיגי…',
  'status.backOnline':      'החיבור חזר',
```

**Mount site** — `frontend/src/components/layout/AppShell.jsx:302-304`
```jsx
        {/* Connection banner — owns its own debounce + offline/connecting
            split. Used to be an inline debounced 'Offline — reconnecting…'
            banner; ConnectionStatus is the unified component now, fed by
            useNetworkStatus (navigator.onLine + WS). */}
        <ConnectionStatus />
```
Its parent scroller sets `scrollbarGutter: 'stable'` (`AppShell.jsx:299`) — the `grid-template-rows: 0fr→1fr` wrapper must go *inside* this, around the banner.

**SystemHealthBanner enter/exit** — `frontend/src/components/ui/SystemHealthBanner.jsx:104` is the only gate (`if (!copy) return null`), i.e. also a hard cut, and `:149-160` is the shell:
```jsx
  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        display: 'flex', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap',
        padding: 12, borderRadius: 'var(--r-card)',
        background: pal.bg,
        border: `0.5px solid ${pal.border}`,
        color: 'var(--ink)',
      }}
    >
```
with the in-progress pulse at `:161-165` (`className={inProgress ? 'z-dot z-pulse' : 'z-dot'}`; `.z-pulse` defined at `frontend/src/index.css:691`). Mount — `frontend/src/pages/Dashboard.jsx:1288-1293`:
```jsx
      {health?.system_health && (
        <SystemHealthBanner
          health={health}
          onRefresh={() => { getHealth().then(setHealth).catch(() => {}) }}
        />
      )}
```

---

# 7. Loading variant D — "Scan and settle"

## 7a. Lab implementation

`frontend/src/lab/sections/Feedback.jsx:450-473` — the scan math (shared setup):
```jsx
function LoadingDemo({ variant, tx, ms, replayKey, rtl }) {
  const t = useT()
  const [phase, setPhase] = useState('loading')
  const [arrived, setArrived] = useState(0)
  useEffect(() => {
    setPhase('loading'); setArrived(0)
    if (variant === 'C') { ... }
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
```
The D branch — `frontend/src/lab/sections/Feedback.jsx:500-520`:
```jsx
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
```
`RoomCardStatic` — `Feedback.jsx:524-531`. Declaration + spec — `Feedback.jsx:744-750`.

Lab deps: `tx`, `ms`, `rtl` (from `useLab().rtl`; production must read `document.dir` / the i18n direction), `replayKey` (demo-only), `.zl-skel`, `.zl-grid2`, `ROOMS` mock. `scanDelay` hardcodes a **2-column, 136px-tall** grid — it must be re-derived per landing site. `mixBlendMode: 'screen'` on white only works on a dark-ish ground.

## 7b. Production skeleton sites (every one)

### Devices.jsx — 6 × 60px bars (`frontend/src/pages/Devices.jsx:2857-2866`)
```jsx
      {/* Loading skeleton — only when we have nothing to show. Once entities
          are populated, keep the existing list visible during a re-fetch
          (stale-while-revalidate) so back-navigation never goes blank just
          because the TTL expired. */}
      {loading && entities.length === 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {[1,2,3,4,5,6].map(i => <div key={i} style={{ height: 60, borderRadius: 11, background: 'var(--surface)', border: '0.5px solid var(--line)', opacity: 0.6 }} />)}
        </div>
      )}
```
Single column → `scanDelay`'s `i % 2` collapses; needs a row-only delay.

### Rooms.jsx — 4 skeleton tiles (`frontend/src/pages/Rooms.jsx:771-790`)
```jsx
      {!reorderMode && (
        <div className="z-rooms-grid" data-motion-stagger="">
          {/* Stale-while-revalidate: only show skeleton on a true cold start
              (no rooms cached at all). On a back-nav refresh, show the
              cached tiles immediately — they update in place when the new
              data arrives. */}
          {loading && filteredRooms.length === 0 && [1, 2, 3, 4].map(i => (
            <div key={i} style={{ height: 'var(--rooms-tile-h)', borderRadius: 'var(--r-card)', background: 'var(--surface-2)', opacity: 0.6 }} />
          ))}
          {filteredRooms.map(room => (
            <RoomTile ... />
          ))}
        </div>
      )}
```
**Conflict to resolve:** this grid already carries `data-motion-stagger=""`, whose CSS cascade is `frontend/src/motion/motion.css:192-209` (35ms-per-child nth-child delays, capped at child 8). A scan delay would double-stagger. Height is `var(--rooms-tile-h)`, not 136px.

### Actions.jsx — 3 × 82px (`frontend/src/pages/Actions.jsx:496-504`)
```jsx
      {/* Skeleton until BOTH the automations list AND the Smart Light Schedule
          status have loaded, so the schedule card appears in place with the
          rest instead of jumping in after its separate fetch resolves. */}
      {(circadianStatus === null || (loading && automations.length === 0)) && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {[1,2,3].map(i => <div key={i} style={{ height: 82, borderRadius: 'var(--r-card)', background: 'var(--surface)', border: '0.5px solid var(--line)', opacity: 0.6 }} />)}
        </div>
      )}
```

### Anomalies.jsx — 2 × 100px (`frontend/src/pages/Anomalies.jsx:528-536`)
```jsx
          {/* Skeleton only on a cold start. Cached anomalies stay visible
              while a background refresh is in flight. */}
          {loading && activeList.length === 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {[1, 2].map(i => (
                <div key={i} style={{ height: 100, borderRadius: 'var(--r-card)', background: 'var(--surface-2)', border: '0.5px solid var(--line)' }} />
              ))}
            </div>
          )}
```

### Suggestions.jsx — 3 × 120px (`frontend/src/pages/Suggestions.jsx:297-303`)
```jsx
      {/* Loading — stale-while-revalidate: skeleton only on true cold start.
          During a background refresh, keep cached cards visible below. */}
      {loading && suggestions.length === 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {[1,2,3].map(i => <div key={i} style={{ height: 120, borderRadius: 'var(--r-card)', background: 'var(--surface)', border: '0.5px solid var(--line)', opacity: 0.6 }} />)}
        </div>
      )}
```

### Tasks.jsx — 4 × 56px (`frontend/src/pages/Tasks.jsx:413-421`)
```jsx
      {/* Loading skeleton */}
      {loading && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {[1,2,3,4].map(i => (
            <div key={i} style={{ height: 56, borderRadius: 'var(--r-card)', background: 'var(--surface-2)', border: '0.5px solid var(--line)' }} />
          ))}
        </div>
      )}
```
Note: gated on `loading` alone (no stale-while-revalidate), so the scan WILL replay on every refetch — exactly the tradeoff the lab note warns about.

### QuickAsks.jsx — 4 × 120px in a 2-col grid (closest to the lab's geometry) — `frontend/src/pages/QuickAsks.jsx:252-257`
```jsx
      {/* Loading — skeleton only on cold start; otherwise keep cached grid */}
      {loading && items.length === 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8 }}>
          {[1,2,3,4].map(i => <div key={i} style={{ height: 120, borderRadius: 'var(--r-card)', background: 'var(--surface)', border: '0.5px solid var(--line)', opacity: 0.6 }} />)}
        </div>
      )}
```

### DeviceDetail skeleton — `frontend/src/pages/DeviceDetail.jsx:981-996`
```jsx
    // Skeleton — static placeholders, no pulse loop; the page fills in within
    // a network round-trip so an ambient animation buys nothing.
    return (
      <div style={{ maxWidth: 'var(--page-max-w-narrow)', margin: '0 auto', padding: '24px 20px 24px' }}>
        <div style={{ marginBottom: 24 }}>
          <button onClick={() => navigate(-1)} className="z-icon-btn" aria-label={t('deviceDetail.back')}>
            <ArrowLeft size={20} strokeWidth={1.75} className="icon-flip-rtl" />
          </button>
          <div style={{ height: 34, width: 160, marginTop: 12, borderRadius: 'var(--r-chip)', background: 'var(--surface-2)' }} />
        </div>
        {[1, 2, 3].map(i => (
          <div key={i} style={{ height: 96, marginBottom: 12, borderRadius: 'var(--r-card)', background: 'var(--surface-2)' }} />
        ))}
      </div>
    )
```
This one is an early `return` from the page function (gate at `:949`, `:981`) — the whole page swaps, so a sweep overlay needs a positioned wrapper that doesn't exist yet.

### DataState.jsx (unused — zero consumers) — `frontend/src/components/ui/DataState.jsx`
Full file read. The override hook the scan would live behind is `renderSkeleton` (`:93`, `:110`, `:122`):
```jsx
  if (loading) {
    return renderSkeleton ? renderSkeleton() : <DefaultSkeleton />
  }
```
Default skeleton is a text label, not a block — `:26-40`:
```jsx
function DefaultSkeleton() {
  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        minHeight: 120, padding: 24,
        color: 'var(--ink-mute)', fontSize: 13,
      }}
    >
      {i18nT('state.loading')}
    </div>
  )
}
```
There is no shimmer/sweep keyframe anywhere in `frontend/src/motion/motion.css` today (only `zm-pending` opacity at `:331-335` and `zPulse` at `frontend/src/index.css:691`) — the sweep is net-new CSS.

---

# 8. Success variant C — "Ring bloom"

## 8a. Lab implementation (full)

`frontend/src/lab/sections/Feedback.jsx:620-626` — the drawn check:
```jsx
function CheckPath({ tx, draw, delay = 0.12, size = 30 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'block' }}>
      <motion.path d="M5 12.5l4.5 4.5L19 7.5" initial={draw ? { pathLength: 0 } : false} animate={{ pathLength: 1 }} transition={tx({ duration: 0.36, delay, ease: EASE.out })} />
    </svg>
  )
}
```

`frontend/src/lab/sections/Feedback.jsx:628-640` — host setup (disc token, haptic at 120ms):
```jsx
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
```

**Variant C itself** — `frontend/src/lab/sections/Feedback.jsx:653-658`
```jsx
          {variant === 'C' && (
            <motion.div initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={tx({ type: 'spring', duration: 0.5, bounce: 0.3 })} style={disc}>
              <motion.span initial={{ scale: 1, opacity: 0.7 }} animate={{ scale: 2, opacity: 0 }} transition={tx({ duration: 0.6, delay: 0.12, ease: EASE.out })} style={{ position: 'absolute', inset: 0, borderRadius: 999, border: '2px solid var(--ok)', pointerEvents: 'none' }} />
              <CheckPath tx={tx} draw />
            </motion.div>
          )}
```

**Title rise (the "+8px beneath it" half of C)** — `frontend/src/lab/sections/Feedback.jsx:670-677`
```jsx
          <div>
            {variant === 'A' ? (
              <div className="zl-title3">{title}</div>
            ) : (
              <motion.div className="zl-title3" initial={{ y: variant === 'C' ? 8 : 0, opacity: variant === 'A' ? 1 : 0 }} animate={{ y: 0, opacity: 1 }} transition={tx({ duration: 0.3, delay: 0.26, ease: EASE.out })}>{title}</motion.div>
            )}
            <motion.div className="zl-subhead zl-mute" initial={variant === 'A' ? false : { opacity: 0 }} animate={{ opacity: 1 }} transition={tx({ duration: 0.3, delay: 0.4 })} style={{ marginTop: 4 }}>{sub}</motion.div>
          </div>
```
Spec line — `Feedback.jsx:766`: `'ring 1→2 600 ms ease-out · title y 8→0 300 ms delay 260 ms'`.

Lab deps: `tx`, `ms`, `useHaptic`, `useT`, `.zl-title3` / `.zl-subhead` / `.zl-mute`, `Button` from primitives (`Feedback.jsx:688`), and `LayoutGroup id="success"` (`:643`) which exists for variant D only.

## 8b. Production landing sites

### (i) Onboarding DoneStep — `frontend/src/pages/onboarding/steps.jsx:399-415`
```jsx
  return (
    <section style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16 }}>
      <div aria-hidden style={{
        width: 64, height: 64, borderRadius: '50%',
        background: 'color-mix(in srgb, var(--ok) 12%, var(--surface))', color: 'var(--ok)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <Check size={32} strokeWidth={2} />
      </div>
      <div className="z-title">{t('mobileOnboard.allSet')}</div>
      {showButton && (
        <button onClick={onDone} className="z-btn-primary z-button" style={{ marginTop: 8 }}>
          {t('common.continue')}
        </button>
      )}
    </section>
  )
```
Disc differs from the lab: `--ok 12%` fill (lab `16%`), `color: 'var(--ok)'` (lab `--ok-text`), lucide `<Check size={32} strokeWidth={2} />` (lab draws its own 24-viewBox path at `strokeWidth 2.6`, size 30).

**Hard timing constraint** — `frontend/src/pages/onboarding/steps.jsx:391-398`:
```jsx
  // Auto-advance after 1.5s, with a visible Continue button after 1s as a
  // fallback if the post-navigate redirect chain ever hiccups.
  const [showButton, setShowButton] = useState(false)
  useEffect(() => {
    const btnTimer = setTimeout(() => setShowButton(true), 1000)
    const navTimer = setTimeout(onDone, 1500)
    return () => { clearTimeout(btnTimer); clearTimeout(navTimer) }
  }, [onDone])
```
The lab's C sequence runs disc(500ms) + ring(120+600=720ms) + title(260+300=560ms) — it fits inside 1500ms, but only just, and there is no haptic today.

### (ii) PairingWizard "Device found!" — `frontend/src/components/PairingWizard.jsx:861-877`
```jsx
        {step === 'found' && foundDevice && (
          <motion.div
            key="found"
            {...STEP_MOTION}
            className="flex flex-col gap-4"
          >
            <div className="flex items-center gap-3 p-4 rounded-card bg-ok-soft border border-ok-soft">
              <CheckCircle2 size={24} strokeWidth={1.75} className="text-ok shrink-0" aria-hidden />
              <div className="min-w-0">
                <p className="text-body font-semibold text-ok-text">{t('wizard.pairing.deviceFound')}</p>
                {(foundDevice.manufacturer || foundDevice.model) && (
                  <p className="text-subhead text-ok-text truncate">
                    {[foundDevice.manufacturer, foundDevice.model].filter(Boolean).join(' · ')}
                  </p>
                )}
              </div>
            </div>
```
This is a **horizontal strip with a 24px `CheckCircle2`, not a 64px disc** — porting the ring bloom means restructuring the layout, not just adding motion. Step state machine: `PairingWizard.jsx:66` (`STEP_IDS`), `:224` (`foundDevice`), `:302` (`setStep('found')`). The lab's own note (`Feedback.jsx:711`) flags this site, and `recommend` for this demo is **B**, not C — C is explicitly "too much for every paired bulb".

### (iii) IrWalkWizard done disc — `frontend/src/pages/IrWalkWizard.jsx:669-693`
```jsx
  const renderDone = (ok) => (
    <div style={{ textAlign: 'center', display: 'flex', flexDirection: 'column', gap: 16, padding: '16px 0' }}>
      <motion.div
        initial={{ scale: 0.5, opacity: 0, rotate: ok ? -12 : 0 }}
        animate={{ scale: 1, opacity: 1, rotate: 0 }}
        transition={T_ENTER}
        style={{
          width: 72, height: 72, borderRadius: '50%', margin: '0 auto',
          background: ok ? 'var(--ok)' : 'var(--surface-2)',
          color: ok ? 'var(--on-accent)' : 'var(--ink-2)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
        {ok ? <PartyPopper size={32} strokeWidth={1.75} /> : <Ear size={32} strokeWidth={1.75} />}
      </motion.div>
      <p className="z-title">
        {ok ? t('irWalk.validate.successTitle') : t('irWalk.finish.title')}
      </p>
      <p className="z-body" style={{ color: 'var(--ink-mute)', maxWidth: 360, margin: '0 auto' }}>
        {ok ? t('irWalk.validate.successBody') : t('irWalk.finish.failBody') /* actual: t('irWalk.validate.failBody') */}
      </p>
      <Button variant="primary" size="lg" style={{ marginTop: 8 }} onClick={() => navigate('/devices')}>
        {t('common.done')}
      </Button>
    </div>
  )
```
(verbatim line `:687` is `{ok ? t('irWalk.validate.successBody') : t('irWalk.validate.failBody')}`.)
Already has an entrance (`scale 0.5→1`, `rotate -12→0`, `T_ENTER` = `{ duration: 0.24, ease: [0.16,1,0.3,1] }` from `frontend/src/lib/motion.js:22`) and a **72px solid `--ok` disc with `PartyPopper`, not a tinted disc with a check**. Phase machine `IrWalkWizard.jsx:181`, render at `:780-781`.

Related existing check-draw-adjacent moment in the same file — the per-command success overlay, `frontend/src/pages/IrWalkWizard.jsx:100-123` (96px solid `--ok` disc, `Check size={52} strokeWidth={3}`, `initial scale 0.4 → exit scale 1.15`, `T_ENTER`). This is the closest production analogue to the lab's disc+check and the natural host for a ring.

---

## Cross-cutting notes for the plan

- `frontend/src/components/ui/DeviceControls.jsx:1-15` is the import header the ports extend; `useKinetic` (`:70`), `detentTick` (`:74-80`), `isMotionOn`/`useMotionOn` (`frontend/src/motion/flag.js`), `CSS_EASE`/`haptic`/`isReduced` (`frontend/src/motion/motion.js`) and `import '../../motion/controls.css'` are already wired there. `frontend/src/components/device/remotes/ACRemote.jsx`, `frontend/src/components/device/DeviceCard.jsx`, `frontend/src/pages/Actions.jsx`, `Rooms.jsx`, `DeviceDetail.jsx`, `onboarding/steps.jsx`, `IrWalkWizard.jsx` do **not** import the motion layer — each port adds the import + the `useKinetic`/`isMotionOn` gate itself.
- Every lab variant that uses `filter: blur(...)` (SegC, ToastD) or an infinite loop (ToastD spinner, BannerDemo breathe) violates the stated rule in `frontend/src/motion/motion.js:11-18` ("transform and opacity only", "nothing loops for decoration") and needs an explicit `safe()` / reduced-motion branch — see `frontend/src/motion/motion.css:336+` and `controls.css:155-175` for the existing reduced-motion blocks.
- Direction: `BrightnessA`'s RTL handling (`Controls.jsx:372`) is `document.dir === 'rtl' || ref.current.closest('[dir=rtl]')`; `LoadingDemo` takes `rtl` from `useLab()`; `HoldDeleteA`'s clip-path and `RollingDigit`'s flex row are direction-naive. Production reads direction through `frontend/src/lib/i18n` / `document.dir` / `.icon-flip-rtl`.
