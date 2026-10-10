# Port notes — Data + Moments (extracted 2026-10-10 from feat/motion-lab)

I have everything. Here is the report.

---

# Lab helpers that every port must replace

Before the per-pick sections, the substitution table (all lab variants below depend on some subset):

| Lab helper | Where defined | Production equivalent |
|---|---|---|
| `tx(t)` — scales a framer transition by lab speed | `lab/LabContext.jsx:52` → `lab/time.js:16-38` (`scaleTransition`) | **Delete the wrapper.** Pass the transition literally. The lab speed control does not exist in the app. |
| `ms(n)` — scales `setTimeout` choreography | `lab/LabContext.jsx:54` | **Delete.** Use raw ms. |
| `EASE.out` `[0.23,1,0.32,1]`, `EASE.inOut` `[0.77,0,0.175,1]` | `lab/time.js:46-55` | `src/motion/motion.js:20-26` has the **identical** `EASE.out/glide/inOut/drawer/std`. For in-app call sites the house vocabulary is `src/lib/motion.js:15-23` — `EASE_STANDARD=[0.2,0,0,1]`, `EASE_ENTER=[0.16,1,0.3,1]`, `T_STATE`, `T_ENTER`, `T_PRESS`, `FADE_UP`, `FADE`. |
| `SPRING.*`, `DUR.*` | `lab/time.js:74-83` | `src/motion/motion.js:36-52` — byte-identical values. |
| `useHaptic()` from `lab/LabContext.jsx:79-87` | lab-only; also dispatches `lab:haptic` window event | `haptic(kind)` from `src/motion/motion.js:104-108` — same `PATTERNS` map (`selection/light/medium/heavy/success/warning/error`), minus the window event. |
| reduced-motion | `MotionConfig reducedMotion` in `LabContext.jsx:59` | `isReduced()` / `onReducedChange()` / `safe(transition, reduced)` — `src/motion/motion.js:73-83` |
| `useT()` returning `{en,he}` picker | `lab/ziggy/primitives.jsx:36-45` | `useT()` / `t()` from `src/lib/i18n` with flat dotted keys (`lib/i18n/en.js`, `he.js`) |
| `Icon name=…` (lucide name map) | `lab/ziggy/primitives.jsx:14-35` | direct `lucide-react` imports (the app does this everywhere) |
| `Page` / `Card` / `Button` / `Tile` / `Row` | `lab/ziggy/primitives.jsx:47-80+` | `.z-card`, `.z-btn-primary`, `.z-btn-secondary`, `.z-chip`, `.z-icon-btn` in `index.css` |
| `.zl-mono` = `font-variant-numeric: tabular-nums` | `lab/ziggy/ziggy.css:23` | `.z-mono` — `index.css:351-355`: `font-family: inherit; font-variant-numeric: tabular-nums; unicode-bidi: isolate;` **Note: `.z-mono` already carries `unicode-bidi: isolate`, which is the RTL island the lab's `dir="ltr"` hack approximates.** |
| `.zl-toast`, `.zl-tile`, `.zl-chip`, `.zl-grid2`, `.zl-stack`, `.zl-hstack` | `lab/ziggy/ziggy.css` | `index.css` + `src/motion/motion.css` + `src/motion/controls.css` |
| `knobs`, `replayKey`, `replay`, `rtl`, `reduced`, `speed`, `stage` render props | `lab/ui/Demo.jsx:16, 48-72` | none — knob values become literals; `replayKey` becomes a real state/mount key |
| `--lab-speed` CSS var (used in `Data.jsx:220` inline `transition`) | lab root | `var(--dur-state)` / `var(--dur-press)` / `var(--dur-enter)` (`index.css:95-99`) with `var(--ease-standard)` / `var(--ease-enter)` |

CSS token parity already exists: `index.css:95-99` defines `--dur-press: 120ms`, `--dur-state: 200ms`, `--dur-enter: 240ms`, `--ease-standard: cubic-bezier(0.2,0,0,1)`, `--ease-enter: cubic-bezier(0.16,1,0.3,1)`.

---

# 1. Data › readout variant **B — "Rolling digits"**

## 1a. The lab implementation

`frontend/src/lab/sections/Data.jsx:14-27` — the whole rolling-digit component:

```jsx
function RollingNumber({ value, digits = 1, tx, dur = 0.45, size = 44 }) {
  const str = value.toFixed(digits)
  return (
    <span className="zl-mono" style={{ display: 'inline-flex', fontSize: size, lineHeight: 1, fontWeight: 700, letterSpacing: '-0.02em' }}>
      {str.split('').map((c, i) => c === '.' || c === '-' ? <span key={'s' + i}>{c}</span> : (
        <span key={i} style={{ display: 'inline-block', position: 'relative', height: '1em', width: '0.6em', overflow: 'hidden' }}>
          <motion.span animate={{ y: `-${Number(c)}em` }} transition={tx({ type: 'spring', duration: dur, bounce: 0.05 })} style={{ display: 'block' }}>
            {Array.from({ length: 10 }).map((_, d) => <span key={d} style={{ display: 'block', height: '1em', textAlign: 'center' }}>{d}</span>)}
          </motion.span>
        </span>
      ))}
    </span>
  )
}
```

How it handles the four cases you asked about:

- **Decimals** — `value.toFixed(digits)`; `digits` is the prop (`1` for °C, `0` for `%` and `W`). The decimal point is matched at `c === '.'` and rendered as a **bare `<span>{c}</span>` with no fixed width** — i.e. the separator is *not* in a 0.6em cell (unlike `BlurDigits`, which gives separators a `0.3em` cell). The `.` therefore keeps the font's natural period advance.
- **Units** — **not handled inside the component.** The unit is a sibling span at the call site (`Data.jsx:83`, `:89`, `:90`): `<span className="zl-title3 zl-mute">°C</span>`, `<span className="zl-subhead zl-mute">%</span>`, `<span className="zl-subhead zl-mute">W</span>`, inside a `display:flex; alignItems:'baseline'` wrapper.
- **Sign** — `c === '-'` takes the same bare-span branch as `.`, so a minus is static text with natural advance; it does not roll and does not get a cell.
- **RTL** — **`RollingNumber` has NO `dir="ltr"`.** Only `BlurDigits` (variant D) is an LTR island: `Data.jsx:43` `<span className="zl-mono" dir="ltr" …>`. This is the one correctness gap in the pick: variant B as written relies on the outer `display:inline-flex` (which fixes visual order of the cells) but does not isolate bidi. The production `.z-mono` class already supplies `unicode-bidi: isolate` (`index.css:351-355`), so the port should either keep `.z-mono` on the wrapper or add `dir="ltr"` explicitly as `BlurDigits` does.
- **Each cell** is `width: 0.6em; height: 1em; overflow: hidden`, and the inner column is 10 stacked `height:1em` glyphs translated by `y: -${digit}em`. Spring: `{ type: 'spring', duration: 0.45, bounce: 0.05 }`.

Lab dependencies: `tx` (remove), `motion` from framer-motion (already a dep), `.zl-mono` → `.z-mono`.

The sibling components in the same island, for reference — the spring-glide one (`SpringNumber`) is used by the *sparkline* and *bars* demos, so the port needs it too:

`Data.jsx:29-34`
```jsx
function SpringNumber({ value, digits = 1, tx, size = 44 }) {
  const mv = useSpring(value, tx({ stiffness: 140, damping: 22 }))
  useEffect(() => { mv.set(value) }, [value, mv])
  const text = useTransform(mv, (v) => v.toFixed(digits))
  return <motion.span className="zl-mono" style={{ fontSize: size, lineHeight: 1, fontWeight: 700, letterSpacing: '-0.02em' }}>{text}</motion.span>
}
```

`Data.jsx:40-56` (variant D, the one with the LTR island — included because its separator/cell handling is the model to copy):
```jsx
function BlurDigits({ value, digits = 1, tx, size = 44 }) {
  const str = value.toFixed(digits)
  return (
    <span className="zl-mono" dir="ltr" style={{ display: 'inline-flex', fontSize: size, lineHeight: 1, fontWeight: 700, letterSpacing: '-0.02em' }}>
      {str.split('').map((c, i) => {
        const sep = c === '.' || c === '-' || c === ','
        return (
          <span key={'cell' + i} style={{ display: 'inline-grid', width: sep ? '0.3em' : '0.6em', height: '1em', justifyItems: 'center', overflow: 'visible' }}>
            <AnimatePresence mode="popLayout" initial={false}>
              <motion.span key={c} initial={{ opacity: 0, y: '0.14em', filter: 'blur(4px)' }} animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }} exit={{ opacity: 0, y: '-0.14em', filter: 'blur(4px)' }} transition={tx({ duration: 0.22, ease: EASE.out })} style={{ display: 'block', gridArea: '1 / 1' }}>{c}</motion.span>
            </AnimatePresence>
          </span>
        )
      })}
    </span>
  )
}
```

The call-site harness that chooses the variant and proves the remount hazard — `Data.jsx:69-91`:

```jsx
function ReadoutDemo({ variant, tx, ms }) {
  const t = useT(); const h = useHaptic()
  const [auto, setAuto] = useState(false)
  const s = useLiveSensor(ms, auto)
  const prev = useRef(s.temp); const [trend, setTrend] = useState(0)
  useEffect(() => { setTrend(Math.sign(s.temp - prev.current)); prev.current = s.temp }, [s.temp])
  // a render helper, not a component: a component defined in render remounts on every
  // tick, which would reset the roll / blur-swap before it could play
  const num = (v, d, size) => variant === 'A' ? <span className="zl-mono" style={{ fontSize: size, lineHeight: 1, fontWeight: 700, letterSpacing: '-0.02em' }}>{v.toFixed(d)}</span> : variant === 'B' ? <RollingNumber value={v} digits={d} tx={tx} size={size} /> : variant === 'D' ? <BlurDigits value={v} digits={d} tx={tx} size={size} /> : <SpringNumber value={v} digits={d} tx={tx} size={size} />
  return (
    <Page title={t({ en: 'Living Room', he: 'סלון' })}>
      …
        <Card style={{ display: 'flex', alignItems: 'flex-end', gap: 12 }}>
          <div style={{ flex: 1 }}><div className="zl-footnote zl-mute">{t({ en: 'Temperature', he: 'טמפרטורה' })}</div><div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>{num(s.temp, 1, 44)}<span className="zl-title3 zl-mute">°C</span>
          …
        <div className="zl-grid2">
          <Card><div className="zl-footnote zl-mute">{t({ en: 'Humidity', he: 'לחות' })}</div><div style={{ display: 'flex', alignItems: 'baseline', gap: 2 }}>{num(s.hum, 0, 32)}<span className="zl-subhead zl-mute">%</span></div></Card>
          <Card><div className="zl-footnote zl-mute">{t({ en: 'Water heater', he: 'דוד' })}</div><div style={{ display: 'flex', alignItems: 'baseline', gap: 2 }}>{num(s.watts, 0, 32)}<span className="zl-subhead zl-mute">W</span></div></Card>
        </div>
```

Demo registration (where `inZiggy` names the intended landing sites) — `Data.jsx:353-360`, variant B at `:357`:
```jsx
<Demo id="readout" title="Live sensor readout" purpose="Temperature, humidity, power: they move, so show them moving." principles={['state', 'restraint']} inZiggy={['SensorRemote hero (56px)', 'DeviceCard MetricPills', 'Dashboard room tile chips']}
  recommend="D"
  variants={[
    …
    { key: 'B', label: 'Rolling digits', note: 'Each digit rolls to its new value (an odometer); the direction of the roll is the direction of the change. Digits that did not change stay still.', render: (p) => <ReadoutDemo {...p} variant="B" /> },
```

## 1b. Production landing sites

### SensorRemote 56px hero — `frontend/src/components/device/remotes/SensorRemote.jsx:36-62`

```jsx
export function SensorRemote({ entity }) {
  const facts = deviceFacts(entity)
  const tone = TONE[statusTone(facts)] || TONE.idle

  // Numeric sensor: the reading is the page's single hero number (56);
  // word states (Open / Motion / Clear) sit at Large Title.
  const isNumeric = [KIND.TEMPERATURE, KIND.HUMIDITY, KIND.POWER_METER].includes(facts.kind)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Big reading */}
      <div className="z-card" style={{
        padding: 24,
        background: tone.bg,
        textAlign: 'center', borderColor: 'transparent',
        transition: 'background var(--dur-state) var(--ease-standard)',
      }}>
        <div className={isNumeric ? 'z-mono' : 'z-display'} style={{
          color: tone.fg,
          ...(isNumeric ? { fontSize: 56, lineHeight: 1, fontWeight: 700, letterSpacing: '-0.02em' } : {}),
        }}>
          {facts.stateLabel}
        </div>
        <div style={{ fontSize: 13, marginTop: 8, color: 'var(--ink-mute)' }}>
          {facts.meta.label}
        </div>
      </div>
```

Key facts for the port: the hero's inline style `{fontSize:56, lineHeight:1, fontWeight:700, letterSpacing:'-0.02em'}` is **character-identical** to `RollingNumber`'s own style block minus `fontSize: size` — so `size={56}` reproduces it exactly. But `facts.stateLabel` is **already a formatted string with the unit baked in** (see `lib/devices.js:876` `const _stateLabel = _isUnavailable ? i18nT('common.unavailable') : labelFn(entity)`, exposed at `:898`). `RollingNumber` takes a **number**. The port needs a numeric value + unit split at this site, which `facts` does not currently expose as separate fields for this path.

Sibling numeric readouts on the same page, `SensorRemote.jsx:68-79` and the row renderer `:86-95`:
```jsx
          {facts.battery != null && (
            <DiagRow Icon={facts.battery < 20 ? BatteryLow : Battery} label={i18nT('sensorRemote.battery')} value={`${facts.battery}%`} tone={facts.battery < 20 ? 'err' : 'idle'} />
          )}
          {facts.rssi != null && (
            <DiagRow Icon={Wifi} label={i18nT('sensorRemote.signal')} value={`${facts.rssi} dBm`} />
          )}
```
```jsx
function DiagRow({ Icon, label, value, tone = 'idle' }) {
  const fg = tone === 'err' ? 'var(--err-text)' : tone === 'warn' ? 'var(--warn-text)' : 'var(--ink)'
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, minHeight: 40, fontSize: 13 }}>
      {Icon && <Icon size={18} strokeWidth={1.75} style={{ color: 'var(--ink-mute)', flexShrink: 0 }} />}
      <span style={{ color: 'var(--ink-mute)', flex: 1 }}>{label}</span>
      <span className="z-mono" style={{ color: fg, fontWeight: 600 }}>{value}</span>
    </div>
  )
}
```
`value` arrives as a template string (`` `${facts.battery}%` ``) — again value+unit pre-joined.

### DeviceCard MetricPills — `frontend/src/components/device/DeviceCard.jsx:599-653`

```jsx
const _METRIC_FALLBACK_UNITS = {
  power:           'W',
  current:         'A',
  voltage:         'V',
  energy:          'kWh',
  temperature:     '°',
  humidity:        '%',
  illuminance:     'lx',
  battery:         '%',
  signal_strength: 'dBm',
  duration:        'min',
}

function _fmtMetricValue(state) {
  if (state == null || state === 'unavailable' || state === 'unknown') return null
  const n = Number(state)
  if (!Number.isFinite(n)) return String(state)
  if (Math.abs(n) >= 100) return Math.round(n).toString()
  if (Math.abs(n) >= 10)  return n.toFixed(1).replace(/\.0$/, '')
  return n.toFixed(2).replace(/\.?0+$/, '')
}

function MetricPills({ metrics }) {
  if (!Array.isArray(metrics) || metrics.length === 0) return null
  const visible = metrics
    .map((m) => {
      const v = _fmtMetricValue(m.state)
      if (v == null) return null
      const unit = m.unit || _METRIC_FALLBACK_UNITS[m.device_class] || ''
      return { dc: m.device_class, value: v, unit }
    })
    .filter(Boolean)
    .slice(0, 3)
  if (visible.length === 0) return null
  return (
    <div className="z-mono" style={{
      display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 6, alignItems: 'center',
      fontSize: 12, lineHeight: '18px', color: 'var(--ink-mute)',
    }}>
      {visible.map((m, i) => (
        <span
          key={`${m.dc}-${i}`}
          title={m.dc}
          style={{
            padding: '2px 8px', borderRadius: 999,
            background: 'var(--surface-2)', border: '0.5px solid var(--line)',
            color: 'var(--ink-mute)', whiteSpace: 'nowrap',
          }}
        >
          {m.value}{m.unit ? (m.unit === '°' ? '°' : ` ${m.unit}`) : ''}
        </span>
      ))}
    </div>
  )
}
```

This is the **best-shaped** landing site in the app: `_fmtMetricValue` already returns the digit string separately from `unit`, so `{m.value}` can be swapped for `<RollingNumber value={Number(m.state)} digits={…}/>` with the unit left as the existing trailing text. Note `_fmtMetricValue` has **variable decimal count** (`0` for |n|≥100, `1` for ≥10, `2` below, with trailing-zero stripping) — `RollingNumber`'s fixed-cell layout will shift cell count as a value crosses 10 or 100; `digits` must be derived from the same thresholds, and the trailing-`.replace(/\.?0+$/,'')` stripping will change the glyph count mid-stream.

Call site: `DeviceCard.jsx:569` `<MetricPills metrics={metrics} />` inside the row variant, whose own mono value line is `:566-568`:
```jsx
        <div className="z-mono z-subhead" style={{ marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {secondaryLine(facts)}
        </div>
```

Tile-variant state line — `DeviceCard.jsx:492-495`:
```jsx
        <div className="z-mono" style={{ fontSize: stateSize, lineHeight: '18px', color: subColor,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {facts.stateLabel}{shownBrightness != null && facts.isOn ? ` · ${shownBrightness}%` : ''}
        </div>
```

Compact-card state — `DeviceCard.jsx:671`:
```jsx
      <span className="z-mono" style={{ fontSize: 12, color: 'var(--ink-mute)' }}>{facts.stateLabel}</span>
```

IR climate inline temp stepper — `DeviceCard.jsx:143-145`:
```jsx
      <span className="z-mono" style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)', minWidth: 40, textAlign: 'center' }}>
        {t != null ? `${Math.round(t)}°` : '—'}
      </span>
```

### Devices.jsx sensor state row `23.4°C · Temperature` — `frontend/src/pages/Devices.jsx:2104-2114`

```jsx
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
              <p className={cn(colorClass, 'truncate min-w-0 flex-1')}>
                {stateLabel}
                {/* Mid-scrub only: the value has to be visible while the
                    finger is setting it. `null` at rest, so this renders
                    nothing at all unless a drag is actually in progress. */}
                {scrubValue != null ? ` · ${scrubValue}%` : ''}
                {!isControllable && stateSecondary && (
                  <span className="text-ink-faint font-normal ml-1">· {stateSecondary}</span>
                )}
              </p>
```

`stateLabel` / `stateSecondary` come from `Devices.jsx:1795-1797`:
```jsx
  const { primary: stateLabel, secondary: stateSecondary } = (!isIr && !isController && !isHidden)
    ? formatEntityState(entity)
    : { primary: isHidden ? t('devices.hidden') : '', secondary: null }
```

and the producer, `frontend/src/lib/utils.js:91-115` — **this is where `23.4°C` and `Temperature` are built**:
```js
  if (domain === 'sensor') {
    …
    const num = parseFloat(state)
    const val = isNaN(num) ? state : (Number.isInteger(num) ? num : parseFloat(num.toFixed(1)))
    const unit = unit_of_measurement || ''
    const label = device_class
      ? device_class.charAt(0).toUpperCase() + device_class.slice(1)
      : null
    return {
      primary: unit ? `${val}${unit}` : `${val}`,
      secondary: label,
    }
  }
```
`primary` is a joined string. For a rolling-digit port, `formatEntityState` must gain a third field (the raw number) or the call site must re-parse. `val` has **variable decimals** (integer values print with none, non-integers with one), which again changes `RollingNumber`'s cell count between ticks.

The **`· {scrubValue}%` mid-scrub brightness** is the "brightness % mid-scrub" landing site. `scrubValue` is the card's live-drag state, documented at `Devices.jsx:1829-1830` ("Live brightness while a scrub is in progress. `null` at rest, so the resting state line is byte-identical to what it always rendered.").

### Dashboard room-tile chips — `frontend/src/pages/Dashboard.jsx:471-503`

```jsx
  const chipNeutralBg = photo ? 'rgba(0,0,0,0.32)' : 'var(--surface)'
  const chipFg        = photo ? '#fff' : 'var(--ink)'
  const chipBase = {
    fontSize: 12, lineHeight: '16px', color: chipFg, fontVariantNumeric: 'tabular-nums',
    padding: '4px 8px', borderRadius: 999, backdropFilter: 'blur(8px)',
    border: photo ? 'none' : '0.5px solid var(--line)',
    display: 'inline-flex', alignItems: 'center', gap: 4,
  }
  const chips = (summary.tempSensor || summary.humSensor || summary.occupied) && (
    <div style={{ display: 'flex', gap: 4, alignItems: 'center', minWidth: 0 }}>
      {summary.occupied && (
        <span title={t('rooms.occupied')} aria-label={t('rooms.occupied')} style={{ ...chipBase, background: 'color-mix(in srgb, var(--ok) 55%, transparent)', color: photo ? '#fff' : 'var(--ink)' }}>
          <User size={14} strokeWidth={2} aria-hidden="true" />
        </span>
      )}
      {summary.tempSensor && (() => {
        const raw = parseFloat(summary.tempSensor.state)
        const unit = summary.tempSensor.unit_of_measurement
                  || summary.tempSensor.attributes?.unit_of_measurement
                  || '°C'
        const tempC = unit.includes('F') ? (raw - 32) * 5 / 9 : raw
        const bg = tempC < 18 ? 'color-mix(in srgb, var(--info) 55%, transparent)'
                 : tempC > 25 ? 'color-mix(in srgb, var(--err) 55%, transparent)'
                 : chipNeutralBg
        return <span style={{ ...chipBase, background: bg }}>{raw.toFixed(1)}°</span>
      })()}
      {summary.humSensor && (
        <span style={{ ...chipBase, background: chipNeutralBg }}>
          {parseFloat(summary.humSensor.state).toFixed(0)}%
        </span>
      )}
    </div>
  )
```
Cleanest site after MetricPills: `raw.toFixed(1)` and `parseFloat(...).toFixed(0)` are exactly `RollingNumber`'s `digits={1}` / `digits={0}` contract, with `°` and `%` as adjacent text. Chips use `fontVariantNumeric:'tabular-nums'` inline rather than `.z-mono`, so they lack `unicode-bidi: isolate`.

### Brightness % (not mid-scrub) and power/volume readouts — `frontend/src/components/ui/DeviceControls.jsx`

BrightnessLamp's own big number, `:167-171`:
```jsx
      <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-0.035em', color: 'var(--ink)', lineHeight: 1 }}>
        {isOn ? `${pct}%` : t('deviceControls.off')}
      </div>
```
(Its drag handler at `:140-154` already does detent haptics — `if (isMotionOn()) detentTick(detent, next, 5)` — "One tick per 5% of brightness, never one per frame.")

Brightness slider label, `:759-770`:
```jsx
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
          <span className="z-eyebrow">{t('deviceControls.brightness')}</span>
          <span className="z-mono" style={{ fontSize: 12, color: 'var(--ink-mute)' }}>{brightness}%</span>
        </div>
        <GradientSlider
          value={brightness}
          onChange={setBrightness}
          onCommit={commitBri}
          min={1} max={100}
          gradient="linear-gradient(90deg, var(--ink-ghost) 0%, var(--gold) 100%)"
        />
      </div>
```
Colour-temp label, `:774-776`:
```jsx
            <span className="z-mono" style={{ fontSize: 12, color: 'var(--ink-mute)' }}>{colorTemp}K · {colorTemp < 3500 ? t('deviceControls.tempWarm') : colorTemp < 5000 ? t('deviceControls.tempNeutral') : t('deviceControls.tempCool')}</span>
```
Preset chip brightness, `:614`:
```jsx
                <span className="z-mono" style={{ fontSize: 12, fontWeight: 500 }}>{p.settings.brightness_pct}%</span>
```
Media volume readout, `:1103-1105`:
```jsx
          <span className="z-mono text-footnote text-ink-mute w-12 text-end shrink-0">
            {isMuted ? t('deviceControls.muted') : volReliable ? `${volume}%` : t('deviceControls.unknown')}
          </span>
```
IR remote Vol / Ch counters, `:1811` and `:1829`:
```jsx
            <span className="z-mono" style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink)' }}>{t('deviceControls.remote.vol')} {volDisplay}</span>
```
```jsx
            <span className="z-mono" style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink)' }}>{t('deviceControls.remote.ch')} {chDisplay}</span>
```

---

# 2. Data › sparkline variant **A — "Draw + live append"**

## 2a. Lab implementation — `Data.jsx:100-131`

```jsx
function Sparkline({ data, w = 320, h = 80, tx, live }) {
  const min = Math.min(...data), max = Math.max(...data)
  const pts = data.map((v, i) => [(i / (data.length - 1)) * w, h - ((v - min) / (max - min || 1)) * (h - 12) - 6])
  const d = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ')
  const area = d + ` L ${w} ${h} L 0 ${h} Z`
  const last = pts[pts.length - 1]
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{ overflow: 'visible', display: 'block', width: '100%' }}>
      <defs><linearGradient id="spk" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="var(--accent)" stopOpacity="0.28" /><stop offset="1" stopColor="var(--accent)" stopOpacity="0" /></linearGradient></defs>
      <motion.path key={live ? 'a' : 'a0'} d={area} fill="url(#spk)" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={tx({ duration: 0.6, delay: 0.4 })} />
      <motion.path d={d} fill="none" stroke="var(--accent)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" initial={live ? false : { pathLength: 0, d }} animate={{ pathLength: 1, d }} transition={live ? tx({ d: { duration: 0.4, ease: EASE.out } }) : tx({ duration: 1.1, ease: EASE.inOut })} />
      <motion.circle r="4" fill="var(--accent)" cx={last[0]} cy={last[1]} initial={false} animate={{ cx: last[0], cy: last[1] }} transition={tx({ duration: 0.4, ease: EASE.out })} />
    </svg>
  )
}

function SparkDemo({ tx, ms, replayKey }) {
  const t = useT(); const h = useHaptic()
  const [data, setData] = useState([23.1, 23.4, 23.9, 24.6, 25.2, 25.4, 25.1, 24.7, 24.9, 25.3, 25.8, 26.1, 26.0, 25.6, 25.2, 24.8])
  const [live, setLive] = useState(false)
  const push = () => { setLive(true); setData(d => [...d.slice(1), +(d[d.length - 1] + (Math.random() - 0.5) * 1.2).toFixed(1)]); h('selection') }
  return (
    <Page title={t({ en: 'Living Room · Temperature', he: 'סלון · טמפרטורה' })}>
      <Card>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10 }}><span className="zl-footnote zl-mute">{t({ en: 'Last 4 hours', he: '4 השעות האחרונות' })}</span><SpringNumber value={data[data.length - 1]} digits={1} tx={tx} size={28} /></div>
        <Sparkline data={data} tx={tx} live={live} />
      </Card>
      <div className="zl-hstack" style={{ marginTop: 12 }}><Button style={{ height: 36 }} onClick={push}>{t({ en: 'New sample', he: 'דגימה חדשה' })}</Button></div>
      <p className="zl-footnote zl-mute" style={{ marginTop: 12 }}>On load the line draws left to right (pathLength) and the area fades in beneath. A new sample slides the whole line one step and the end dot follows. The value rides along.</p>
    </Page>
  )
}
```

Registration — `Data.jsx:362-363`:
```jsx
<Demo id="sparkline" title="History sparkline" purpose="The past explains the present. Draw it, then let new samples push it along." principles={['continuity', 'state']} inZiggy={['DeviceDetail SensorHistoryChart']}
  variants={[{ key: 'A', label: 'Draw + live append', note: 'On load the line draws left to right (pathLength) and the area fades in beneath; a new sample slides the whole line one step and the end dot follows.', render: (p) => <SparkDemo {...p} /> }]} />
```

Mechanism: two framer `pathLength`/`d` behaviours switched by one `live` flag. On mount (`live===false`) the stroke animates `pathLength: 0 → 1` over `1.1s EASE.inOut` and the area path fades in with `delay: 0.4`. Once `live` is true, `initial={false}` and the transition becomes per-property (`{ d: { duration: 0.4, ease: EASE.out } }`) so framer **interpolates the `d` attribute itself** — the whole polyline slides one sample. The end dot is a separate `motion.circle` animating `cx`/`cy` on the same 0.4s curve. Index-based x (`i / (data.length - 1) * w`), min/max autoscale with `(max - min || 1)` guard, 6px top/bottom inset (`h - 12 … - 6`).

Lab deps: `tx` (remove), `EASE.out`/`EASE.inOut` → `src/motion/motion.js:20-26`, `SpringNumber` for the header value, `h('selection')` → `haptic('selection')`, the `spk` gradient id (**must be made unique per instance in production** — multiple charts on a page would collide).

## 2b. Production landing site — `frontend/src/components/device/SensorHistoryChart.jsx` (whole file is the target; 185 lines)

Geometry + path builder, `:19-47`:
```js
const W = 280
const H = 96
const PAD_X = 4
const PAD_Y = 8

function formatValue(v, unit) {
  if (v == null || !Number.isFinite(v)) return '—'
  const fixed = Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(1)
  return unit ? `${fixed}${unit}` : fixed
}

function buildPath(points, minV, maxV, startMs, endMs) {
  if (!points.length) return ''
  const span = Math.max(1, endMs - startMs)
  const range = Math.max(0.001, maxV - minV)
  const xs = (ms) => PAD_X + ((ms - startMs) / span) * (W - 2 * PAD_X)
  const ys = (v)  => PAD_Y + (1 - (v - minV) / range) * (H - 2 * PAD_Y)
  let d = ''
  for (let i = 0; i < points.length; i++) {
    const p = points[i]
    d += (i === 0 ? 'M ' : ' L ') + xs(p.ms).toFixed(1) + ' ' + ys(p.v).toFixed(1)
  }
  return d
}

const RANGES = [
  { key: '24h', label: '24h', hours: 24 },
  { key: '7d',  label: '7d',  hours: 24 * 7 },
]
```

Data load (`getEntityHistory`, from `../../lib/api`) and stats, `:49-95`:
```jsx
export default function SensorHistoryChart({ entityId, unitFallback }) {
  const [rangeKey, setRangeKey] = useState('24h')
  const range = RANGES.find(r => r.key === rangeKey) || RANGES[0]
  const [points, setPoints] = useState([])
  const [unit, setUnit] = useState(unitFallback || null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true); setError(false)
    getEntityHistory(entityId, range.hours)
      .then((r) => {
        if (cancelled) return
        const parsed = (r?.points || [])
          .map(p => ({ ms: Date.parse(p.t), v: p.v }))
          .filter(p => Number.isFinite(p.ms) && Number.isFinite(p.v))
          .sort((a, b) => a.ms - b.ms)
        setPoints(parsed)
        setUnit(r?.unit || unitFallback || null)
        setLoading(false)
      })
      .catch(() => {
        if (cancelled) return
        setError(true); setLoading(false)
      })
    return () => { cancelled = true }
  }, [entityId, range.hours, unitFallback])

  const stats = useMemo(() => {
    if (!points.length) return null
    let minV = Infinity, maxV = -Infinity
    for (const p of points) {
      if (p.v < minV) minV = p.v
      if (p.v > maxV) maxV = p.v
    }
    // Pad the range slightly so the line isn't flush with the top/bottom.
    if (minV === maxV) { minV -= 0.5; maxV += 0.5 }
    return {
      minV, maxV,
      startMs: points[0].ms,
      endMs:   points[points.length - 1].ms,
      latest:  points[points.length - 1].v,
    }
  }, [points])

  const path = stats ? buildPath(points, stats.minV, stats.maxV, stats.startMs, stats.endMs) : ''
```

The SVG that must change, `:157-181`:
```jsx
      {!loading && !error && stats && (
        <svg
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="none"
          width="100%"
          height={H}
          style={{ display: 'block' }}
        >
          {/* Midline */}
          <line
            x1={PAD_X} x2={W - PAD_X}
            y1={H / 2} y2={H / 2}
            stroke="var(--line)" strokeWidth="0.5" strokeDasharray="2 3"
          />
          <path
            d={path}
            fill="none"
            stroke="var(--accent)"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
        </svg>
      )}
```

Deltas the port has to reconcile — these are real, not cosmetic:

1. **Plain `<path>`, no framer, no animation at all.** Becomes `motion.path` with the `pathLength`/`d` pair.
2. **`preserveAspectRatio="none"` + `vectorEffect="non-scaling-stroke"`** — the chart is deliberately non-uniformly stretched. The lab uses `viewBox` with default `preserveAspectRatio` and `strokeWidth="2.5"`. `pathLength` animation is unaffected by `vectorEffect`, but the lab's `overflow:'visible'` end-dot (`r="4"`) would be stretched horizontally under `preserveAspectRatio="none"`.
3. **No area fill and no end dot exist today** — both are net-new elements, so the `<defs><linearGradient id="spk">` must be added with a per-instance id.
4. **x is time-based, not index-based** (`xs(p.ms)` vs lab `i/(n-1)*w`). A "live append" therefore does *not* slide by a fixed step; `startMs`/`endMs` both move. Framer can still interpolate `d` as long as the **point count is unchanged**; `d`-interpolation requires same-command-count paths.
5. **There is no live-append path at all.** `points` is replaced wholesale by a fetch keyed on `[entityId, range.hours, unitFallback]`. Nothing subscribes to WS `state_changed` for this chart. To get "live append" the component must either subscribe (the hook used elsewhere is `useWsMessages()` from `src/hooks/useWebSocket`) or receive pushed samples from a parent.
6. **Range toggle (`24h` / `7d`) swaps the whole dataset** — point count changes, so framer `d`-interpolation will fail across a range switch; that transition needs the draw-on-mount branch (`key` on `rangeKey`), not the append branch.
7. **Three empty states** (`loading` / `error` / `!points.length`, `:142-156`) each render a fixed-height div; the mount-draw must fire when transitioning out of them, not on component mount.

Mount site: `grep` shows `SensorHistoryChart` is consumed from the device-detail info surface; the chart owns its own card chrome (`:98-104`, `background: var(--surface)`, `border: 0.5px solid var(--line)`, `borderRadius: 16`, `padding: 14`, `marginBottom: 12`).

---

# 3. Data › bars variant **A — "Glide + stagger"**

## 3a. Lab implementation — `Data.jsx:135-161`

```jsx
function BarsDemo({ tx }) {
  const t = useT(); const h = useHaptic()
  const [battery, setBattery] = useState(78)
  const [signal, setSignal] = useState(3)
  const col = battery > 60 ? 'var(--ok)' : battery > 20 ? 'var(--warn)' : 'var(--err)'
  return (
    <Page title={t({ en: 'Door Sensor', he: 'חיישן דלת' })}>
      <div className="zl-stack">
        <Card>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}><span className="zl-footnote zl-mute">{t({ en: 'Battery', he: 'סוללה' })}</span><SpringNumber value={battery} digits={0} tx={tx} size={15} /></div>
          <div style={{ height: 10, borderRadius: 5, background: 'var(--surface-3)', overflow: 'hidden' }}><motion.div animate={{ width: `${battery}%`, backgroundColor: col }} transition={tx({ type: 'spring', duration: 0.6, bounce: 0 })} style={{ height: '100%', borderRadius: 5 }} /></div>
          <div className="zl-hstack" style={{ marginTop: 10 }}>{[92, 55, 14].map(v => <button key={v} className="zl-chip" data-on={battery === v ? 'true' : 'false'} style={{ cursor: 'pointer' }} onClick={() => { setBattery(v); h('selection') }}>{v}%</button>)}</div>
        </Card>
        <Card>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span className="zl-footnote zl-mute">{t({ en: 'Signal', he: 'אות' })}</span>
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: 20 }}>
              {[0, 1, 2, 3].map(i => <motion.span key={i} animate={{ backgroundColor: i < signal ? 'var(--ink)' : 'var(--line-2)', scaleY: i < signal ? 1 : 0.6 }} transition={tx({ duration: 0.22, delay: i * 0.05, ease: EASE.out })} style={{ width: 5, height: 6 + i * 4, borderRadius: 2, transformOrigin: 'bottom', background: 'var(--line-2)' }} />)}
            </div>
          </div>
          <div className="zl-hstack" style={{ marginTop: 10 }}>{[['Weak', 1], ['Fair', 2], ['Good', 3], ['Strong', 4]].map(([l, v]) => <button key={l} className="zl-chip" data-on={signal === v ? 'true' : 'false'} style={{ cursor: 'pointer' }} onClick={() => { setSignal(v); h('selection') }}>{l}</button>)}</div>
        </Card>
      </div>
      <p className="zl-footnote zl-mute" style={{ marginTop: 12 }}>Battery fill and colour glide; signal bars rise one after another, 50ms apart. Today both jump.</p>
    </Page>
  )
}
```

Registration — `Data.jsx:365-366`:
```jsx
<Demo id="bars" title="Battery and signal" purpose="A bar that fills to its value tells you how much; a bar that jumps tells you nothing about the change." principles={['state', 'causality']} inZiggy={['DeviceDetail.jsx BatteryBar / SignalBars']}
  variants={[{ key: 'A', label: 'Glide + stagger', note: 'Battery fill and colour glide on a flat spring; signal bars rise one after another, 50ms apart, so a stronger signal is more bars arriving, not a swap.', render: (p) => <BarsDemo {...p} /> }]} />
```

Two distinct behaviours: battery = **`width` + `backgroundColor` on one `motion.div`**, spring `{duration:0.6, bounce:0}`; signal = **four `motion.span`s, each with `delay: i * 0.05`**, animating `backgroundColor` and `scaleY` (1 when lit, 0.6 when not) with `transformOrigin:'bottom'`, 0.22s `EASE.out`. Note the lab animates `width` (a layout property), which `src/motion/motion.js:14-17` explicitly forbids ("transform and opacity only"; "no animating layout properties").

Lab deps: `tx`, `EASE.out`, `SpringNumber`, `h('selection')`, `.zl-chip`/`.zl-stack`/`.zl-hstack`.

## 3b. Production landing sites

### BatteryBar — `frontend/src/pages/DeviceDetail.jsx:108-121`

```jsx
function BatteryBar({ level, unit = '%' }) {
  if (level == null) return null
  const barColor = level > 60 ? 'var(--ok)' : level > 20 ? 'var(--warn)' : 'var(--err)'
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <div className="z-slider-track" style={{ flex: 1 }}>
        <div className="z-slider-fill" style={{ width: `${level}%`, background: barColor }} />
      </div>
      <span className="z-mono" style={{ fontSize: 12, color: 'var(--ink-mute)', width: 44, textAlign: 'end' }}>
        {level}{unit}
      </span>
    </div>
  )
}
```
Thresholds `>60 / >20` are **identical** to the lab's `col`. The track/fill are the shared `.z-slider-track` / `.z-slider-fill` classes (not inline, unlike the lab's `height:10, borderRadius:5, background:var(--surface-3)`), so changing the fill to a `motion.div` must preserve `.z-slider-fill`. `{level}{unit}` is the rolling-number site from pick 1. Mounted at `DeviceDetail.jsx:1382`:
```jsx
              <BatteryBar level={diagnostics.battery} unit={diagnostics.battery_unit} />
```

### SignalBars — `frontend/src/pages/DeviceDetail.jsx:123-154`

```jsx
function SignalBars({ lqi, rssi }) {
  const t = useT()
  if (lqi == null && rssi == null) return null
  const strength = lqi != null
    ? Math.round((lqi / 255) * 100)
    : rssi != null ? Math.max(0, Math.min(100, Math.round((rssi + 100) * 2))) : null
  if (strength == null) return null
  const bars = Math.ceil(strength / 25)
  // Friendly label instead of "LQI 187" / "-68 dBm". Raw value still
  // available on hover for support/debugging via the title attribute.
  const friendly = bars >= 4 ? t('deviceDetail.signalStrong')
    : bars >= 3 ? t('deviceDetail.signalGood')
    : bars >= 2 ? t('deviceDetail.signalFair')
    : t('deviceDetail.signalWeak')
  const rawTitle = lqi != null ? `LQI ${lqi}` : `${rssi} dBm`
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 16 }} title={rawTitle}>
      {[1, 2, 3, 4].map(b => (
        <div
          key={b}
          style={{
            height: `${b * 25}%`, width: 5, borderRadius: 2,
            background: b <= bars ? 'var(--ok)' : 'var(--line-2)',
          }}
        />
      ))}
      <span style={{ marginInlineStart: 8, fontSize: 12, color: 'var(--ink-mute)', lineHeight: 1 }}>
        {friendly}
      </span>
    </div>
  )
}
```
Mounted at `DeviceDetail.jsx:1389`:
```jsx
              <SignalBars lqi={diagnostics.lqi} rssi={diagnostics.rssi} />
```
Port deltas: bars are `[1,2,3,4]` (1-indexed) vs lab `[0,1,2,3]`; heights are **percentages of a 16px row** (`${b*25}%`) vs the lab's absolute `6 + i*4`; lit colour is `var(--ok)` vs lab `var(--ink)`; there is no `transformOrigin` or `scaleY` today, so the stagger needs `transformOrigin: 'bottom'` added; the lab's stagger index must become `b - 1`. i18n keys already exist: `deviceDetail.signalStrong/signalGood/signalFair/signalWeak`.

### "VolumeBars" — **does not exist.** 

There is no bar-stack volume component in `DeviceDetail.jsx` or `DeviceControls.jsx`. Volume is rendered three ways, all of them non-bar:

- `DeviceControls.jsx:1084-1106` — mute button + `<Slider>` + `z-mono` `%` readout (code in §1b above).
- `DeviceControls.jsx:1807-1813` — IR up/down buttons around a `z-mono` `VOL {volDisplay}` counter (code in §1b).
- `DeviceControls.jsx:1587-1588` — remote command labels only:
```js
  volume_up:    { label: 'VOL+',   titleKey: 'deviceControls.remote.volUp' },
  volume_down:  { label: 'VOL−',   titleKey: 'deviceControls.remote.volDown' },
```
Volume state fields, `DeviceControls.jsx:1012-1021`:
```js
  const isMuted   = entity.is_volume_muted
  // volume_level=0.0 while playing usually means the TV routes audio through ARC/eARC
  // and the integration can't read the real volume — treat it as unknown in that case.
  const volReliable  = entity.volume_level != null && !(entity.volume_level === 0 && entity.state === 'playing')
  const rawVol       = volReliable ? Math.round(entity.volume_level * 100) : null
  const [volume, setVolume] = useState(rawVol ?? 50)
  …
    if (volReliable) setVolume(Math.round(entity.volume_level * 100))
  }, [entity.volume_level, entity.state])
```
So "glide + stagger" for volume lands on either the `Slider` fill (glide only) or is a net-new bar-stack component.

---

# 4. Data › confidence variant **B — "Count-up + dots + bar"**

## 4a. Lab implementation — `Data.jsx:165-187`

```jsx
function ConfidenceDemo({ variant, tx, replayKey }) {
  const t = useT()
  const [pct, setPct] = useState(82)
  const mv = useSpring(0, tx({ stiffness: 60, damping: 18 }))
  useEffect(() => { mv.set(pct) }, [pct, mv, replayKey])
  const text = useTransform(mv, (v) => Math.round(v) + '%')
  const dots = 5; const lit = Math.round((pct / 100) * dots)
  return (
    <Page title={t({ en: 'Suggested', he: 'מומלץ' })}>
      <Card>
        <div className="zl-caption zl-mute" style={{ textTransform: 'uppercase', letterSpacing: '.06em' }}>{t({ en: 'Pattern · time of day', he: 'תבנית · שעה ביום' })}</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '8px 0 10px' }}>
          {variant === 'A' ? <span className="zl-headline zl-mono">{pct}%</span> : <motion.span className="zl-headline zl-mono">{text}</motion.span>}
          <div style={{ display: 'flex', gap: 4 }}>{Array.from({ length: dots }).map((_, i) => <motion.span key={i + '-' + replayKey} initial={{ scale: 0.6, opacity: 0.4 }} animate={{ scale: 1, opacity: 1, backgroundColor: i < lit ? 'var(--accent)' : 'var(--line-2)' }} transition={tx({ type: 'spring', duration: 0.4, bounce: 0.3, delay: 0.1 + i * 0.07 })} style={{ width: 6, height: 6, borderRadius: 999, background: 'var(--line-2)' }} />)}</div>
        </div>
        <div className="zl-subhead" style={{ color: 'var(--ink-2)', marginBottom: 12 }}>{t({ en: 'You turn on the kids room night light around 19:40 on weekdays. Save it as an automatic action?', he: 'אתה מדליק את אור הלילה בחדר הילדים בסביבות 19:40 בימי חול. לשמור כפעולה אוטומטית?' })}</div>
        <div style={{ height: 6, borderRadius: 3, background: 'var(--surface-3)', overflow: 'hidden', marginBottom: 12 }}><motion.div key={replayKey} initial={{ width: 0 }} animate={{ width: `${pct}%` }} transition={tx({ type: 'spring', duration: 0.9, bounce: 0 })} style={{ height: '100%', background: 'var(--accent)' }} /></div>
        <div className="zl-hstack"><Button variant="primary" style={{ height: 40 }}>{t({ en: 'Yes, create', he: 'כן, צור' })}</Button><Button style={{ height: 40 }}>{t({ en: 'Later', he: 'אחר כך' })}</Button></div>
      </Card>
      <div className="zl-hstack" style={{ marginTop: 12 }}>{[44, 82, 96].map(v => <button key={v} className="zl-chip" data-on={pct === v ? 'true' : 'false'} style={{ cursor: 'pointer' }} onClick={() => setPct(v)}>{v}%</button>)}</div>
    </Page>
  )
}
```

Registration — `Data.jsx:368-373`, variant B at `:372`:
```jsx
<Demo id="confidence" title="Confidence meter" purpose="82% is a claim. Counting up to it, with the dots lighting in order, makes it feel measured." principles={['state', 'hierarchy']} inZiggy={['Suggestions.jsx ConfidenceMeter', 'SuggestedTab card']}
  recommend="B"
  variants={[
    { key: 'A', label: 'Dots stagger, number static', note: 'The five dots light in order on mount; the number is already there.', render: (p) => <ConfidenceDemo {...p} variant="A" /> },
    { key: 'B', label: 'Count-up + dots + bar', note: 'Recommended. The number counts up on a slow spring while the dots light and the bar fills; three views of one value arriving together. It reads as measured rather than asserted.', render: (p) => <ConfidenceDemo {...p} variant="B" /> },
  ]} />
```

Three views of one value: `useSpring(0, {stiffness:60, damping:18})` → `useTransform(mv, v => Math.round(v)+'%')` for the number; five dots on `{type:'spring', duration:0.4, bounce:0.3, delay: 0.1 + i*0.07}` animating `scale`+`opacity`+`backgroundColor`; one bar `width: 0 → ${pct}%` on `{type:'spring', duration:0.9, bounce:0}`. `lit = Math.round((pct/100) * 5)` — **identical formula** to production's `Math.round(value * 5)`. Note variant A and B differ **only** in the number (`{pct}%` vs `{text}`); the dot stagger and the bar are in both.

Lab deps: `tx`, `useSpring`/`useTransform` (framer, available), `replayKey` (becomes a mount key — in production the card already mounts via `AnimatePresence`, so no replay plumbing needed).

## 4b. Production landing sites

### `frontend/src/pages/Suggestions.jsx:17-31` — the legacy page's ConfidenceMeter

```jsx
// ── Confidence meter ──────────────────────────────────────────────────────────
// ONE 13px footnote: "82%" + five dots, ink-mute.
function ConfidenceMeter({ value }) {
  const filled = Math.round(value * 5)
  return (
    <span className="z-footnote z-mono" style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
      {Math.round(value * 100)}%
      <span style={{ display: 'inline-flex', gap: 3 }} aria-hidden="true">
        {[0,1,2,3,4].map(i => (
          <span key={i} style={{ width: 4, height: 4, borderRadius: '50%', background: i < filled ? 'var(--ink-2)' : 'var(--line-2)' }} />
        ))}
      </span>
    </span>
  )
}
```

**Important**: `Suggestions.jsx:1-7` marks this file LEGACY:
```jsx
// LEGACY — superseded by the Suggested tab inside Automations.jsx.
// The canonical SuggestionCard now lives at Automations.jsx (Configure → wizard flow,
// no auto-deploy). This page's SuggestionCard still uses the older accept/reject UX
// and is kept only because /suggestions is still routed from App.jsx and linked from
// Dashboard. New suggestion work should go through the Suggested tab; do not extend
// this page. Slated for removal once the Dashboard link and /suggestions route are
// retired.
```

Usage context, `Suggestions.jsx:60-82` (the card that would carry the mount animation; it already has one):
```jsx
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.97 }}
      transition={T_ENTER}
      style={{
        padding: 12, borderRadius: 'var(--r-card)',
        background: 'var(--surface)',
        border: '0.5px solid var(--line)',
        // Resolved cards read in the muted ink, not through an opacity veil.
        color: isPending ? 'var(--ink)' : 'var(--ink-mute)',
      }}
    >
      {/* Type + confidence row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
        <p className="z-eyebrow" style={{ margin: 0 }}>{t(meta.key)}</p>
        <div style={{ flex: 1 }} />
        <ConfidenceMeter value={suggestion.confidence} />
```

### `frontend/src/components/automations/templates/SuggestedTab.jsx:8-23` — the **canonical** one

```jsx
// ── Suggested tab (embedded from Suggestions.jsx logic) ──────────────────────
// Confidence: ONE 13px footnote line — "82%" plus five dots — in ink-mute. The
// old 9/11px pairing and the per-type tint made every card compete.
function ConfidenceMeter({ value }) {
  const filled = Math.round(value * 5)
  return (
    <span className="z-footnote z-mono" style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
      {Math.round(value * 100)}%
      <span style={{ display: 'inline-flex', gap: 3 }} aria-hidden="true">
        {[0,1,2,3,4].map(i => (
          <span key={i} style={{ width: 4, height: 4, borderRadius: '50%', background: i < filled ? 'var(--ink-2)' : 'var(--line-2)' }} />
        ))}
      </span>
    </span>
  )
}
```
Byte-identical to the Suggestions.jsx copy except the leading comment. Usage, `SuggestedTab.jsx:56-69`:
```jsx
    <motion.div layout layoutDependency={layoutKey} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.97 }} transition={T_ENTER}
      style={{ padding: 12, borderRadius: 'var(--r-card)', background: 'var(--surface)', border: '0.5px solid var(--line)', color: isPending ? 'var(--ink)' : 'var(--ink-mute)' }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
        <p className="z-eyebrow" style={{ margin: 0 }}>{meta.label}</p>
        <div style={{ flex: 1 }} />
        <ConfidenceMeter value={suggestion.confidence} />
```

Store field: `suggestion.confidence` is a **0..1 float** (`Math.round(value * 100)` for the %, `Math.round(value * 5)` for dots) from `src/stores/suggestionStore.js`. The lab's `pct` is 0..100 — scale conversion required.

Port deltas: dots are **4×4px, `var(--ink-2)` when lit** (lab: 6×6, `var(--accent)`); **there is no bar at all** — the bar is net-new; both copies are duplicated, so the port must touch both files (or extract one shared component). The whole meter is `aria-hidden="true"` on the dot span, and the `%` text carries the accessible value, which a `motion.span` from `useTransform` preserves.

### IR AssumedStatePicker confidence dot band — `frontend/src/pages/Devices.jsx`

**This is a different thing from the suggestion meter**: a 3-state band (`live`/`estimated`/`stale`/`unknown`), not a 0..1 score. Derivation, `Devices.jsx:945-954`:
```js
  const confidence = (() => {
    const live = stateRec.live_at
    const est = stateRec.estimated_at
    if (!live && !est) return 'unknown'
    const now = Date.now() / 1000
    if (live && now - live <= 30) return 'live'
    if (est && now - est <= 6 * 3600) return 'estimated'
    if (live && now - live <= 6 * 3600) return 'estimated'
    return 'stale'
  })()
```

The dot band itself, `Devices.jsx:1026-1046`:
```jsx
                {confidence === 'live' && (
                  <span
                    title="Live: physical-remote press confirmed in the last 30s"
                    className="inline-block w-1.5 h-1.5 rounded-full bg-ok animate-pulse"
                  />
                )}
                {confidence === 'estimated' && (
                  <span
                    title="Estimated: from Ziggy's last command (no recent RX)"
                    className="inline-block w-1.5 h-1.5 rounded-full bg-warn-soft border border-warn"
                  />
                )}
                {confidence === 'stale' && (
                  <span
                    title="Stale: no observation for hours"
                    className="inline-block w-1.5 h-1.5 rounded-full bg-ink-mute opacity-40"
                  />
                )}
                <span>{assumedState ?? t('common.unknown')}</span>
                {acFacts.length > 0 && (
                  <span className="opacity-80">· {acFacts.join(' · ')}</span>
                )}
                <span className="text-[9px] opacity-60 ml-0.5">{t('devices.assumedSuffix')} ▾</span>
```
Note `animate-pulse` on the live dot — that is a **Tailwind infinite loop**, which `src/motion/motion.js:12` forbids ("nothing loops for decoration"). The intent comment is at `Devices.jsx:1017-1024`.

The **other** IR confidence surface — `AssumedStatePicker`, `Devices.jsx:152-250`, which has **no dot at all**, only the chip tint and a tooltip, `:193-214`:
```jsx
  const chipClass = cn(
    'flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-medium border transition-colors whitespace-nowrap',
    isStale
      ? 'bg-warn-soft border-warn-soft text-warn'
      : assumedState === 'on' || (assumedState && assumedState !== 'off')
      ? 'bg-ok-soft border-ok-soft text-ok'
      : assumedState === 'off'
      ? 'bg-surface-2 border-line text-ink-mute'
      : 'bg-surface-2/50 border-dashed border-line text-ink-mute',
  )

  return (
    <div style={{ flexShrink: 0 }}>
      <button
        ref={btnRef}
        onClick={handleOpen}
        title={isStale
          ? t('devices.irAssumedTooltipStale', { hours: Math.round(ageHours) })
          : t('devices.irAssumedTooltipNormal', { confidence: irConfidence })}
        className={chipClass}
        data-pending={pending ? 'true' : undefined}
      >
```
and its band, computed differently again — `Devices.jsx:1808-1819`:
```js
  // Stale check: if we assumed 'on' but the last IR activity was hours ago and
  // no real-state link exists, downgrade confidence — the assumption may be wrong.
  const STALE_AFTER_HOURS = 4
  const lastActivityIso = irDevice?.assumed_state_at || irDevice?.last_command_sent_at
  const ageHours = lastActivityIso
    ? (Date.now() - new Date(String(lastActivityIso).replace(' ', 'T')).getTime()) / 3_600_000
    : Infinity
  const isStale = assumedState === 'on' && !irDevice?.ha_entity_id && ageHours > STALE_AFTER_HOURS
  // State confidence: confirmed (has HA entity link), estimated (we sent a command), unknown (no info)
  const irConfidence = irDevice?.ha_entity_id ? 'confirmed'
    : isStale ? 'stale'
    : (assumedState != null) ? 'estimated'
    : 'unknown'
```
Mounted at `Devices.jsx:2049-2053`. **Two different confidence vocabularies exist** (`live/estimated/stale/unknown` vs `confirmed/estimated/stale/unknown`) with two different derivations in the same file — the port must pick one. i18n keys: `devices.irAssumedTooltipStale`, `devices.irAssumedTooltipNormal`, `devices.irAssumedTooltipPlain`, `devices.setAssumedState`, `devices.clearAssumption`, `devices.assumedSuffix`, `common.unknown`.

---

# 5. Data › counts variant **A — "Roll + pop"**

## 5a. Lab implementation — `Data.jsx:191-242`

Full component; variant A means `nudge === false`, so follow the `!nudge` branches:

```jsx
function CountDemo({ tx, variant = 'A' }) {
  const t = useT(); const h = useHaptic()
  const [n, setN] = useState(3)
  const nudge = variant === 'B'
  // B: direction of the last change drives the roll direction and the nudge
  const prev = useRef(n); const dir = Math.sign(n - prev.current) || 1
  const tabRef = useRef(null); const navRef = useRef(null)
  useEffect(() => {
    const d = Math.sign(n - prev.current); prev.current = n
    if (!nudge || !d) return
    // increase: up 3px and 1.2×; decrease: a 2px dip. A count going up is news; going down is relief.
    const kf = d > 0 ? { y: [0, -3, 0], scale: [1, 1.2, 1] } : { y: [0, 2, 0] }
    const opts = tx({ duration: d > 0 ? 0.36 : 0.26, times: [0, 0.35, 1], ease: EASE.out })
    const anims = [tabRef.current, navRef.current].filter(Boolean).map(el => animate(el, kf, opts))
    return () => anims.forEach(a => a.stop())
  }, [n]) // eslint-disable-line
  const roll = (key) => (
    <AnimatePresence mode="popLayout" initial={false} custom={dir}>
      <motion.span key={key} custom={dir} variants={{ in: (d) => ({ y: nudge ? (d > 0 ? 12 : -12) : 12, opacity: 0 }), show: { y: 0, opacity: 1 }, out: (d) => ({ y: nudge ? (d > 0 ? -12 : 12) : -12, opacity: 0 }) }} initial="in" animate="show" exit="out" transition={tx({ duration: 0.2, ease: EASE.out })} style={{ display: 'inline-block' }}>{key}</motion.span>
    </AnimatePresence>
  )
  return (
    <Page title={t({ en: 'Alerts', he: 'התראות' })}>
      <div style={{ display: 'flex', background: 'var(--surface-2)', border: '1px solid var(--line)', borderRadius: 12, padding: 4, marginBottom: 16 }}>
        <span style={{ flex: 1, height: 40, borderRadius: 9, background: 'var(--surface)', boxShadow: 'var(--shadow-sm)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, fontWeight: 600, fontSize: 15 }}>
          {t({ en: 'Active', he: 'פעילות' })}
          <AnimatePresence initial={false}>
            {(n > 0 || !nudge) && (
              <motion.span key="tabbadge" ref={tabRef} initial={nudge ? { scale: 0.5, opacity: 0 } : false} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.4, opacity: 0, transition: tx({ duration: 0.16, ease: EASE.out }) }} transition={tx({ type: 'spring', duration: 0.35, bounce: 0.4 })}
                style={{ position: 'relative', minWidth: 22, height: 22, borderRadius: 999, background: n > 0 ? 'var(--err)' : 'var(--line-2)', color: '#fff', display: 'grid', placeItems: 'center', fontSize: 12, padding: '0 6px', overflow: 'hidden', transition: `background calc(200ms * var(--lab-speed,1))` }}>
                {roll(n)}
              </motion.span>
            )}
          </AnimatePresence>
        </span>
        <span style={{ flex: 1, height: 40, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--ink-mute)', fontWeight: 500, fontSize: 15 }}>{t({ en: 'History', he: 'היסטוריה' })}</span>
      </div>
      <div className="zl-hstack"><Button style={{ height: 36 }} onClick={() => { setN(v => v + 1); h('warning') }}>+ {t({ en: 'new alert', he: 'התראה חדשה' })}</Button><Button style={{ height: 36 }} onClick={() => { setN(v => Math.max(0, v - 1)); h(nudge ? 'selection' : 'success') }}>− {t({ en: 'cleared', he: 'נוקתה' })}</Button></div>
      <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 56, borderTop: '1px solid var(--line)', display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', alignItems: 'center', background: 'var(--surface)' }}>
        {['house', 'layout-grid', 'lightbulb', 'zap', 'bell'].map((ic, i) => (
          <span key={ic} style={{ position: 'relative', display: 'grid', placeItems: 'center', color: i === 4 ? 'var(--ink)' : 'var(--ink-mute)' }}>
            <Icon name={ic} size={22} />
            {i === 4 && (
              <AnimatePresence>{n > 0 && <motion.span key="b" ref={navRef} initial={{ scale: 0.5, opacity: 0 }} animate={{ scale: [1.25, 1], opacity: 1 }} exit={{ scale: 0.5, opacity: 0, transition: tx({ duration: 0.16, ease: EASE.out }) }} transition={tx({ type: 'spring', duration: 0.35, bounce: 0.4 })} style={{ position: 'absolute', top: -6, marginInlineStart: 22, minWidth: 16, height: 16, borderRadius: 999, background: 'var(--err)', color: '#fff', fontSize: 10, fontWeight: 700, display: 'grid', placeItems: 'center', padding: '0 4px', boxShadow: '0 0 0 2px var(--surface)', overflow: 'hidden' }}>{nudge ? roll(n) : n}</motion.span>}</AnimatePresence>
            )}
          </span>
        ))}
      </div>
      <p className="zl-footnote zl-mute" style={{ marginTop: 12 }}>{nudge ? '…' : 'Tab count rolls vertically; the nav badge pops in with a spring on the first alert and pops away at zero.'}</p>
    </Page>
  )
}
```

What variant A actually does, isolated:
- **Tab count rolls**: `roll(n)` — `AnimatePresence mode="popLayout"`, enter `{y: 12, opacity: 0}` → `{y:0, opacity:1}`, exit `{y:-12, opacity:0}`, `0.2s EASE.out`. With `nudge===false` the direction is **always upward** regardless of whether the count rose or fell.
- **Tab badge never unmounts** (`(n > 0 || !nudge)` is always true for A), has `initial={false}`, so no pop; its `background` cross-fades via a plain CSS `transition` string that reads `--lab-speed` and must become `var(--dur-state) var(--ease-standard)`.
- **Nav badge pops**: `initial={{scale:0.5, opacity:0}}`, `animate={{scale:[1.25,1], opacity:1}}`, exit `{scale:0.5, opacity:0}` at `0.16s`; spring `{duration:0.35, bounce:0.4}`. In A the nav badge content is the **plain number** (`{nudge ? roll(n) : n}`), not the roll.
- The `useEffect` nudge block (`:198-206`) is **dead code in A** (`if (!nudge || !d) return`). It is only there for B. Do not port it for pick A.
- Haptics: `+` fires `h('warning')`; `−` fires `h('success')` in A (`h(nudge ? 'selection' : 'success')`).

Registration — `Data.jsx:375-380`, variant A at `:378`:
```jsx
<Demo id="counts" title="Counts and badges" purpose="A count changing is news. Roll it; pop the badge on the first, retire it at zero." principles={['hierarchy', 'state']} inZiggy={['Anomalies tab counts', 'BottomNav (no badge today)', 'chat bubble unread pill']}
  recommend="B"
  variants={[
    { key: 'A', label: 'Roll + pop', note: 'The tab count rolls vertically (always upward); the nav badge pops in with a spring on the first alert and pops away at zero.', render: (p) => <CountDemo {...p} variant="A" /> },
```

Lab deps: `tx`, `EASE.out`, `animate` (imperative, B-only), `useHaptic`, `Icon`, `Page`, `Button`, `--lab-speed`, `var(--shadow-sm)`.

## 5b. Production landing sites

### Dashboard `{n} rooms active` — `frontend/src/pages/Dashboard.jsx:1253-1266`

```jsx
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          {activeRooms.length > 0
            ? <span className="z-dot z-dot-on" style={{ flexShrink: 0 }} />
            : <span className="z-dot" style={{ background: 'var(--line-2)', flexShrink: 0 }} />}
          <span style={{ fontSize: 13, color: 'var(--ink-mute)' }}>
            {activeRooms.length > 0
              ? (activeRooms.length === 1
                  ? t('dashboard.roomsActiveOne', { n: activeRooms.length })
                  : t('dashboard.roomsActiveMany', { n: activeRooms.length }))
              : t('dashboard.allQuiet')}
          </span>
```
i18n: `lib/i18n/en.js:4213-4214` / `he.js:4176-4177`
```js
  'dashboard.roomsActiveOne':           '{n} room active',
  'dashboard.roomsActiveMany':          '{n} rooms active',
```
```js
  'dashboard.roomsActiveOne':           'חדר אחד פעיל',
  'dashboard.roomsActiveMany':          '{n} חדרים פעילים',
```
Blocker for a digit roll: **the number is embedded in an interpolated sentence**, and the Hebrew singular (`'חדר אחד פעיל'`) **drops `{n}` entirely**. A roll needs the digit as its own node, so the key must be split (digit + label) or the roll must animate the whole string. `activeRooms` is defined at `Dashboard.jsx:1159`; the H1 above it is `statusText` (`dashboard.homeAwake` / `dashboard.homeCalm`, `:1205-1207`), deliberately count-free per the comment at `:1202-1204`.

### Devices header subtitle — `frontend/src/pages/Devices.jsx:2642-2645`

```jsx
              {t('devices.subtitleActive', { active: activeCount, total: getTotalControllable(), totalEntities: entities.length })}
              {hiddenCount > 0 && ` · ${t('devices.subtitleHidden', { n: hiddenCount })}`}
              {unassigned.length > 0 && <span style={{ color: 'var(--warn)', marginInlineStart: 4 }}>· {t('devices.subtitleUnassigned', { n: unassigned.length })}</span>}
              {noRoomEntities.length > 0 && <span style={{ color: 'var(--ink-faint)', marginInlineStart: 4 }}>· {t('devices.subtitleNoRoom', { n: noRoomEntities.length })}</span>}
```
`activeCount` from `Devices.jsx:2554` (`const activeCount = getActiveCount()`).
i18n: `en.js:364` / `he.js:362`
```js
  'devices.subtitleActive':       '{active} of {total} active · {totalEntities} total',
```
```js
  'devices.subtitleActive':       '{active} מתוך {total} פעילים · {totalEntities} בסך הכל',
```
**Three numbers in one interpolated string** — the hardest site for a per-digit roll. Needs the key decomposed into fragments.

### Anomalies counts — `frontend/src/pages/Anomalies.jsx:477-495`

```jsx
  const criticalCount = activeList.filter(a => a.severity === 'critical').length
  const warningCount  = activeList.filter(a => a.severity === 'warning').length

  const tabs = [
    { id: 'active',  label: t('anomaliesPage.tabAll', { n: activeList.length || 0 }) },
    { id: 'history', label: t('anomaliesPage.tabHistory') },
    { id: 'rules',   label: t('anomaliesPage.tabRules') },
  ]

  return (
    <div style={{ maxWidth: 'var(--page-max-w)', margin: '0 auto', padding: '24px 20px 24px' }}>

      {/* Header */}
      <div className="z-page-head">
        <div>
          <p className="z-eyebrow">
            {t('anomaliesPage.today')}{criticalCount + warningCount > 0 ? t('anomaliesPage.needAttentionCount', { n: criticalCount + warningCount }) : ''}
          </p>
          <h1 className="z-display" style={{ margin: 0 }}>{t('alerts.title')}</h1>
        </div>
```
The tab count is **inside the tab label string** (`anomaliesPage.tabAll` with `{n}`), not a separate badge element like the lab's. The lab's badge-in-tab shape does not exist here; porting "roll + pop" means introducing a badge element.

### Suggestions stat strip — `frontend/src/pages/Suggestions.jsx:261-277`

```jsx
      {/* Stats strip — Title-size tabular numbers in ink; zero reads faint. */}
      {suggestions.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 8, marginBottom: 20 }}>
          {[
            { label: t('suggestions.statPending'),     value: pending.length },
            { label: t('suggestions.statusAccepted'),  value: suggestions.filter(s => s.status === 'accepted').length },
            { label: t('suggestions.statusSnoozed'),   value: suggestions.filter(s => s.status === 'snoozed').length },
            { label: t('suggestions.statusDismissed'), value: suggestions.filter(s => s.status === 'rejected').length },
          ].map(({ label, value }) => (
            <div key={label} style={{ padding: 12, borderRadius: 'var(--r-card)', background: 'var(--surface)', border: '0.5px solid var(--line)', textAlign: 'center' }}>
              <p className="z-title z-mono" style={{ color: value > 0 ? 'var(--ink)' : 'var(--ink-faint)', margin: 0 }}>{value}</p>
              <p className="z-eyebrow" style={{ marginTop: 4 }}>{label}</p>
            </div>
          ))}
        </div>
      )}
```
**Best site in this pick**: `{value}` is a bare number in its own `<p className="z-title z-mono">`. Drop-in for the roll. Note the colour flips `var(--ink)` ↔ `var(--ink-faint)` at zero — the lab's badge does the same thing with `var(--err)` ↔ `var(--line-2)`.

Tab chips with count badges, `Suggestions.jsx:279-295` — **this is the closest structural match to the lab's tab badge**:
```jsx
      {/* Tabs — filter chips: active = surface-2 + ink + hairline. */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        {[{ id: 'pending', label: t('suggestions.tabPending'), count: pending.length }, { id: 'history', label: t('suggestions.tabHistory') }].map(tabDef => (
          <button
            key={tabDef.id}
            onClick={() => setTab(tabDef.id)}
            aria-pressed={tab === tabDef.id}
            style={chipStyle(tab === tabDef.id)}
          >
            {tabDef.label}
            {tabDef.count > 0 && (
              <span className="z-chip z-mono" style={{ padding: '0 8px', lineHeight: '22px' }}>
                {tabDef.count}
              </span>
            )}
          </button>
        ))}
      </div>
```
`{tabDef.count > 0 && …}` is already the lab's mount/unmount condition, so the pop-in/pop-away wraps it directly in `AnimatePresence`.

### Tasks headers — `frontend/src/pages/Tasks.jsx:310-318, 383-389, 437-439`

```jsx
function TaskGroup({ label, count, tint, tasks, ...rowProps }) {
  …
        <p className="z-eyebrow">{label}</p>
        <span style={{ fontSize: 12, color: 'var(--ink-mute)', fontVariantNumeric: 'tabular-nums', marginInlineStart: 'auto' }}>{count}</span>
```
```jsx
          <p className="z-eyebrow">{t('tasks.eyebrow')}</p>
          …
            {t('tasks.totalCount', { n: tasks.length })}
```
```jsx
              <TaskGroup label={t('tasks.today')} count={todayTasks.length} tint="var(--ink)" tasks={todayTasks} {...rowProps} />
              <TaskGroup label={t('tasks.thisWeek')} count={weekTasks.length} tint="var(--warn)" tasks={weekTasks} {...rowProps} />
              <TaskGroup label={t('tasks.laterNoDate')} count={laterTasks.length} tint="var(--line-2)" tasks={laterTasks} {...rowProps} />
```
`{count}` in `TaskGroup` is a bare number in its own span — another clean site. `tasks.totalCount` is interpolated.

### Alerts "See all N" — `frontend/src/pages/Dashboard.jsx:1411-1413` (mobile) and `:1533-1536` (desktop rail)

```jsx
            <button onClick={() => navigate('/alerts')} style={sectionEditBtn}>
              {t('dashboard.seeAllN', { n: anomalies.length })}
            </button>
```
```jsx
              {/* One "See all N" in the header carries the count and the
                  link to /alerts — the old trailing "See all →" row after
                  five items duplicated both. */}
              <button onClick={() => navigate('/alerts')} style={sectionEditBtn}>
                {t('dashboard.seeAllN', { n: anomalies.length })}
              </button>
```
i18n: `en.js:2636-2637` / `he.js:2263-2264`
```js
  'dashboard.seeAllN':            'See all {n}',
  'dashboard.seeAllNArrow':       'See all {n} →',
```
```js
  'dashboard.seeAllN':            'הצגת כל ה־{n}',
  'dashboard.seeAllNArrow':       'הצגת כל ה־{n} ←',
```
Also `automations.suggested.seeAll` = `'See all ({n})'` / `'לראות הכול ({n})'` (`en.js:1668` / `he.js:1644`).

Alert chip counts on the Dashboard (singular/plural pairs, all interpolated), `Dashboard.jsx:1198-1201`:
```jsx
    ...(criticalAnomalies.length > 0 ? [{ id: 'anom-crit', sev: 'critical', text: criticalAnomalies.length === 1 ? t('dashboard.criticalAlertsOne', { n: criticalAnomalies.length }) : t('dashboard.criticalAlertsMany', { n: criticalAnomalies.length }), to: '/alerts' }] : []),
    ...(warningAnomalies.length  > 0 ? [{ id: 'anom-warn', sev: 'warn',     text: warningAnomalies.length === 1 ? t('dashboard.anomaliesOne', { n: warningAnomalies.length }) : t('dashboard.anomaliesMany', { n: warningAnomalies.length }), to: '/alerts' }] : []),
    ...(pendingCount() > 0 ? [{ id: 'sug', sev: 'info', text: pendingCount() === 1 ? t('dashboard.suggestionsReadyOne', { n: pendingCount() }) : t('dashboard.suggestionsReadyMany', { n: pendingCount() }), to: '/alerts' }] : []),
    ...(taskTrackingEnabled && overdueTasks.length > 0 ? [{ id: 'tasks', sev: 'warn', text: overdueTasks.length === 1 ? t('dashboard.overdueTasksOne', { n: overdueTasks.length }) : t('dashboard.overdueTasksMany', { n: overdueTasks.length }), to: '/tasks' }] : []),
```
These are plain strings in a data array — no element to animate without restructuring.

### The one badge that already exists — chat bubble unread

`frontend/src/components/chat/ChatBubble.jsx:106-110`:
```jsx
      {unread > 0 && (
        <span className="z-chat-bubble-badge" data-testid="chat-bubble-badge" aria-hidden="true">
          {unread > 9 ? '9+' : unread}
        </span>
      )}
```
and its CSS, `frontend/src/components/chat/chatBubble.css` (the `.z-chat-bubble-badge` block):
```css
.z-chat-bubble-badge {
  position: absolute;
  top: -4px;
  inset-inline-end: -4px;
  box-sizing: border-box;
  min-width: 20px;
  height: 20px;
  padding: 0 8px;
  border-radius: 999px;
  background: var(--surface);
  color: var(--ink);
  border: 0.5px solid var(--line);
  font-size: 11px;
  font-weight: 500;
  line-height: 19px;
  text-align: center;
  font-variant-numeric: tabular-nums;
  box-shadow: 0 0 0 2px var(--bg);
  pointer-events: none;
}
```
`{unread > 0 && …}` + `unread > 9 ? '9+' : unread` is exactly the lab's badge contract, and the `9+` clamp means the roll only ever has one digit cell. Store fields: `chatUnread`, `bumpChatUnread`, `clearChatUnread` on `useChatStore`. **`BottomNav` has no badge at all** (the lab's `inZiggy` note says so).

---

# 6. Moments › onboarding-steps variant **B — "Slide + dots grow"** (duration 0.4)

## 6a. Lab implementation

Step model — `Moments.jsx:16-21`:
```jsx
const STEPS = [
  { key: 'sensors', title: { en: 'Confirm your sensors', he: 'אישור החיישנים' }, body: { en: "We'll walk through each sensor in your kit. Edit the name if you like, or just tap Next.", he: 'נעבור על כל חיישן בערכה. אפשר לערוך את השם, או פשוט להקיש הבא.' }, icon: 'radar' },
  { key: 'starter', title: { en: 'Starter actions', he: 'פעולות להתחלה' }, body: { en: 'Here are a few actions matched to your kit. Toggle the ones you want.', he: 'הנה כמה פעולות שמתאימות לערכה שלך. בחר את אלה שאתה רוצה.' }, icon: 'zap' },
  { key: 'notify', title: { en: 'Notifications', he: 'התראות' }, body: { en: 'Ziggy will send alerts about your home: arrivals, issues, and reminders you set.', he: 'זיגי ישלח התראות על הבית: הגעות, תקלות ותזכורות.' }, icon: 'bell' },
  { key: 'done', title: { en: "You're all set.", he: 'הכל מוכן.' }, body: { en: 'Your home is ready.', he: 'הבית שלך מוכן.' }, icon: 'check' },
]
```

Dots — `Moments.jsx:35-41`:
```jsx
function Dots({ idx, n, tx, variant }) {
  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'center', height: 20 }}>
      {Array.from({ length: n }).map((_, i) => <motion.span key={i} animate={{ width: i === idx ? 18 : 7, backgroundColor: i < idx ? 'var(--ink-mute)' : i === idx ? 'var(--ink)' : 'var(--line-2)' }} transition={variant === 'A' ? { duration: 0 } : tx({ type: 'spring', duration: 0.4, bounce: 0.1 })} style={{ height: 7, borderRadius: 4, background: 'var(--line-2)' }} />)}
    </div>
  )
}
```

The slide — `Moments.jsx:43-65` (the `variant === 'B'` branch):
```jsx
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
```

Footer nav — `Moments.jsx:92-95`:
```jsx
        <div style={{ display: 'flex', gap: 10, padding: '16px 0 20px' }}>
          <Button style={{ flex: 1 }} onClick={() => go(-1)} disabled={idx === 0}>{t({ en: 'Back', he: 'חזרה' })}</Button>
          <Button variant="primary" style={{ flex: 2 }} onClick={() => isDone ? setIdx(0) : go(1)}>{isDone ? t({ en: 'Start over', he: 'מהתחלה' }) : t({ en: 'Next', he: 'הבא' })}</Button>
        </div>
```

Step bodies (what the slide carries) — `Moments.jsx:23-33`:
```jsx
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
```

Registration, with the 0.4 knob and the explicit production targets — `Moments.jsx:354-359`:
```jsx
<Demo id="onboarding-steps" bare title="Onboarding step advance" purpose="First run is the one time the user watches every transition. The steps should feel like a path, not a slideshow." principles={['continuity', 'physical']} inZiggy={['WebOnboarding.jsx:96-112', 'MobileOnboarding.jsx:190-208', 'onboarding/steps.jsx']}
  knobs={[{ key: 'duration', label: 'Duration', min: 0.2, max: 0.8, step: 0.02, value: 0.4, unit: 'ms' }]}
  recommend="C"
  variants={[
    { key: 'A', label: 'Cut (today)', render: (p) => <OnboardingDemo {...p} variant="A" /> },
    { key: 'B', label: 'Slide + dots grow', note: 'Content slides in the direction of travel; the current dot widens to a bar. Exit 140 ms, enter 400 ms.', render: (p) => <OnboardingDemo {...p} variant="B" /> },
```

Spec: **enter `0.4s EASE.out` with `x: 28 * dir * sign`; exit `0.14s` with `x: -28 * dir * sign`; dots spring `{duration:0.4, bounce:0.1}` on `width 7↔18` + three-way `backgroundColor`.**

Lab deps: `tx`, `knobs.duration` (→ literal `0.4`), `rtl` from `useLab` (→ production reads `dir` / `document.dir` or the i18n lang — **the `sign` flip is required for Hebrew**, since `x` is a physical axis), `EASE.out`, `useHaptic` (`'light'` per step, `'success'` on the final step), `Icon`, `Card`, `Button`, `.zl-*` classes, and `AnimatePresence mode="popLayout"` with `custom={dir.current}` — note `dir` is a **ref**, deliberately, so the exiting child reads the same direction as the entering one.

## 6b. Production landing sites

### `frontend/src/pages/WebOnboarding.jsx` — step conditional

The step enum, `:30-37`:
```js
const STEP = {
  SETUP:    'setup',
  SENSORS:  'sensors',
  STARTER:  'starter',
  NOTIFY:   'notify',
  LOCATION: 'location',
  DONE:     'done',
}
```
Transitions, `:42-69`:
```jsx
  const [step, setStep] = useState(STEP.SETUP)
  // The owner's super_admin session token from /api/auth/setup. Held in state
  // (NOT committed to the auth store) until DONE so the app stays on the
  // unauthenticated gate — and this wizard stays mounted — through every step.
  const [sessionToken, setSessionToken] = useState(null)
  const [sensorsConfirmedCount, setSensorsConfirmedCount] = useState(0)
  const [automationsAcceptedCount, setAutomationsAcceptedCount] = useState(0)
  const [errors, setErrors] = useState([])
  const startedAtRef = useRef(Date.now())

  const pushError = (msg) => setErrors(es => [...es, String(msg).slice(0, 200)])

  const afterSetup = (token) => { setSessionToken(token); setStep(STEP.SENSORS) }
  const afterSensors = (confirmed) => {
    if (typeof confirmed === 'number') setSensorsConfirmedCount(confirmed)
    setStep(STEP.STARTER)
  }
  const afterStarter = (accepted) => {
    if (typeof accepted === 'number') setAutomationsAcceptedCount(accepted)
    setStep(STEP.NOTIFY)
  }
  const afterNotify   = () => setStep(STEP.LOCATION)
  const afterLocation = () => setStep(STEP.DONE)
```

The subtitle conditional, `:85-92`:
```jsx
          <p className="z-subhead" style={{ margin: '4px 0 0' }}>
            {step === STEP.SETUP    && t('mobileOnboard.subtitleClaim')}
            {step === STEP.SENSORS  && t('mobileOnboard.subtitleSensors')}
            {step === STEP.STARTER  && t('mobileOnboard.subtitleStarter')}
            {step === STEP.NOTIFY   && t('mobileOnboard.subtitleNotify')}
            {step === STEP.LOCATION && t('mobileOnboard.subtitleLocation')}
            {step === STEP.DONE     && t('mobileOnboard.subtitleDone')}
          </p>
        </header>
```

**The step conditional that must change, `:95-113`:**
```jsx
        <main style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
          {step === STEP.SETUP    && <WebSetupStep    onDone={afterSetup} onError={pushError} />}
          {step === STEP.SENSORS  && <SensorsStep     onDone={afterSensors} onError={pushError} authToken={sessionToken} />}
          {step === STEP.STARTER  && <StarterStep      userToken={sessionToken} authToken={sessionToken} onDone={afterStarter} onError={pushError} />}
          {step === STEP.NOTIFY   && <NotifyStep       onDone={afterNotify} />}
          {step === STEP.LOCATION && <WebLocationStep  onDone={afterLocation} onError={pushError} authToken={sessionToken} />}
          {step === STEP.DONE     && (
            <DoneStep
              onDone={afterDone}
              isFirstPair={true}
              startedAt={startedAtRef.current}
              sensorsConfirmedCount={sensorsConfirmedCount}
              automationsAcceptedCount={automationsAcceptedCount}
              errors={errors}
              onError={pushError}
              authToken={sessionToken}
            />
          )}
        </main>
```
Six bare `&&` conditionals, **no `AnimatePresence`, no dots, no progress indicator of any kind**, `step` is a **string enum, not an index** — so the lab's `dir.current = d` (a numeric delta) has nothing to compute from. The port needs a step **order array** to derive direction. There is no "Back" button on either wizard (each step calls `onDone` forward only), so direction is always +1 in practice; the lab's bidirectional `sign`/`dir` machinery is latent capability.

### `frontend/src/pages/MobileOnboarding.jsx` — same shape, nine steps

Transitions, `:65, 113-127`:
```jsx
  const [step, setStep]             = useState(STEP.PAIR)
  …
    setStep(firstPair ? STEP.CLAIM : STEP.PERSON)
  }
  const afterClaim   = () => setStep(STEP.SENSORS)
  …
    setStep(STEP.STARTER)
  }
  …
    setStep(STEP.NOTIFY)
  }
  const afterPerson  = () => setStep(STEP.NOTIFY)
  const afterNotify  = () => setStep(STEP.LOCATION)
  const afterLocation = () => setStep(STEP.MOTION)
  const afterMotion  = () => setStep(STEP.DONE)
```
Note `afterPair` **branches** (`firstPair ? CLAIM : PERSON`), so the step list is not linear — a dots row has to decide what the denominator is.

Subtitle conditional, `:149-159`:
```jsx
        <p className="z-subhead" style={{ margin: '4px 0 0' }}>
          {step === STEP.PAIR     && t('mobileOnboard.subtitlePair')}
          {step === STEP.CLAIM    && t('mobileOnboard.subtitleClaim')}
          {step === STEP.SENSORS  && t('mobileOnboard.subtitleSensors')}
          {step === STEP.STARTER  && t('mobileOnboard.subtitleStarter')}
          {step === STEP.PERSON   && t('mobileOnboard.subtitlePerson')}
          {step === STEP.NOTIFY   && t('mobileOnboard.subtitleNotify')}
          {step === STEP.LOCATION && t('mobileOnboard.subtitleLocation')}
          {step === STEP.MOTION   && t('mobileOnboard.subtitleMotion')}
          {step === STEP.DONE     && t('mobileOnboard.subtitleDone')}
        </p>
      </header>
```

**The step conditional, `:189-209`:**
```jsx
      <main style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        {step === STEP.PAIR     && <PairStep    onDone={(firstPair) => { setPaired(true); afterPair(firstPair) }} />}
        {step === STEP.CLAIM    && <ClaimStep   onDone={(userTok) => { setUserToken(userTok); afterClaim() }} onError={pushError} />}
        {step === STEP.SENSORS  && <SensorsStep onDone={afterSensors} onError={pushError} />}
        {step === STEP.STARTER  && <StarterStep userToken={userToken} onDone={afterStarter} onError={pushError} />}
        {step === STEP.PERSON   && <PersonStep  onDone={afterPerson} />}
        {step === STEP.NOTIFY   && <NotifyStep  onDone={afterNotify} />}
        {step === STEP.LOCATION && <LocationStep onDone={afterLocation} />}
        {step === STEP.MOTION   && <MotionStep  onDone={afterMotion} />}
        {step === STEP.DONE     && (
          <DoneStep
            onDone={afterDone}
            isFirstPair={isFirstPair}
            startedAt={startedAtRef.current}
            sensorsConfirmedCount={sensorsConfirmedCount}
            automationsAcceptedCount={automationsAcceptedCount}
            errors={errors}
            onError={pushError}
          />
        )}
      </main>
```
There is also a non-step element that renders only on `STEP.PAIR` (`:166-188`, the "use as wall display" escape hatch) — it sits **outside** `<main>`, so it would not be carried by the slide.

### `frontend/src/pages/onboarding/steps.jsx` — the shared step bodies (432 lines)

Exported step components, which are the things the slide would carry:
```
:27   export function SensorsStep({ onDone, onError, authToken = null })
:195  export function StarterStep({ userToken, onDone, onError, authToken = null })
:343  export function NotifyStep({ onDone })
:368  export function DoneStep({ … })
:420  export function PermissionScreen({ title, body, onAllow, onSkip, busy })
```
These are shared by both wizards — so animating the wrapper in both call sites is sufficient; the bodies need no change.

### `AutomationWizard` StepDots — **the existing dots implementation to reuse**

`frontend/src/components/automations/bundles/engine/StepFrame.jsx:10-32` (imported by `AutomationWizard.jsx:17` and rendered at `:125`/`:257`):
```jsx
// Each dot is a 44px-tall target (the visible pill is 7px); the row of dots
// stays compact because the buttons overlap horizontally only by their gap.
export function StepDots({ count, current, maxReached, onJump }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 0 }} role="group">
      {Array.from({ length: count }, (_, i) => {
        const isCurrent = i === current
        const isDone = i < current
        const enabled = onJump && i <= maxReached
        return (
          <button key={i} type="button" onClick={() => enabled && onJump(i)} disabled={!enabled}
            aria-label={`${i + 1}/${count}`} aria-current={isCurrent ? 'step' : undefined}
            style={{ height: 44, padding: '0 2px', background: 'none', border: 'none',
              display: 'flex', alignItems: 'center', cursor: enabled ? 'pointer' : 'default' }}>
            <span aria-hidden="true" style={{ display: 'block', width: isCurrent ? 18 : 7, height: 7, borderRadius: 999,
              transition: 'width var(--dur-state) var(--ease-standard), background var(--dur-state) var(--ease-standard)',
              background: isCurrent ? 'var(--ink)' : isDone ? 'var(--ink-mute)' : 'var(--line-2)' }} />
          </button>
        )
      })}
    </div>
  )
}
```

**This is already the lab's `Dots` component, in production, via CSS instead of framer.** Point-by-point:
- `width: isCurrent ? 18 : 7` — lab `width: i === idx ? 18 : 7` ✅ identical
- `background: isCurrent ? 'var(--ink)' : isDone ? 'var(--ink-mute)' : 'var(--line-2)'` — lab `i < idx ? 'var(--ink-mute)' : i === idx ? 'var(--ink)' : 'var(--line-2)'` ✅ identical three-way
- `height: 7, borderRadius: 999` — lab `height: 7, borderRadius: 4` (near-identical; 999 vs 4 on a 7px pill is visually the same)
- animated by `transition: 'width var(--dur-state) …, background var(--dur-state) …'` = **200ms `cubic-bezier(0.2,0,0,1)`**, where the lab uses a framer spring `{duration:0.4, bounce:0.1}`. That is the only real delta.
- Extras production has and the lab does not: 44px tap targets, `role="group"`, `aria-label="{i+1}/{count}"`, `aria-current="step"`, and **clickable back-jump** gated on `maxReached`.

So the onboarding port should import `StepDots` from `components/automations/bundles/engine/StepFrame.jsx` rather than re-implement `Dots`, and (if the spring is wanted) swap its CSS transition for the framer spring — which would change the automation wizard too, since it is the same component.

The frame it lives in, `StepFrame.jsx:34-65`:
```jsx
export function StepFrame({ title, step, total, maxReached, onJump, onBack, backLabel,
  onPrimary, primaryLabel, primaryDisabled, children, hideFooter = false }) {
  const t = useT()
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: '4px 2px' }} dir="auto">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <p className="z-eyebrow" style={{ margin: 0, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</p>
        <span style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          <StepDots count={total} current={step} maxReached={maxReached} onJump={onJump} />
          <span className="z-footnote z-mono" style={{ color: 'var(--ink-faint)' }}>
            {step + 1}/{total}
          </span>
        </span>
      </div>
      {children}
      {/* hideFooter: an embedded sub-flow (e.g. the presence-sensor creator
          inside Smart Room) owns its own Back/Next, so the outer nav is
          suppressed to avoid two competing button rows. */}
      {!hideFooter && (
        <div style={{ display: 'flex', gap: 8, paddingTop: 4 }}>
          <button type="button" onClick={onBack} className="z-btn-secondary" style={{ flex: 1 }}>
            {backLabel || t('automations.bundles.back')}
          </button>
          <button type="button" onClick={onPrimary} disabled={primaryDisabled} className="z-btn-primary"
            style={{ flex: 1, opacity: primaryDisabled ? 0.5 : 1 }}>
            {primaryLabel || t('automations.bundles.next')}
          </button>
        </div>
      )}
    </div>
  )
}
```
`{children}` is the un-animated slot — the lab's `AnimatePresence` + `motion.div` wraps exactly here. `step` is a **numeric index** in `StepFrame` (unlike the onboarding wizards' string enums), so direction is computable for free. i18n keys: `automations.bundles.back`, `automations.bundles.next`.

Note `StepFrame.jsx:38` carries `dir="auto"` — the lab's `sign` flip would need `rtl` from the i18n lang, not from this attribute.

---

# 7. Moments › pairing variant **B — "Radar + blip lands"**

## 7a. Lab implementation — `Moments.jsx:103-159`, variant B block at `:123-136`

The whole demo (B branch highlighted):

```jsx
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
```

**The radar itself — `Moments.jsx:123-136`:**
```jsx
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
```

Status copy + found CTA, shared across variants — `Moments.jsx:148-156`:
```jsx
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.div key={phase} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={tx({ duration: 0.24, ease: EASE.out })} style={{ textAlign: 'center' }}>
            <div className="zl-title3">{found ? t(COPY.found) : t({ en: 'Pairing mode active', he: 'מצב צימוד פעיל' })}</div>
            <div className="zl-subhead zl-mute">{found ? t({ en: 'IKEA Trådfri bulb · Give it a name', he: 'נורת IKEA · תן לה שם' }) : t(COPY.searching)}</div>
          </motion.div>
        </AnimatePresence>
        <AnimatePresence>{found && <motion.div key="cta" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={tx({ duration: 0.3, delay: 0.2, ease: EASE.out })} style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 8 }}><input className="zl-btn" defaultValue={t({ en: 'Kids Room Lamp', he: 'מנורת חדר ילדים' })} style={{ justifyContent: 'flex-start', fontWeight: 500 }} /><Button variant="primary">{t({ en: 'Save device', he: 'שמירת מכשיר' })}</Button></motion.div>}</AnimatePresence>
        <p className="zl-footnote zl-mute">{t({ en: 'The device is found after ~4 s. Press Replay to watch again.', he: 'המכשיר נמצא אחרי ~4 שניות. לחץ Replay.' })}</p>
```
Copy constants from `lab/mock/home.js:87-90`:
```js
  searching: { en: 'Looking for new devices…', he: 'מחפש מכשירים חדשים…' },
  found: { en: 'Found a bulb', he: 'נמצאה נורה' },
  pairing: { en: 'Getting to know it…', he: 'לומד להכיר אותו…' },
  paired: { en: 'Ready', he: 'מוכן' },
```

Registration — `Moments.jsx:364-368`:
```jsx
<Demo id="pairing" bare title="Pairing: searching → found" purpose="Searching should look like searching; finding should feel like a small arrival." principles={['causality', 'state']} inZiggy={['PairingWizard.jsx:727-899', 'CountdownRing']}
  recommend="B"
  variants={[
    { key: 'A', label: 'Halo + ring (today)', note: 'The countdown ring and a breathing halo; found = the number becomes a check.', render: (p) => <PairingDemo {...p} variant="A" /> },
    { key: 'B', label: 'Radar + blip lands', note: 'A sweep rotates; blips ping at bearings as the radio hears things; when the device is found, its blip flies to the centre and grows into a device icon on a spring. The search had a geometry; the result came from it.', render: (p) => <PairingDemo {...p} variant="B" /> },
```

Mechanics worth naming for the port:
- **220×220 dish**: outer `border-radius:999` ring + `radial-gradient(circle, var(--surface) 0%, var(--surface-2) 100%)`, plus two concentric range rings at `r = 0.33` and `0.66` of 220.
- **Sweep**: one `motion.div`, `rotate: 0→360`, `2.4s linear repeat: Infinity`, painted by `conic-gradient(from 0deg, transparent 0deg, color-mix(in srgb, var(--accent) 45%, transparent) 60deg, transparent 61deg)` — a 60° wedge with a hard trailing edge. Its transition is **not** passed through `tx` (raw object), so it ignores lab speed; same for variant A's halo at `:116`.
- **Three blips**, each `[distance, bearingDeg, startDelaySec]`: `[0.7, 40, 1.2]`, `[0.45, 200, 2.0]`, `[0.85, 300, 3.1]`. Position is computed polar → absolute: `left = 110 + cos(a·π/180)·100·d − 5`, `top = 110 + sin(…)·100·d − 5` (10px dot, so −5 centers it). Keyframed `opacity:[0,1,0.2,0]` and `scale:[0.4,1,1,0.6]` over `2.4s` with `repeat: Infinity, repeatDelay: 0.4`.
- **The landing blip** is the second blip's bearing (200°) at a *closer* radius (45 instead of 100·0.45): it enters at `scale:0.3` positioned on the dish, then animates `left/top` to center (`110 − 32`, a 64px tile) and `scale:1` on `{type:'spring', duration:0.6, bounce:0.3}`. It animates `left`/`top` — **layout properties**, against `motion.js:14-17`; a transform-based port would use `x`/`y`.
- Centre dot (the hub itself): 8px `var(--ink)`, present only while searching.
- Haptic `'success'` fires with the phase flip at 4200ms.

Lab deps: `tx`, `ms` (both the 1s countdown tick and the 4.2s found timer), `replayKey`, `EASE.out`, `useHaptic`, `Icon`, `Button`, `COPY`, `--accent-2`/`--accent-text`/`--shadow-md` tokens.

## 7b. Production landing site — `frontend/src/components/PairingWizard.jsx`

### CountdownRing — `:112-125`

```jsx
function CountdownRing({ value, max }) {
  const r    = 52
  const circ = 2 * Math.PI * r
  const pct  = value / max
  return (
    <svg width="128" height="128" viewBox="0 0 128 128" className="rotate-[-90deg]">
      <circle cx="64" cy="64" r={r} fill="none" stroke="currentColor"
        strokeWidth="6" className="text-line" />
      <circle cx="64" cy="64" r={r} fill="none" stroke="currentColor"
        strokeWidth="6" strokeLinecap="round" className="text-accent transition-all duration-200"
        strokeDasharray={circ} strokeDashoffset={circ * (1 - pct)} />
    </svg>
  )
}
```
(The lab's variant A reproduces this almost exactly at `Moments.jsx:118` — `strokeDasharray="327"`, `strokeDashoffset={327 * (1 - secs/180)}`, `transition: 'stroke-dashoffset 200ms'`, which matches `transition-all duration-200` here.)

### The halo + "Scanning for devices…" block — `:737-851`

```jsx
            {/* Zigbee / Z-Wave: countdown ring. The breathing halo is the ONE
                ambient loop on this screen — it means "the network is open". */}
            {(protocol === 'zigbee' || protocol === 'zwave') && (
              <div className="relative flex items-center justify-center w-32 h-32">
                <motion.div
                  animate={{ scale: [1, 1.18, 1], opacity: [0.5, 0.1, 0.5] }}
                  transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
                  className="absolute inset-0 rounded-full bg-accent-soft pointer-events-none"
                />
                <CountdownRing value={countdown} max={pairDuration} />
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <span className="text-title2 text-ink tabular-nums">
                    {countdown}
                  </span>
                  <span className="text-footnote text-ink-mute">{t('wizard.pairing.sec')}</span>
                </div>
              </div>
            )}
```
This halo is **character-identical** to the lab's variant-A halo (`Moments.jsx:116`: `scale: [1, 1.18, 1], opacity: [0.5, 0.1, 0.5]`, `duration: 2, repeat: Infinity, ease: 'easeInOut'`). Variant B **replaces** this whole `w-32 h-32` block with the 220×220 dish — a 128→220px footprint increase inside a `flex flex-col items-center gap-5` column.

The matter spinner and the Broadlink/Wi-Fi discovered-flows list are the other two protocol branches that would NOT get a radar (`:752-826`):
```jsx
            {/* Matter: spinner — 1s linear, the one loop on this screen */}
            {protocol === 'matter' && (
              <div className="relative flex items-center justify-center w-24 h-24">
                <div className="z-spin w-16 h-16 rounded-full border-4 border-line border-t-accent" aria-hidden />
                <Sparkles size={24} strokeWidth={1.75} className="absolute text-ink-2" aria-hidden />
              </div>
            )}

            {/* Broadlink / Wi-Fi: discovered flows list */}
            {(protocol === 'broadlink' || protocol === 'wifi') && (
              <div className="w-full">
                {flowsLoading ? (
                  <div className="flex items-center justify-center py-6">
                    <div className="z-spin w-8 h-8 rounded-full border-2 border-line border-t-ink-mute" aria-hidden />
                  </div>
                ) : configuringFlow ? (
                  <ConfigFlowRunner … />
                ) : configFlows.length > 0 ? (
                  <div className="space-y-2 text-start">
                    <p className="text-subhead text-ink-mute mb-2">
                      {configFlows.length === 1
                        ? t('wizard.pairing.discoveredHaOne', { n: configFlows.length })
                        : t('wizard.pairing.discoveredHa', { n: configFlows.length })}
                    </p>
                    {configFlows.map((flow) => (
                      <button
                        key={flow.flow_id}
                        onClick={() => setConfiguringFlow(flow)}
                        className="w-full flex items-center justify-between gap-2 min-h-[64px] px-4 py-3 rounded-card bg-surface border border-line hover:bg-surface-2 transition-colors duration-press text-start"
                      >
                        <div className="min-w-0">
                          <p className="text-body font-semibold text-ink">{flow.title}</p>
                          <p className="text-subhead text-ink-mute capitalize">{flow.handler}</p>
                        </div>
                        <span className="flex items-center gap-1 text-subhead font-medium text-ink-mute shrink-0">
                          {t('wizard.pairing.configure')} <ChevronRight size={20} strokeWidth={1.75} className="icon-flip-rtl" aria-hidden />
                        </span>
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="w-full bg-surface-2 rounded-card p-4 text-start space-y-2">
                    <p className="text-body font-semibold text-ink">
                      {t('wizard.pairing.noneDiscovered')}
                    </p>
                    …
```
This is the **discovered-flow list** you asked about: it's a real list of HA config flows (`flow.flow_id`, `flow.title`, `flow.handler`) with its own `n`-count copy — **the radar's blips are decoration with no data behind them, but this list is actual discovered items**. A faithful "blip lands" would map one blip per `configFlows` entry; today the Zigbee/Z-Wave branch (the one with the ring) has no per-device list at all, and the Broadlink/Wi-Fi branch (the one with the list) has no ring.

Status copy block, `:828-847`:
```jsx
            <div>
              <p className="text-body font-semibold text-ink mb-1">
                {protocol === 'matter'                          ? t('wizard.pairing.commissioning')      :
                 protocol === 'broadlink' || protocol === 'wifi'? t('wizard.pairing.waitingForDevice')  :
                 t('wizard.pairing.pairingActive')}
              </p>
              {(protocol === 'zigbee' || protocol === 'zwave') && (
                <p className="text-subhead text-ink-mute">
                  {protocol === 'zigbee'
                    ? t('wizard.pairing.zigbeeSubtext')
                    : t('wizard.pairing.zwaveSubtext')}
                </p>
              )}
```

**"Scanning for devices…"** — `:848-853`:
```jsx
            {(protocol === 'zigbee' || protocol === 'zwave') && (
              <div className="flex items-center gap-2 text-subhead text-ink-mute">
                <span className="z-dot bg-ink-mute" aria-hidden />
                {t('wizard.pairing.scanningForDevices')}
              </div>
            )}

            <Button variant="secondary" onClick={handleCancel}>
              {t('wizard.cancel')}
            </Button>
```

### "Device found!" banner — `:861-880`

```jsx
        {/* ── Device found — configure ─────────────────────── */}
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
and its name field + room picker + save, `:882-899`:
```jsx
            <Input
              label={t('wizard.pairing.deviceName')}
              value={deviceName}
              onChange={(e) => setDeviceName(e.target.value)}
              placeholder={t('wizard.pairing.deviceNamePh')}
            />

            <div className="flex flex-col gap-2">
              <label className="text-subhead font-semibold text-ink">
                {t('wizard.pairing.assignToRoomOpt')} <span className="text-ink-mute font-normal">{t('wizard.pairing.optional')}</span>
              </label>
              <RoomPicker rooms={allRooms} value={roomId} onChange={setRoomId} />
            </div>

            {errorMsg && <p role="alert" className="text-subhead text-err-text">{errorMsg}</p>}

            <Button onClick={handleSave} disabled={saving} className="w-full">
              {saving ? t('wizard.pairing.saving') : t('wizard.pairing.saveDevice')}
            </Button>
          </motion.div>
        )}
```
**The critical structural fact**: `step === 'pairing'` and `step === 'found'` are **sibling conditionals, each its own `motion.div` with `{...STEP_MOTION}`**. The lab's blip-lands-and-becomes-the-device-icon requires **continuity across that boundary** — a shared `layoutId` between the radar's blip and the found banner's icon, or a single element that survives the step change. Today the radar's container unmounts entirely and the banner mounts fresh. `step` values: `'select' | 'idle' | 'pairing' | 'found' | 'timeout' | 'error' | 'switcher_flow'` (conditionals at `:576, 613, 727, 861, 902, 944, 978`); `setStep('found')` fires at `:302`.

Related state: `foundDevice` (`:224`), `countdown`, `pairDuration`, `protocol`, `configFlows`, `flowsLoading`, `configuringFlow`, `deviceName`, `roomId`, `saving`, `errorMsg`. The transition-to-found poller is described at `:420`:
```
    //  • device-registry poller → transitions to 'found' when the bulb appears
```

### PairingWizard's own StepDots — `:66-108` (a *different* dots implementation from StepFrame's)

```jsx
const STEP_IDS = ['idle', 'pairing', 'found']

// ── Sub-components ──────────────────────────────────────────────────────────

function StepDots({ current }) {
  const t = useT()
  const labels = {
    idle:    t('wizard.pairing.stepReady'),
    pairing: t('wizard.pairing.stepPairing'),
    found:   t('wizard.pairing.stepFound'),
  }
  return (
    <div className="flex items-center justify-center gap-2 mb-6">
      {STEP_IDS.map((id, i) => {
        const idx = STEP_IDS.indexOf(current)
        const done   = i < idx
        const active = id === current
        return (
          <div key={id} className="flex items-center gap-2">
            <div className={cn(
              'flex items-center justify-center w-6 h-6 rounded-full text-footnote font-semibold z-mono transition-colors duration-200',
              done   ? 'bg-ink text-bg' :
              active ? 'bg-surface-2 text-ink border border-ink' :
                       'bg-surface text-ink-mute border border-line'
            )}>
              {done ? <Check size={14} strokeWidth={2.5} aria-hidden /> : i + 1}
            </div>
            <span className={cn(
              'text-footnote font-medium',
              active ? 'text-ink' : 'text-ink-mute'
            )}>
              {labels[id]}
            </span>
            {i < STEP_IDS.length - 1 && (
              <div className={cn(
                'w-8 h-px transition-colors duration-200',
                done ? 'bg-ink' : 'bg-line'
              )} />
            )}
          </div>
        )
      })}
    </div>
  )
}
```
Rendered at `:571`:
```jsx
      {['idle', 'pairing', 'found'].includes(step) && <StepDots current={step} />}
```
This is a **numbered-chip + connector-line stepper**, not a pill row — so the app has **two** `StepDots` with the same name and different designs (`StepFrame.jsx:12` pill row vs this). The lab's `Ready · Pairing · Configure` caption (`Moments.jsx:112`) is a stand-in for this. i18n keys: `wizard.pairing.stepReady/stepPairing/stepFound`.

---

# 8. Moments › scene-run variant **B — "Wave from the bedroom"** (cascade 0.16)

## 8a. Lab implementation — `Moments.jsx:225-291`

The order the wave travels in and the step list:
```jsx
const ORDER = ['bedroom', 'bathroom', 'kids', 'office', 'kitchen', 'living_room', 'balcony'] // distance from the bedroom
const SCENE_STEPS = [{ en: 'Lights off', he: 'כיבוי אורות' }, { en: 'TV off', he: 'כיבוי טלוויזיה' }, { en: 'AC to 24°', he: 'מזגן ל־24°' }, { en: 'Lock the door', he: 'נעילת הדלת' }]
```

The whole demo; **the B branch is `:243-248`**:
```jsx
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
              …
            ) : <div className="zl-row__sub">4 {t({ en: 'steps', he: 'שלבים' })}</div>}
          </div>
          <motion.button onClick={state === 'done' ? reset : state === 'idle' ? run : undefined} layout animate={{ backgroundColor: state === 'done' ? 'var(--ok)' : state === 'running' ? 'var(--surface-2)' : 'var(--accent)', color: state === 'done' ? '#fff' : state === 'running' ? 'var(--ink-mute)' : 'var(--on-accent)' }} transition={tx({ type: 'spring', duration: 0.4, bounce: 0 })} style={{ height: 40, padding: '0 16px', borderRadius: 999, border: 0, fontWeight: 600, fontSize: 14, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, flex: 'none' }}>
            <AnimatePresence mode="popLayout" initial={false}><motion.span key={state} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={tx({ duration: 0.16 })} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>{state === 'idle' ? <><Icon name="play" size={14} />{t(COPY.run)}</> : state === 'running' ? t(COPY.running) : <><Icon name="check" size={14} strokeWidth={3} />{t({ en: 'Reset', he: 'איפוס' })}</>}</motion.span></AnimatePresence>
          </motion.button>
        </Card>
        …
```

**What variant B animates, element by element** (this is the "which elements wave" answer):

1. **Each room tile** (`:266`) — `motion.div` per `ROOMS` entry, `backgroundColor: var(--surface) → var(--tile-base)` and `opacity: 1 → 0.7`, `0.4s EASE.out`.
2. **Each room tile's icon chip** (`:267`) — `backgroundColor: var(--accent-2) → var(--surface-2)`, `color: var(--accent-text) → var(--ink-mute)`, `scale: 1 → 0.92`, `0.36s EASE.out`.
3. The wave is produced **not** by a framer stagger but by **seven `setTimeout`s** (`:245`): `later(fn, 200 + i * 0.16 * 1000)` — i.e. 200, 360, 520, 680, 840, 1000, 1160 ms, each flipping exactly one room id in `lit`. Each tick fires `h('selection')`.
4. **The lit count** (`:263`) — plain `{litCount}` text, decrementing with the wave. (The HeroCascade digit-roll in §10 is the primitive this is meant to use.)
5. **The hero line** (`:260`) — `AnimatePresence mode="popLayout"` keyed on `allOff`; `Home is awake` → `Good night`, `0.32s EASE.out`, with `filter: blur(3px)` on both enter and exit and `y: ±10`.
6. **The moon** (`:261`) — appears only when `allOff && variant !== 'A'`; `{opacity:0, y:14, rotate:-30} → {opacity:1, y:0, rotate:0}`, spring `{duration:0.8, bounce:0.2, delay:0.1}`, `color: var(--gold)`.
7. **The Run button** (`:282-284`) — `layout` + `backgroundColor`/`color` across `idle → running → done` (`var(--accent)` → `var(--surface-2)` → `var(--ok)`), spring `{duration:0.4, bounce:0}`, with its label in a `popLayout` `AnimatePresence` keyed on `state` (0.16s, `y: ±8`).
8. Completion at `200 + 7 × 160 + 300 = 1620ms` → `setState('done')`, `h('success')`.

**Data the variant needs** (the crux of the port): an **ordered list of affected rooms**. `ORDER` is a hand-written constant — `['bedroom','bathroom','kids','office','kitchen','living_room','balcony']` with the comment `// distance from the bedroom`. Plus per-room lit state (`lit`, keyed by room id) and the device/room grid (`ROOMS` from `lab/mock/home.js:6-14`).

Registration, with the 0.16 cascade knob — `Moments.jsx:381-386`:
```jsx
<Demo id="scene-run" activeNav="actions" title="Scene run: Good Night" purpose="A scene changes the whole home. The home should visibly change, in the order it happens." principles={['causality', 'hierarchy', 'state']} inZiggy={['AutomationCard Run', 'RoutineCard Run now', 'execution_result toast']}
  knobs={[{ key: 'cascade', label: 'Cascade gap (B, C)', min: 0.05, max: 0.4, step: 0.01, value: 0.16, unit: 'ms' }]}
  recommend="B"
  variants={[
    { key: 'A', label: 'Toast (today)', render: (p) => <SceneDemo {...p} variant="A" /> },
    { key: 'B', label: 'Wave from the bedroom', note: 'Rooms go dark one after another, ordered by distance from the bedroom; the count rolls; the hero becomes "Good night" and a moon rises. The scene is watched, not reported.', render: (p) => <SceneDemo {...p} variant="B" /> },
```

Lab deps: `tx`, `ms`, `knobs.cascade` (→ literal `0.16`), `EASE.out`, `useHaptic` (`'medium'` on run, `'selection'` per room, `'success'` on done), `Icon`, `Card`, `ROOMS`, `COPY.run`/`COPY.running`, tokens `--tile-base`, `--accent-2`, `--accent-text`, `--on-accent`, `--gold`.

## 8b. Production landing sites

### Routines "Run now" — `frontend/src/pages/Routines.jsx`

Icon-button row, `:510-517`:
```jsx
            {[
              { onClick: () => onRun(routine),       color: 'var(--ok)',       title: 'Run now', path: <path d="M5 3l14 9-14 9V3z" fill="currentColor" stroke="none"/> },
              { onClick: () => onView(routine),      color: 'var(--ink-mute)', title: 'View',    path: <><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></> },
              { onClick: () => onEdit(routine),      color: 'var(--ink-mute)', title: 'Edit',    path: <><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></> },
              { onClick: () => onDelete(routine.id), color: 'var(--accent)',   title: 'Delete',  path: <><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/></> },
            ].map(({ onClick, color, title, path }) => (
              <button key={title} onClick={onClick} title={title} style={{ background: 'none', border: 'none', cursor: 'pointer', color, padding: 4 }}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">{path}</svg>
              </button>
            ))}
```
Modal footer, `:584-588`:
```jsx
        <button onClick={() => { onRun(routine); onClose?.() }} className="z-btn-secondary" style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
          <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><path d="M5 3l14 9-14 9V3z"/></svg>
          Run now
        </button>
```
The handler, `:680` and `:700`:
```jsx
  const { routines, loading, fetchRoutines, saveRoutine, removeRoutine, runRoutine, loadRoutineConfig } = useAutomationStore()
```
```jsx
  const handleRun    = async r => { try { await runRoutine(r.id) } catch { addToast('Failed to run', 'error') } }
```

**Per-device/per-room feedback that exists: none.** `handleRun` awaits, and on failure toasts `'Failed to run'` (a **hardcoded English string**, not an i18n key). On success it does nothing locally — the only acknowledgement is the WS toast below. The button has **no running/done state**; it is a 13px icon that looks identical before, during and after. `Run now`, `View`, `Edit`, `Delete` are also hardcoded English `title` strings here.

### Actions / AutomationCard Run — `frontend/src/components/automations/AutomationCard.jsx:75-79`

```jsx
  const actions = [
    { onClick: () => onTrigger(automation.id), color: 'var(--ink-mute)', title: t('automations.view.runNow'), path: <path d="M6 4l14 8-14 8V4z" fill="currentColor" stroke="none"/> },
    { onClick: () => onView(automation),       color: 'var(--ink-mute)', title: t('automations.card.view'),  path: <><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></> },
    { onClick: () => onDelete(automation.id),  color: 'var(--err-text)', title: t('common.delete'),          path: <><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/></> },
  ]
```
Card wrapper (already has FLIP + enter/exit), `AutomationCard.jsx:84-92`:
```jsx
    <motion.div layout layoutDependency={layoutKey} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.98 }} transition={T_ENTER} data-automation-id={automation.id}>
      <div style={{
        padding: 12, borderRadius: 'var(--r-card)', background: 'var(--surface)',
        border: `0.5px solid ${hasOfflineDep ? 'color-mix(in srgb, var(--warn) 40%, var(--line))' : 'var(--line)'}`,
        boxShadow: highlighted ? '0 0 0 2px color-mix(in srgb, var(--accent) 55%, transparent)' : 'none',
        transition: 'box-shadow var(--dur-state) var(--ease-standard)',
        display: 'flex', alignItems: 'flex-start', gap: 16,
      }}>
```
Note `data-automation-id={automation.id}` — an existing data-attribute hook on the card, and `highlighted` already drives a deep-link accent ring (`/actions?focus=<id>`, comment at `:27-29`).

`triggerAutomation` call sites, `frontend/src/pages/Actions.jsx:562` and `:739` — **identical inline handlers, duplicated**:
```jsx
                  onTrigger={async id => { try { await triggerAutomation(id); addToast(t('automations.triggered'), 'success') } catch (e) { addToast(e?.userMessage || t('automations.failedToTrigger'), 'error') } }} />
```
```jsx
          onTrigger={async (id) => { try { await triggerAutomation(id); addToast(t('automations.triggered'), 'success') } catch (e) { addToast(e?.userMessage || t('automations.failedToTrigger'), 'error') } }}
```
Store accessor, `Actions.jsx:32`:
```jsx
  const { automations, routines, loading, fetchAutomations, fetchRoutines, addAutomation, removeAutomation, toggleAutomation, triggerAutomation, loadAutomationConfig, saveRoutine } = useAutomationStore()
```
i18n keys: `automations.triggered`, `automations.failedToTrigger`, `automations.view.runNow`, `automations.card.view`.

So **two toasts fire per run**: this immediate optimistic `automations.triggered`, plus the WS `execution_result` toast seconds later. That is the "a toast, then a WS toast seconds later" finding the lab's SectionIntro cites (`Moments.jsx:349`).

Also: `AutomationViewModal.jsx:87-88` is a third Run entry point:
```jsx
          {onTrigger && (
            <button onClick={() => { onTrigger(automation.id); onClose?.() }} className="z-btn-secondary" style={{ flex: 1 }}>
```

### The WS `execution_result` handler — `frontend/src/App.jsx:601-618`

```jsx
    // Automation / routine execution result
    if (last.type === 'execution_result') {
      const { label, ok, steps_total, steps_failed, errors } = last
      if (ok) {
        addToast(i18nT('toast.stepsCompleted', { label, n: steps_total }), 'success')
      } else {
        const detail = errors?.[0] ? `\n${errors[0]}` : ''
        addToast(
          i18nT('toast.stepsFailed', { label, failed: steps_failed, total: steps_total }) + detail,
          'error',
          7000,
        )
      }
    }
```
i18n, `lib/i18n/en.js:2547-2548` / `he.js:2174-2175`:
```js
  'toast.stepsCompleted':   '{label} — {n} step(s) completed',
  'toast.stepsFailed':      '{label} — {failed}/{total} step(s) failed',
```
```js
  'toast.stepsCompleted':   '{label} — {n} שלבים הושלמו',
  'toast.stepsFailed':      '{label} — {failed}/{total} שלבים נכשלו',
```

**This is the single most important finding for pick B.** The payload the backend broadcasts is:

```
{ type: 'execution_result', label, ok, steps_total, steps_failed, errors }
```

There is **no per-step, no per-device and no per-room data in it**, and no ordering. The wave needs `[{room_id | entity_id}, …]` in execution order; the message carries only aggregate counts and an error array. The lab's `ORDER` constant has **nothing to map to** in the current WS contract. This is a backend change (`services`/`core` emit site), not a frontend-only port.

What *does* arrive per-device, and is the only existing mechanism by which a scene run visibly changes the home: the `state_changed` branch at `App.jsx:492-494`:
```jsx
    // Live HA entity state push
    if (last.type === 'state_changed' && last.entity_id) {
      updateEntityState(last.entity_id, last.new_state, last.attributes)
```
inside the batched loop whose rationale is at `:459-466`:
```jsx
  const lastWsSeqRef = useRef(0)
  useEffect(() => {
    // Process EVERY message we haven't handled yet — not just the newest one.
    // A burst (Sync → 7 state_changed at once) coalesces into a single React
    // render; taking only messages[last] dropped the other 6 card updates, so
    // those tiles went stale "if ever". Cursor by monotonic _seq.
    const fresh = messages.filter((m) => (m?._seq ?? 0) > lastWsSeqRef.current)
    if (fresh.length === 0) return
    lastWsSeqRef.current = fresh[fresh.length - 1]._seq
    for (const last of fresh) {
```
**That batching is the second obstacle**: seven `state_changed` messages for a scene arrive as a burst and are deliberately coalesced into one React render, so the tiles all flip in the same frame. A "wave" would need the arrival order preserved and replayed with a 160ms gap — i.e. a client-side queue that deliberately de-coalesces what this loop was written to coalesce.

Dashboard-side feedback: the room tiles that would wave are `Dashboard.jsx` room cards (chips/dot code in §1b; the activity dot at `:504-513` with its comment "same criteria as the greeting's 'N rooms active' count so the two never disagree"). The hero line that would become "Good night" is `statusText` → `dashboard.homeAwake` / `dashboard.homeCalm` at `Dashboard.jsx:1205-1207`, rendered as `<h1 className="z-display">` at `:1252` with **no `AnimatePresence`**.

---

# 9. Moments › ziggy-pill variant **B — "Pill opens into a card"**

## 9a. Lab implementation — `Moments.jsx:295-335`

What the pill **represents** in the lab: six system states, enumerated at `:295`:
```jsx
const PILL_STATES = ['idle', 'listening', 'thinking', 'alert', 'offline', 'undo']
```

Full component — `expanded` (the B behaviour) is `:302`, and the card body is `:323`:

```jsx
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
```

**The pill's copy, per state** (`:300`):

| state | label (en) | label (he) | tone | glyph |
|---|---|---|---|---|
| `idle` | *(none — 36px circle)* | — | `var(--accent)` | `'Z'` |
| `listening` | `Listening…` | `מקשיב…` | `var(--accent)` | 4-bar waveform, `scaleY:[0.3,1,0.3]`, `0.7 + i*0.06`s, `delay: i*0.07`, infinite |
| `thinking` | `Thinking…` | `חושב…` | `var(--accent)` | 12px ring spinner, `rotate:360`, 1.2s linear infinite, `borderTopColor: transparent` |
| `alert` | `Balcony door open · AC on` | `דלת מרפסת פתוחה · מזגן דולק` | `var(--warn)` | `warning` icon, 13px, `strokeWidth 2.5` |
| `offline` | `Reconnecting…` | `מתחבר מחדש…` | `var(--err)` | `wifi-off` icon |
| `undo` | `Living Room lights off` | `אורות הסלון כבו` | `var(--ok)` | `check` icon, `strokeWidth 3`, **plus an inline `Undo` action button** |

**The card content when it opens** (B, only for `alert`): two buttons, `Turn AC off` (`כיבוי מזגן`, filled `var(--warn)` with `#1e1812` text) and `Ignore` (`התעלם`, transparent with `rgba(255,255,255,.25)` border), both `setS('idle')`. They enter `{opacity:0, y:6} → {opacity:1, y:0}` at `0.22s delay 0.14`, after the pill's own layout spring.

**The pill→card morph itself**: one `motion.div` with `layout` inside `LayoutGroup`, spring `{duration:0.5, bounce:0.18}`, flipping six style values at once on `expanded`:
- `borderRadius: 999 → 20`
- `height: 36 → 'auto'`
- `padding: '0 14px 0 8px' → 14`
- `alignItems: 'center' → 'stretch'`
- `flexDirection: 'row' → 'column'`
- avatar `28 → 24` px and `margin: 4 → 0`
with `overflow: 'hidden'`, `maxWidth: 320`, `background: var(--ink)`, `color: var(--bg)`, `boxShadow: var(--shadow-lg)`. The avatar and the label both carry `layout="position"` so they translate rather than stretch.

Registration — `Moments.jsx:391-396`:
```jsx
<Demo id="ziggy-pill" title="Ziggy pill: the system's voice" purpose="One place for every system message: listening, thinking, an alert, offline, undo. It grows to speak and shrinks when done." principles={['continuity', 'hierarchy', 'restraint']} inZiggy={['Toast.jsx', 'ConnectionStatus', 'SubscriptionGateBanner', 'AIChat status pill', 'ChatBubble unread']}
  recommend="B"
  variants={[
    { key: 'A', label: 'Morphing pill', note: 'Width and content morph between states (layout + blur crossfade). The mark becomes a waveform, a spinner, a warning, a check.', render: (p) => <ZiggyPill {...p} variant="A" /> },
    { key: 'B', label: 'Pill opens into a card', note: 'Same pill; an alert that needs a decision expands downward into a small card with actions, then folds back. Dynamic-Island grammar applied to a home.', tradeoff: 'Competes with the top safe-area on phones with a notch; keep it under the status bar.', render: (p) => <ZiggyPill {...p} variant="B" /> },
  ]} />
```

Lab deps: `tx`, `LayoutGroup`/`layout`/`layout="position"` (framer, available), `useHaptic`, `Icon`, `Card`, `ROOMS`, `COPY.undo`/`COPY.lightsOn`/`COPY.allOff`, `.zl-toast__action`, `.zl-btn--pill`, tokens `--accent-3`, `--shadow-lg`, and the hardcoded `#1e1812` on-accent colour (production has `var(--on-accent)`).

## 9b. Production landing sites — what the "real Ziggy pill" actually is today

There is **no single pill**. The lab SectionIntro states it (`Moments.jsx:350`): *"System messages have no single home: 190 error toasts, a fixed subscription strip, a sticky connection banner, a health card."* Here are the surfaces:

### 1. AIChat status pill — `frontend/src/pages/AIChat.jsx:1954-1972`

```jsx
          {/* Top status pill: shows during listening AND post-release stages.
              The dictation itself lives in the LiveUserBubble in the chat;
              this pill is just the steady "what stage am I in" indicator
              (Listening → Transcribing → Thinking → Speaking). */}
          {(listening || transcribing || speaking) && (
            <span className="z-chip" role="status" style={{ minHeight: 40, color: 'var(--ink-mute)', maxWidth: '70vw' }}>
              {listening && <VoiceWave active size={16} />}
              <span
                style={{ fontVariantNumeric: 'tabular-nums', overflow: 'hidden', textOverflow: 'ellipsis',
                         whiteSpace: 'nowrap', minWidth: 0 }}
                dir="auto"
              >
                {listening ? t('chat.listening')
                  : transcribing ? t('chat.transcribing')
                  : orbState === 'thinking' ? t('chat.thinking')
                  : t('chat.speaking')}
              </span>
            </span>
          )}
```

**This is the closest existing analogue to the lab pill, and it is exactly as the brief says: no transition.** A bare `{cond && <span className="z-chip">}` — it appears and disappears in one frame, and the label text swaps in place with no crossfade. Its four states (`chat.listening` / `chat.transcribing` / `chat.thinking` / `chat.speaking`) map onto the lab's `listening` / `thinking`. It already has `role="status"` (which

the lab pill lacks) and `VoiceWave` is the production waveform component, the analogue of the lab's 4-bar `scaleY` loop.

The sibling wake-word chip in the same header row — `AIChat.jsx:1938-1952`:
```jsx
          {wakewordEnabled && !wakeInitFailed && micEnabled !== null && (
            <button
              type="button"
              onClick={onToggleMic}
              className="z-chip"
              aria-pressed={!!micEnabled}
              title={micEnabled
                ? t('chat.wakeOnTitle')
                : t('chat.wakeOffTitle')}
              style={{ minHeight: 40, cursor: 'pointer', fontFamily: 'inherit', color: 'var(--ink-mute)' }}
            >
              <span className="z-dot" aria-hidden="true" style={{ background: micEnabled ? 'var(--ok)' : 'var(--ink-faint)' }} />
              {micEnabled ? t('chat.wakeOn') : t('chat.muted')}
            </button>
          )}
```
i18n keys in play: `chat.listening`, `chat.transcribing`, `chat.thinking`, `chat.speaking`, `chat.wakeOn`, `chat.muted`, `chat.wakeOnTitle`, `chat.wakeOffTitle`, `chat.eyebrow`, `chat.ziggy`.

State fields driving it: `listening`, `transcribing`, `speaking`, `orbState` (`'thinking'` among its values), `micEnabled`, `wakewordEnabled`, `wakeInitFailed`. Rehearsal mode is noted at `AIChat.jsx:569` ("persisted server-side: null until loaded so the pill…").

### 2. The thinking bubble (the `thinking` glyph's real home) — `frontend/src/pages/AIChat.jsx:450-500`

```jsx
      key={i}
      aria-hidden="true"
      style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--ink-mute)', display: 'block' }}
      animate={{ y: [0, -4, 0] }}
      transition={{ duration: 0.8, delay: i * 0.15, repeat: Infinity, ease: 'easeInOut' }}
    />
  ))

  // Generic chat → just the bouncing dots
  if (mode !== 'pro') {
    return (
      <div
        role="status"
        aria-label={`${t('chat.ziggy')} · ${t('chat.thinking')}`}
        style={{ display: 'flex', gap: 8, alignItems: 'flex-start', alignSelf: 'flex-start' }}
      >
        <ZiggyAvatar />
        <div style={{ ...bubbleStyle, gap: 6 }}>{dots}</div>
      </div>
    )
  }

  // Pro Mode → progressive label that cycles through design stages
  const stages = [
    t('chat.proStage.lookingAtHome'),
    t('chat.proStage.checkingSensors'),
    t('chat.proStage.designing'),
    t('chat.proStage.finishing'),
  ]
  return (
    <div
      role="status"
      aria-label={t('chat.ziggy')}
      style={{ display: 'flex', gap: 8, alignItems: 'flex-start', alignSelf: 'flex-start' }}
    >
      <ZiggyAvatar />
      <div className="z-subhead" style={bubbleStyle}>
        <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>{dots}</span>
        <motion.span
          key={stage}
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={T_STATE}
          dir="auto"
        >
          {stages[stage]}
```
The dots loop `y:[0,-4,0]`, `0.8s`, `delay: i*0.15`, infinite — **byte-identical** to the lab's chat `dots` (`Moments.jsx:177`). Pro mode already does a keyed label crossfade with `T_STATE` from `src/lib/motion.js`.

### 3. ChatBubble FAB — `frontend/src/components/chat/ChatBubble.jsx`

Header doc (`:1-21`) — this is the file's own statement of what the FAB represents and what the unread badge means:
```jsx
// Floating chat bubble — phones only.
//
// On a narrow screen the chat has no room to live beside a page the way the
// wide-screen dock does, so it folds into this 56px FAB (ink fill, the
// sparkle in the page colour) above the bottom nav. Tapping it raises the chat as a bottom sheet (ChatSheet) over whatever
// page is open; the conversation itself lives in chatStore, so it is the
// same chat the /chat tab shows, not a second one.
//
// Where it appears: every AppShell route except /chat (the page IS the chat)
// — plus a defensive list of surfaces that never carry it (wall, ops,
// onboarding) should one of them ever be mounted under the shell. On wide
// screens (CHAT_DOCK_QUERY) it never renders: the dock is the phone-free
// answer there, and mounting both would be two live chats.
//
// Unread: a `ziggy_response` push that lands while the sheet is closed bumps
// a badge, so a reply to something asked before closing the sheet (Ziggy was
// still thinking) is not lost. Counting uses the same monotonic `_seq` cursor
// as useChatThreads / App.jsx, primed at mount so the WS buffer's history is
// never counted as new. Opening the sheet — or landing on /chat — clears it.
```

Route gate, `:30-45`:
```jsx
// Routes that carry their own chat (or none at all). Prefix match on a path
// segment boundary, so `/chatter` would not be swallowed by `/chat`.
const HIDDEN_PREFIXES = ['/chat', '/wall', '/ops', '/mobile-onboarding', '/mobile-diagnostics', '/invite', '/welcome', '/login']

export function chatSurfaceHidden(pathname) {
  const p = pathname || '/'
  return HIDDEN_PREFIXES.some((pre) => p === pre || p.startsWith(pre + '/'))
}

// One hook answers "may the phone chat surface exist here?" for both the
// bubble and the sheet, so they can never disagree.
export function useChatSurfaceEligible() {
  const location = useLocation()
  const wide = useMediaQuery(CHAT_DOCK_QUERY)
  return !wide && !chatSurfaceHidden(location.pathname)
}
```

**The proactive-notification surface** — the `ziggy_response` unread counter, `:47-82`:
```jsx
export function ChatBubble() {
  const t = useT()
  const location = useLocation()
  const eligible = useChatSurfaceEligible()
  const open = useChatStore((s) => s.chatSheet)
  const unread = useChatStore((s) => s.chatUnread)
  const setChatSheet = useChatStore((s) => s.setChatSheet)
  const bumpChatUnread = useChatStore((s) => s.bumpChatUnread)
  const clearChatUnread = useChatStore((s) => s.clearChatUnread)

  // Unread counter. `lastSeq` starts null so the first pass only primes the
  // cursor from whatever the buffer already holds.
  const wsMessages = useWsMessages()
  const lastSeq = useRef(null)
  useEffect(() => {
    const list = wsMessages || []
    if (lastSeq.current === null) {
      lastSeq.current = list.reduce((m, x) => Math.max(m, x?._seq ?? 0), 0)
      return
    }
    let fresh = 0
    for (const m of list) {
      if (m?._seq == null || m._seq <= lastSeq.current) continue
      lastSeq.current = m._seq
      if (m.type === 'ziggy_response') fresh += 1
    }
    if (!fresh) return
    // Only a reply nobody is looking at is "unread": the sheet is closed and
    // the page under it is not the chat itself.
    const s = useChatStore.getState()
    if (!s.chatSheet && !chatSurfaceHidden(location.pathname)) bumpChatUnread(fresh)
  }, [wsMessages, location.pathname, bumpChatUnread])

  // Landing on /chat is reading the chat.
  useEffect(() => {
    if (location.pathname === '/chat' || location.pathname.startsWith('/chat/')) clearChatUnread()
  }, [location.pathname, clearChatUnread])
```

The button and badge, `:84-113`:
```jsx
  if (!eligible) return null

  const label = unread > 0
    ? (unread === 1 ? t('chat.bubble.unreadOne') : t('chat.bubble.unread', { n: unread }))
    : t('chat.bubble.open')

  return (
    <button
      type="button"
      className="z-chat-bubble"
      data-testid="chat-bubble"
      data-open={open || undefined}
      aria-label={label}
      title={label}
      aria-expanded={open}
      aria-haspopup="dialog"
      onClick={() => setChatSheet(true)}
    >
      {/* Ziggy's own mark, not a generic sparkle — this is the one button that
          reaches him. `invert` because the bubble is filled with --ink, so its
          artwork opposes the page. Decorative: aria-label above already names
          the button. */}
      <Logo variant="symbol" height={26} tone="invert" decorative />
      {unread > 0 && (
        <span className="z-chat-bubble-badge" data-testid="chat-bubble-badge" aria-hidden="true">
          {unread > 9 ? '9+' : unread}
        </span>
      )}
    </button>
  )
}
```

**Data-attribute hooks on this surface**: `data-testid="chat-bubble"`, `data-testid="chat-bubble-badge"`, `data-open={open || undefined}`. Store fields: `chatSheet`, `chatUnread`, `setChatSheet`, `bumpChatUnread`, `clearChatUnread` on `useChatStore`; `CHAT_DOCK_QUERY` exported from the same store. i18n keys: `chat.bubble.unreadOne`, `chat.bubble.unread`, `chat.bubble.open`. Test coverage exists at `frontend/src/components/chat/__tests__/ChatBubble.test.jsx` — the two `data-testid`s are the selectors, so a port must keep them.

The FAB's existing motion is **all CSS**, `frontend/src/components/chat/chatBubble.css`:
```css
.z-chat-bubble {
  position: fixed;
  inset-inline-end: 16px;
  /* Same floor as the bottom nav's gesture-bar band, plus a 16px breath. */
  inset-block-end: calc(var(--nav-h) + max(var(--safe-bottom), 8px) + 16px);
  width: 56px;
  height: 56px;
  border-radius: 50%;
  …
  background: var(--ink);
  color: var(--bg);
  …
  /* Above page content and the nav bar (z-30); below the More menu (z-40),
     modals (z-40/50), the chat sheet (z-40) and toasts (z-60). */
  z-index: 35;
  box-shadow: var(--shadow-fab);
  …
  transition:
    transform var(--dur-press) var(--ease-standard),
    box-shadow var(--dur-press) var(--ease-standard),
    opacity var(--dur-state) var(--ease-standard);
}
```
```css
.z-chat-bubble:active {
  /* 1px settle + a hair smaller: the button is heard. */
  transform: translateY(1px) scale(0.96);
  box-shadow: var(--shadow-md);
}
```
```css
/* While the sheet is up the bubble steps aside (it would otherwise sit under
   the scrim right where the composer's Send button lands). It comes back as
   the sheet collapses — that is the "sheet folds into the bubble" beat. */
.z-chat-bubble[data-open] {
  opacity: 0;
  transform: scale(0.9);
  pointer-events: none;
}
```
```css
@media (prefers-reduced-motion: reduce) {
  .z-chat-bubble {
    transition: opacity var(--dur-state) var(--ease-standard);
  }
  .z-chat-bubble:active,
  .z-chat-bubble[data-open] {
    transform: none;
  }
}
```

**Two notes that bear directly on the pill→card port:**
1. `background: var(--ink); color: var(--bg)` on the FAB is **the lab pill's exact fill** (`Moments.jsx:307`). Same object, different shape — the FAB is the collapsed pill in all but name, already fixed-positioned with its own z-index band.
2. `z-index: 35` with the documented stacking order (`toasts z-60`, `chat sheet z-40`, `modals z-40/50`). A top-anchored Ziggy pill has to be slotted into that ladder; the lab uses a bare `zIndex: 3` inside its stage, which says nothing.
3. The bubble is **bottom-anchored, inset-inline-end** — the lab pill is **top-centered** (`top: 14, justifyContent: 'center'`), which is the tradeoff note on variant B ("Competes with the top safe-area on phones with a notch").

### 4. ChatSheet — `frontend/src/components/chat/ChatSheet.jsx`

Relevant structural facts for a pill-opens-into-card port (the sheet is the existing "pill opens into something bigger" mechanism):

```jsx
// ── The sheet itself is motion/SheetSurface ─────────────────────────────────
// Presentation — the layer, the backdrop, the panel, the drag, the dismissal
// rules, Escape and the page scroll lock — moved to src/motion/SheetSurface.jsx
// so the device sheet is the same object rather than a second one. Everything
// this file passes down is the chat sheet's own skin and its own chat-specific
// behaviour; none of the resting values changed. What the surface ADDS here,
// and only while `data-motion="on"`:
//   - a backdrop whose opacity follows the finger instead of sitting at 1
//   - velocity projection and the flick rule layered ON TOP of the old
//     distance/velocity dismissal, never replacing it
//   - one detent, equal to today's height. The chat sheet is a fixed-height
//     panel measured against the visual viewport; a second stop would change
//     where it rests, so it has exactly one and rests exactly where it did.
// Deliberately NOT taken: body drag (the body is AIChat, a scroller this file
// does not own — the sheet is dragged by its header, as before) and focus
// restore (new behaviour the chat sheet never had).
```
Imports and constants, `:48-60`:
```jsx
import { useCallback, useEffect, useRef } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { X, Maximize2 } from 'lucide-react'
import { useChatStore } from '../../stores/chatStore'
import { useT } from '../../lib/i18n'
import { ErrorBoundary } from '../ui/ErrorBoundary'
import { SheetSurface } from '../../motion/SheetSurface'
import AIChat from '../../pages/AIChat'
import { useChatSurfaceEligible } from './ChatBubble'

const CLOSE_DISTANCE_PX = 120
const CLOSE_VELOCITY = 600          // px/s — a flick closes regardless of distance

// Pre-JS height (CSS); the measure effect replaces it with pixels.
const PANEL_H_CSS = 'min(calc(72 * var(--vh) / 100), calc(var(--vh) - var(--safe-top) - 48px))'
```
So the production app **already has** a morph-to-surface primitive — `src/motion/SheetSurface.jsx` (25.7KB), gated on `data-motion="on"` — plus `src/motion/morph.js` (17.2KB) and `src/motion/gestures.js` (13.8KB). The lab's `LayoutGroup` + `layout` pill→card is a *second*, simpler morph; the port decision is whether the Ziggy pill reuses `SheetSurface`/`morph.js` or stays a standalone `layout` animation.

### 5. The other system-message surfaces the pill is meant to absorb

Named in the lab's `inZiggy` list (`Moments.jsx:391`) and mounted in `App.jsx`:
```jsx
    {/* Prompt 9 chunk 3 / decision 5: persistent banner shown when the
        relay's billing gate has refused a recent request. Mounted at the
        top so it overlays every route, including mobile-onboarding. */}
    <SubscriptionGateBanner />
    <MobileOnboardingRedirector />
```
Plus the toast channel the pill would replace — `addToast(...)` from `useUIStore`, called from `App.jsx` for `command_failed` (`:528-535`), `ir_command_detected` (`:565`), and `execution_result` (`:601-615`), with the `7000`ms duration override for failures. `ConnectionStatus` is driven by `connected` (passed to `<AppShell connected={connected} />`, `App.jsx:~625`).

The `undo` state in the lab pill has **no production counterpart at all** — there is no undo affordance on any toast; `COPY.undo` exists only in `lab/mock/home.js:82`.

---

# 10. `HeroCascade.jsx` — the two shared primitives

File: `frontend/src/lab/ui/HeroCascade.jsx` (162 lines). Its thesis comment, `:1-7`:
```jsx
// Motion Lab — the opening: one tap, six consequences.
//
// A single tap on a light tile sets off a choreographed chain that shows the
// whole thesis in two seconds: the control hears you, the hub is asked, the
// state arrives, the room learns it, the house changes mood, and the
// feedback grows out of the thing you touched. Off is the same chain with
// faster exits.
```

## 10a. "Room count rolls" — `HeroCascade.jsx:96-102`

```jsx
                  <div className="zl-tile__meta" style={{ display: 'flex', gap: 4 }}>
                    <span style={{ display: 'inline-block', height: 18, overflow: 'hidden', width: 10 }}>
                      <motion.span animate={{ y: `-${roomCount * 18}px` }} transition={tx({ type: 'spring', duration: 0.5, bounce: 0.1 })} style={{ display: 'block' }}><span style={{ display: 'block', height: 18 }}>0</span><span style={{ display: 'block', height: 18 }}>1</span></motion.span>
                    </span>
                    <span>{roomCount === 1 ? t({ en: 'light on', he: 'אור דולק' }) : t({ en: 'lights on', he: 'אורות דולקים' })}</span>
                  </div>
```

This is the **minimal, two-value form** of `RollingNumber` from §1:

- A `10 × 18px` window with `overflow: hidden`.
- The column is literally two hardcoded spans, `0` and `1`, each `height: 18`.
- Translation is in **pixels** (`y: -${roomCount * 18}px`), not `em` — because the cell height is a known 18px line-box, not a font-relative `1em`. `RollingNumber` uses `em`, which is the generalisable form.
- Spring `{type:'spring', duration:0.5, bounce:0.1}` — **slower and bouncier** than `RollingNumber`'s `{duration:0.45, bounce:0.05}`.
- Cell width is `10px` (one digit of the meta type size), vs `RollingNumber`'s `0.6em`.
- The **pluralised label sits outside the rolling window** as its own span and swaps text instantly (`roomCount === 1 ? 'light on' : 'lights on'`). That is the pattern the Dashboard `roomsActiveOne`/`roomsActiveMany` port needs: digit in a roll window, word as a sibling — rather than one interpolated string.

Its driver, `HeroCascade.jsx:43` and `:59`:
```jsx
  const [roomCount, setRoomCount] = useState(0)
```
```jsx
    later(() => { setRoomCount(next ? 1 : 0); setBeat(3) }, next ? BEATS[3].at : 640)
```
and the beat that names its intent, `:20`:
```jsx
  { at: 980, key: 'room', title: 'The room learns it', body: 'The Living Room tile\'s count rolls 0 → 1 and its dot lights. Same object, new fact.', p: 'continuity' },
```

The companion dot on the same tile (the "its dot lights" half), `:91-94`:
```jsx
              <motion.div className="zl-tile zl-room" animate={{ borderColor: roomCount ? 'color-mix(in srgb, var(--accent) 35%, var(--line))' : 'var(--line)' }} style={{ minHeight: 96, marginBottom: 18, cursor: 'default' }}>
                <div className="zl-tile__row"><span className="zl-tile__icon"><Icon name="sofa" /></span>
                  <motion.span animate={{ background: roomCount ? 'var(--ok)' : 'var(--ink-ghost)', scale: roomCount ? [1, 1.5, 1] : 1 }} transition={tx({ duration: 0.36 })} style={{ width: 8, height: 8, borderRadius: 999 }} />
                </div>
```
`scale: [1, 1.5, 1]` over `0.36s` — the dot's own pop. Compare the production room dot, `Dashboard.jsx:506-512`, which has **no animation** but already carries the same resting geometry and an `--ok` glow:
```jsx
    <span style={{
      flexShrink: 0,
      width: 8, height: 8, borderRadius: '50%',
      background: isActiveRoom ? 'var(--ok)' : (photo ? 'rgba(255,255,255,0.3)' : 'var(--line-2)'),
      boxShadow: isActiveRoom ? '0 0 0 3px color-mix(in srgb, var(--ok) 30%, transparent)' : 'none',
    }} />
```

The hero word-swap on the same cascade (the primitive behind "house changes mood"), `:79-83`:
```jsx
                <span style={{ position: 'relative', display: 'inline-grid' }}>
                  <AnimatePresence mode="popLayout" initial={false}>
                    <motion.span key={awake ? 'a' : 'c'} initial={{ opacity: 0, y: 10, filter: 'blur(4px)' }} animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }} exit={{ opacity: 0, y: -10, filter: 'blur(4px)' }} transition={tx({ duration: 0.34, ease: EASE.out })} style={{ color: awake ? 'var(--accent-text)' : 'inherit' }}>{t(title)}</motion.span>
                  </AnimatePresence>
                </span>
```
and the status line under it, `:85-88` — note it is the **`1 room active` / `All quiet` pair**, i.e. literally the Dashboard greeting row:
```jsx
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 18 }}>
                <motion.span animate={{ background: awake ? 'var(--ok)' : 'var(--line-2)', boxShadow: awake ? '0 0 0 3px color-mix(in srgb, var(--ok) 30%, transparent)' : '0 0 0 0px transparent' }} transition={tx({ duration: 0.3 })} style={{ width: 8, height: 8, borderRadius: 999 }} />
                <AnimatePresence mode="popLayout" initial={false}><motion.span key={awake ? '1' : '0'} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={tx({ duration: 0.2 })} className="zl-subhead zl-mute">{awake ? t({ en: '1 room active', he: 'חדר אחד פעיל' }) : t({ en: 'All quiet', he: 'הכל שקט' })}</motion.span></AnimatePresence>
              </div>
```
`boxShadow: '0 0 0 3px color-mix(in srgb, var(--ok) 30%, transparent)'` is **character-identical** to `Dashboard.jsx:511`. The hero dot + line here is a 1:1 motion overlay on `Dashboard.jsx:1253-1266`.

## 10b. "dot → toast layoutId" — `HeroCascade.jsx:106-140`

The shared-element travel, in three parts.

**The group**, `:106`:
```jsx
              <LayoutGroup id="hero-cascade">
```

**The source — the tile's status dot, rendered only while the toast is absent** (`:119`):
```jsx
                      {!toast && <motion.span layoutId="hero-dot" style={{ width: 8, height: 8, borderRadius: 999, background: on ? 'var(--accent)' : 'var(--line-2)' }} />}
```

**The destination — the toast carrying the same `layoutId`** (`:129-139`):
```jsx
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
```

The mechanism, precisely:

1. **`{!toast && …}` / `{toast && …}` are mutually exclusive** — exactly one element with `layoutId="hero-dot"` is mounted at any moment. That is what makes framer treat the swap as one element moving rather than two elements crossfading. Both must be inside the same `LayoutGroup`.
2. The dot is `8×8, borderRadius:999`; the toast is `left:16, right:16, bottom:72, borderRadius:14`. Framer interpolates position, size **and** `borderRadius` 999→14 on a spring `{duration:0.5, bounce:0}` — the dot grows into the bar.
3. **The toast's contents fade in separately and later**: an inner `motion.span` with `{opacity:0} → {opacity:1}`, `0.16s` with `delay: 0.16`. This is the standard shared-element trick — the container morphs first, the text arrives after, so the text never stretches with the box.
4. The toast then carries a **second, static 8px dot** as its leading element (`background: on ? 'var(--ok)' : 'var(--line-2)'`), so the thing that travelled visually "becomes" the dot in the toast.
5. **Exit does not use the layout animation**: `exit={{ opacity: 0, y: 6, transition: {duration: 0.16} }}` — the toast fades up and away, and the tile dot remounts at `!toast`. The travel is one-directional by design.
6. `Undo` calls `fire()` again with `e.stopPropagation()`, re-running the whole cascade in the other direction.

The beat that states the intent, `:22`:
```jsx
  { at: 1420, key: 'toast', title: 'Feedback from the cause', body: 'The tile\'s status dot grows into the confirmation, with Undo. Nothing pops from nowhere.', p: 'continuity' },
```

The choreography that drives both primitives, `:51-67`:
```jsx
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
```
with the timer helpers at `:47-49`:
```jsx
  const timers = useRef([])
  const clear = () => { timers.current.forEach(clearTimeout); timers.current = [] }
  const later = (fn, at) => timers.current.push(setTimeout(fn, ms(at)))
```
and the beat table at `:16-23` (the `at` values are the canonical timings for the whole cascade):
```jsx
const BEATS = [
  { at: 0, key: 'press', title: 'Heard you', body: 'Press feedback under the finger, before any radio answers.', p: 'restraint' },
  { at: 120, key: 'pending', title: 'Asking the hub', body: 'The tile leans toward the new state and a bounded ring draws. Waiting has a shape.', p: 'causality' },
  { at: 760, key: 'arrive', title: 'State arrives', body: 'The hub answers: the tile commits and the bulb\'s rays draw outward. Light spreads from its source.', p: 'state' },
  { at: 980, key: 'room', title: 'The room learns it', body: 'The Living Room tile\'s count rolls 0 → 1 and its dot lights. Same object, new fact.', p: 'continuity' },
  { at: 1200, key: 'house', title: 'The house changes mood', body: 'Only the word that changed moves: calm → awake. The hero line is the home\'s state.', p: 'hierarchy' },
  { at: 1420, key: 'toast', title: 'Feedback from the cause', body: 'The tile\'s status dot grows into the confirmation, with Undo. Nothing pops from nowhere.', p: 'continuity' },
]
```
Note the **asymmetric off path**: turning off uses hardcoded faster timings (`520/640/760/880`, dismiss at `3200`) rather than the `BEATS[].at` values (`760/980/1200/1420`, dismiss at `4200`) — "exit is FASTER than enter", per `src/motion/motion.js:13`.

Lab deps for both primitives: `tx` and `ms` from `useLab()` (`:38-39`), `useHaptic`, `EASE.out`, `Icon`, `COPY.toastLightOn`/`COPY.undo`/`COPY.on`/`COPY.off`/`COPY.greeting`, `Stage` (`./Stage`), `.zl-toast` / `.zl-toast__action` / `.zl-tile` / `.zl-room` / `.zl-nav` from `lab/ziggy/ziggy.css`, `.ml-hero*` / `.ml-beats` / `.ml-beat*` / `.ml-btn` from `lab/lab.css`, and `lab.dir` for `dir={lab.dir}`.

Production counterparts for the travel: there is **no `layoutId` shared-element travel anywhere in the toast path today** — `addToast` from `useUIStore` renders a detached toast with no relationship to the control that caused it. The existing morph machinery that could host it is `src/motion/morph.js` (17.2KB) and `src/motion/SheetSurface.jsx`, both gated on `data-motion="on"` per `src/motion/flag.js`; `src/motion/MotionRoot.jsx` is the provider. The resting toast styles live in the production toast component (the lab's `.zl-toast` is `background: var(--ink)`-on-light / `var(--surface-3)`-on-dark per `lab/ziggy/ziggy.css:97-105`).

---

# Cross-cutting notes for the plan

Three things that affect more than one pick:

1. **`src/motion/motion.js:12-18` forbids what several picks animate.** The stated rules are "transform and opacity only (plus clip-path for reveals)", "no `transition: all`, no animating layout properties", "nothing loops for decoration". Violations in the picked variants: bars/confidence animate `width` (BatteryBar, confidence bar); the pairing blip animates `left`/`top`; the radar sweep and the pairing blips loop infinitely (as does the existing production halo at `PairingWizard.jsx:739-743` and `animate-pulse` at `Devices.jsx:1029`). Each needs an explicit carve-out or a transform rewrite.

2. **`data-motion="on"` gating.** Everything in `src/motion/` is behind the flag (`src/motion/flag.js`, 3.3KB; `motion.js:8-9`: *"Everything is gated on `[data-motion="on"]` (set by ./flag.js), so the untouched app is always one attribute away"*). The ported lab code is **not** currently gated — the picks are inline framer in page components, not in `src/motion/`. Existing in-page call sites already read the flag via `useMotionOn()` (e.g. `Devices.jsx:1821-1822`) and `isMotionOn()` (`DeviceControls.jsx:152`), plus `data-motion-icon` / `data-motion-ring` / `data-pending` attribute hooks (`DeviceCard.jsx:666`, `DeviceControls.jsx:1089`, `Devices.jsx:215`, `Devices.jsx:1019`). The plan should state which side of the flag each port lands on.

3. **Reduced motion.** The lab wraps everything in one `MotionConfig reducedMotion` (`LabContext.jsx:59`). Production has per-call-site `safe()` / `isReduced()` (`motion.js:73-83`) and CSS `@media (prefers-reduced-motion: reduce)` blocks (e.g. the `chatBubble.css` block above). No equivalent of `MotionConfig` is mounted — `src/motion/MotionRoot.jsx` (2.5KB) is the place to check whether one should be.
