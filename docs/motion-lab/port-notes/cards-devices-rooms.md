# Port notes — Cards + Devices + Rooms (extracted 2026-10-10 from feat/motion-lab)

# Motion Lab → production port: code + landing sites

**Lab helper contract (applies to every pick below).** Each lab variant's `render(props)` receives `{ knobs, replayKey, replay, rtl, reduced, speed, tx, ms, stage }` — `frontend/src/lab/ui/Demo.jsx:16` and `:71-72`. Production equivalents:

| Lab helper | Where defined | Production replacement |
|---|---|---|
| `tx(t)` | `frontend/src/lab/LabContext.jsx:52` → `scaleTransition` (`frontend/src/lab/time.js:16-38`) | **Delete the wrapper.** Pass the raw transition object. Lab-only global time-scale. |
| `ms(n)` | `frontend/src/lab/LabContext.jsx:54` (`n / speed`) | **Delete.** Use literal ms in `setTimeout`. |
| `knobs.*` | `Demo` knob sliders | **Inline the chosen constant** (values given per pick). |
| `EASE.out / .enter / .inOut / .drawer` | `frontend/src/lab/time.js:46-55` | `frontend/src/motion/motion.js:20-26` `EASE` (identical arrays) **or** `frontend/src/lib/motion.js:15-16` `EASE_STANDARD`/`EASE_ENTER`. Note `lab EASE.enter === lib/motion EASE_ENTER === [0.16,1,0.3,1]`; `lab EASE.out === motion/motion EASE.out === [0.23,1,0.32,1]`. |
| `useHaptic()` | `frontend/src/lab/LabContext.jsx:79-87` | `haptic(kind)` from `frontend/src/motion/motion.js:104-108` (identical `PATTERNS` map, `:91-99`). |
| `useT()` / `t({en,he})` | `frontend/src/lab/ziggy/primitives.jsx:38-45` | `useT()` from `frontend/src/lib/i18n` + real keys in `lib/i18n/en.js` / `he.js`. |
| `Icon`, `Page`, `Card`, `Button`, `Dot`, `Tile` | `frontend/src/lab/ziggy/primitives.jsx:32-105` | lucide icons directly; `components/ui/Card`, `.z-card`, `.z-chip`, `.z-btn-primary/secondary`, `z-icon-btn`. |
| `.zl-*` classes | `frontend/src/lab/ziggy/ziggy.css` (`.zl-card` :33, `.zl-card--pad` :34, `.zl-tile` :37-53, `.zl-room` :56, `.zl-dot` :58-61, `.zl-toast` :97, `.zl-sheet` :108, `.zl-sheet__grabber` :114, `.zl-backdrop` :115, `.zl-row*` :118-123, `.zl-chip` :126-127, `.zl-grid2` :133, `.zl-stack` :134) | `.z-card` / `.z-chip` / `.z-eyebrow` / `.z-mono` + `frontend/src/motion/motion.css` + `frontend/src/motion/sheet.css` |
| `.ml-hint` | `frontend/src/lab/lab.css:139` | lab-only affordance text — drop. |
| `cssEase(key)` | `frontend/src/lab/time.js:68-71` | `CSS_EASE` in `frontend/src/motion/motion.js:28-34`, or the `--m-*` vars in `motion.css:26-36`. |
| `var(--lab-speed,1)` in inline CSS transitions | lab only | `var(--dur-state)` / `var(--dur-press)` / `var(--dur-enter)` |

Everything in the production motion layer is gated on `[data-motion="on"]` (`frontend/src/motion/flag.js`, read in components via `useMotionOn()` / `isMotionOn()`). **Every port must respect the "inline transition outranks the stylesheet" trap** documented at `frontend/src/components/device/DeviceCard.jsx:462-466`, `frontend/src/pages/Dashboard.jsx:339-344`, `frontend/src/pages/Devices.jsx:1904-1913`.

---

# CARDS

## Pick 1 — `card-expand` variant C "Layered depth" (0.42 / bounce 0.18 / stagger 0.05)

### 1a. Lab implementation

Knob declaration — `frontend/src/lab/sections/Cards.jsx:587-591`:
```jsx
        knobs={[
          { key: 'duration', label: 'Duration', min: 0.15, max: 0.9, step: 0.02, value: 0.42, unit: 'ms' },
          { key: 'bounce', label: 'Bounce (B)', min: 0, max: 0.4, step: 0.02, value: 0.18 },
          { key: 'stagger', label: 'Stagger (D)', min: 0, max: 0.12, step: 0.01, value: 0.05, unit: 'ms' },
        ]}
```
Variant C entry — `frontend/src/lab/sections/Cards.jsx:596`:
```jsx
          { key: 'C', label: 'Layered depth', note: 'The open card lifts (scale 1.02 + shadow) and the others recede and dim. Hierarchy: this one matters now.', tradeoff: 'Dimming siblings costs a paint on each; fine for ≤10 cards.', render: (p) => <ExpandC {...p} /> },
```
**NOTE:** `ExpandC` hard-codes `bounce: 0` — the `bounce 0.18` knob is only read by `ExpandB` (`:62`). Variant C at 0.42 is a **spring duration 0.42, bounce 0**. The `stagger 0.05` knob is only read by `ExpandD` (`:118`). Per the `Demo` note at `:597`, C "composes with D" — if the owner wants the stagger too, D's choreography block must be merged in.

`ExpandC` verbatim — `frontend/src/lab/sections/Cards.jsx:79-101`:
```jsx
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
```
The head (with chevron rotation) and the body it expands — `Cards.jsx:21-40`:
```jsx
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
```
Severity colour map — `Cards.jsx:19`: `const SEV = { critical: 'var(--err)', warning: 'var(--warn)', info: 'var(--info)' }`

Lab deps: `useT`, `useHaptic`, `tx`, `Page`, `Icon`, `Button`, `.zl-card`, `.zl-card--pad`, `.zl-stack`, `.zl-row__icon`, `.zl-row__title`, `.zl-footnote`, `.zl-mute`, `.zl-mono`, `.zl-subhead`, `.zl-hstack`.

### 1b. Production landing site

**There is no expanding anomaly card today.** The lab's `ALERTS` list maps onto `AnomalyCard`, which has an identical structure (3px `borderInlineStart` severity bar, tinted 36px icon box, title, mono meta strip, actions row) **but no `open` state and no body.** That is the main port cost: a `details`/`reasoning` body + a disclosure control must be added.

`frontend/src/pages/Anomalies.jsx:215-254` — the card root that must gain `animate={{scale, opacity, boxShadow, zIndex}}` + `onClick`:
```jsx
function AnomalyCard({ anomaly, roomId, roomName, variant = 'active', onChange }) {
  const sev       = anomaly.severity || 'warning'
  const color     = SEV_COLOR[sev] || SEV_COLOR.warning
  const textColor = SEV_TEXT[sev] || SEV_TEXT.warning
  const room      = humanRoom(roomId, roomName)
  const ruleId    = anomaly.rule_id
  ...
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.97 }}
      transition={T_ENTER}
      style={{
        display: 'flex', gap: 12, padding: 12, borderRadius: 'var(--r-card)', minHeight: 48,
        background: 'var(--surface)', border: '0.5px solid var(--line)',
        borderInlineStart: `3px solid ${cleared ? 'var(--line-2)' : color}`,
      }}
    >
```
- `animate` is already occupied by the entrance (`{opacity:1,y:0}`) — the port must merge `scale`/`opacity`/`boxShadow`/`zIndex` into that same object, not add a second `animate`.
- `transition={T_ENTER}` (`frontend/src/lib/motion.js:22` = `{duration:0.24, ease:[0.16,1,0.3,1]}`) must become `{type:'spring', duration:0.42, bounce:0}`.
- `style` has no `position:'relative'` and no `overflow:'hidden'` — both are required by `ExpandC`.
- Severity tokens already match the lab's: `frontend/src/pages/Anomalies.jsx:51-52`:
```jsx
const SEV_COLOR = { critical: 'var(--err)', warning: 'var(--warn)', info: 'var(--info)' }
const SEV_TEXT  = { critical: 'var(--err-text)', warning: 'var(--warn-text)', info: 'var(--ink-2)' }
```
- The icon box that becomes `AlertHead`'s `.zl-row__icon` — `Anomalies.jsx:256-268`.
- The meta strip (`ANOM-06 · 2h ago · Living Room`) — `Anomalies.jsx:290-305`, built at `:232-237`.
- The actions row that becomes `AlertBody` (`SnoozeMenu` + `ActionButton`) — `Anomalies.jsx:307-330`; `SnoozeMenu` at `:109-177`, `ActionButton` at `:182-210`.
- "Siblings dim" requires the siblings to be in one list: both section lists are at `Anomalies.jsx:548-589` (`needsAttention` `:553-569`, `info`/`earlierToday` `:570-586`). The open-card state has to be hoisted to the page so a card in `needsAttention` can dim a card in `earlierToday`, or ExpandC's dimming is per-section only.
- `AnomalyCard` is also reused with `variant="history"` (`Anomalies.jsx:613-625`) — history cards are **not** inside an `AnimatePresence` and have no `onChange`; decide whether they expand too.

**The other two surfaces the lab's `inZiggy` names:**
- `frontend/src/components/automations/templates/SuggestedTab.jsx:56-91` — `SuggestionCard` (canonical). Also `layout` + `initial/animate/exit` + `T_ENTER`, also **no expand**: `:57-59`
```jsx
    <motion.div layout layoutDependency={layoutKey} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.97 }} transition={T_ENTER}
      style={{ padding: 12, borderRadius: 'var(--r-card)', background: 'var(--surface)', border: '0.5px solid var(--line)', color: isPending ? 'var(--ink)' : 'var(--ink-mute)' }}
    >
```
- `frontend/src/pages/Suggestions.jsx` — **LEGACY** (banner at `:1-7`: "do not extend this page"). It *does* have the expand the lab variant describes, at `Suggestions.jsx:116-175`, with the production disclosure being a height tween, not a spring — `:126-129`:
```jsx
          <AnimatePresence>
            {expanded && (
              <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} transition={T_STATE} style={{ overflow: 'hidden' }}>
                <div style={{ marginTop: 4, paddingInlineStart: 12, borderInlineStart: '2px solid var(--line)', display: 'flex', flexDirection: 'column', gap: 8 }}>
```
with its chevron at `Suggestions.jsx:123`:
```jsx
            <ChevronRight size={16} strokeWidth={1.75} aria-hidden="true" style={{ transform: expanded ? 'rotate(90deg)' : 'none', transition: 'transform var(--dur-state) var(--ease-standard)' }} />
```
Note this is a 90° ChevronRight, not the lab's 180° chevron, and it uses a raw inline `transition` instead of the `[data-motion-chevron]` hook (`motion.css:260-261`).

The third `inZiggy` site, `Devices.jsx "Show controls"`, is pick 6 below.

---

## Pick 2 — `list-remove` variant E "Absorbed by the count" (0.4)

### 2a. Lab implementation

Knob — `frontend/src/lab/sections/Cards.jsx:603`:
```jsx
        knobs={[{ key: 'duration', label: 'Gap-close duration (B, D, E)', min: 0.15, max: 0.8, step: 0.02, value: 0.4, unit: 'ms' }]}
```
Variant E entry (carries the authoritative spec string) — `Cards.jsx:610`:
```jsx
          { key: 'E', label: 'Absorbed by the count', note: 'The row shrinks (scale → 0.3, opacity → 0) toward the section\'s count badge (its transform-origin is measured to the badge\'s centre each layout), then the badge squashes and rolls down by one; an insert grows out of the badge and the count rolls up. Continuity to the number: the row did not vanish, it became part of the count.', tradeoff: 'Needs a visible count in the header, and the origin measurement runs on every layout (cheap for ≤20 rows).', spec: (k) => `shrink 300 ms ease-out · gap ${Math.round(k.duration * 1000)} ms +100 ms · badge 320 ms`, render: (p) => <ListE {...p} /> },
```
`AbsorbRow` — the measured transform-origin — `Cards.jsx:310-327`:
```jsx
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
```
`ListE` — the badge squash + digit roll + direction — `Cards.jsx:329-358`:
```jsx
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
```
Lab deps beyond the table: `useMotionValue`, `useLayoutEffect`, and `animate()` **imperatively on a DOM node** (`framer-motion`'s `animate(element, keyframes, options)`) — `Cards.jsx:4` imports `animate`. Also `useAlertList` (`Cards.jsx:201-207`) and `ListFrame` (`:209-216`) are lab-only scaffolding.

### 2b. Production landing sites — and the count element to absorb into

**(i) Anomalies.jsx snooze / action removal.** The cards: `Anomalies.jsx:556-567` and `:573-584`. Removal is **not local state** — it is a full refetch:

`Anomalies.jsx:425-428`:
```jsx
  const refreshAfterChange = useCallback(() => {
    loadActive()
    if (tab === 'history') loadHistory()
  }, [tab, loadActive, loadHistory])
```
called from `SnoozeMenu.doSnooze` (`Anomalies.jsx:114-126`, `onSnoozed()` at `:120`) and `ActionButton.run` (`:188-203`, `onDone()` at `:194`). **The card therefore only leaves after `getActiveAnomalies()` returns** — the lab's exit never starts on the tap. This is the lab's own "found" note, `Cards.jsx:578`.

**The count elements available to absorb into, in priority order:**

1. The tab label count — `Anomalies.jsx:480-484`:
```jsx
  const tabs = [
    { id: 'active',  label: t('anomaliesPage.tabAll', { n: activeList.length || 0 }) },
    { id: 'history', label: t('anomaliesPage.tabHistory') },
    { id: 'rules',   label: t('anomaliesPage.tabRules') },
  ]
```
rendered at `Anomalies.jsx:510-522`. This is a plain string inside the segmented pill — there is **no DOM node wrapping just the number**, so `badgeRef` has nothing to measure. A `<span>` around `{n}` must be added.

2. The header eyebrow count — `Anomalies.jsx:492-494`:
```jsx
          <p className="z-eyebrow">
            {t('anomaliesPage.today')}{criticalCount + warningCount > 0 ? t('anomaliesPage.needAttentionCount', { n: criticalCount + warningCount }) : ''}
          </p>
```
computed at `Anomalies.jsx:477-478`:
```jsx
  const criticalCount = activeList.filter(a => a.severity === 'critical').length
  const warningCount  = activeList.filter(a => a.severity === 'warning').length
```
3. The section eyebrows themselves have **no count at all** — `Anomalies.jsx:555` (`needsAttention`) and `:572` (`earlierToday`):
```jsx
                    <p className="z-eyebrow" style={{ marginBottom: 4 }}>{t('anomaliesPage.needsAttention')}</p>
...
                    <p className="z-eyebrow" style={{ marginBottom: 4, marginTop: needsAttention.length > 0 ? 8 : 0 }}>{t('anomaliesPage.earlierToday')}</p>
```
The lab's header is a flex row with an uppercase eyebrow + a right-aligned pill badge (`Cards.jsx:345-352`); to port it, these two `<p>`s must become that row, with `needsAttention.length` / `info.length` in a badge span (`:549-550`).

**(ii) Tasks.jsx task done.** `frontend/src/pages/Tasks.jsx:84-86` (the row), `:320-322` (the tree), `:346` (the mutation):
```jsx
  const handleToggle      = async (task) => { try { await update(task.id, { done: !(task.done || task.completed) }) } catch { addToast(t('tasks.failedToUpdate'), 'error') } }
```
Tasks **already has a per-group count node** — this is the best-matched landing site in the app. `Tasks.jsx:310-326`:
```jsx
function TaskGroup({ label, count, tint, tasks, ...rowProps }) {
  if (!tasks.length) return null
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <span style={{ width: 4, height: 14, borderRadius: 2, background: tint, flexShrink: 0 }} />
        <p className="z-eyebrow">{label}</p>
        <span style={{ fontSize: 12, color: 'var(--ink-mute)', fontVariantNumeric: 'tabular-nums', marginInlineStart: 'auto' }}>{count}</span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <AnimatePresence mode="popLayout">
          {tasks.map(t => <TaskRow key={t.id || t.task} task={t} {...rowProps} />)}
        </AnimatePresence>
      </div>
    </div>
  )
}
```
`Tasks.jsx:317` is **the absorb target**: it already has `tabular-nums`, is `marginInlineStart:'auto'` (so it sits where the lab badge sits), and `count` is a prop (`Tasks.jsx:437-439`). It needs a `ref`, the `scale:[1,1.25,1]` squash, and an `AnimatePresence mode="popLayout"` digit roll. The three call sites:
```jsx
              <TaskGroup label={t('tasks.today')} count={todayTasks.length} tint="var(--ink)" tasks={todayTasks} {...rowProps} />
              <TaskGroup label={t('tasks.thisWeek')} count={weekTasks.length} tint="var(--warn)" tasks={weekTasks} {...rowProps} />
              <TaskGroup label={t('tasks.laterNoDate')} count={laterTasks.length} tint="var(--line-2)" tasks={laterTasks} {...rowProps} />
```
Secondary count: the page header `pendingCount`, `Tasks.jsx:373` + `:384-389`:
```jsx
  const pendingCount = tasks.filter(t => !t.done && !t.completed).length
...
          <h1 className="z-display" style={{ margin: 0 }}>
            {pendingCount > 0 ? t('tasks.pendingHeader', { n: pendingCount }) : t('tasks.allClear')}
          </h1>
          <p className="z-footnote" style={{ fontVariantNumeric: 'tabular-nums' }}>
            {t('tasks.totalCount', { n: tasks.length })}
          </p>
```
The current row exit is `exit={{ opacity: 0, x: -16 }}` (`Tasks.jsx:85`) — a horizontal slide, which the absorb replaces with `scale:0.3 → transformOrigin: <badge centre>`. The `AnimatePresence mode="popLayout"` at `:320` must become plain `AnimatePresence` (the lab wraps each row in its own height-collapsing outer div instead; `popLayout` would fight `AbsorbRow`'s outer height animation).

**(iii) Suggestions accept/reject.** Canonical: `SuggestedTab.jsx:196-201` — and its **stat counts are chips on the sub-tabs**, `SuggestedTab.jsx:171-176`:
```jsx
          {[{ id: 'pending', label: t('automations.suggested.pending'), count: pending.length }, { id: 'history', label: t('automations.suggested.history') }].map(tab => (
            <button key={tab.id} onClick={() => setSubtab(tab.id)} aria-pressed={subtab === tab.id} style={chipStyle(subtab === tab.id)}>
              {tab.label}
              {tab.count > 0 && <span className="z-chip z-mono" style={{ padding: '0 8px', lineHeight: '22px' }}>{tab.count}</span>}
            </button>
          ))}
```
`<span className="z-chip z-mono">` at `:174` is already a measurable badge node — the cleanest absorb target in the whole app. Identical markup on the legacy page, `Suggestions.jsx:288-292`.

The legacy page also carries the **full stat strip** the pick mentions — `Suggestions.jsx:261-276`:
```jsx
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
`<p className="z-title z-mono">` at `:271` is the per-status count node. Accept/reject mutations: `Suggestions.jsx:224-226`. Note the lab absorbs **toward one badge**; accept and reject land in *different* stat cells, which is extra information the lab variant does not model.

`SuggestedTab.jsx` also carries an explicit `layoutKey` contract that the port must preserve — `SuggestedTab.jsx:150-152`:
```jsx
            // FLIP only when a card leaves (reject / snooze): `pending.length`
            // moves, the next one glides up. See `layoutKey` in Actions.jsx.
            <SuggestionCard key={s.id} suggestion={s} layoutKey={pending.length} onConfigure={() => onConfigure(s)} onReject={() => onReject(s.id)} onSnooze={(days) => onSnooze(s.id, days)} />
```

---

## Pick 3 — `travel` variant B "Shared layoutId travel" (0.5)

### 3a. Lab implementation

Knob + entry — `frontend/src/lab/sections/Cards.jsx:627` / `:631`:
```jsx
        knobs={[{ key: 'duration', label: 'Travel duration', min: 0.2, max: 1, step: 0.02, value: 0.5, unit: 'ms' }]}
...
          { key: 'B', label: 'Shared layoutId travel', note: 'Recommended. The same row (layoutId) flies from To do to Done; the check springs in first, the travel follows. The count rolls. It stays the pick: one object, one move, nothing to learn.', render: (p) => <TravelDemo {...p} variant="B" /> },
```
`TravelDemo` — A and B are the same component; `variant` only changes `layoutId` and the `AnimatePresence mode`. `Cards.jsx:470-491`:
```jsx
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
```
`TaskRow` — a `forwardRef`, with `layout` **and** `layoutId`, and the check that springs in — `Cards.jsx:459-468`:
```jsx
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
```
Three load-bearing details for the port:
1. `LayoutGroup id` wrapping **both** sections (`Cards.jsx:485`) — without it the `layoutId` hand-off has no shared context.
2. `AnimatePresence mode="sync"` (not `popLayout`) for variant B (`Cards.jsx:478`) — `popLayout` takes the exiting node out of flow and breaks the travel.
3. `TravelC`'s comment at `Cards.jsx:517` documents a trap that applies to B too:
```jsx
  // plain render helpers (not components): a component defined in render would remount and break the layoutId hand-off
```
…yet `TravelDemo` **does** define `Section` inside render (`:475`). That works only because `TaskRow` (the `layoutId` holder) is module-level. In the port, the section component must be module-level or the rows must not be re-created.

Lab data: `TASKS` at `Cards.jsx:452-457`.

### 3b. Production landing sites

**(i) Tasks.jsx To do → Done.** `handleToggle` at `Tasks.jsx:346`. The two trees:

Grouped (pending) view — `Tasks.jsx:433-451`:
```jsx
      {!loading && groupedView && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
          {(todayTasks.length > 0 || weekTasks.length > 0 || laterTasks.length > 0) ? (
            <>
              <TaskGroup label={t('tasks.today')} count={todayTasks.length} tint="var(--ink)" tasks={todayTasks} {...rowProps} />
              <TaskGroup label={t('tasks.thisWeek')} count={weekTasks.length} tint="var(--warn)" tasks={weekTasks} {...rowProps} />
              <TaskGroup label={t('tasks.laterNoDate')} count={laterTasks.length} tint="var(--line-2)" tasks={laterTasks} {...rowProps} />
            </>
          ) : (
            filtered.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <AnimatePresence mode="popLayout">
                  {filtered.map(t => <TaskRow key={t.id || t.task} task={t} {...rowProps} />)}
                </AnimatePresence>
              </div>
            )
          )}
        </div>
      )}
```
Done view — `Tasks.jsx:453-460`:
```jsx
      {/* Done view — flat list */}
      {!loading && !groupedView && done.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <AnimatePresence mode="popLayout">
            {done.map(t => <TaskRow key={t.id || t.task} task={t} {...rowProps} />)}
          </AnimatePresence>
        </div>
      )}
```
**Blocker, must be in the plan:** these two are **mutually exclusive by filter**, not two sections on one screen. `Tasks.jsx:371`:
```jsx
  const groupedView = filter !== 'done'
```
and the bucketing at `Tasks.jsx:365-370`:
```jsx
  const pending = filtered.filter(t => !(t.done || t.completed))
  const done    = filtered.filter(t => t.done || t.completed)

  const todayTasks  = pending.filter(t => t.due && new Date(t.due) <= todayEnd)
  const weekTasks   = pending.filter(t => t.due && new Date(t.due) > todayEnd && new Date(t.due) <= weekEnd)
  const laterTasks  = pending.filter(t => !t.due || new Date(t.due) > weekEnd)
```
With `filter === 'all'` the Done list is **not rendered at all** (the `done` block requires `!groupedView`), so a ticked task vanishes with no destination on screen. Travel B requires either a 4th `TaskGroup` for Done under `groupedView`, or `filter === 'all'` to render both trees. The travel that *does* exist today is **Today ↔ This Week ↔ Later** when a due date changes — three `TaskGroup`s, three separate `AnimatePresence mode="popLayout"` trees, no `LayoutGroup`, no `layoutId`.

`TaskRow` is already a `forwardRef` with `layout` (`Tasks.jsx:69`, `:82-86`) — it needs `layoutId={`task-${task.id}`}`, a `LayoutGroup` around the groups container (`Tasks.jsx:434`), the `mode="popLayout"` → `"sync"` change at `:320`, and the exit `{opacity:0, x:-16}` (`:85`) replaced with a plain opacity. The check button that should spring — `Tasks.jsx:97-116`, with the current hard glyph swap at `:114`:
```jsx
            {isDone && <ZIcon name="check" size={14} />}
```
inside a span whose only animation is a CSS colour tween, `:112`:
```jsx
            transition: 'background var(--dur-state) var(--ease-standard), border-color var(--dur-state) var(--ease-standard)',
```

**(ii) Anomalies needsAttention ↔ earlierToday.** `Anomalies.jsx:548-589`. The split is by severity:
```jsx
            const needsAttention = activeList.filter(a => a.severity === 'critical' || a.severity === 'warning')
            const info           = activeList.filter(a => a.severity === 'info')
```
Two sibling `AnimatePresence mode="popLayout"` trees (`:556` and `:573`), stable keys `` `${a._roomId}:${a.rule_id}` `` (`:559`, `:577`) — so a `layoutId` can reuse that key. No `LayoutGroup`. Travel happens when the engine downgrades a severity, and because of `refreshAfterChange` / the WS handler (`Anomalies.jsx:406-420`) the whole `active` object is replaced, so React unmounts/remounts — `layoutId` with a stable key is exactly what makes that survivable.

**(iii) Suggestions Pending ↔ History.** `SuggestedTab.jsx:163-165`:
```jsx
  const pending = suggestions.filter(s => s.status === 'pending')
  const history = suggestions.filter(s => s.status !== 'pending')
  const displayed = subtab === 'pending' ? pending : history
```
Only **one** of the two is ever mounted (`:197` renders `displayed`), so there is no cross-container travel to animate — the port has to make them two visible sections, or this pick does not apply. Same shape on the legacy page (`Suggestions.jsx:221-222`, `:237`, `:324-338`). `SuggestionCard` has `layout layoutDependency={layoutKey}` (`SuggestedTab.jsx:57`); adding `layoutId` must not break the deliberate `layoutDependency` gating at `:150-152`.

---

# DEVICES

## Pick 4 — `origin` variant C "Bulb rays draw" (0.6)

### 4a. Lab implementation

Knob + entry — `frontend/src/lab/sections/Devices.jsx:694` / `:699`:
```jsx
        knobs={[{ key: 'duration', label: 'Ring / bloom duration', min: 0.2, max: 1, step: 0.02, value: 0.6, unit: 'ms' }]}
...
          { key: 'C', label: 'Bulb rays draw', note: 'The bulb glyph grows 8% and six rays draw outward (pathLength) as it comes on; off retracts them in 140ms. The icon itself carries the state.', render: (p) => <OriginC {...p} /> },
```
**NOTE:** the `duration` knob (0.6) is read by `OriginB` only (`Devices.jsx:76`). `OriginC`/`BulbRays` hard-code their own timings: `0.32s` on, `0.14s` off, `0.08 + i*0.02` per-ray delay, and a `spring duration 0.4 bounce 0.3` on the glyph scale.

`BulbRays` — `frontend/src/lab/sections/Devices.jsx:92-104`:
```jsx
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
```
`OriginC` — `Devices.jsx:106-119`:
```jsx
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
```
`BaseTile` — `Devices.jsx:46-54`; `useOriginState` (the `tick` counter that re-keys the rays) — `Devices.jsx:36-44`:
```jsx
function useOriginState() {
  const [on, setOn] = useState(false)
  const [origin, setOrigin] = useState(null) // 'local' | 'remote'
  const [by, setBy] = useState(null) // null | 'wall' | a PEOPLE entry
  const [tick, setTick] = useState(0)
  const local = () => { setOrigin('local'); setBy(null); setOn(v => !v); setTick(k => k + 1) }
  const remote = (who = 'wall') => { setOrigin('remote'); setBy(who); setOn(v => !v); setTick(k => k + 1) }
  return { on, origin, by, tick, local, remote }
}
```
Lab deps: `cssEase` (`lab/time.js:68`), `.zl-tile__icon`, `COPY` from `lab/mock/home`, `Icon`, `OriginFrame` (`Devices.jsx:22-34`, lab-only trigger buttons).

### 4b. What "origin" signal variant C expects

**Variant C expects none.** `OriginC` reads only `s.on` and `s.tick` — it never touches `s.origin` or `s.by`. It is the *one* origin variant that is purely a state-change glyph and needs **no WS origin whatsoever**. (`OriginB` reads `s.origin === 'remote'`; `OriginE` reads `s.by` for initials; `OriginF` reads `s.origin`. The lab says so explicitly at `Devices.jsx:698`: *"Needs the WS event to carry an origin (context.user_id / physical)"* for B, and at `:701` for E: *"Needs the WS event to carry context.user_id"*.)

So variant C ports with **zero backend change**, and it replaces/augments the existing ignition keyframe rather than adding an origin channel.

**Does the WS payload carry an origin today? No.** `services/ha_subscriber.py:283-288` — the entire `state_changed` broadcast payload:
```python
        await manager.broadcast({
            "type": "state_changed",
            "entity_id": entity_id,
            "new_state": new_s,
            "attributes": attrs,
        })
```
`grep -n '"context"\|user_id\|parent_id\|origin'` over `services/ha_subscriber.py` and `backend/ws_manager.py` → **no matches.** HA's own event does carry `event.context.{id,user_id,parent_id}`, but `_handle_state_changed` only reads `event.event.data` (`ha_subscriber.py:235-238`):
```python
    data = event.get("event", {}).get("data", {})
    entity_id = data.get("entity_id")
    raw_new_state = data.get("new_state")
    raw_old_state = data.get("old_state")
```
`backend/ws_manager.py:103-123` just fans the dict out verbatim.

There **is** a server-side origin signal already computed, just not broadcast — `services/manual_overrides.py` (`was_ziggy_initiated` :125, `was_recent_ziggy_write` :160, `mark_manual` :175), consumed at `ha_subscriber.py:292-312`:
```python
        if prev_s and new_s and prev_s != new_s:
            domain = entity_id.split(".", 1)[0]
            # Out-of-band only: a change with ANY recent Ziggy write behind it
            # (engine, UI tap, chat, voice) is Ziggy acting, not the user
            # bypassing Ziggy — it must not lock the entity for 30 minutes.
            if (domain in CONTROLLABLE_DOMAINS
                    and not was_ziggy_initiated(entity_id)
                    and not was_recent_ziggy_write(entity_id)):
                mark_manual(entity_id)
```
That boolean is the cheapest path to an `origin: "ziggy" | "external"` field for variants B/E/F; it does **not** distinguish *which person*.

### 4c. Production landing sites for variant C

**WS dispatch (unchanged by this pick, but it is the cause):** `frontend/src/App.jsx:490-491`:
```jsx
    if (last.type === 'state_changed' && last.entity_id) {
      updateEntityState(last.entity_id, last.new_state, last.attributes)
```
inside the cursor loop `App.jsx:458-467`. Store reducer: `frontend/src/stores/deviceStore.js:602-650` (fast-path at `:610-615`, entity patch at `:619-621`, `ziggyRooms` patch at `:626-646`).

**The thing being replaced** — the current ignition, `frontend/src/motion/motion.css:99-108`:
```css
/* Ignition: the icon blooms once as the device comes on. 6% overshoot on
 * scale only — the same curve Lumen uses for a light well igniting. */
[data-motion="on"] [data-on="true"] [data-motion-icon] {
  animation: zm-ignite 360ms var(--m-out) backwards;
}
@keyframes zm-ignite {
  0%   { transform: scale(0.94); }
  60%  { transform: scale(1.06); }
  100% { transform: scale(1); }
}
```
with its reduced-motion kills at `motion.css:345` and `:373`.

**Every `data-motion-icon` box (the ray host):**

| file:line | element | icon |
|---|---|---|
| `components/device/DeviceCard.jsx:472-479` | `TileCard` icon box, `iconBoxSize`, `borderRadius:'var(--r-ctl)'` | `<KindIcon kind={facts.kind} size={iconSize} />` |
| `components/device/DeviceCard.jsx:550-557` | `RowCard` 40×40 icon box | `<KindIcon kind={facts.kind} size={19} />` |
| `components/device/DeviceCard.jsx:667-669` | `CompactCard` bare span (no box) | `<KindIcon kind={facts.kind} size={16} />` |
| `pages/Dashboard.jsx:350-357` | pinned-grid tile, 32×32 | `<DeviceIcon kind={facts.kind} size={18} fill />` |
| `pages/Devices.jsx:1922-1936` | `DeviceCard` header, 40×40, `borderRadius:12` | `<DeviceIcon kind={getKind(entity)} customIcon={entity.icon} size={21} fill />` |
| `pages/Devices.jsx:997-999` | IR device card, `w-9 h-9 rounded-xl bg-accent/15` | `<Icon className="w-4 h-4 text-accent" />` |
| `pages/Devices.jsx:1234-1242` | `SmartSensorCard`, 40×40 | `<Sparkles size={18} strokeWidth={2.2} />` |

Verbatim, the two the pick names first — `DeviceCard.jsx:472-479`:
```jsx
      <div data-motion-icon style={{
        width: iconBoxSize, height: iconBoxSize, borderRadius: 'var(--r-ctl)',
        background: iconBg,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: iconColor,
      }}>
        <KindIcon kind={facts.kind} size={iconSize} />
      </div>
```
`Dashboard.jsx:350-357`:
```jsx
      <span data-motion-icon="" style={{
        width: 32, height: 32, borderRadius: 'var(--r-ctl)', flexShrink: 0,
        background: iconBg, color: iconColor,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        lineHeight: 1,
      }} aria-hidden="true">
        <DeviceIcon kind={facts.kind} size={18} fill />
      </span>
```
`Devices.jsx:1922-1928`:
```jsx
          <div data-motion-icon style={{
            width: 40, height: 40, borderRadius: 12, fontSize: 21,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            position: 'relative',
            background: isActive ? 'var(--ink)' : 'var(--surface-2)',
            color: isActive ? 'var(--bg)' : 'var(--ink)',
          }}>
```

**Three port constraints:**
1. Rays need `overflow: visible` on the icon box and the tile. Every box above is `overflow` default (visible) **but** `.z-card` and `TileCard` clip: `DeviceCard.jsx:454-470` has no `overflow`, however `Devices.jsx:1917` and the `Card` wrapper may; `SheetSurface`'s `.z-msheet` is `overflow:hidden` (`sheet.css:54`). Verify per surface.
2. The rays are keyed on `tick` to replay (`Devices.jsx:99`). Production has **no change counter** — `data-on` flips and CSS `animation` replays only because the selector re-matches. For a framer `pathLength` port, either keep it in CSS (`stroke-dasharray`/`stroke-dashoffset` keyframes on a sibling `<svg>` under the same `[data-on="true"] [data-motion-icon]` selector, which replays for free), or add a render-counter ref next to `pending` in `DeviceCardImpl` (`DeviceCard.jsx:693`).
3. The glyph is a lucide component (`KindIcon` → `DeviceIcon`, `DeviceCard.jsx:85`), not an inline `<svg>` — rays must be a separate absolutely-positioned `<svg>` sibling, as the lab does (`Devices.jsx:96`, `position:'absolute', inset:0`). The lab's `strokeWidth` swap (`1.9 → 2.2`, `Devices.jsx:112`) is a prop on `Icon`; `DeviceIcon`/`KindIcon` must accept and forward `strokeWidth`.

---

## Pick 5 — `pending` variant B "Ring → check / cross"

### 5a. Lab implementation

Entry — `frontend/src/lab/sections/Devices.jsx:709`:
```jsx
          { key: 'B', label: 'Ring → check / cross', note: 'A ring draws to 90% around the icon (bounded, not a loop), then closes green with a check, or a red cross pops and the state line says "Didn\'t respond".', render: (p) => <PendingB {...p} /> },
```
(This Demo has **no knobs** — `Devices.jsx:705-714`. All timings are literals.)

`PendingB` verbatim — `frontend/src/lab/sections/Devices.jsx:237-263`:
```jsx
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
```
`usePendingSim` — the **four-state machine the port needs**, `Devices.jsx:194-210`:
```jsx
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
```
Numbers: ring draws to `pathLength 0.9` over **1.6s linear**; `ok` ring closes `0.9 → 1` while fading over **0.5s**; badge `spring duration 0.35 bounce 0.35`; `ok` dwell **600ms**, `fail` dwell **2200ms**. Haptics: `h('success')` / `h('error')` on state entry (`Devices.jsx:239`).

Lab deps: `ms()` (only for the simulator — not needed in production, the real latency is the hub), `tx`, `Icon`, `.zl-tile`, `.zl-tile__icon`, `.zl-tile__row`, `.zl-tile__name`, `.zl-tile__meta`, `COPY`, `useHaptic`.

### 5b. Production landing sites

**The thing being replaced** — `frontend/src/motion/motion.css:329-335`:
```css
/* A command in flight: the control dims slightly until the hub answers.
 * Optimistic UI lies; this tells the truth without blocking anything. */
[data-motion="on"] [data-pending="true"] { animation: zm-pending 1.1s ease-in-out infinite; }
@keyframes zm-pending {
  0%, 100% { opacity: 1; }
  50%      { opacity: 0.62; }
}
```
reduced-motion kill at `motion.css:365`.

**The blocking structural fact: `data-pending` is a two-state boolean, and variant B needs four states.** Every emitter below publishes `pending ? 'true' : undefined` — there is no `ok` and no `fail` anywhere in the attribute contract. The port's first task is `data-pending="pending" | "ok" | "fail"` (or a second `data-motion-outcome`), plus a store/local timer for the `ok` 600ms / `fail` 2200ms dwell.

**DeviceCard.jsx optimistic flow — `components/device/DeviceCard.jsx:716-772`** (this is the canonical one; it is where `ok`/`fail` is already *known* and thrown away):
```jsx
  const onCommand = async (command, params) => {
    if (pending) return
    setPending(true)
    // One click → one log line, no matter how many internal calls follow.
    // Most users will only have logging at "off"; this is a no-op then.
    logger.click('DeviceCard', command, {
      entity_id: entity?.entity_id,
      ir_device: entity?._irDevice?.id,
      domain: entity?.domain,
      room: entity?.room,
      params,
    })

    // Optimistic update — flip the displayed state immediately so the tile
    // doesn't appear to "do nothing" while the HA round-trip completes.
    // Reverts if the call fails. WebSocket state_changed events overwrite
    // these once HA confirms (or corrects) the real value.
    const store = useDeviceStore.getState()
    let revert = null
    if (command === 'toggle' && facts.meta.toggle) {
      const nextState = facts.isOn ? 'off' : 'on'
      if (facts.isIr) {
        const irId = entity._irDevice?.id
        if (irId) {
          const prev = entity.assumed_state
          store.updateIrAssumedState(irId, nextState)
          revert = () => store.updateIrAssumedState(irId, prev ?? 'unknown')
        }
      } else {
        const prev = entity.state
        store.updateEntityState(entity.entity_id, nextState)
        revert = () => store.updateEntityState(entity.entity_id, prev)
      }
    }

    try {
      await sendDeviceCommand(entity, command, params)
      // No post-call verify: HA's REST POST already blocks until HA
      // commits the new state, and ha_subscriber broadcasts state_changed
      // (with full attributes) within ~10 ms of that commit. A second
      // getEntityState() round-trip would either return the SAME data the
      // WS event is about to deliver, or race ahead of it and read a
      // stale value from the same cache the WS is updating. Either way
      // it's wasted work on the user-perceived latency path. If WS is
      // disconnected, the optimistic state stays until reconnect — the
      // ha_connected banner already surfaces this.
    } catch (e) {
      revert?.()
      logger.error('device_command_failed', e, {
        entity_id: entity?.entity_id, command,
        reverted: !!revert,
      })
      addToast(e.message || i18nT('deviceCard.controlFailed'), 'error')
    } finally {
      setPending(false)
    }
  }
```
`pending` state declared at `DeviceCard.jsx:693`; threaded into all three variants at `:774-776`:
```jsx
  if (variant === 'tile')    return <TileCard    facts={facts} onCommand={onCommand} onOpen={open} dense={dense} group={group} metrics={groupMetrics} tileStyle={tileStyle} pending={pending} />
  if (variant === 'compact') return <CompactCard facts={facts} onCommand={onCommand} onOpen={open} pending={pending} />
  return <RowCard facts={facts} onCommand={onCommand} onOpen={open} dense={dense} metrics={groupMetrics} pending={pending} />
```
The three catch/finally branches at `:762-771` are exactly where `setOutcome('fail')` / `setOutcome('ok')` go. The `fail` path **also already toasts** (`:768`), which variant B replaces with the in-tile state line ("the state line says why").

**Also failing silently today, from the server:** `App.jsx:532-541`:
```jsx
    // Surface command failures from the backend's fire-and-forget toggle path.
    // The backend already broadcasts a corrective state_changed before this,
    // so the optimistic tile state is already reverted; we just toast the user.
    if (last.type === 'command_failed' && last.entity_id) {
      const name = last.entity_id.split('.').slice(-1)[0].replace(/_/g, ' ')
      addToast(
        last.message ? `${name}: ${last.message}` : i18nT('toast.didNotRespond', { name }),
        'error',
      )
    }
```
`toast.didNotRespond` is the production i18n key for the lab's "Didn't respond" (`Devices.jsx:258`). For variant B this `command_failed` must reach the tile, not only the toast — i.e. a per-entity `failedAt` map in `deviceStore`.

**All `data-pending` emitters (every one needs the 4-state widening, and the ones with an icon box can host the ring):**

| file:line | emitter | has `data-motion-icon` sibling? |
|---|---|---|
| `components/device/DeviceCard.jsx:453` | `TileCard` root `<button>` | yes, `:472` |
| `components/device/DeviceCard.jsx:539` | `RowCard` root `.z-card` | yes, `:550` |
| `components/device/DeviceCard.jsx:664` | `CompactCard` root `.z-chip` | yes (bare span), `:667` |
| `pages/Dashboard.jsx:331` | pinned tile `<button>` (`pending \|\| brightnessPending`) | yes, `:350` |
| `pages/Dashboard.jsx:894` | (shortcut/scene control) | — |
| `pages/Dashboard.jsx:1580`, `:1592` | suggestion save / reject buttons | — |
| `pages/Devices.jsx:215`, `:313` | IR command / state buttons | — |
| `pages/Devices.jsx:909` | `data-pending={pendingCmd === cmd ...}` (per-command) | — |
| `pages/Devices.jsx:1017` | IR assumed-state chip | — |
| `pages/Devices.jsx:1227` | `SmartSensorCard` (`deleting`) | yes, `:1234` |
| `pages/Devices.jsx:1914` | `DeviceCard` root `Card` | yes, `:1922` |
| `pages/Rooms.jsx:967`, `:991` | routine trigger buttons | — |
| `pages/Rooms.jsx:1548` | all-lights row (`allLightsPending`) | — |

Verbatim, the two the pick names — `DeviceCard.jsx:452-453`:
```jsx
      data-on={String(isOnState)}
      data-pending={pending ? 'true' : undefined}
```
`Dashboard.jsx:328-331`:
```jsx
      // The state hooks the motion layer reads: 220ms to arrive, 160ms to
      // leave, a breath while the hub has been asked and has not answered.
      data-on={String(on)}
      data-pending={(pending || brightnessPending) ? 'true' : undefined}
```
Note `Dashboard.jsx:345` *additionally* dims inline — `opacity: pending ? 0.7 : 1` — which will fight the ring's own opacity and the layer's `zm-pending`; it must go.

**Toggle.jsx — `frontend/src/components/ui/Toggle.jsx:18-84`.** It has **no `data-pending` at all**: it is a controlled Radix switch (`checked`/`onCheckedChange`, `:39-41`) with a haptic on pointerdown (`:33-36`) and a knob transform tween (`:76-79`). There is nowhere for a pending ring to live without the caller passing a pending prop. Its CSS twin: `motion.css:135-136`:
```css
[data-motion="on"] .z-toggle { transition: background-color 200ms var(--m-std); }
[data-motion="on"] .z-toggle::after { transition: transform 220ms var(--m-out); }
```
**ToggleButton in DeviceCard.jsx — `components/device/DeviceCard.jsx:91-127`.** Also **no `data-pending`**; it only carries `data-motion-ring` (`:104`) and an inline press/colour transition (`:117-119`):
```jsx
        transition: motionOn
          ? 'background var(--dur-press) var(--ease-standard), color var(--dur-press) var(--ease-standard), box-shadow var(--dur-press) var(--ease-standard)'
          : 'background var(--dur-press) var(--ease-standard), color var(--dur-press) var(--ease-standard)',
```
Its 40×40 square (`:106`, `borderRadius:'var(--r-ctl)'`, `<Power size={...} strokeWidth={2}/>` at `:124`) is the natural second ring host — the lab's ring is a 44×44 svg at `inset:-4` around a 36px icon box, so a 40px button wants `inset:-4` → 48×48.

`PlayPauseButton` (`DeviceCard.jsx:152-173`) is already `borderRadius:'50%'` 40×40 (`:163`) — the single best ring host in the app, and it is also pick 7's glyph-swap site.

---

## Pick 6 — `card-controls` variant B "Span + FLIP siblings" (0.42)

### 6a. Lab implementation

Knob + entry — `frontend/src/lab/sections/Devices.jsx:717` / `:721`:
```jsx
        knobs={[{ key: 'duration', label: 'Duration', min: 0.2, max: 0.9, step: 0.02, value: 0.42, unit: 'ms' }]}
...
          { key: 'B', label: 'Span + FLIP siblings', note: 'The open card spans the row and grows on a spring; every neighbour slides to its new place.', render: (p) => <ExpandGrid {...p} variant="B" /> },
```
`ExpandGrid` — the shared A/B/C body. Variant B is the `layout={true}`, `gridColumn: '1 / -1'`, spring path. `Devices.jsx:378-391` + `:412-441`:
```jsx
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
              ...
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
```
The five mechanics of variant B, isolated:
1. `layout={variant !== 'A'}` → `layout` is **on for B** (`Devices.jsx:413`) — that is the FLIP of the siblings.
2. `gridColumn: isOpen && variant !== 'C' ? '1 / -1' : undefined` (`:413`) — the span.
3. `LayoutGroup id={'exp-B'}` around the grid (`:386`) — makes the siblings co-measure.
4. `alignItems: 'start'` on the grid (`:387`) — without it the row stretches and the FLIP looks wrong.
5. `layout="position"` on the header row and name block (`:414`, `:417`) — keeps the type from stretching during the box animation.
6. The body is a spring height animation (`transition={... : spring}` at `:419`), not A's `0.22s EASE.drawer`.

`ControlsBody` (the stand-in remote) — `Devices.jsx:368-376`:
```jsx
function ControlsBody({ t }) {
  return (
    <div style={{ paddingTop: 12 }}>
      <div className="zl-footnote zl-mute" style={{ marginBottom: 6 }}>{t({ en: 'Brightness', he: 'בהירות' })}</div>
      <div style={{ height: 36, borderRadius: 12, background: 'var(--surface-3)', overflow: 'hidden', marginBottom: 10 }}><div style={{ width: '62%', height: '100%', background: 'var(--accent)' }} /></div>
      <div className="zl-hstack">{['2700K', '3500K', '5000K'].map((k, i) => <span key={k} className="zl-chip" data-on={i === 0 ? 'true' : 'false'}>{k}</span>)}</div>
    </div>
  )
}
```
Lab deps: `LayoutGroup`, `.zl-grid2` (`ziggy.css:133` — fixed 2-col, 3-col at tablet `:153`, 4-col at desktop `:154`), `.zl-tile`, `.zl-btn--pill`, `EASE.drawer`, `DEVICES` mock.

### 6b. Production landing site

**The expanded control surface — `frontend/src/pages/Devices.jsx:2161-2181`** (exactly the lines the pick names):
```jsx
        {/* Expanded control surface — animated height + fade so opening
            and closing doesn't snap the list around. Hidden / sensor /
            unavailable devices never reach this branch. */}
        {!isHidden && kindMeta(getKind(entity)).controllable && entity.state !== 'unavailable' && (
          <AnimatePresence initial={false}>
            {controlsExpanded && (
              <motion.div
                key="controls"
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.22, ease: [0.32, 0.72, 0, 1] }}
                style={{ overflow: 'hidden' }}
              >
                <div style={{ marginTop: 10, paddingTop: 12, borderTop: '0.5px solid var(--line)' }}>
                  <UnifiedDeviceRemote entity={entity} />
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        )}
```
This **is** lab variant A verbatim: `duration: 0.22`, `ease: [0.32, 0.72, 0, 1]` = `EASE.drawer` (`lab/time.js:52`) = `--m-drawer` (`motion.css:36`). Variant B changes it to `transition={{type:'spring', duration:0.42, bounce:0}}`.

State + the two trigger buttons — `Devices.jsx:1803`:
```jsx
  const [controlsExpanded, setControlsExpanded] = useState(false)
```
Trigger 1 (status-badge layout) — `Devices.jsx:2070-2087`:
```jsx
            {kindMeta(getKind(entity)).controllable && (
              <button
                onClick={() => setControlsExpanded(v => !v)}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 3,
                  background: 'none', border: 'none', cursor: 'pointer',
                  color: 'var(--accent)', fontSize: 10.5, fontWeight: 600,
                  fontFamily: 'inherit', padding: '2px 4px', flexShrink: 0,
                }}
              >
                {controlsExpanded ? t('devices.hideControls') : t('devices.showControls')}
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"
                  data-motion-chevron data-open={controlsExpanded ? 'true' : 'false'}
                  style={chevronStyle}>
                  <path d="M6 9l6 6 6-6"/>
                </svg>
              </button>
            )}
```
Trigger 2 (identical block, other layout branch) — `Devices.jsx:2118-2132`. Chevron style — `Devices.jsx:1882-1888`:
```jsx
  // The disclosure chevron on "Show controls". Same glyph, same 180° — the
  // inline transition just has to go when the layer is on, or it outranks
  // motion.css and the hook is dead.
  const chevronStyle = {
    transform: controlsExpanded ? 'rotate(180deg)' : 'none',
    ...(motionOn ? null : { transition: 'transform 0.2s' }),
  }
```
i18n keys: `devices.showControls` / `devices.hideControls`.

**The card root that must carry `layout` and the span — `Devices.jsx:1890-1918`:**
```jsx
  return (
    <motion.div
      ref={ref} layout={layoutArmed} layoutDependency={layoutKey}
      // Two entrances were running per card: the grid's CSS stagger (motion
      // layer) AND this JS-driven fade+scale — 50 framer animations at once
      // on a phone, on top of the mount. With the layer on, the stagger owns
      // the entrance; `initial={false}` mounts at the resting state. With
      // the layer off nothing else animates the card, so the fade stays.
      initial={motionOn ? false : { opacity: 0, scale: 0.96 }}
      animate={{ opacity: isHidden ? 0.45 : 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.96 }}
      transition={{ duration: 0.15 }}
    >
      <Card
        ...
        data-on={String(isOn)}
        data-pending={pending ? 'true' : undefined}
        style={scrubbable ? { touchAction: 'pan-y' } : undefined}
        {...(scrubHandlers || null)}
      >
```
**The `layoutArmed` conflict — this is the blocker for variant B.** `frontend/src/pages/Devices.jsx:2585-2602`:
```jsx
  // FLIP is armed by intent, not paid on every mount.
  //
  // `layout` on a card makes framer measure it (a forced layout read) the
  // moment it mounts — 50 cards, ~100 ms at 8× throttle, before a single
  // pixel of entrance has drawn. That measurement only earns its keep when
  // the user is about to reorder the grid. So the cards carry `layout` only
  // from the pointerdown on a filter chip, the view toggle, the search box
  // or a group header — a beat BEFORE the click that reorders, which is
  // when framer needs its "before" snapshot — until 900 ms after the last
  // change. Reorders still glide; entering the page pays nothing.
  const [layoutArmed, setLayoutArmed] = useState(false)
  const disarmRef = useRef(null)
  const armLayout = () => {
    setLayoutArmed(true)
    clearTimeout(disarmRef.current)
    disarmRef.current = setTimeout(() => setLayoutArmed(false), 900)
  }
  useEffect(() => () => clearTimeout(disarmRef.current), [])
```
and the gate — `Devices.jsx:2572-2583`:
```jsx
  // Layout (FLIP) animations answer to the user, not to data.
  //
  // Every card below is a `motion.div layout`, and framer's default is to
  // re-measure on EVERY render — so a store refresh after mount, the room
  // list resolving, a WS state tick that changed one tile's height, all slid
  // every other card to its new spot. That was "components bounce into
  // position" on entering the page, and it survived `?motion=off` because
  // none of this is the motion layer. `layoutDependency` gates the measure:
  // keyed on what the user changes (view, filter, search, folded groups), a
  // reorder still glides; data landing just lands. A card rendered without
  // the key keeps framer's default (see MeasureLayout: undefined → always).
  const layoutKey = `${viewMode}|${domain}|${search}|${[...collapsedGroups].sort().join(',')}`
```
`armLayout` is called **only** from: the search input (`:2786`), the filter-chip row (`onPointerDownCapture`, `:2791`), and `CollapsibleGroup onArm` (`:2949`, `:2969`, `:2981`, `:2990`, `:3010`, `:3026`, `:3050`). **"Show controls" never arms it**, and `controlsExpanded` is not in `layoutKey`. So today: the open card's height changes, every neighbour in later grid rows jumps with zero animation — exactly `Cards.jsx:581`'s found note and `Devices.jsx:720`'s variant A label. The port must add `controlsExpanded` to the arming path (call `armLayout()` in the two `onClick`s at `:2072`/`:2118`) **and** fold it into `layoutKey`, or the FLIP is dead on arrival.

Prop plumbing — `Devices.jsx:1779` (`layoutKey, layoutArmed,` in the card's destructure) and `:2604-2624` (`deviceCardProps`, with `layoutKey`/`layoutArmed` at `:2606-2607`).

**Grid definition — all identical, `repeat(auto-fill, minmax(220px, 1fr))`, `gap: 8`** — `frontend/src/pages/Devices.jsx:2950`, `:2971`, `:2982`, `:2991`, `:3011`, `:3028`, `:3052`, `:3064`, `:3073`, e.g.:
```jsx
                <div data-motion-stagger="" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 8, marginBottom: 4 }}>
```
Two consequences for the span: (a) `auto-fill` means the column count is **unknown at render time**, so `gridColumn: '1 / -1'` works (it is "all tracks") but the open card becomes full-width even on a 6-column desktop — the lab's 2-col `.zl-grid2` made that look proportionate; (b) there is **no `alignItems:'start'`** on any of these grids, which the lab's variant B needs (`Devices.jsx:387`). And every one of them is a `data-motion-stagger` container (`motion.css:192-213`) — the CSS stagger's `animation-delay`s target `> *:nth-child(n)`, so inserting a `LayoutGroup` wrapper between the grid and the cards would break the stagger.

`SmartSensorCard` shares the same `layout={layoutArmed} layoutDependency={layoutKey}` contract — `Devices.jsx:1209-1217`.

The lab's variant C ("tile becomes the sheet", the Demo's `recommend`) is already production reality via `motion/DeviceSheet.jsx` — see pick 8.

---

## Pick 7 — `icon-morphs` variant A "Play/Pause · Lock · Blinds · Fan"

### 7a. Lab implementation — and the GSAP answer

**Yes, the lab uses GSAP MorphSVG — for Play/Pause only.** `frontend/src/lab/sections/Devices.jsx:6-8` and `:16`:
```jsx
import gsap from 'gsap'
import { MorphSVGPlugin } from 'gsap/MorphSVGPlugin'
import { useGSAP } from '@gsap/react'
...
gsap.registerPlugin(MorphSVGPlugin, useGSAP)
```
The two paths and the morph — `Devices.jsx:445-460`:
```jsx
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
```
`morphSVG: { shape, shapeIndex: 'auto' }` is a **MorphSVGPlugin (GSAP Club/paid)** feature, interpolating a 1-subpath triangle into a 2-subpath pause. Nothing else in the lab uses MorphSVG.

**The other three in variant A are hand-made framer transforms on inline SVG primitives, not path interpolation:**

`LockMorph` — a rect + a shackle path that swings on a `transformOrigin`, `Devices.jsx:462-472`:
```jsx
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
```
`BlindsMorph` — five `<line>`s whose `y` is a function of `pos`, `Devices.jsx:474-489`:
```jsx
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
```
`FanMorph` — a continuous `rotate` `useMotionValue` whose period encodes the level, `Devices.jsx:491-508`:
```jsx
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
```
`FanMorph` divides by `speed` directly (`:496-497`), not via `tx` — the only place in these picks that does. In production, drop `/ speed`.

Container + copy — `Devices.jsx:605-618` (`IconMorphs`), Demo entry `:729`:
```jsx
          { key: 'A', label: 'Play/Pause · Lock · Blinds · Fan', note: 'Controls: MorphSVG between play and pause; a shackle that swings; slats that spread; a fan whose spin speed is the level.', render: (p) => <IconMorphs {...p} /> },
```
and the honest footnote, `Devices.jsx:615`: *"Today every one of these is a hard glyph swap."* The found note, `Devices.jsx:688`: *"No icon morphs. Play/Pause, Lock/LockOpen, Volume/Mute hard-swap; the light bulb glyph is the same asset on and off."*

(For completeness: production already ships a `frontend/src/motion/morph.js` — 334 lines — which is the shared-element rect morph used by room tiles (`useMorphReturn`, `captureOriginFromEvent`), **not** an SVG path morpher.)

### 7b. Every production glyph swap — complete inventory

**Play / Pause — 5 sites:**

1. `frontend/src/components/device/DeviceCard.jsx:170` — `PlayPauseButton`, the pick's named site:
```jsx
      {playing ? <Pause size={16} fill="currentColor" /> : <Play size={16} fill="currentColor" style={{ marginInlineStart: 2 }} />}
```
State from `facts.state === 'playing'` (`:153`); the button is 40×40 `borderRadius:'50%'`, `background:'var(--ink)'`, `color:'var(--bg)'` (`:162-168`). Imported at `DeviceCard.jsx:30`: `Thermometer, Plug, Square, ArrowUp, ArrowDown, Play, Pause,`. Mounted for media at `DeviceCard.jsx:307-313`:
```jsx
      // the room view. Play/pause stays additive when the device supports it.
...
            <PlayPauseButton facts={facts} onCommand={onCommand} />
```
Note: `fill="currentColor"` on both — these are lucide *outline* icons being filled; a MorphSVG port would use the lab's own `PLAY`/`PAUSE` path strings instead, which is cleaner.

2. `frontend/src/components/ui/DeviceControls.jsx:1070-1072` — the media transport's inverted 44px tile:
```jsx
          {isPlaying
            ? <Pause size={18} strokeWidth={1.75} className="text-bg" />
            : <Play  size={18} strokeWidth={1.75} className="text-bg translate-x-px" />}
```
inside `DeviceControls.jsx:1064-1073` (`onService(isPlaying ? 'media_pause' : 'media_play', {})`, `data-motion-ring`, `w-11 h-11 rounded-full bg-ink`). Imported `DeviceControls.jsx:4`: `SkipBack, SkipForward, Play, Pause, Volume2, VolumeX,`.

3. `frontend/src/components/ui/DeviceControls.jsx:1395` — `VacuumControls` start:
```jsx
          <Play size={16} strokeWidth={1.75} /> {t('deviceControls.startVacuum')}
```
4. `frontend/src/components/ui/DeviceControls.jsx:1399` — `VacuumControls` pause:
```jsx
          <Pause size={16} strokeWidth={1.75} /> {t('deviceControls.pause')}
```
Both in `DeviceControls.jsx:1391-1401`; this is a **whole-button swap** (different label, different background), not a glyph swap — a path morph would have to survive the button being replaced.

5. `frontend/src/pages/Rooms.jsx:969` + `:993` — routine trigger `Play` (never becomes `Pause`; `Loader2` spins instead):
```jsx
        {isTriggering ? <Loader2 size={18} strokeWidth={1.75} className="z-spin" /> : <Play size={18} strokeWidth={1.75} />}
```
Also imported-but-swapless `Play, Pause` at `Rooms.jsx:4` and `Play` at `Dashboard.jsx:20` (used as a section-head icon, `Dashboard.jsx:971`).

**Lock / LockOpen — 3 sites, plus the status pills:**

1. `frontend/src/components/ui/DeviceControls.jsx:1346` — lock:
```jsx
          <Lock size={16} strokeWidth={1.75} /> {t('deviceControls.lock')}
```
2. `frontend/src/components/ui/DeviceControls.jsx:1370` — unlock:
```jsx
          <LockOpen size={16} strokeWidth={1.75} /> {t('deviceControls.unlock')}
```
Both in `LockControls`, `frontend/src/components/ui/DeviceControls.jsx:1325-1375`. Imported `:5`: `ArrowUp, ArrowDown, Lock, LockOpen, Home, Square, Minus, Plus,`. **This is the hardest Lock port**: the two glyphs live in *different branches of a four-way conditional*, and there is a confirm step in between — `DeviceControls.jsx:1336-1372`:
```jsx
    <div style={{ marginTop: 8, paddingTop: 8, borderTop: '0.5px solid var(--line)' }}>
      {isPending ? (
        <div style={{ textAlign: 'center', fontSize: 12, color: 'var(--ink-mute)', padding: '12px 0' }}>{pendingLabel}</div>
      ) : !isLocked ? (
        <button
          onClick={() => onService('lock', {})}
          data-motion-ring
          style={{ ...ctrlBtn, width: '100%', background: `color-mix(in srgb, var(--ok) 12%, var(--surface))`, color: 'var(--ok-text)', border: '0.5px solid color-mix(in srgb, var(--ok) 30%, var(--line))' }}
        >
          <Lock size={16} strokeWidth={1.75} /> {t('deviceControls.lock')}
        </button>
      ) : confirming ? (
        <div style={{ display: 'flex', gap: 8 }}>
          ...
        </div>
      ) : (
        <button
          onClick={() => setConfirming(true)}
          data-motion-ring
          style={{ ...ctrlBtn, width: '100%', background: `color-mix(in srgb, var(--err) 10%, var(--surface))`, color: 'var(--err-text)', border: '0.5px solid color-mix(in srgb, var(--err) 30%, var(--line))' }}
        >
          <LockOpen size={16} strokeWidth={1.75} /> {t('deviceControls.unlock')}
        </button>
      )}
    </div>
```
The three branches unmount each other, so a shackle that swings needs one persistent `<svg>` lifted above the conditional. Note `isPending` (`:1329`) already exists here — `entity.state === 'locking' || 'unlocking'` — the only real tri-state pending in the app, relevant to pick 5 too.

3. `frontend/src/components/device/DeviceCard.jsx:322` — the lock's `StatusPill` (**no glyph at all**, text only):
```jsx
      return <StatusPill tone={facts.state === 'locked' ? 'ok' : 'warn'} label={facts.stateLabel} />
```
`StatusPill` itself — `DeviceCard.jsx:200-215` — is `padding:'4px 12px'`, `borderRadius:999`, a tone→`{bg,fg}` map, and renders only `{label}`. `LockIcon` is imported at `DeviceCard.jsx:29` (`DoorOpen, Lock as LockIcon, AlarmSmoke, Droplets, Activity, Camera,`) and used only by the kind-icon table, not by this pill. **Porting a lock morph to the card means adding a glyph slot to `StatusPill`.**

**Volume2 / VolumeX — 2 sites:**

1. `frontend/src/components/ui/DeviceControls.jsx:1094` — the real mute toggle:
```jsx
            {isMuted ? <VolumeX size={18} strokeWidth={1.75} /> : <Volume2 size={18} strokeWidth={1.75} />}
```
in `DeviceControls.jsx:1086-1095` (`onService('volume_mute', { is_volume_muted: !isMuted })`, `data-motion-ring`, `aria-pressed={!!isMuted}`).
2. `frontend/src/components/ui/DeviceControls.jsx:1748` — `VolumeX` on an IR command button (one-way, no `Volume2` counterpart):
```jsx
              {b.cmd === 'mute' && <VolumeX size={20} strokeWidth={1.75} />}
```
`Volume2` is also imported at `pages/Devices.jsx:3` and used as a *static* kind icon at `Devices.jsx:135` (`soundbar: Volume2,`) — not a swap.

Adjacent, no-swap volume UI: `VolumeBars` in `DeviceCard.jsx:175-189` (4 bars, `background: i < filled ? 'var(--ink-2)' : 'var(--line-2)'`, no transition).

**Cover / Blinds — `CoverControls`, `frontend/src/components/ui/DeviceControls.jsx:1210-1241`** (full text in section 7b's source above; key lines `:1219-1229` are three `ArrowUp` / `Square` / `ArrowDown` buttons, `:1230-1238` is the position Slider). **There is no blinds glyph at all** — no `<rect>`+slats anywhere. The lab's `BlindsMorph` would be a *new* component; the live `localPos` it needs is already there, `:1212-1215`:
```jsx
  const position = entity.current_position
  const [localPos, setLocalPos] = useState(position ?? 0)

  useEffect(() => { if (position != null) setLocalPos(position) }, [position])
```
and the % readout at `:1234`: `<span className="z-mono">{localPos}%</span>`.

**Fan — `FanControls`, `frontend/src/components/ui/DeviceControls.jsx:1244-1322`.** Again **no fan glyph**: the level lives in a Slider + preset chips, and the only icon is `<Power size={20} strokeWidth={1.75} />` on the on/off button (`:1275`, `:1317`). The level the lab's spin period encodes is already computed — `:1247-1252`:
```jsx
  const rawPct = entity.percentage ?? 0
  const [pct, setPct] = useState(rawPct)
  const presetMode  = entity.preset_mode
  const presetModes = entity.preset_modes || []

  useEffect(() => { setPct(entity.percentage ?? 0) }, [entity.percentage])
```
The off-state branch (`:1266-1280`) returns early with just the Power button — a spinning fan glyph would need a home in both branches. Preset chips at `:1291-1305`.

**Port note on the ambient loop:** `FanMorph`'s `repeat: Infinity` violates the layer's own rule unless earned — `motion.css:316-320`:
```css
/* ── Live status ─────────────────────────────────────────────────────────
 * The one loop in the whole layer, and it earns it: a room that is occupied
 * right now is a continuously true reading, not an event. It stops dead
 * under reduced motion, and the state is always also carried by a word. */
```
"a fan that is spinning right now" is the same justification, but it must stop under reduced motion (`motion.css:343-369`) and the level must also be a word (it is: `{pct}%` at `:1287`).

---

## Pick 8 — `sheet` variant B "Page peeks beneath" (peek 0.72, elastic 0.12)

### 8a. Lab implementation

Knobs + entry — `frontend/src/lab/sections/Devices.jsx:733-741`:
```jsx
      <Demo id="sheet" stage="fixed" title="Device sheet detents (interactive)" purpose="The sheet is the most complete gesture in the app. Tune it here." principles={['physical', 'continuity']} inZiggy={['motion/SheetSurface.jsx', 'motion/DeviceSheet.jsx DETENTS [0.72, 1]']}
        knobs={[
          { key: 'peek', label: 'Peek detent', min: 0.4, max: 0.9, step: 0.02, value: 0.72 },
          { key: 'elastic', label: 'Rubber-band past top', min: 0, max: 0.4, step: 0.02, value: 0.12 },
        ]}
        recommend="B"
        variants={[
          { key: 'A', label: 'Two detents + dismiss', note: 'Drag the sheet: it rests at the peek detent or the top; the corners square off as it reaches the top; a downward flick (or a release past 85%) dismisses; the backdrop follows the drag. Tap a tile to bring it back.', render: (p) => <SheetDetents {...p} variant="A" /> },
          { key: 'B', label: 'Page peeks beneath', note: 'Recommended. The list page behind scales to 0.94, rounds its corners and darkens as the sheet rises (the iOS modal grammar), and it all reverses as the sheet lowers. Every value is a useTransform of the sheet\'s live y, so the page follows your finger, not a timer. The sheet is on top of something, and that something is still there.', tradeoff: 'Scaling the whole page repaints it once per frame during the drag; keep the page a compositor layer (it already is, via transform).', spec: () => 'scale 1 → 0.965 (peek) → 0.94 (top) · radius 0 → 18 · dim 0 → 0.42', render: (p) => <SheetDetents {...p} variant="B" /> },
        ]} />
```
**What "page peeks beneath" changes — exactly three `useTransform`s of the sheet's live `y`, plus a black layer behind the page.** `frontend/src/lab/sections/Devices.jsx:622-645`:
```jsx
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
```
So, concretely, variant B:
- **Page wrapper** (`:639`) gets `scale: pageScale` (1 → 0.965 at peek → **0.94** at top), `borderRadius: pageRadius` (0 → **18**), `transformOrigin: '50% 0%'`, `overflow:'hidden'`.
- **A new dim layer inside the page wrapper** (`:643`) — `background:'var(--ink)'`, `opacity: pageDim` (0 → 0.22 at peek → **0.42** at top), `pointerEvents:'none'`.
- **The layer root gains `background:'var(--ink)'`** (`:638`) so the gap revealed by the scaled-down page is black, not the page's own colour.
- **The normal scrim is switched off**: `opacity: peek ? 0 : scrim` (`:645`). In B the darkening *is* `pageDim`, not the backdrop.

The gesture half (identical in A and B, and already production) — `Devices.jsx:646-669`:
```jsx
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
```
Lab deps: `useMotionValue`, `useTransform`, imperative `animate(y, …)`, `.zl-sheet` (`ziggy.css:108`), `.zl-sheet__grabber` (`:114`), `.zl-backdrop` (`:115`), `.zl-grid2`, `KIND_ICON` (`Devices.jsx:18`), `DEVICES`/`COPY` mocks.

### 8b. Production landing site

**The knobs already match production exactly** — `frontend/src/motion/DeviceSheet.jsx:30-50`:
```jsx
// Peek first, full height second. SheetSurface sorts these into y-offsets, so
// the sheet rests at the peek and "the top" is one drag up.
//
// 0.72, not 0.55. Two reasons, and the first is the real one:
//
//   - At 0.55 the peek CUT THE CONTROL IN HALF. A light's remote is a
//     brightness well, a brightness bar, presets and the power button, and the
//     power button — the single most likely thing you opened the device to
//     press — fell below the fold. A peek that hides the main control is not a
//     peek, it is a teaser, and it forces a drag to do the one-tap thing.
//   - It is the height the chat sheet already rests at, so the app has ONE
//     resting height for a bottom sheet rather than two that differ by enough
//     to look like an accident.
//
// It stays a fraction rather than "however tall the content is" on purpose: a
// sheet whose resting height changes per device would make every device open
// feel like a different interaction.
const DETENTS = [0.72, 1]
// Rubber-band resistance past the top stop — motion/gestures.js's number.
const ELASTIC = { top: 0.12, bottom: 1 }
const CLASSES = { panel: 'z-msheet', head: 'z-msheet-head', body: 'z-msheet-body scrollbar-thin' }
```
passed through at `DeviceSheet.jsx:74-91`:
```jsx
    <SheetSurface
      open={open}
      handoff={handoff}
      dock
      onClose={onClose}
      onPromote={onPromote}
      promoteLabel={t('deviceCard.openDetails')}
      title={name}
      detents={DETENTS}
      dragElastic={ELASTIC}
      bodyDrag
      restoreFocus
      classNames={CLASSES}
    >
      <DeviceRemote entity={entity} />
    </SheetSurface>
```
So **peek 0.72 and elastic 0.12 need no change.** The pick is purely the page-recede.

**Where SheetSurface paints the backdrop — `frontend/src/motion/SheetSurface.jsx:267-289`:**
```jsx
  // ── Backdrop follows the drag ─────────────────────────────────────────
  // Opacity only; the colour token is untouched. framer's own enter/exit fade
  // on the scrim has settled by the time a finger is on the sheet, so writing
  // the inline value here never fights it — and on exit framer writes the same
  // property again and takes it back.
  const paintScrim = useCallback((y) => {
    const scrim = scrimRef.current
    const el = panelRef.current
    if (!scrim || !el) return
    const H = el.offsetHeight || 1
    const peek = stopsRef.current[stopsRef.current.length - 1]
    scrim.style.transition = 'none'
    scrim.style.opacity = String(clamp((H - y) / Math.max(1, H - peek), 0, 1))
  }, [panelRef])

  // Only ever called on the motion-on path: with the flag off nothing has
  // touched the backdrop's inline opacity, and it must stay that way.
  const settleScrim = useCallback(() => {
    const scrim = scrimRef.current
    if (!scrim) return
    scrim.style.transition = reduce ? 'none' : 'opacity var(--dur-state) var(--ease-standard)'
    scrim.style.opacity = '1'
  }, [reduce])
```
Called from `onDrag` — `SheetSurface.jsx:291-296`:
```jsx
  const onDrag = useCallback((_e, info) => {
    // `onDrag` is also a real DOM prop. If framer is ever standing aside (a test
    // that stubs it out), a native drag event would arrive here with no info.
    if (!motionOn || !info?.offset) return
    paintScrim(stopsRef.current[idxRef.current] + info.offset.y)
  }, [motionOn, paintScrim])
```
and `settleScrim` from `goToDetent` — `SheetSurface.jsx:298-303`. `dismiss` clears the inline transition so framer's exit tween can own it — `:251-259`. The scrim node and its style — `SheetSurface.jsx:522-531`:
```jsx
          <motion.div
            ref={scrimRef}
            onClick={dismiss}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, transition: scrimTransition }}
            transition={scrimTransition}
            style={styles.scrim || DEFAULT_SCRIM_STYLE}
            {...(attrs.scrim || EMPTY)}
          />
```
`DEFAULT_SCRIM_STYLE` / `DEFAULT_LAYER_STYLE` — `SheetSurface.jsx:83-93`:
```jsx
const DEFAULT_LAYER_STYLE = {
  position: 'fixed', left: 0, right: 0, top: 0, height: 'var(--vh)',
  zIndex: 50,
  display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', alignItems: 'stretch',
  pointerEvents: 'none',
}
const DEFAULT_SCRIM_STYLE = {
  position: 'absolute', inset: 0,
  background: 'var(--backdrop)', backdropFilter: 'blur(8px)',
  pointerEvents: 'auto', touchAction: 'none',
}
```
The panel (which owns `y`) — `SheetSurface.jsx:532-552`:
```jsx
          <motion.div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-label={label || title}
            className={classNames.panel}
            drag="y"
            dragListener={false}
            dragControls={dragControls}
            dragConstraints={{ top: stops[0], bottom: stops[stops.length - 1] }}
            dragElastic={dragElastic}
            dragMomentum={false}
            onDrag={onDrag}
            onDragEnd={onDragEnd}
            initial={{ y: '100%' }}
            animate={{ y: restY }}
            exit={{ y: '100%', transition: exitTransition }}
            transition={panelTransition}
            style={styles.panel}
            {...(attrs.panel || EMPTY)}
          />
```
`restY` at `:417-419`; `panelTransition = SPRING_SHEET` at `:410` (= `{type:'spring', stiffness:400, damping:30, mass:0.8}`, `lib/motion.js:18` — **identical to the lab's `settle` spring at `Devices.jsx:635`**).

**Five concrete architectural facts the port must deal with, because production is *not* a `useMotionValue(y)` design:**

1. **framer owns `y` as a prop, not as a `MotionValue`.** `animate={{ y: restY }}` (`:547`) + framer's own drag. There is no `y` MotionValue to `useTransform` from — which is exactly why `paintScrim` is an imperative per-frame `style.opacity` write (`:272-280`). The page-recede must follow the same pattern: a `paintPage(y)` writing `transform: scale(...)`, `border-radius`, and a dim layer's opacity imperatively from `onDrag`, with a `settlePage()` twin. The reason is documented at `SheetSurface.jsx:26-37`:
```jsx
// 1. framer owns `y`, not `el.style.transform`.
//    motion/gestures.js has `useSheetDetents`, a pointer-based engine that
//    drives the transform imperatively. It encodes exactly the right rules —
//    ...
//    It does not reuse the engine, because the engine would have to
//    take `transform` away from framer, and the chat sheet's entrance is a
//    framer spring (SPRING_SHEET) on `y`.
```
2. **The page is not inside the sheet's tree.** The layer is `position:'fixed'` `zIndex:50` (`:84-85`); the page is whatever `AppShell` rendered. The port needs a handle to the routed page wrapper — and that wrapper is the same node that carries `data-motion-enter` (`motion.css:149-155`) and `data-motion-enter="back"` (`:182-188`), both of which already animate `transform`. A scale written there will collide with `zm-page-in` / `zm-page-back` on the frame a sheet opens during a navigation.
3. **`transform` on an ancestor traps the fixed sheet.** The layer is `position:fixed`; if the page wrapper is an ancestor of it, scaling the wrapper makes it the containing block. The layer already sits outside the page (it is rendered from `App.jsx`'s sheet slot), but the layer's own hygiene rule exists for exactly this — `motion.css:383-388`:
```css
/* ── Hygiene ─────────────────────────────────────────────────────────────
 * Never let the layer break the keyboard, and never let a transform trap a
 * fixed child (a transformed ancestor becomes the containing block). */

[data-motion="on"] :focus-visible { transition: none !important; }
[data-motion="on"] [data-pressing] :is([style*="position: fixed"], .fixed) { transform: none; }
```
The bottom nav (`[data-motion-nav]`, `motion.css:267-276`) and any `.fixed` chrome inside the page will be dragged by the scale — they must be hoisted out or excluded.
4. **The docked (wide) frame has no page to recede.** `docked = dock && wide` (`:172`), `WIDE_QUERY = '(min-width: 768px)'` (`:60`), and the docked branch (`:464-508`) deliberately has **no dim**: `:466-467` — *"No dim: the panel sits beside the page, not over it."* `DeviceSheet` passes `dock` (`:78`), so the peek must be narrow-only.
5. **The hand-off assumes the page is at full scale.** `sheet.css:120-157` (`.z-msheet-handoff`) dissolves the sheet onto the page at the same URL, with the timing reasoning at `:128-137`. If the page is still at `scale 0.94` when the dissolve runs, the "same rectangle" premise breaks. The page scale must return to 1 **before** `handingOff` (`SheetSurface.jsx:176`) starts, i.e. on `promote()` (`:261-265`), not on `dismiss()`.

`.z-msheet` itself is `height: calc(var(--vh) - var(--safe-top) - 10px)` (`sheet.css:44`, with the long "HEIGHT, not max-height" reasoning at `:26-43`) and `overflow: hidden` (`:54`) — so the lab's `H = 640` becomes `var(--vh)`-derived, and `stops` are computed by `measure()` (`SheetSurface.jsx:~220-243`). The lab's `radius` transform (0 → 24 over the first 40px, `Devices.jsx:629`) has **no production equivalent** — `.z-msheet` has a static `border-start-*-radius: var(--r-sheet)` (`sheet.css:50-51`); the corners never square off at the top today, so variant A's corner behaviour is also unported.

---

# ROOMS

## Pick 9 — `occupancy` variant D "Presence arrives / leaves" (breath 3)

### 9a. Lab implementation

Knob + entry — `frontend/src/lab/sections/Rooms.jsx:426` / `:432`:
```jsx
        knobs={[{ key: 'breath', label: 'Breath period (B)', min: 1.5, max: 5, step: 0.1, value: 3, unit: 's', digits: 1 }]}
...
          { key: 'D', label: 'Presence arrives / leaves', note: 'A person mark enters from the tile\'s edge with a ripple, and slides back out the way it came. Direction = door.', render: (p) => <OccD {...p} /> },
```
**NOTE:** `breath: 3` is read **only by `OccB`** (`Rooms.jsx:69`, the pulsing dot). `OccD` has no loop and no breath at all — its timings are literals: ripple `0.8s EASE.out`, mark in `spring duration 0.5 bounce 0.25`, mark out `0.28s EASE.inOut`.

`OccD` verbatim — `frontend/src/lab/sections/Rooms.jsx:101-122`:
```jsx
function OccD({ tx }) {
  // presence "ripple": a person mark arrives with a ripple; leaves by fading toward the door edge
  const [state, setState] = useOcc(); const t = useT()
  return (
    <OccFrame state={state} setState={setState} t={t}>
      <RoomTileBase state={state} t={t}>
        <span style={{ position: 'relative', width: 28, height: 28, display: 'grid', placeItems: 'center' }}>
          <AnimatePresence>
            {state === 'occupied' && (
              <>
                <motion.span key="rip" initial={{ scale: 0.4, opacity: 0.6 }} animate={{ scale: 2.4, opacity: 0 }} transition={tx({ duration: 0.8, ease: EASE.out })} style={{ position: 'absolute', width: 28, height: 28, borderRadius: 999, border: '2px solid var(--ok)' }} />
                <motion.span key="p" initial={{ x: 14, opacity: 0, scale: 0.8 }} animate={{ x: 0, opacity: 1, scale: 1 }} exit={{ x: 14, opacity: 0, scale: 0.8, transition: tx({ duration: 0.28, ease: EASE.inOut }) }} transition={tx({ type: 'spring', duration: 0.5, bounce: 0.25 })} style={{ position: 'absolute', width: 24, height: 24, borderRadius: 999, background: 'var(--ok)', color: '#fff', display: 'grid', placeItems: 'center' }}><Icon name="users" size={13} strokeWidth={2.5} /></motion.span>
              </>
            )}
            {state === 'unknown' && <motion.span key="q" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="zl-caption zl-mute" style={{ fontFamily: 'var(--ml-mono)' }}>?</motion.span>}
          </AnimatePresence>
        </span>
      </RoomTileBase>
      <p className="zl-footnote zl-mute" style={{ gridColumn: '1 / -1' }}>Someone arrives: a person mark enters from the tile's edge with a ripple. Leaving: it slides back out the way it came. Unknown is a quiet "?".</p>
    </OccFrame>
  )
}
```
Three-state model the variant assumes — `Rooms.jsx:15-26`:
```jsx
const OCC_ORDER = ['occupied', 'empty', 'unknown']
const OCC_REASON = {
  occupied: { en: 'motion 20s ago', he: 'תנועה לפני 20 שניות' },
  empty: { en: 'quiet for 6 min', he: 'שקט 6 דקות' },
  unknown: { en: 'sensor not reporting', he: 'החיישן לא מדווח' },
}

function useOcc() {
  const [state, setState] = useState('occupied')
  const cycle = () => setState(s => OCC_ORDER[(OCC_ORDER.indexOf(s) + 1) % OCC_ORDER.length])
  return [state, setState, cycle]
}
```
`RoomTileBase` (the `children` slot is the top-right of the tile row) — `Rooms.jsx:39-46`. Today's baseline for comparison, `OccA` — `Rooms.jsx:48-58`.

Lab deps: `AnimatePresence`, `Icon name="users"` (lucide `Users`, via `primitives.jsx:23`), `EASE.out`/`EASE.inOut`, `.zl-tile`/`.zl-room`/`.zl-tile__icon`/`.zl-caption`, `var(--ml-mono)` (lab font var, `lab.css`). **`x: 14` is a physical-axis offset** — in RTL it must flip; the lab does not do this (`OccF`'s note at `Rooms.jsx:165` is explicit that *it* uses the leading edge for that reason). The port must use a direction-aware sign, as `OriginE` does (`lab/sections/Devices.jsx:147`: `const from = rtl ? -150 : 150`).

### 9b. Production landing sites

**(i) Dashboard.jsx `RoomTileFace` — `frontend/src/pages/Dashboard.jsx:453-551`.** The occupancy pill the pick names, `Dashboard.jsx:479-485`:
```jsx
  const chips = (summary.tempSensor || summary.humSensor || summary.occupied) && (
    <div style={{ display: 'flex', gap: 4, alignItems: 'center', minWidth: 0 }}>
      {summary.occupied && (
        <span title={t('rooms.occupied')} aria-label={t('rooms.occupied')} style={{ ...chipBase, background: 'color-mix(in srgb, var(--ok) 55%, transparent)', color: photo ? '#fff' : 'var(--ink)' }}>
          <User size={14} strokeWidth={2} aria-hidden="true" />
        </span>
      )}
```
This is the exact code the lab's found note calls out (`lab/sections/Rooms.jsx:417`): *"Occupancy renders as a User-glyph chip only when `occupied === true`; false and null are indistinguishable (Dashboard.jsx:481). The chip mounts and unmounts with no transition."* — confirmed: `{summary.occupied && (...)}` is a bare conditional with **no `AnimatePresence`**, so there is no exit at all, and `empty` vs `unknown` both render nothing.

`chipBase` (shared by occupancy, temp and humidity) — `Dashboard.jsx:471-478`:
```jsx
  const chipNeutralBg = photo ? 'rgba(0,0,0,0.32)' : 'var(--surface)'
  const chipFg        = photo ? '#fff' : 'var(--ink)'
  const chipBase = {
    fontSize: 12, lineHeight: '16px', color: chipFg, fontVariantNumeric: 'tabular-nums',
    padding: '4px 8px', borderRadius: 999, backdropFilter: 'blur(8px)',
    border: photo ? 'none' : '0.5px solid var(--line)',
    display: 'inline-flex', alignItems: 'center', gap: 4,
  }
```
The chip's host row (where the mark would enter from) — `Dashboard.jsx:514-526`:
```jsx
  // One top row carries the room mark, the sensor chips and the activity dot,
  // so nothing can land in the same corner as anything else. On a photo the
  // room mark is the photo itself, so that slot stays empty.
  const topRow = (mark) => (
    <div style={{
      position: 'absolute', top: 12, insetInline: 12,
      display: 'flex', alignItems: 'center', gap: 8, minWidth: 0,
    }}>
      {mark}
      {chips}
      <span style={{ marginInlineStart: 'auto', display: 'flex', alignItems: 'center' }}>{dot}</span>
    </div>
  )
```
The separate, **unanimated** activity dot (not occupancy — on-devices-or-motion) — `Dashboard.jsx:504-513`:
```jsx
  // Activity dot — same criteria as the greeting's "N rooms active" count so
  // the two never disagree (a room with motion but no on-devices is active).
  const dot = (
    <span style={{
      flexShrink: 0,
      width: 8, height: 8, borderRadius: '50%',
      background: isActiveRoom ? 'var(--ok)' : (photo ? 'rgba(255,255,255,0.3)' : 'var(--line-2)'),
      boxShadow: isActiveRoom ? '0 0 0 3px color-mix(in srgb, var(--ok) 30%, transparent)' : 'none',
    }} />
  )
```
Both the photo and the plain branch render `topRow` — `Dashboard.jsx:529-539` (plain) and `:540-550` (photo).

**The store field: `summary.occupied` — a boolean, not three states.** `Dashboard.jsx:73-74`:
```jsx
  const occupied = roomOccupancy(room, entityMap, occupancySensors)
  return { id: room.id, name: room.name, activeCount, offlineCount, parts, tempSensor, humSensor, hasMotion, occupied }
```
built in `buildRoomSummary` (`Dashboard.jsx:33-75`), with `hasMotion` separately at `:45-50`:
```jsx
  const hasMotion  = devices.some(d => {
    const e = ent(d)
    return e?.domain === 'binary_sensor'
      && ['motion', 'occupancy', 'presence'].includes(e.device_class)
      && e.state === 'on'
  })
```
**For variant D's three states, `roomOccupancy` must return `'occupied' | 'empty' | 'unknown'`** (or `true | false | null`) instead of a boolean — the "unknown is a quiet ?" branch (`lab/sections/Rooms.jsx:115`) has no data source today.

**(ii) Rooms.jsx `RoomTile` — `frontend/src/pages/Rooms.jsx:125-290`.** Its occupancy chip, `Rooms.jsx:218-225`:
```jsx
        {(room.tempSensor || room.humSensor || room.occupied) && (
          <div style={{ position: 'absolute', top: photo ? 12 : 48, insetInlineStart: 12, display: 'flex', gap: 4, alignItems: 'center', flexWrap: 'wrap' }}>
            {room.occupied && (
              <span title={t('rooms.occupied')} aria-label={t('rooms.occupied')}
                style={{ ...chipBase, background: photo ? 'color-mix(in srgb, var(--ok) 55%, transparent)' : 'color-mix(in srgb, var(--ok) 14%, var(--surface))', color: photo ? '#fff' : 'var(--ok-text)', padding: 4 }}>
                <User size={14} strokeWidth={2} aria-hidden />
              </span>
            )}
```
Same bare conditional. `chipBase` here — `Rooms.jsx:159-161`. The Rooms tile's own status dot (`hasActive`, `Rooms.jsx:205-212`) is additionally hidden on hover (`{!hovered && ...}`), which an exit animation would fight.

i18n key for both: `rooms.occupied` → `'Occupied'` (`lib/i18n/en.js:739`).

**(iii) `data-motion-live` — `frontend/src/motion/motion.css:316-327`:**
```css
/* ── Live status ─────────────────────────────────────────────────────────
 * The one loop in the whole layer, and it earns it: a room that is occupied
 * right now is a continuously true reading, not an event. It stops dead
 * under reduced motion, and the state is always also carried by a word. */

[data-motion="on"] [data-motion-live="true"] {
  animation: zm-breathe 4s ease-in-out infinite;
}
@keyframes zm-breathe {
  0%, 100% { opacity: 0.55; }
  50%      { opacity: 1; }
}
```
reduced-motion kills at `motion.css:364` and `:372`.

**Confirmed dead.** `grep -rn "data-motion-live" frontend/src/` returns only: the CSS above (`:321`, `:364`, `:372`), the lab's own found notes (`lab/sections/Rooms.jsx:418`, `lab/sections/Overview.jsx:12`), and the README's own admission — `frontend/src/motion/README.md:92`:
```
| `data-motion-live="true"` | **UNWIRED** — nothing emits this | would breathe; see the rules above |
```
No component emits it. Variant D does **not** need it (it has no loop) — but the period is 4s here vs the lab's `breath: 3` knob, so if the owner also wants `OccB`'s pulse, the two must be reconciled.

---

## Pick 10 — `environment` variant B "Number glides + corner wash"

### 10a. Lab implementation

Entry — `frontend/src/lab/sections/Rooms.jsx:442` (this Demo has **no knobs**, `:438-444`):
```jsx
          { key: 'B', label: 'Number glides + corner wash', note: 'The number glides on a spring while the chip and a corner wash change colour with it.', render: (p) => <EnvDemo {...p} variant="B" /> },
```
`TempTile` — A/B/C share one component; B is `roll = true, thermal = false`. `frontend/src/lab/sections/Rooms.jsx:205-238`:
```jsx
function TempTile({ value, tx, variant = 'A' }) {
  const t = useT()
  const roll = variant !== 'A'; const thermal = variant === 'C'
  const spring = useSpring(value, tx({ stiffness: 120, damping: 20 }))
  useEffect(() => { spring.set(value) }, [value, spring])
  const text = useTransform(spring, (v) => v.toFixed(1))
  // C: the tile's background is a function of the live value, not of a threshold
  const bg = useTransform(spring, (v) => thermalMix(v))
  const iconBg = useTransform(spring, (v) => thermalMix(v, 45))
  const cold = value < 18; const hot = value > 25
  const prev = useRef(value); const [trend, setTrend] = useState(0)
  useEffect(() => { setTrend(Math.sign(value - prev.current)); prev.current = value }, [value])
  return (
    <motion.div className="zl-tile zl-room" style={{ minHeight: 140, position: 'relative', overflow: 'hidden', background: thermal ? bg : undefined }}>
      {!thermal && <motion.div animate={{ opacity: cold || hot ? 1 : 0, background: cold ? 'radial-gradient(100% 70% at 100% 0%, color-mix(in srgb, var(--info) 22%, transparent), transparent 70%)' : 'radial-gradient(100% 70% at 100% 0%, color-mix(in srgb, var(--err) 22%, transparent), transparent 70%)' }} transition={tx({ duration: 0.6 })} style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }} />}
      <div className="zl-tile__row" style={{ position: 'relative' }}>
        <motion.span className="zl-tile__icon" style={{ background: thermal ? iconBg : undefined }}><Icon name="bed-double" /></motion.span>
        {thermal ? (
          ...
        ) : (
          <motion.span className="zl-chip zl-mono" animate={{ backgroundColor: cold ? 'color-mix(in srgb, var(--info) 18%, var(--surface))' : hot ? 'color-mix(in srgb, var(--err) 18%, var(--surface))' : 'var(--surface-2)', color: cold ? 'var(--info)' : hot ? 'var(--err-text)' : 'var(--ink-2)' }} transition={tx({ duration: 0.4 })} style={{ height: 24, fontSize: 12, borderColor: 'transparent' }}>
            {roll ? <motion.span>{text}</motion.span> : value.toFixed(1)}°
          </motion.span>
        )}
      </div>
      <div style={{ position: 'relative' }}><div className="zl-tile__name">{t({ en: 'Bedroom', he: 'חדר שינה' })}</div><div className="zl-tile__meta">{t(COPY.allOff)}</div></div>
    </motion.div>
  )
}
```
Variant B's four mechanics:
1. **`useSpring(value, {stiffness:120, damping:20})`** + `spring.set(value)` on change (`Rooms.jsx:208-209`) — the glide.
2. **`useTransform(spring, v => v.toFixed(1))`** rendered as `<motion.span>{text}</motion.span>` (`:210`, `:231`) — the digits track the spring, one decimal, no re-render per frame.
3. **The corner wash**: an absolutely-positioned `inset:0` div with a `radial-gradient(100% 70% at 100% 0%, …)` (top-trailing corner), `opacity` 0↔1 and `background` crossfading info↔err over **0.6s** (`:219`).
4. **The chip tint**: `animate={{backgroundColor, color}}` over **0.4s** at the `18` / `25` thresholds (`:230`).

`EnvDemo` (the step buttons + the per-variant caption) — `Rooms.jsx:240-252`; `thermalMix` (C only) — `Rooms.jsx:199-203`.

Lab deps: `useSpring`, `useTransform` (framer), `.zl-chip`, `.zl-mono`, `.zl-tile__icon`, `COPY.allOff`, `Icon name="bed-double"`.

### 10b. Production landing sites

**(i) Dashboard.jsx temperature chip — `frontend/src/pages/Dashboard.jsx:486-496`:**
```jsx
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
```
and the humidity chip — `Dashboard.jsx:497-501`:
```jsx
      {summary.humSensor && (
        <span style={{ ...chipBase, background: chipNeutralBg }}>
          {parseFloat(summary.humSensor.state).toFixed(0)}%
        </span>
      )}
```
Thresholds documented at `Dashboard.jsx:467-470`:
```jsx
  // Chip fills sit on a photo (dark wash) or on the plain surface (surface-2).
  // Temperature is tinted by the same indoor-comfort thresholds as the Rooms
  // page (<18°C cool, 18–25°C neutral, >25°C warm); the unit is sniffed from
  // HA's unit_of_measurement so °F sensors get the same thresholds.
```
Four facts for the port:
- **`<span>`, not `motion.span`** → the `bg` switch is a hard cut; `chipBase` (`:473-478`) sets no `transition`. (The generic `.z-chip` rule in `motion.css:115-131` would give it 200ms, but this is an inline-styled bare span with no class, so it is unreachable.) Exactly the lab's found note, `lab/sections/Rooms.jsx:419`.
- **`raw.toFixed(1)`** already matches the lab's one decimal.
- **The number is `raw`, the colour is `tempC`** — the F→C normalisation applies to the threshold only. The lab's variant B springs `value` directly; the port must spring `raw` for the digits and derive the tint from the converted value, or they will disagree on an °F sensor.
- There is **no corner wash element** on the tile at all. The lab's wash is `inset:0` inside a tile that is `overflow:hidden` — the Dashboard tile is the `CarouselRoomTile` div (`Dashboard.jsx:665-684`, `overflow:'hidden'` at `:673`) or `GridRoomTile`; the wash must go inside `RoomTileFace`, **under** the photo scrim at `Dashboard.jsx:543`:
```jsx
      <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg, transparent 40%, rgba(0,0,0,0.72) 100%)' }} />
```
On a photo tile the lab's 22% radial gradient will be nearly invisible under that 72% black scrim — the port needs a photo/plain split like `chipNeutralBg` already has.

`summary.tempSensor` / `humSensor` come from `findRoomMetric` — `Dashboard.jsx:51-56`:
```jsx
  // findRoomMetric also walks each device's _group.metrics so a multi-sensor
  // node (Roni Room Sensor: temp + humidity + battery) keeps surfacing
  // humidity as a Dashboard chip even though grouping absorbed humidity into
  // the temperature primary's siblings.
  const tempSensor = findRoomMetric(devices, 'temperature', entityMap)
  const humSensor  = findRoomMetric(devices, 'humidity',    entityMap)
```
Updated on WS by `deviceStore.updateEntityState`'s `ziggyRooms` patch — `frontend/src/stores/deviceStore.js:626-646`, specifically `:638-642`:
```jsx
          devices: r.devices.map((d) =>
            d.entity_id === entityId
              ? { ...d, ha_state: state, ha_attributes: { ...(d.ha_attributes || {}), ...attributes } }
              : d
          ),
```
A spring only glides if the component **does not remount** between values; `buildRoomSummary` is called inside a `useMemo` (`Dashboard.jsx:1132`) keyed on the rooms array, and `CarouselRoomTile`/`GridRoomTile` are keyed on `room.id` — so identity survives. Good.

**(ii) Rooms.jsx tile chips — `frontend/src/pages/Rooms.jsx:226-249`:**
```jsx
            {room.tempSensor && (() => {
              const raw = parseFloat(room.tempSensor.state)
              const unit = room.tempSensor.unit_of_measurement
                        || room.tempSensor.attributes?.unit_of_measurement
                        || '°C'
              const tempC = unit.includes('F') ? (raw - 32) * 5 / 9 : raw
              const bg = photo
                ? (tempC < 18 ? 'color-mix(in srgb, var(--info) 55%, transparent)'
                  : tempC > 25 ? 'color-mix(in srgb, var(--err) 55%, transparent)'
                  : 'rgba(0, 0, 0, 0.32)')
                : (tempC < 18 ? 'color-mix(in srgb, var(--info) 14%, var(--surface))'
                  : tempC > 25 ? 'color-mix(in srgb, var(--err) 14%, var(--surface))'
                  : 'var(--surface)')
              return (
                <span style={{ ...chipBase, fontVariantNumeric: 'tabular-nums', background: bg }}>
                  {raw.toFixed(1)}°
                </span>
              )
            })()}
            {room.humSensor && (
              <span style={{ ...chipBase, fontVariantNumeric: 'tabular-nums', background: photo ? 'rgba(0,0,0,0.32)' : 'var(--surface)' }}>
                {parseFloat(room.humSensor.state).toFixed(0)}%
              </span>
            )}
```
Same shape, but with a **photo/plain mix-percentage split already done** (55% on photo, 14% on plain) — that is the pattern the corner wash should copy. Comment at `Rooms.jsx:214-217`. Note the Rooms chips are `tabular-nums` per-chip while Dashboard's `chipBase` carries `fontVariantNumeric` for all of them (`Dashboard.jsx:474`) — a gliding number **requires** tabular to avoid width jitter, so Dashboard is fine and Rooms is fine, but any new chip must not forget it.

---

## Pick 11 — `longpress` variant B "Progress ring + cascade" (cascade 0.07)

### 11a. Lab implementation

Knob + entry — `frontend/src/lab/sections/Rooms.jsx:447` / `:451`:
```jsx
        knobs={[{ key: 'cascade', label: 'Cascade gap (B, C)', min: 0, max: 0.2, step: 0.01, value: 0.07, unit: 'ms' }]}
...
          { key: 'B', label: 'Progress ring + cascade', note: 'Recommended. A ring fills around the room icon while you hold (so you know it is a hold, and how long); on commit the room\'s lights go off one after another, 70ms apart, and the count rolls down. No toast. It wins over C because the ring is a bounded progress: it tells you when the hold will land.', render: (p) => <LongPressDemo {...p} variant="B" /> },
```
`LongPressDemo` — A/B/C in one. Variant B's parts, from `frontend/src/lab/sections/Rooms.jsx:256-346`:

The hold engine (`progress` MotionValue + a `0.48s` linear animation + a `480ms` timer) — `Rooms.jsx:286-292`:
```jsx
  const start = () => {
    setHolding(true)
    if (variant === 'B') ctrl.current = animate(progress, 1, tx({ duration: 0.48, ease: 'linear' }))
    timer.current = setTimeout(() => { setHolding(false); fire() }, ms(480))
  }
  const cancel = () => { setHolding(false); clearTimeout(timer.current); ctrl.current?.stop(); animate(progress, 0, tx({ duration: 0.16 })) }
  const dash = useTransform(progress, [0, 1], [126, 0])
```
The cascade (`fire`, B branch) — `Rooms.jsx:270-285`:
```jsx
  const fire = () => {
    const target = count > 0 ? false : true
    if (variant === 'A') { setOn(Object.fromEntries(lights.map(l => [l.id, target]))); setToast(`${t(room.name)} · ${target ? t(COPY.on) : t(COPY.off)}`); setTimeout(() => setToast(null), ms(2000)); h('medium'); return }
    if (variant === 'C') {
      ...
    }
    // B: cascade, one tile after another
    lights.forEach((l, i) => setTimeout(() => { setOn(o => ({ ...o, [l.id]: target })); h('selection') }, ms(i * knobs.cascade * 1000)))
    h('medium')
  }
```
The ring SVG (B only), the tile press, and the pointer wiring — `Rooms.jsx:303-308`:
```jsx
          <motion.div className="zl-tile zl-room" animate={{ scale: holding ? 0.97 : 1 }} transition={tx({ duration: 0.16, ease: EASE.out })} style={{ minHeight: 140, position: 'relative', touchAction: 'none', userSelect: 'none', overflow: 'visible', zIndex: 1 }}
            onPointerDown={(e) => { try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* synthetic pointer */ } start() }} onPointerUp={cancel} onPointerCancel={cancel} onPointerLeave={cancel}>
            <div className="zl-tile__row">
              <span className="zl-tile__icon" ref={iconRef} style={{ position: 'relative', overflow: 'visible' }}>
                <Icon name="sofa" />
                {variant === 'B' && <svg width="44" height="44" viewBox="0 0 44 44" style={{ position: 'absolute', inset: -4, transform: 'rotate(-90deg)', pointerEvents: 'none' }}><motion.circle cx="22" cy="22" r="20" fill="none" stroke="var(--accent)" strokeWidth="2.5" strokeDasharray="126" style={{ strokeDashoffset: dash }} strokeLinecap="round" /></svg>}
```
The count that rolls down — `Rooms.jsx:320-326`:
```jsx
            <div>
              <div className="zl-tile__name">{t(room.name)}</div>
              <div className="zl-tile__meta" style={{ display: 'flex', gap: 4 }}>
                <AnimatePresence mode="popLayout" initial={false}><motion.span key={count} initial={{ y: 8, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: -8, opacity: 0 }} transition={tx({ duration: 0.18 })} style={{ display: 'inline-block', minWidth: 10 }}>{count}</motion.span></AnimatePresence>
                <span>{t({ en: 'lights on', he: 'אורות דולקים' })}</span>
              </div>
            </div>
```
with `count` at `Rooms.jsx:269`: `const count = Object.values(on).filter(Boolean).length`

The per-light tiles that receive the cascade — `Rooms.jsx:293-298`:
```jsx
  const lightTile = (l, extraStyle) => (
    <motion.div key={l.id} ref={(el) => { lightRefs.current[l.id] = el }} animate={{ background: on[l.id] ? 'var(--accent-2)' : 'var(--surface-2)', color: on[l.id] ? 'var(--accent-text)' : 'var(--ink-mute)', scale: on[l.id] ? 1 : 0.94 }} transition={tx({ duration: 0.22, ease: EASE.out })} style={{ borderRadius: 12, height: 44, display: 'grid', placeItems: 'center', position: 'relative', ...extraStyle }}>
      <Icon name="lightbulb" size={18} />
      {variant === 'C' && ranks[l.id] && <span className="zl-caption" style={{ position: 'absolute', top: 3, insetInlineEnd: 5, fontFamily: 'var(--ml-mono)', fontSize: 9, opacity: 0.6 }}>{ranks[l.id]}</span>}
    </motion.div>
  )
```
and the grid they sit in — `Rooms.jsx:335-339`. Variant A's toast (which B **removes**) — `Rooms.jsx:342`.

Numbers: ring fill **0.48s linear** (`strokeDasharray="126"`, `strokeDashoffset` 126→0, rotated −90°), cancel **0.16s**, hold **480ms**, tile press **scale 0.97 / 0.16s**, cascade **70ms per light**, per-light tint **0.22s**, count roll **0.18s**, haptics `h('selection')` per light + `h('medium')` on commit.

Lab deps: `useMotionValue`, `useTransform`, imperative `animate()`, `ms()` for the cascade (replace with literal ms), `.zl-tile`/`.zl-room`/`.zl-tile__icon`/`.zl-tile__meta`, `devicesInRoom` mock (`lab/mock/home`), `.ml-hint` (`lab.css:139`, the "press and hold" affordance text — drop).

### 11b. Production landing sites

**(i) `useLongPress` — `frontend/src/motion/gestures.js:12-57`** (the pick's `:15-57`):
```js
// ── Long-press vs tap ───────────────────────────────────────────────────
// A press that travels more than 8px is neither: it is a scroll or a scrub.

export function useLongPress({ onLongPress, onTap, ms = 480, enabled = true } = {}) {
  const timer = useRef(null)
  const fired = useRef(false)
  const start = useRef(null)

  const cancel = useCallback(() => {
    clearTimeout(timer.current)
    start.current = null
  }, [])

  const onPointerDown = useCallback((e) => {
    if (!enabled || !isMotionOn()) return
    if (e.pointerType === 'mouse' && e.button !== 0) return
    fired.current = false
    start.current = { x: e.clientX, y: e.clientY }
    clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      fired.current = true
      start.current = null
      haptic('medium')
      onLongPress?.(e)
    }, ms)
  }, [enabled, onLongPress, ms])

  const onPointerMove = useCallback((e) => {
    if (!start.current) return
    if (Math.hypot(e.clientX - start.current.x, e.clientY - start.current.y) > 8) cancel()
  }, [cancel])

  const onClick = useCallback((e) => {
    if (fired.current) { fired.current = false; e.preventDefault(); e.stopPropagation(); return }
    onTap?.(e)
  }, [onTap])

  useEffect(() => () => clearTimeout(timer.current), [])

  if (!enabled || !isMotionOn()) return { onClick: onTap }
  return {
    onPointerDown, onPointerMove,
    onPointerUp: cancel, onPointerCancel: cancel, onPointerLeave: cancel,
  onClick,
  }
}
```
**The gap:** `ms = 480` and `haptic('medium')` already match the lab exactly. What is missing is **any progress output**. The hook exposes no `holding` flag and no progress value — it must gain either `onHoldStart`/`onHoldCancel` callbacks or return `{ holding, progress }` (a `MotionValue`, as the lab does). Also: the lab captures the pointer (`setPointerCapture`, `Rooms.jsx:304`); `useLongPress` does **not** — it relies on `onPointerLeave` to cancel. And the lab cancels on *any* leave; production additionally cancels on an 8px travel (`gestures.js:39-42`), which is better and must be kept.

**(ii) Rooms.jsx — `frontend/src/pages/Rooms.jsx:134-147`** (the pick's `:136-155`):
```jsx
  // Tap still opens the room, and hands the shared-element morph the rectangle
  // the photo occupied so the room page can start from it. A 480ms press
  // toggles the room's lights instead. With the layer off useLongPress returns
  // the plain onClick it was given, so this is exactly today's behaviour —
  // and because the inner element is a real <button>, Enter and Space come
  // through the same onTap path and get the same transition.
  const press = useLongPress({
    ms: 480,
    onTap: (e) => {
      captureOriginFromEvent(`room:${room.id}`, e, '[data-room-photo]')
      onClick?.(e)
    },
    onLongPress: () => toggleRoomLights(room, roomName, addToast, t),
  })
```
`...press` is spread on the inner `<button>` — `Rooms.jsx:185-188`:
```jsx
      <button {...press} style={{
        width: '100%', height: '100%', padding: 0, border: 'none', background: 'transparent',
        cursor: 'pointer', display: 'block', position: 'relative', color: 'inherit',
      }}>
```
and `:149-155` is the morph-return ref that shares that node:
```jsx
  const nameRef = useRef(null)
  const morphRef = useMorphReturn(`room-back:${room.id}`, { contentRef: nameRef })
```
**No `touchAction:'none'`, no `userSelect:'none'`** on this button — the lab sets both (`Rooms.jsx:303`) and they are needed for a hold on touch.

**The icon the ring must wrap, on a Rooms tile, exists only in the plain (no-photo) branch** — `Rooms.jsx:196-200`:
```jsx
          /* Plain tile: the room's line glyph top-left, name in ink below */
          <div style={{ position: 'absolute', top: 12, insetInlineStart: 12, color: 'var(--ink-mute)', display: 'flex' }}>
            <Home size={28} strokeWidth={1.75} aria-hidden />
          </div>
```
On a photo tile **there is no icon at all** (`Rooms.jsx:189-194`; and `Dashboard.jsx:516` says so explicitly: *"On a photo the room mark is the photo itself, so that slot stays empty"*). So the progress ring has **no host on a photo tile** — it must either ring the status dot (`Rooms.jsx:205-212`), ring the tile border, or the design must add a mark.

**(iii) `toggleRoomLights` — `frontend/src/pages/Rooms.jsx:109-123`:**
```jsx
  const lights = (room.devices || []).filter(d => {
    const domain = d.domain || d.entity_id?.split('.')[0]
    return domain === 'light' && d.entity_id
  })
  if (!lights.length) return
  const anyOn = lights.some(d => d.ha_state === 'on')
  try {
    await Promise.all(lights.map(d => controlDevice(d.entity_id, anyOn ? 'turn_off' : 'turn_on')))
    addToast(`${roomLabel} · ${anyOn ? t('rooms.offToast') : t('rooms.onToast')}`, 'success')
    try { await useDeviceStore.getState().fetchAll({ force: true }) } catch {}
  } catch (e) {
    addToast(e?.message || t('rooms.failedShort'), 'error')
  }
}
```
**This is the second blocker.** `Promise.all` fires all lights **simultaneously** — there is no cascade to animate. Variant B needs it to become a sequential `for…of` with a 70ms gap (or the UI cascade must be decoupled from the network, which is what the lab actually does: the lab's `setOn` is pure UI). And `addToast(…)` at `:118` is exactly the toast variant B deletes (`lab/sections/Rooms.jsx:451`: *"No toast."*), plus `fetchAll({force:true})` at `:119` is the forced refetch the lab's found note names (`lab/sections/Rooms.jsx:420`).

i18n keys to retire/keep: `rooms.onToast` → `'On'`, `rooms.offToast` → `'Off'` (`lib/i18n/en.js:763-764`), `rooms.failedShort`.

**(iv) Dashboard.jsx `useRoomTileMotion` — `frontend/src/pages/Dashboard.jsx:419-442`** (the pick's `:422-441`):
```jsx
// Tap opens the room and hands the shared-element morph the rectangle the
// photo occupied, so the room page can start from it. A 480ms press toggles
// the room's lights instead. Both degrade to nothing with the layer off:
// useLongPress hands back the plain onClick it was given, and captureOrigin
// refuses to record anything.
//
// The rectangle is resolved through `[data-room-photo]` rather than trusting
// whatever node the handlers happen to be spread on. This dashboard has two
// different room-tile surfaces — the phone carousel and the desktop grid — and
// the morph is only honest if both hand over the box that actually holds the
// photo. The attribute marks that box on each of them, and matches the one the
// Rooms page uses.
function useRoomTileMotion(room, roomLabel) {
  const navigate = useNavigate()
  const addToast = useUIStore(s => s.addToast)
  return useLongPress({
    ms: 480,
    onTap: (e) => {
      captureOriginFromEvent(`room:${room.id}`, e, '[data-room-photo]')
      navigate(`/rooms/${room.id}`)
    },
    onLongPress: () => toggleRoomLights(room, roomLabel, addToast),
  })
}
```
with Dashboard's **own duplicate** `toggleRoomLights` — `frontend/src/pages/Dashboard.jsx:398-417`:
```jsx
// ── Room-tile interaction ─────────────────────────────────────────────────────
// Long-press outcome: every light in the room follows the majority — if any of
// them is on, the press turns them all off. Uses the same catch-up refetch the
// shortcut handlers below use, because a multi-entity command is exactly the
// case where a dropped state_changed leaves tiles lying.
async function toggleRoomLights(room, roomLabel, addToast) {
  const lights = (room.devices || []).filter(d => {
    const domain = d.domain || d.entity_id?.split('.')[0]
    return domain === 'light' && d.entity_id
  })
  if (!lights.length) return
  const anyOn = lights.some(d => d.ha_state === 'on')
  try {
    await Promise.all(lights.map(d => controlDevice(d.entity_id, anyOn ? 'turn_off' : 'turn_on')))
    addToast(`${roomLabel} · ${anyOn ? tt('rooms.offToast') : tt('rooms.onToast')}`, 'success')
    try { await useDeviceStore.getState().fetchAll({ force: true }) } catch {}
  } catch (e) {
    addToast(e?.message || tt('rooms.failedShort'), 'error')
  }
}
```
**Two copies of the same function** (`Dashboard.jsx:403-417` and `Rooms.jsx:109-123`, differing only in `tt` vs `t`) — the cascade change must be made twice or the function lifted to a shared module.

Two consumers, both spreading `press` on a plain `<div>` (not a button) — `CarouselRoomTile`, `Dashboard.jsx:652-690` (hook at `:655`, spread at `:667`):
```jsx
              <div
                ref={(el) => { morphRef.current = el; tileRef?.(el) }}
                {...press}
                data-room-photo=""
```
and `GridRoomTile` at `Dashboard.jsx:755` + `:793`.

**The count that must roll down.** On the tile, that is the status line — `Dashboard.jsx:457-466`:
```jsx
  const statusLine = (
    <>
      {summary.activeCount > 0
        ? t('dashboard.activeShort', { n: summary.activeCount })
        : summary.hasMotion
          ? t('dashboard.motion')
          : t('dashboard.idle')}
      {showParts && summary.parts.length > 0 && ` · ${summary.parts[0]}`}
    </>
  )
```
rendered at `Dashboard.jsx:535` (plain) and `:547` (photo). `activeCount` is **not just lights** — `Dashboard.jsx:58`:
```jsx
  const activeCount  = lights.length + media.length + climate.length + fans.length + switches.length + vacuums.length
```
so "N active" rolling down by one per light in the cascade is only honest if the room has no other active devices. i18n: `dashboard.activeShort` → `'{n} active'` (`lib/i18n/en.js:2644`), `dashboard.motion` → `'motion'` (`:2642`), `dashboard.idle` → `'idle'` (`:2643`). **Critically, `{n}` is interpolated inside a translated string**, so the digit cannot be isolated for a roll without splitting the key — the same problem pick 12 has. On Rooms.jsx the equivalent is `countLine`, `Rooms.jsx:163-168`:
```jsx
  const countLine = (
    <>
      {room.entityCount} · {hasActive ? t('rooms.someOn', { n: room.activeCount }) : t('rooms.idle')}
      {room.offlineCount > 0 && <> · {t('rooms.nOff', { n: room.offlineCount })}</>}
    </>
  )
```
(`rooms.someOn` → `'{n} on'`, `lib/i18n/en.js:709`; `rooms.idle` → `'idle'`, `:710`.) Here `room.entityCount` **is** a bare JSX expression and could roll without touching i18n.

---

## Pick 12 — `status` variant C "Only the word changes"

### 12a. Lab implementation

Entry — `frontend/src/lab/sections/Rooms.jsx:455-461` (no knobs):
```jsx
      <Demo id="status" title="Home status line" purpose="The dashboard's first line is the house's mood. When it changes, let it change." principles={['state', 'restraint']} inZiggy={['Dashboard.jsx:1245-1279 greeting block']}
        recommend="C"
        variants={[
          { key: 'A', label: 'Swap (today)', render: (p) => <StatusLine {...p} variant="A" /> },
          { key: 'B', label: 'Line replaces line', note: 'Old line leaves up with a 3px blur, new line arrives from below. The dot\'s halo grows. 320ms; rare enough to be a moment.', render: (p) => <StatusLine {...p} variant="B" /> },
          { key: 'C', label: 'Only the word changes', note: 'Recommended, and usually the best one. The hero line is split into words; "Home is" never moves, only "awake" ↔ "calm" crossfades with a 4px blur and 8px of travel, and the dot\'s halo springs wider. In the count line only the digit rolls. The eye is told exactly what changed. Restraint: the event is one word, so one word moves.', tradeoff: 'Word-level splitting must be done per language ("הבית ער" has a different stem); the copy layer has to expose the parts, not a sentence.', spec: () => 'word in 280 ms ease-out · out 180 ms · halo spring 500 ms b0.2', render: (p) => <StatusLine {...p} variant="C" /> },
        ]} />
```
`StatusLine` — the whole component, with the **stem/word split** at `:356-359`. `frontend/src/lab/sections/Rooms.jsx:350-406`:
```jsx
function StatusLine({ variant, tx }) {
  const t = useT(); const h = useHaptic()
  const [active, setActive] = useState(2)
  const awake = active > 0
  const line = awake ? t({ en: `${active} room${active === 1 ? '' : 's'} active`, he: `${active} חדרים פעילים` }) : t({ en: 'All quiet', he: 'הכל שקט' })
  const title = awake ? t({ en: 'Home is awake', he: 'הבית ער' }) : t({ en: 'Home is calm', he: 'הבית רגוע' })
  // C: the hero line split into a fixed stem and the one word that changes
  const stem = t({ en: 'Home is', he: 'הבית' })
  const word = awake ? t({ en: 'awake', he: 'ער' }) : t({ en: 'calm', he: 'רגוע' })
  const wordTx = tx({ duration: 0.28, ease: EASE.out })
  return (
    <Page>
      <div className="zl-caption zl-mute" style={{ textTransform: 'uppercase', letterSpacing: '.06em' }}>{t(COPY.greeting)}</div>
      <div style={{ minHeight: 44, marginTop: 4 }}>
        {variant === 'A' ? <h1 className="zl-large" style={{ margin: 0 }}>{title}</h1> : variant === 'C' ? (
          <h1 className="zl-large" style={{ margin: 0, display: 'flex', gap: '0.28em', alignItems: 'baseline' }}>
            <span>{stem}</span>
            <span style={{ position: 'relative', display: 'inline-grid' }}>
              <AnimatePresence mode="popLayout" initial={false}>
                <motion.span key={word} layout initial={{ opacity: 0, y: 8, filter: 'blur(4px)' }} animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }} exit={{ opacity: 0, y: -8, filter: 'blur(4px)', transition: tx({ duration: 0.18, ease: EASE.out }) }} transition={wordTx} style={{ display: 'inline-block', color: awake ? 'var(--ink)' : 'var(--ink-2)' }}>{word}</motion.span>
              </AnimatePresence>
            </span>
          </h1>
        ) : (
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.h1 key={title} initial={{ opacity: 0, y: 10, filter: 'blur(3px)' }} animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }} exit={{ opacity: 0, y: -10, filter: 'blur(3px)' }} transition={tx({ duration: 0.32, ease: EASE.out })} className="zl-large" style={{ margin: 0 }}>{title}</motion.h1>
          </AnimatePresence>
        )}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
        <span style={{ position: 'relative', width: 10, height: 10, display: 'grid', placeItems: 'center' }}>
          <motion.span animate={{ background: awake ? 'var(--ok)' : 'var(--line-2)', boxShadow: awake ? (variant === 'C' ? '0 0 0 5px color-mix(in srgb, var(--ok) 22%, transparent)' : '0 0 0 3px color-mix(in srgb, var(--ok) 30%, transparent)') : '0 0 0 0px transparent' }} transition={variant === 'C' ? tx({ type: 'spring', duration: 0.5, bounce: 0.2 }) : tx({ duration: 0.3 })} style={{ width: 8, height: 8, borderRadius: 999 }} />
        </span>
        {variant === 'A' ? <span className="zl-subhead zl-mute">{line}</span> : variant === 'C' ? (
          // only the number rolls; "rooms active" stays put. Crossing zero swaps the whole phrase (it has to).
          <span className="zl-subhead zl-mute" style={{ display: 'inline-flex', gap: 4 }}>
            <AnimatePresence mode="popLayout" initial={false}>
              {awake ? (
                <motion.span key="n" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={tx({ duration: 0.16 })} style={{ display: 'inline-flex', gap: 4 }}>
                  <span style={{ display: 'inline-grid', minWidth: '0.7em' }}><AnimatePresence mode="popLayout" initial={false}><motion.span key={active} initial={{ y: 8, opacity: 0, filter: 'blur(2px)' }} animate={{ y: 0, opacity: 1, filter: 'blur(0px)' }} exit={{ y: -8, opacity: 0, filter: 'blur(2px)', transition: tx({ duration: 0.14 }) }} transition={tx({ duration: 0.22, ease: EASE.out })} className="zl-mono" style={{ display: 'inline-block' }}>{active}</motion.span></AnimatePresence></span>
                  <span>{t({ en: `room${active === 1 ? '' : 's'} active`, he: 'חדרים פעילים' })}</span>
                </motion.span>
              ) : <motion.span key="q" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={tx({ duration: 0.2 })}>{t({ en: 'All quiet', he: 'הכל שקט' })}</motion.span>}
            </AnimatePresence>
          </span>
        ) : (
          <AnimatePresence mode="popLayout" initial={false}><motion.span key={line} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={tx({ duration: 0.2 })} className="zl-subhead zl-mute">{line}</motion.span></AnimatePresence>
        )}
      </div>
```
Variant C, decomposed — **four** independent changes:
1. **Hero split into `stem` + `word`** (`:357-358`), the `<h1>` becomes `display:flex, gap:'0.28em', alignItems:

baseline'` (`:365`), the word lives in an `inline-grid` wrapper (`:367`) so the swap does not reflow, and the exiting/entering word carries `y: ±8` + `filter: blur(4px)` with **enter 0.28s / exit 0.18s** (`:369`).
2. **The dot's halo springs wider**: variant C uses `0 0 0 5px` at 22% vs B's `0 0 0 3px` at 30%, on a `spring duration 0.5 bounce 0.2` instead of a 0.3s tween (`:381`).
3. **The count line: only the digit rolls.** The digit sits in its own `inline-grid, minWidth:'0.7em'` cell (`:389`) with `y: ±8` + `blur(2px)`, enter **0.22s** / exit **0.14s**, `className="zl-mono"`; the words `room(s) active` are a static sibling (`:390`).
4. **Crossing zero swaps the whole phrase** — the outer `AnimatePresence` at `:386-393` toggles between the `key="n"` number group and `key="q"` "All quiet", 0.16s/0.2s. The lab's own comment at `:384` says this is unavoidable.

The lab also carries the per-language warning in the variant's `tradeoff` (`Rooms.jsx:460`): *"Word-level splitting must be done per language ("הבית ער" has a different stem); the copy layer has to expose the parts, not a sentence."* — note the lab's own Hebrew stem is `הבית` + `ער` / `רגוע`, and its Hebrew count phrase is **not pluralised** (`חדרים פעילים` for all n, `:390`).

Lab deps: `AnimatePresence mode="popLayout"`, `layout` on the word, `filter: blur()` (not in the production layer's transform/opacity-only budget — see `motion.js:14`: *"transform and opacity only (plus clip-path for reveals)"*; this is a deliberate exception the plan must call out), `.zl-large`, `.zl-subhead`, `.zl-caption`, `.zl-mute`, `.zl-mono`, `COPY.greeting`.

### 12b. Production landing site — the greeting block

**The hero line — `frontend/src/pages/Dashboard.jsx:1202-1207`:**
```jsx
  // The flat status row below (dot + "N rooms active" + presence) already
  // shows the count. The big H1 above just communicates calm-vs-awake at a
  // glance — duplicating the count here read as repetition on mobile.
  const statusText = activeRooms.length > 0
    ? t('dashboard.homeAwake')
    : t('dashboard.homeCalm')
```
**The greeting block itself — `frontend/src/pages/Dashboard.jsx:1245-1279`** (exactly the lines the pick names):
```jsx
      <div>
        {/* No brand mark here. The greeting is this screen's header, and a logo
            above it only restates which app you opened. Ziggy's mark appears
            where it means something instead: on the chat button, and on what he
            says back. */}
        <p className="z-eyebrow" style={{ margin: '0 0 4px' }}>{greetingByTime()}</p>
        <h1 className="z-display" style={{ margin: '0 0 8px' }}>{statusText}</h1>
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
          {homePersons.length > 0 && (
            <>
              <span style={{ color: 'var(--ink-faint)', fontSize: 13 }} aria-hidden="true">·</span>
              <button
                onClick={() => navigate('/settings#presence')}
                style={{
                  background: 'none', border: 'none', padding: 0, minHeight: 40,
                  fontSize: 13, color: 'var(--ink-mute)',
                  fontFamily: 'inherit', cursor: 'pointer',
                }}
              >
                {presenceStr}
              </button>
            </>
          )}
        </div>
      </div>
```
Mapped against the lab's four changes:

| Lab C part | Production line | Port cost |
|---|---|---|
| hero stem + word | `Dashboard.jsx:1251` — one `<h1 className="z-display">{statusText}</h1>` holding a whole translated sentence | **i18n split required** (below) |
| dot halo springs | `Dashboard.jsx:1253-1255` — **two mutually-exclusive `<span>`s** with different classes, swapped by a ternary | the two spans must become **one** `motion.span` with an animated `background` + `boxShadow`; a ternary between two different nodes can never animate |
| digit rolls | `Dashboard.jsx:1256-1262` — the digit is **inside** the interpolated string `t('dashboard.roomsActiveMany', { n })` | **i18n split required** |
| zero-crossing phrase swap | same ternary at `:1257-1261` | needs `AnimatePresence` around the `<span>`; today it is a bare conditional with no exit |

**The i18n blocker, stated precisely.** The four keys that exist today:

`frontend/src/lib/i18n/en.js:2615-2616`:
```js
  'dashboard.homeCalm':           'Home is calm',
  'dashboard.homeAwake':          'Home is awake',
```
`frontend/src/lib/i18n/en.js:4212-4214`:
```js
  'dashboard.allQuiet':                 'All quiet',
  'dashboard.roomsActiveOne':           '{n} room active',
  'dashboard.roomsActiveMany':          '{n} rooms active',
```
`frontend/src/lib/i18n/he.js:2242-2243`:
```js
  'dashboard.homeCalm':           'הבית רגוע',
  'dashboard.homeAwake':          'הבית ער',
```
`frontend/src/lib/i18n/he.js:4175-4177`:
```js
  'dashboard.allQuiet':                 'הכל שקט',
  'dashboard.roomsActiveOne':           'חדר אחד פעיל',
  'dashboard.roomsActiveMany':          '{n} חדרים פעילים',
```
Every one of these is a **whole sentence**, which is exactly the lab's tradeoff note. Variant C needs, at minimum:
- `dashboard.homeStem` (`'Home is'` / `'הבית'`), `dashboard.homeWordAwake` (`'awake'` / `'ער'`), `dashboard.homeWordCalm` (`'calm'` / `'רגוע'`) — and the existing `homeAwake`/`homeCalm` kept as the reduced-motion / layer-off fallback, since the split must not change the resting string.
- `dashboard.roomsActiveOneSuffix` (`'room active'`) / `dashboard.roomsActiveManySuffix` (`'rooms active'` / `'חדרים פעילים'`) so `{n}` can be a separate node. Note the Hebrew `roomsActiveOne` is `'חדר אחד פעיל'` — **"one" is a word, not a digit**, so at n=1 Hebrew has no digit to roll and the port must fall back to a plain phrase swap for that case.
- RTL: the hero's `display:flex; gap:'0.28em'` works in both directions, but the word's `y: ±8` is vertical so it is direction-safe; nothing here needs `insetInline`.

**`activeRooms` — the value that drives both lines** — `Dashboard.jsx:1159-1161`:
```jsx
  const activeRooms = useMemo(
    () => roomSummaries.filter(r => r.activeCount > 0 || r.hasMotion),
```
(and the sort that uses the same predicate, `Dashboard.jsx:1151`). `roomSummaries` is the `useMemo` at `Dashboard.jsx:1132`. The `activeCount > 0 || hasMotion` predicate is deliberately the same one `RoomTileFace`'s dot uses — `Dashboard.jsx:456` and the comment at `:504-505`. Any change to the count's animation must not fork that predicate.

`.z-dot` / `.z-dot-on` are index.css classes (not in `motion/`), so there is no existing transition on them — confirmed by their absence from `motion.css`'s generic-surface list (`motion.css:115-131` covers `.z-card`, `.z-chip`, `.z-pill`, `.z-icon-btn`, `.z-btn-primary`, `.z-btn-secondary`, `.z-nav-item`, `.z-input` — **not** `.z-dot`).

### 12c. The tile status line (the second half of this pick)

`Dashboard.jsx:457-466` (`statusLine`, already quoted in pick 11) is the tile-level `"{n} active" / "motion" / "idle"`. Keys: `dashboard.activeShort` `'{n} active'` (`en.js:2644`), `dashboard.motion` `'motion'` (`:2642`), `dashboard.idle` `'idle'` (`:2643`); Hebrew `'{n} פעילים'` / `'תנועה'` / `'במנוחה'` (`he.js:2269-2271`).

It is rendered in two places, both as a plain `<p>` with no animation:
- plain tile — `Dashboard.jsx:533-536`:
```jsx
        <div ref={nameRef} style={{ position: 'absolute', bottom: 16, insetInline: 16 }}>
          <p dir="auto" style={{ fontSize: 15, fontWeight: 600, color: 'var(--ink)', margin: '0 0 4px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</p>
          <p style={{ fontSize: 12, color: 'var(--ink-mute)', margin: 0, fontVariantNumeric: 'tabular-nums', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{statusLine}</p>
        </div>
```
- photo tile — `Dashboard.jsx:545-548` (identical, `color:'rgba(255,255,255,0.85)'`).

**Three conflicts with a digit roll here, all in those two lines:**
1. `whiteSpace: 'nowrap'` + `overflow:'hidden'` + `textOverflow:'ellipsis'` — an `inline-grid` digit cell inside an ellipsising nowrap `<p>` will not clip predictably; the roll needs its own non-clipping wrapper.
2. `fontVariantNumeric: 'tabular-nums'` is already there — good, the digit will not jitter.
3. `nameRef` is the **morph-return content ref** (`Dashboard.jsx:533`, consumed by `useMorphReturn` at `:663` / `:155` in Rooms) — the comment at `Dashboard.jsx:449-452` says this block *"fades in behind the motion rather than un-stretching"*. A per-digit `AnimatePresence` inside a node that the room-hero morph is already fading will produce two overlapping animations on the same text on every room-page return.

The Rooms.jsx twin is `countLine` — `frontend/src/pages/Rooms.jsx:163-168` (quoted in pick 11), rendered at `Rooms.jsx:255-260`:
```jsx
        <div ref={nameRef} style={{ position: 'absolute', bottom: 0, left: 0, right: 0, padding: 12, textAlign: 'start' }}>
          <p dir="auto" style={{ fontSize: 15, lineHeight: '22px', fontWeight: 600, color: photo ? '#fff' : 'var(--ink)', marginBottom: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{roomName}</p>
          <p className="z-mono" style={{ fontSize: 12, lineHeight: '18px', color: photo ? 'rgba(255,255,255,0.85)' : 'var(--ink-mute)' }}>
            {countLine}
          </p>
        </div>
```
This one is `.z-mono` and **has no `nowrap`/`ellipsis`** on the count line, and its leading `{room.entityCount}` is a bare expression — so it is the easier of the two to port, and the only count in the room tiles that can roll without an i18n change.

---

# Cross-pick summary of blockers to put in the plan

Ordered by how much they gate the rest:

1. **`data-pending` is a boolean, four states are needed** (pick 5). Blocks nothing else, but it is the single widest API change: 16 emitters listed. `motion.css:329-335` is the rule to replace; `DeviceCard.jsx:751-771` is where `ok`/`fail` is already known; `App.jsx:535-541` (`command_failed`) is the server-side failure that currently only toasts.
2. **No origin on the wire** (pick 4). Variant C does not need it — ship C first and leave B/E/F until `services/ha_subscriber.py:283-288` carries an origin. The cheapest source is `services/manual_overrides.was_ziggy_initiated` (already computed at `ha_subscriber.py:292-312`); a *named* person needs HA's `event.context.user_id`, which `ha_subscriber.py:235-238` never reads.
3. **Cards leave only after a refetch** (picks 1, 2). `Anomalies.jsx:425-428` (`refreshAfterChange`) and the WS handler at `:408-420`. Until removal is optimistic, the absorb/travel exits start one or two round-trips late.
4. **`toggleRoomLights` is `Promise.all`, duplicated twice** (pick 11). `Dashboard.jsx:403-417` and `Rooms.jsx:109-123`. No cascade exists to animate; the toast at `:412`/`:118` and the `fetchAll({force:true})` at `:413`/`:119` are both things the variant deletes.
5. **`useLongPress` exposes no progress** (pick 11). `motion/gestures.js:15-57`. Needs `{ holding, progress }` or hold callbacks; and on a *photo* room tile there is no icon to ring (`Rooms.jsx:189-194`, `Dashboard.jsx:516`).
6. **i18n keys are whole sentences** (picks 11, 12). `en.js:2615-2616`, `:2642-2644`, `:4212-4214`; `he.js:2242-2243`, `:2269-2271`, `:4175-4177`. Hebrew `roomsActiveOne` has no digit at all.
7. **`layoutArmed` is not armed by "Show controls"** (pick 6). `Devices.jsx:2595-2601`, `:2583`, call sites at `:2786`/`:2791`/`:2949`+. Without arming, variant B's FLIP never runs.
8. **Three travel destinations are not simultaneously mounted** (pick 3). Tasks `groupedView` at `Tasks.jsx:371` (Done is never rendered under `all`); `SuggestedTab.jsx:165` (`displayed` is one tab or the other).
9. **Occupancy is a boolean, three states are needed** (pick 9). `roomOccupancy(...)` → `summary.occupied` at `Dashboard.jsx:73-74`; `room.occupied` on the Rooms page. `data-motion-live` (`motion.css:321-327`) is confirmed emitted by nothing (`README.md:92`).
10. **`filter: blur()` is outside the layer's stated budget** (pick 12, and pick 9's `OccG`). `motion/motion.js:14`. Needs an explicit exception in the plan, plus a reduced-motion path — `motion.css:343-369` currently strips travel/scale/loops but says nothing about filters.
11. **The page-recede has no `y` MotionValue to hang off** (pick 8). `SheetSurface.jsx:26-37` explains why framer owns `y` as a prop; `paintScrim` (`:272-280`) + `settleScrim` (`:284-289`) is the imperative pattern to copy. Narrow-frame only (`:172`, `:466-467`), and the scale must be released before `handingOff` (`:176`, `:261-265`, `sheet.css:142-157`).
12. **GSAP MorphSVG is a paid plugin and is used for exactly one glyph** (pick 7). `lab/sections/Devices.jsx:6-8`, `:16`, `:451-454`. The other three (Lock, Blinds, Fan) are hand-made framer transforms on inline SVG primitives — no path interpolation — so they port with no new dependency. Production has `motion/morph.js` but it is a **rect** morph (shared-element), not a path morpher.
