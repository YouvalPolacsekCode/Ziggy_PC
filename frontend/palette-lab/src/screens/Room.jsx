// Room — one room, and why Ziggy believes what it believes about it.
//
// The structure is Ziggy's: which room you are in, the verdict on it, the
// evidence for that verdict, how warm it is, what is switched on in there, and
// one control that acts on the whole room. The reason line gets the largest
// non-heading type on the screen on purpose — "how I know" is the thing Ziggy
// has that a plain remote does not, so it is set as prose, not as metadata.
//
// The room chips exist so all six occupancy states can be walked through in a
// single screen: two occupied, three empty, one unknown, one room with no
// devices at all. `unknown` is never drawn as a quieter `empty` — it gets its
// own dot (hollow), its own badge, its own dashed evidence panel and its own
// heading ("Why Ziggy can't tell"), because "I don't know" is a different fact
// from "nobody is here".
//
// No colour literals: every colour below comes from usePal().

import { useState } from 'react'
import {
  usePal, Card, H1, H2, Text, Label, Btn, Chip, Row, Stack, Section,
  OccDot, StateBadge, Bar, Icon, IconWell, surfaceStyle,
} from '../ui'
import { ROOMS, DEVICES, OCCUPANCY_LABEL, NOW } from '../data'

// Is the palette's hero band safe to set type on?
//
// `grad.hero` is a palette value and so is `c.ink`, but a couple of palettes
// declare a DARK hero next to DARK ink — Premium Corporate's hero is its navy
// accent while its ink is near-black, so a heading on that band disappears.
// Rather than invent a third colour (which would be a colour decision taken in
// a screen, i.e. the wrong place), the band is simply not drawn when the
// palette's own ink cannot survive on it. Restraint is a legitimate header.
export function heroSafe(p) {
  // A palette that declares `heroInk` has already answered this question: it
  // names the ink that survives on its own hero, so the band is always safe to
  // draw and the text simply uses that ink. Suppressing the band instead would
  // silently delete a deliberate design element (Premium Corporate's navy
  // header is the whole top of that direction) to solve a problem the palette
  // has already solved.
  //
  // The luminance test below remains for any future palette that adds a hero
  // WITHOUT saying what colour survives on it — better a missing band than an
  // invisible headline.
  if (p.c.heroInk) return true
  const hexes = (p.grad.hero || '').match(/#[0-9a-fA-F]{6}/g)
  if (!hexes || !hexes.length) return !!p.grad.hero // rgba-over-bg heroes are fine
  const lum = (h) => {
    const v = [1, 3, 5]
      .map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
      .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
    return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2]
  }
  const band = hexes.reduce((s, h) => s + lum(h), 0) / hexes.length
  const inkHex = /^#[0-9a-fA-F]{6}$/.test(p.c.ink) ? lum(p.c.ink) : (p.mode === 'dark' ? 0.9 : 0.05)
  const [a, b] = band > inkHex ? [band, inkHex] : [inkHex, band]
  return (a + 0.05) / (b + 0.05) >= 3
}

// The evidence panel. Occupied/empty read as a statement; unknown reads as an
// admission, and is built differently (dashed edge, different heading) so a
// colourless palette can still tell the two apart.
function ReasonPanel({ room, big }) {
  const p = usePal()
  const unknown = room.occupancy === 'unknown'
  return (
    <Card
      active={room.occupancy === 'occupied'}
      style={unknown ? { borderStyle: 'dashed', borderColor: p.c.lineStrong } : undefined}
    >
      <Label>{unknown ? "Why Ziggy can't tell" : 'How Ziggy knows'}</Label>
      <H2 style={{
        fontSize: big ? p.type.h2 + 3 : p.type.h2,
        fontWeight: p.type.displayWeight,
        lineHeight: 1.3,
        color: unknown ? p.c.warn : p.c.ink,
        marginBottom: 12,
      }}>
        {room.reason}
      </H2>
      <Row gap={8}>
        <Icon name="star" size={14} color={p.c.inkFaint} />
        <Text faint size={p.type.micro}>Ziggy · room sensors · as of {NOW}</Text>
      </Row>
    </Card>
  )
}

// p.space.gap is the list rhythm — 1px in the densest palette — so it is NOT
// the right number for the space between an icon and the label it belongs to.
// That one has a floor.
const inner = (p) => Math.max(p.space.gap, 10)

function DeviceRow({ d, on, onToggle }) {
  const p = usePal()
  return (
    <Card active={on} pad={false} style={{ padding: `12px ${p.space.cardPad}px` }}>
      <Row gap={inner(p)}>
        <IconWell name={d.kind} on={on} size={34} />
        <Stack gap={3} style={{ flex: 1, minWidth: 0 }}>
          <Text weight={650} style={{
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block',
          }}>{d.name}</Text>
          <Text mute size={p.type.small}>{on ? d.sub : 'Off'}</Text>
        </Stack>
        <button
          onClick={onToggle}
          style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}
          aria-label={`Toggle ${d.name}`}
        >
          <StateBadge on={on}>{on ? 'On' : 'Off'}</StateBadge>
        </button>
      </Row>
      {on && typeof d.level === 'number' && d.kind === 'light' && (
        <Bar value={d.level} style={{ marginTop: 12 }} />
      )}
    </Card>
  )
}

export default function Room({ wide, onScreen }) {
  const p = usePal()
  const [roomId, setRoomId] = useState('living')
  const [off, setOff] = useState({})          // id -> true when switched off here
  const [forcedOn, setForcedOn] = useState({}) // id -> true when switched on here

  const room = ROOMS.find((r) => r.id === roomId) || ROOMS[0]
  const devices = DEVICES.filter((d) => d.room === room.name)
  const isOn = (d) => (forcedOn[d.id] ? true : off[d.id] ? false : d.on)

  const lights = devices.filter((d) => d.kind === 'light')
  const litCount = lights.filter(isOn).length
  const activeCount = devices.filter(isOn).length

  const setAllLights = (next) => {
    const o = { ...off }, f = { ...forcedOn }
    lights.forEach((d) => { if (next) { f[d.id] = true; delete o[d.id] } else { o[d.id] = true; delete f[d.id] } })
    setOff(o); setForcedOn(f)
  }
  const everythingOff = () => {
    const o = { ...off }
    devices.forEach((d) => { o[d.id] = true })
    setOff(o); setForcedOn({})
  }

  const verdictColor = room.occupancy === 'occupied'
    ? p.c.good
    : room.occupancy === 'unknown' ? p.c.warn : p.c.inkMute

  // ── Back + room picker ────────────────────────────────────────────────
  const backRow = (
    <Row justify="space-between" style={{ paddingTop: wide ? p.space.gutter : 14 }}>
      <Btn ghost small onClick={() => onScreen('home')} style={{ paddingInlineStart: 0 }}>
        <Icon name="back" size={16} color={p.c.inkMute} />
        Home
      </Btn>
      <Text faint size={p.type.micro} mono>{room.deviceCount} devices</Text>
    </Row>
  )

  const picker = (
    <div style={{
      display: 'flex', gap: Math.max(p.space.gap, 6), overflowX: 'auto',
      margin: `10px -16px ${Math.max(p.space.gap, 16)}px`,
      padding: '2px 16px 4px', scrollbarWidth: 'none',
      ...(wide ? { margin: `12px 0 ${Math.max(p.space.gap, 16)}px`, padding: 0, flexWrap: 'wrap' } : null),
    }}>
      {ROOMS.map((r) => (
        <Chip
          key={r.id}
          active={r.id === roomId}
          onClick={() => setRoomId(r.id)}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 7, cursor: 'pointer', flexShrink: 0 }}
        >
          <OccDot state={r.occupancy} style={{ width: 7, height: 7 }} />
          {r.name}
        </Chip>
      ))}
    </div>
  )

  // ── Verdict header ────────────────────────────────────────────────────
  // On a hero band the ink is the band's, not the body's (see `heroInk` in
  // palettes.js). The verdict WORD goes to hero ink as well, because a
  // semantic colour is not guaranteed to survive an arbitrary band — Premium
  // Corporate's "occupied" navy on its own navy header is invisible. No
  // meaning is lost: the dot beside it still carries the state, and its
  // hollow-versus-filled form is what separates `unknown` from `empty`
  // anyway.
  const onHero = p.grad.hero && heroSafe(p) && !wide
  const hInk = onHero ? (p.c.heroInk || p.c.ink) : undefined

  const header = (
    <div style={{
      marginBottom: p.space.section,
      ...(onHero ? {
        background: p.grad.hero,
        margin: `0 -16px ${p.space.section}px`,
        padding: `18px 16px ${p.space.cardPad}px`,
        borderBottomLeftRadius: p.shape.sheet,
        borderBottomRightRadius: p.shape.sheet,
      } : null),
    }}>
      <H1 style={{ marginBottom: 10, ...(hInk ? { color: hInk } : null) }}>{room.name}</H1>
      <Row gap={10} style={{ flexWrap: 'wrap' }}>
        <Row gap={8}>
          <OccDot state={room.occupancy} />
          <span style={{
            fontFamily: p.type.display, fontSize: p.type.h2,
            fontWeight: p.type.displayWeight, letterSpacing: p.type.tracking,
            textTransform: p.type.labelCase === 'uppercase' ? 'uppercase' : 'none',
            color: hInk || verdictColor,
          }}>{OCCUPANCY_LABEL[room.occupancy]}</span>
        </Row>
        {/* The separator travels with the item it precedes, so a wrapped line
            never ends on a dangling middot. */}
        <Row gap={8}>
          <Text faint size={p.type.small}>·</Text>
          <Text mono mute size={p.type.small}>{room.temp.toFixed(1)}°</Text>
        </Row>
        <Row gap={8}>
          <Text faint size={p.type.small}>·</Text>
          <Text mute size={p.type.small}>{activeCount} of {room.deviceCount} on</Text>
        </Row>
      </Row>
    </div>
  )

  // ── Room-level control ────────────────────────────────────────────────
  const control = (
    <Card active={litCount > 0}>
      <Row gap={inner(p)} style={{ marginBottom: 14 }}>
        <IconWell name="light" on={litCount > 0} size={38} />
        <Stack gap={3} style={{ flex: 1, minWidth: 0 }}>
          <Text weight={700}>All lights</Text>
          <Text mute size={p.type.small}>
            {lights.length === 0 ? 'No lights in this room' : `${litCount} of ${lights.length} on`}
          </Text>
        </Stack>
      </Row>
      <Row gap={Math.max(p.space.gap, 8)} style={{ flexWrap: 'wrap' }}>
        <Btn
          primary={litCount === 0 && lights.length > 0}
          small
          disabled={lights.length === 0}
          onClick={() => setAllLights(litCount === 0)}
          style={{ flex: 1, justifyContent: 'center', opacity: lights.length === 0 ? 0.45 : 1 }}
        >
          {litCount === 0 ? 'Turn lights on' : 'Turn lights off'}
        </Btn>
        <Btn
          small
          disabled={activeCount === 0}
          onClick={everythingOff}
          style={{ flex: 1, justifyContent: 'center', opacity: activeCount === 0 ? 0.45 : 1 }}
        >
          Everything off
        </Btn>
      </Row>
    </Card>
  )

  const glance = (
    <Card flat>
      <Label>At a glance</Label>
      <Stack gap={Math.max(p.space.gap, 8)}>
        {[
          ['Occupancy', OCCUPANCY_LABEL[room.occupancy]],
          ['Temperature', `${room.temp.toFixed(1)}°`],
          ['Devices', `${activeCount} on · ${room.deviceCount} total`],
        ].map(([k, v]) => (
          <Row key={k} justify="space-between" gap={10}>
            <Text faint size={p.type.small}>{k}</Text>
            <Text size={p.type.small} weight={650} mono={k !== 'Occupancy'}>{v}</Text>
          </Row>
        ))}
      </Stack>
    </Card>
  )

  const deviceList = devices.length ? (
    <Stack gap={p.space.gap}>
      {devices.map((d) => (
        <DeviceRow
          key={d.id}
          d={d}
          on={isOn(d)}
          onToggle={() => {
            const on = isOn(d)
            setOff((s) => ({ ...s, [d.id]: on ? true : undefined }))
            setForcedOn((s) => ({ ...s, [d.id]: on ? undefined : true }))
          }}
        />
      ))}
    </Stack>
  ) : (
    <div style={{
      ...surfaceStyle(p, { flat: true }),
      borderStyle: 'dashed', borderColor: p.c.lineStrong,
      padding: p.space.cardPad + 6,
      textAlign: 'center',
    }}>
      <Text mute size={p.type.small} style={{ display: 'block', marginBottom: 4 }}>
        Nothing is set up in {room.name} yet
      </Text>
      <Text faint size={p.type.micro}>Add a device and it will appear here</Text>
    </div>
  )

  if (wide) {
    return (
      <div>
        {backRow}
        {picker}
        {header}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: p.space.section }}>
          <div>
            <Section label={room.occupancy === 'unknown' ? 'No reading' : 'Evidence'}>
              <ReasonPanel room={room} big />
            </Section>
            <Section label={`In ${room.name}`}>{deviceList}</Section>
          </div>
          <div>
            <Section label="Room control">{control}</Section>
            <Section label="Details">{glance}</Section>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div>
      {backRow}
      {picker}
      {header}
      <Section label={room.occupancy === 'unknown' ? 'No reading' : 'Evidence'}>
        <ReasonPanel room={room} />
      </Section>
      <Section label="Room control">{control}</Section>
      <Section label={`In ${room.name}`}>{deviceList}</Section>
    </div>
  )
}
