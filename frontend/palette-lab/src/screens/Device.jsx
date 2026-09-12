// Device — the control screen, and the one that decides a palette.
//
// A smart-home front end lives or dies on one question: can you tell, from
// across the room, that a thing is ON? Every palette answers it differently —
// a warm gradient, a teal glow, a solid orange rectangle, or (in the
// colourless one) pure fill and weight. So the whole screen is built around
// one large surface whose job is to say "on", and the palette decides what
// that surface is made of.
//
// Three control archetypes, chosen by kind, because a light and a thermostat
// are not the same object:
//   • a LEVEL column that fills — a light's brightness, a blind's position
//   • a TEMPERATURE band with a setpoint and ± — climate
//   • a full-bleed POWER slab — plug, TV, water heater, lock
//
// No colour literals. The on-fill is assembled from the DNA: a palette with a
// gradient gets its gradient, a palette without one gets its flat on-tint, and
// the palettes with a glow get the glow.

import { useState } from 'react'
import {
  usePal, Card, H1, Text, Label, Btn, Chip, Row, Stack, Section,
  OccDot, StateBadge, Icon, IconWell,
} from '../ui'
import { DEVICES, FOCUS_DEVICE, ROOMS, ACTIVITY, OCCUPANCY_LABEL } from '../data'

const KIND_LABEL = {
  light: 'Light', tv: 'Media', climate: 'Climate', plug: 'Smart plug',
  cover: 'Blind', lock: 'Lock', water: 'Water heater',
}

const TEMP_MIN = 16
const TEMP_MAX = 30

// ── The on-expression, assembled from the DNA ───────────────────────────
// This is the only "design decision" in the file and it is made entirely out
// of palette values: gradient if the palette has one, flat tint if not.

// The flat tint is expressed as a gradient layer so it can sit UNDER a
// palette's own activeTile gradient — CSS only allows a colour in the last
// layer. Without it, the gradient palettes whose activeTile fades to
// transparent (the glass one especially) produce a fill you cannot see.
const onFill = (p) => {
  const tint = `linear-gradient(${p.c.onTint}, ${p.c.onTint})`
  // Two coats under a gradient: a tint sized for a badge is too thin once it
  // is 300px tall. Opaque tints are unaffected by the second coat, so the
  // palettes that say "on" with solid fill are untouched.
  return p.grad.activeTile
    ? `${p.grad.activeTile}, ${tint}, ${tint}, ${p.c.surface}`
    : `${tint}, ${p.c.surface}`
}
const glow = (p, on, spread = 30) =>
  on && p.c.onGlow !== 'none' ? `0 0 ${spread}px ${p.c.onGlow}` : 'none'

function bigNumberStyle(p, wide) {
  return {
    fontFamily: p.type.display,
    fontSize: wide ? Math.round(p.type.h1 * 1.9) : Math.round(p.type.h1 * 1.5),
    fontWeight: p.type.displayWeight,
    letterSpacing: p.type.tracking,
    lineHeight: 1,
    color: p.c.ink,
    fontVariantNumeric: 'tabular-nums',
    display: 'block',
  }
}

// ── Archetype 1: a column that fills ────────────────────────────────────

function LevelColumn({ value, on, from = 'bottom', height, onSet }) {
  const p = usePal()
  const pct = on ? Math.max(0, Math.min(100, value)) : 0
  const handle = (e) => {
    if (!onSet) return
    const r = e.currentTarget.getBoundingClientRect()
    const rel = (e.clientY - r.top) / r.height
    onSet(Math.round(Math.max(0, Math.min(1, from === 'bottom' ? 1 - rel : rel)) * 100))
  }
  return (
    <div
      onClick={handle}
      role="slider"
      aria-valuenow={pct}
      style={{
        position: 'relative', height, flex: '1 1 0', minWidth: 0, cursor: 'pointer',
        borderRadius: p.shape.ctl, overflow: 'hidden',
        background: p.c.surface2,
        border: `1px solid ${on ? p.c.lineStrong : p.c.line}`,
        boxShadow: glow(p, on, 26),
      }}
    >
      <div style={{
        position: 'absolute', left: 0, right: 0, [from]: 0,
        height: `${pct}%`, background: onFill(p),
        transition: 'height 240ms cubic-bezier(.2,.7,.3,1)',
      }} />
    </div>
  )
}

function LevelControl({ d, st, set, wide }) {
  const p = usePal()
  const isCover = d.kind === 'cover'
  const unitLabel = isCover ? 'Open' : 'Brightness'
  const col = (
    <Stack gap={wide ? 14 : 10} style={{ width: wide ? 260 : 148, flexShrink: 0 }}>
      <div>
        <Label style={{ marginBottom: 6 }}>{unitLabel}</Label>
        <span style={bigNumberStyle(p, wide)}>
          {st.on ? st.level : 0}
          <span style={{ fontSize: '0.42em', marginInlineStart: 2 }}>%</span>
        </span>
      </div>
      <Row gap={8} style={{ flexWrap: 'wrap' }}>
        <StateBadge on={st.on}>
          {isCover ? (st.on ? 'Open' : 'Closed') : st.on ? 'On' : 'Off'}
        </StateBadge>
        <Chip>{KIND_LABEL[d.kind]}</Chip>
      </Row>
      <Btn
        primary={!st.on}
        onClick={() => set({ on: !st.on, level: !st.on && st.level === 0 ? 60 : st.level })}
        style={{ justifyContent: 'center' }}
      >
        <Icon name={d.kind} size={16} color={st.on ? p.c.ink : p.c.accentInk} />
        {st.on ? (isCover ? 'Close' : 'Turn off') : isCover ? 'Open' : 'Turn on'}
      </Btn>
    </Stack>
  )

  return (
    <Row align="stretch" gap={p.space.gap + 2}>
      <LevelColumn
        value={st.level}
        on={st.on}
        from={isCover ? 'top' : 'bottom'}
        height={wide ? 300 : 228}
        onSet={(v) => set({ level: v, on: v > 0 })}
      />
      {col}
      {/* On a desktop the presets belong beside the surface, not in a strip
          under it — otherwise a 600px-wide dimmer sits next to dead space. */}
      {wide && (
        <Stack gap={8} style={{ width: 190, flexShrink: 0 }}>
          <Label style={{ marginBottom: 0 }}>Presets</Label>
          {presetsFor(d.kind).map((it) => (
            <Chip
              key={it.label}
              active={st.on ? st.level === it.v : it.v === 0}
              onClick={() => set({ level: it.v, on: it.v > 0 })}
              style={{ cursor: 'pointer', padding: '10px 14px', textAlign: 'start' }}
            >
              {it.label} · {it.v}%
            </Chip>
          ))}
        </Stack>
      )}
    </Row>
  )
}

// ── Archetype 2: a temperature band ─────────────────────────────────────

function TempControl({ d, st, set, wide }) {
  const p = usePal()
  const t = st.level
  const frac = (t - TEMP_MIN) / (TEMP_MAX - TEMP_MIN)
  const room = ROOMS.find((r) => r.name === d.room)
  const step = (n) => set({ level: Math.max(TEMP_MIN, Math.min(TEMP_MAX, t + n)), on: true })

  const StepBtn = ({ children, onClick }) => (
    <button
      onClick={onClick}
      style={{
        width: wide ? 64 : 52, height: wide ? 64 : 52, flexShrink: 0,
        borderRadius: p.shape.pill === 999 ? 999 : p.shape.ctl,
        background: p.c.surface2, color: p.c.ink,
        border: `1px solid ${p.c.line}`, cursor: 'pointer',
        fontFamily: p.type.display, fontSize: 24, fontWeight: p.type.displayWeight,
        lineHeight: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
    >{children}</button>
  )

  return (
    <Stack gap={wide ? 22 : 16}>
      <Row justify="space-between" align="center" gap={10}>
        <StepBtn onClick={() => step(-1)}>−</StepBtn>
        <div style={{ textAlign: 'center', minWidth: 0 }}>
          <Label style={{ marginBottom: 4 }}>Set to</Label>
          <span style={{
            ...bigNumberStyle(p, wide),
            fontSize: wide ? Math.round(p.type.h1 * 2.4) : Math.round(p.type.h1 * 1.9),
            color: st.on ? p.c.ink : p.c.inkFaint,
          }}>
            {st.on ? t : '--'}<span style={{ fontSize: '0.4em' }}>°</span>
          </span>
        </div>
        <StepBtn onClick={() => step(1)}>+</StepBtn>
      </Row>

      {/* The band: 16° → 30°, filled to the setpoint. A horizontal object on
          purpose — a thermostat must not look like a dimmer. */}
      <div>
        <div style={{
          position: 'relative', height: wide ? 74 : 58, overflow: 'hidden',
          borderRadius: p.shape.ctl, background: p.c.surface2,
          border: `1px solid ${st.on ? p.c.lineStrong : p.c.line}`,
          boxShadow: glow(p, st.on, 26),
        }}>
          <div style={{
            position: 'absolute', inset: 0, insetInlineEnd: `${(1 - (st.on ? frac : 0)) * 100}%`,
            background: onFill(p), transition: 'inset 240ms cubic-bezier(.2,.7,.3,1)',
          }} />
        </div>
        <Row justify="space-between" style={{ marginTop: 7 }}>
          <Text faint size={p.type.micro} mono>{TEMP_MIN}°</Text>
          {room && <Text mute size={p.type.micro}>Room is {room.temp.toFixed(1)}° now</Text>}
          <Text faint size={p.type.micro} mono>{TEMP_MAX}°</Text>
        </Row>
      </div>

      <Row gap={8} style={{ flexWrap: 'wrap' }}>
        {['Cool', 'Heat', 'Fan'].map((m) => (
          <Chip
            key={m}
            active={st.on && st.mode === m}
            onClick={() => set({ mode: m, on: true })}
            style={{ cursor: 'pointer', padding: '8px 14px' }}
          >{m}</Chip>
        ))}
        <Chip
          active={!st.on}
          onClick={() => set({ on: false })}
          style={{ cursor: 'pointer', padding: '8px 14px' }}
        >Off</Chip>
      </Row>
    </Stack>
  )
}

// ── Archetype 3: a slab that is simply on or off ────────────────────────

function PowerControl({ d, st, set, wide }) {
  const p = usePal()
  const isLock = d.kind === 'lock'
  // The lock's engaged state is "locked", which the sample home reports in
  // its own words; `on` for a lock is not the same fact as "live".
  const engaged = isLock ? st.locked : st.on
  const word = isLock ? (engaged ? 'Locked' : 'Unlocked') : engaged ? 'On' : 'Off'
  const toggle = () => set(isLock ? { locked: !st.locked } : { on: !st.on })

  return (
    <Stack gap={p.space.gap}>
      <div
        onClick={toggle}
        style={{
          height: wide ? 300 : 236, cursor: 'pointer',
          borderRadius: p.shape.card, overflow: 'hidden',
          background: engaged ? onFill(p) : p.c.surface,
          border: `1px solid ${engaged ? p.c.lineStrong : p.c.line}`,
          boxShadow: engaged ? glow(p, true, 40) : (p.depth.card === 'none' ? 'none' : p.depth.card),
          display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center', gap: 14,
          transition: 'background 220ms ease, box-shadow 220ms ease',
        }}
      >
        <Icon name={d.kind} size={wide ? 84 : 68} color={engaged ? p.c.onInk : p.c.inkFaint} />
        <span style={{
          ...bigNumberStyle(p, wide),
          fontSize: wide ? Math.round(p.type.h1 * 1.3) : Math.round(p.type.h1 * 1.1),
          color: engaged ? p.c.onInk : p.c.ink,
          textTransform: p.type.labelCase === 'uppercase' ? 'uppercase' : 'none',
          letterSpacing: p.type.labelCase === 'uppercase' ? p.type.labelTrack : p.type.tracking,
        }}>{word}</span>
        {/* The home reports its own words for this device; only show them when
            they add something the big state word did not already say. */}
        {d.sub.toLowerCase() !== word.toLowerCase() && (
          <span style={{
            fontFamily: p.type.body, fontSize: p.type.small, fontWeight: p.type.bodyWeight,
            color: engaged ? p.c.onInk : p.c.inkMute,
          }}>{d.sub}</span>
        )}
      </div>
      <Btn primary={!engaged} onClick={toggle} style={{ justifyContent: 'center' }}>
        {isLock ? (engaged ? 'Unlock' : 'Lock') : engaged ? 'Turn off' : 'Turn on'}
      </Btn>
    </Stack>
  )
}

// ── Presets ─────────────────────────────────────────────────────────────
// Only where the device actually has a scale to preset. A lock does not.

function presetsFor(kind) {
  if (kind === 'light') {
    return [
      { label: 'Relax', v: 20 }, { label: 'Reading', v: 40 },
      { label: 'Evening', v: 60 }, { label: 'Bright', v: 100 },
    ]
  }
  if (kind === 'climate') {
    return [{ label: 'Cool', v: 20 }, { label: 'Comfort', v: 22 }, { label: 'Eco', v: 24 }]
  }
  if (kind === 'cover') {
    return [{ label: 'Closed', v: 0 }, { label: 'Half', v: 50 }, { label: 'Open', v: 100 }]
  }
  return []
}

function Presets({ d, st, set, wide }) {
  const p = usePal()
  const items = presetsFor(d.kind)
  // Level devices carry their presets inside the control card on desktop.
  if (!items.length || (wide && d.kind !== 'climate')) return null
  const unit = d.kind === 'climate' ? '°' : '%'
  return (
    <Section label="Presets">
      <Row gap={p.space.gap === 1 ? 6 : p.space.gap} style={{ flexWrap: 'wrap' }}>
        {items.map((it) => (
          <Chip
            key={it.label}
            active={st.on ? st.level === it.v : it.v === 0}
            onClick={() => set({ level: it.v, on: d.kind === 'climate' ? true : it.v > 0 })}
            style={{ cursor: 'pointer', padding: '9px 14px' }}
          >
            {it.label} · {it.v}{unit}
          </Chip>
        ))}
      </Row>
    </Section>
  )
}

// ── Secondary: where it is, what it is, when it last moved ──────────────

function DetailRow({ k, children, last }) {
  const p = usePal()
  return (
    <Row
      justify="space-between"
      align="flex-start"
      gap={12}
      style={{
        padding: `10px 0`,
        borderBottom: last ? 'none' : `1px solid ${p.c.line}`,
      }}
    >
      <Text faint size={p.type.small} style={{
        textTransform: p.type.labelCase, letterSpacing: p.type.labelTrack,
      }}>{k}</Text>
      <div style={{ textAlign: 'end', minWidth: 0 }}>{children}</div>
    </Row>
  )
}

function Details({ d }) {
  const p = usePal()
  const room = ROOMS.find((r) => r.name === d.room)
  const change = ACTIVITY.find((a) => a.text.startsWith(d.name))
  return (
    <Card>
      <DetailRow k="Room">
        <Row gap={7} justify="flex-end">
          {room && <OccDot state={room.occupancy} />}
          <Text size={p.type.small} weight={650}>{d.room}</Text>
        </Row>
      </DetailRow>
      <DetailRow k="Kind">
        <Text size={p.type.small}>{KIND_LABEL[d.kind]}</Text>
      </DetailRow>
      <DetailRow k="Last change">
        {change
          ? <Text size={p.type.small} mono>{change.t}</Text>
          : <Text size={p.type.small} faint>No recent change</Text>}
      </DetailRow>
      <DetailRow k="Changed by" last={!room}>
        <Text size={p.type.small} mute>{change ? change.by : 'Not recorded'}</Text>
      </DetailRow>
      {room && (
        <DetailRow k={`${room.name} is`} last>
          <Stack gap={3} style={{ alignItems: 'flex-end' }}>
            <StateBadge on={room.occupancy === 'occupied'} state={room.occupancy}>
              {OCCUPANCY_LABEL[room.occupancy]}
            </StateBadge>
            <Text faint size={p.type.micro}>{room.reason}</Text>
          </Stack>
        </DetailRow>
      )}
    </Card>
  )
}

// ── The selector ────────────────────────────────────────────────────────
// Phone: an edge-to-edge strip. Desktop: a list in the side column. One
// selector per layout, never two.

function SelectorTile({ d, selected, onPick }) {
  const p = usePal()
  return (
    <button
      onClick={onPick}
      style={{
        width: 128, flexShrink: 0, padding: 0, border: 'none',
        background: 'none', textAlign: 'start', cursor: 'pointer',
        fontFamily: p.type.body,
      }}
    >
      <Card
        active={selected}
        pad={false}
        style={{
          padding: 11,
          borderColor: selected ? p.c.lineStrong : undefined,
          boxShadow: selected ? glow(p, true, 18) : undefined,
          height: '100%',
        }}
      >
        <Stack gap={8}>
          <Row justify="space-between">
            <IconWell name={d.kind} on={d.on} size={30} />
            {d.on && <OccDot state="occupied" />}
          </Row>
          <Text size={p.type.micro} weight={selected ? 750 : 600} style={{
            display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>{d.name}</Text>
        </Stack>
      </Card>
    </button>
  )
}

function SelectorRow({ d, selected, onPick }) {
  const p = usePal()
  return (
    <button
      onClick={onPick}
      style={{
        display: 'block', width: '100%', padding: 0, border: 'none',
        background: 'none', textAlign: 'start', cursor: 'pointer', fontFamily: p.type.body,
      }}
    >
      <Card
        active={selected}
        pad={false}
        style={{
          padding: '9px 12px',
          borderColor: selected ? p.c.lineStrong : undefined,
          boxShadow: selected ? glow(p, true, 16) : undefined,
        }}
      >
        <Row gap={10}>
          <IconWell name={d.kind} on={d.on} size={28} />
          <Stack gap={2} style={{ flex: 1, minWidth: 0 }}>
            <Text size={p.type.small} weight={selected ? 750 : 600} style={{
              display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>{d.name}</Text>
            <Text faint size={p.type.micro} style={{
              display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>{d.room}</Text>
          </Stack>
          <StateBadge on={d.on}>{d.on ? 'On' : 'Off'}</StateBadge>
        </Row>
      </Card>
    </button>
  )
}

// ── Screen ──────────────────────────────────────────────────────────────

function initialState(d) {
  return {
    on: d.on,
    level: typeof d.level === 'number' ? d.level : d.on ? 100 : 0,
    mode: 'Cool',
    locked: d.kind === 'lock' ? /lock/i.test(d.sub) : false,
  }
}

export default function Device({ wide }) {
  const p = usePal()
  const [id, setId] = useState(FOCUS_DEVICE.id)
  const d = DEVICES.find((x) => x.id === id) || FOCUS_DEVICE
  const [states, setStates] = useState(() =>
    Object.fromEntries(DEVICES.map((x) => [x.id, initialState(x)])))
  const st = states[d.id]
  const set = (patch) => setStates((s) => ({ ...s, [d.id]: { ...s[d.id], ...patch } }))

  const Control = d.kind === 'climate' ? TempControl
    : d.kind === 'light' || d.kind === 'cover' ? LevelControl
      : PowerControl

  const live = d.kind === 'lock' ? st.locked : st.on
  const stateWord = d.kind === 'lock' ? (live ? 'Locked' : 'Unlocked') : live ? 'On' : 'Off'
  const headerSub = d.kind === 'light' && st.on ? `${st.level}% brightness`
    : d.kind === 'climate' && st.on ? `${st.mode} to ${st.level}°`
      : d.kind === 'cover' ? `${st.on ? st.level : 0}% open`
        : d.sub.toLowerCase() === stateWord.toLowerCase() ? KIND_LABEL[d.kind]
          : d.sub

  const header = (
    <div style={{ paddingTop: wide ? p.space.gutter : 14, marginBottom: p.space.section - 6 }}>
      <Row gap={8} style={{ marginBottom: 6 }}>
        <Icon name="back" size={14} color={p.c.inkFaint} />
        <Label style={{ marginBottom: 0 }}>{d.room}</Label>
      </Row>
      <H1 style={{ marginBottom: 10 }}>{d.name}</H1>
      <Row gap={9} style={{ flexWrap: 'wrap' }}>
        <StateBadge on={live}>{stateWord}</StateBadge>
        <Text mute size={p.type.small}>{headerSub}</Text>
      </Row>
    </div>
  )

  const controlCard = (
    <Card raised style={{ marginBottom: p.space.section }}>
      <Control d={d} st={st} set={set} wide={wide} />
    </Card>
  )

  if (wide) {
    return (
      <div>
        {header}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: p.space.section }}>
          <div>
            {controlCard}
            <Presets d={d} st={st} set={set} wide />
            <Section label="About this device">
              <Details d={d} />
            </Section>
          </div>
          <div>
            <Section label="Devices">
              <Stack gap={p.space.gap === 1 ? 1 : 8}>
                {DEVICES.map((x) => (
                  <SelectorRow key={x.id} d={x} selected={x.id === d.id} onPick={() => setId(x.id)} />
                ))}
              </Stack>
            </Section>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div>
      {header}
      <div style={{
        display: 'flex', gap: p.space.gap === 1 ? 6 : p.space.gap, overflowX: 'auto',
        margin: `0 -16px ${p.space.section - 6}px`, padding: '0 16px 4px', scrollbarWidth: 'none',
      }}>
        {DEVICES.map((x) => (
          <SelectorTile key={x.id} d={x} selected={x.id === d.id} onPick={() => setId(x.id)} />
        ))}
      </div>
      {controlCard}
      <Presets d={d} st={st} set={set} />
      <Section label="About this device">
        <Details d={d} />
      </Section>
    </div>
  )
}
