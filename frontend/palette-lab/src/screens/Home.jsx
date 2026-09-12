// Home — the reference screen.
//
// The structure is Ziggy's: a greeting, a one-line verdict on the house, the
// rooms, the devices you pinned, and what just happened. What the palette
// decides is everything else — whether rooms are photo-less blocks or lined
// rows, whether "occupied" is a glow or a filled square, whether the activity
// feed is a rail beside the content or a list beneath it.
//
// No colour literals here on purpose. Anything that looks like a colour
// decision belongs in palettes.js; this file only describes structure.

import {
  usePal, Card, H1, H2, Text, Label, Chip, Row, Stack, Section,
  OccDot, StateBadge, Bar, Icon, IconWell,
} from '../ui'
import { GREETING, HEADLINE, ROOMS, DEVICES, ACTIVITY, STATS, OCCUPANCY_LABEL } from '../data'

function RoomTile({ room, onOpen, w }) {
  const p = usePal()
  const live = room.occupancy === 'occupied'
  return (
    <button
      onClick={onOpen}
      style={{
        width: w, textAlign: 'start', cursor: 'pointer', padding: 0,
        background: 'none', border: 'none', flexShrink: 0, fontFamily: p.type.body,
      }}
    >
      <Card active={live} style={{ height: '100%' }}>
        <Row justify="space-between" align="flex-start" style={{ marginBottom: 14 }}>
          <IconWell name="room" on={live} size={p.space.cardPad > 18 ? 40 : 36} />
          <Stack gap={6} style={{ alignItems: 'flex-end' }}>
            <Text mono size={p.type.small} mute>{room.temp.toFixed(1)}°</Text>
            <OccDot state={room.occupancy} />
          </Stack>
        </Row>
        <H2 style={{ fontSize: p.type.h2, marginBottom: 4 }}>{room.name}</H2>
        <Text mute size={p.type.small} style={{ display: 'block', marginBottom: 10 }}>
          {room.summary}
        </Text>
        <StateBadge on={live} state={room.occupancy}>
          {OCCUPANCY_LABEL[room.occupancy]}
        </StateBadge>
      </Card>
    </button>
  )
}

function DeviceRow({ d }) {
  const p = usePal()
  return (
    <Card active={d.on} pad={false} style={{ padding: `12px ${p.space.cardPad}px` }}>
      <Row>
        <IconWell name={d.kind} on={d.on} size={34} />
        <Stack gap={3} style={{ flex: 1, minWidth: 0 }}>
          <Text weight={650} style={{
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block',
          }}>{d.name}</Text>
          <Text mute size={p.type.small}>{d.sub}</Text>
        </Stack>
        <StateBadge on={d.on}>{d.on ? 'On' : 'Off'}</StateBadge>
      </Row>
      {d.on && typeof d.level === 'number' && d.kind === 'light' && (
        <Bar value={d.level} style={{ marginTop: 12 }} />
      )}
    </Card>
  )
}

function ActivityList({ compact }) {
  const p = usePal()
  return (
    <Stack gap={compact ? 10 : 12}>
      {ACTIVITY.slice(0, compact ? 4 : 6).map((a, i) => (
        <Row key={i} gap={10} align="flex-start">
          <span style={{
            width: 6, height: 6, borderRadius: p.shape.tile <= 4 ? 0 : 999,
            background: i === 0 ? p.c.accent : p.c.inkFaint,
            marginTop: 6, flexShrink: 0,
          }} />
          <Stack gap={2} style={{ flex: 1, minWidth: 0 }}>
            <Text size={p.type.small} style={{ display: 'block' }}>{a.text}</Text>
            <Text faint size={p.type.micro}>{a.by}</Text>
          </Stack>
          <Text faint size={p.type.micro} mono>{a.t}</Text>
        </Row>
      ))}
    </Stack>
  )
}

export default function Home({ wide, onScreen }) {
  const p = usePal()
  const pinned = DEVICES.slice(0, wide ? 4 : 3)

  // A hero is a different surface, so it carries its own ink.
  //
  // Premium Corporate is why this is not optional: its hero is deep navy and
  // its body ink is dark graphite, so the headline — the one thing the hero
  // exists to carry — was very nearly invisible on it. Anything painted on the
  // hero reads heroInk, and every palette declares what that is rather than
  // inheriting body ink and hoping.
  const onHero = p.grad.hero && !wide
  const hInk = onHero ? (p.c.heroInk || p.c.ink) : undefined
  const hMute = onHero ? (p.c.heroInkMute || p.c.inkMute) : undefined

  const header = (
    <div style={{
      paddingTop: wide ? p.space.gutter : 18,
      marginBottom: p.space.section,
      // A palette with a hero gradient gets one; the flat ones deliberately
      // get nothing at all rather than a washed-out version of someone else's.
      ...(onHero ? {
        background: p.grad.hero,
        margin: `0 -16px ${p.space.section}px`,
        padding: `22px 16px ${p.space.cardPad}px`,
        borderBottomLeftRadius: p.shape.sheet,
        borderBottomRightRadius: p.shape.sheet,
      } : null),
    }}>
      <Label style={{ marginBottom: 6, ...(hMute ? { color: hMute } : null) }}>{GREETING}</Label>
      <H1 style={{ marginBottom: 10, ...(hInk ? { color: hInk } : null) }}>{HEADLINE}</H1>
      <Row gap={8}>
        <OccDot state="occupied" />
        <Text mute size={p.type.small} style={hMute ? { color: hMute } : undefined}>
          {STATS.active} of {STATS.total} active · {STATS.rooms} rooms
        </Text>
      </Row>
    </div>
  )

  const roomsBlock = (
    <Section label="Rooms">
      {wide ? (
        <div style={{
          display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: p.space.gap,
        }}>
          {ROOMS.map((r) => <RoomTile key={r.id} room={r} w="100%" onOpen={() => onScreen('rooms')} />)}
        </div>
      ) : (
        <div style={{
          display: 'flex', gap: p.space.gap, overflowX: 'auto',
          margin: '0 -16px', padding: '0 16px 4px',
          scrollbarWidth: 'none',
        }}>
          {ROOMS.map((r) => <RoomTile key={r.id} room={r} w={218} onOpen={() => onScreen('rooms')} />)}
        </div>
      )}
    </Section>
  )

  const devicesBlock = (
    <Section label="Pinned devices">
      <Stack gap={p.space.gap === 1 ? 1 : p.space.gap}>
        {pinned.map((d) => <DeviceRow key={d.id} d={d} />)}
      </Stack>
    </Section>
  )

  if (wide) {
    return (
      <div>
        {header}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: p.space.section }}>
          <div>
            {roomsBlock}
            {devicesBlock}
          </div>
          <div>
            <Section label="Recent activity">
              <Card><ActivityList /></Card>
            </Section>
            <Section label="Ask Ziggy">
              <Card active>
                <Row gap={10} style={{ marginBottom: 10 }}>
                  <Icon name="star" size={18} color={p.c.onInk} />
                  <Text weight={700} size={p.type.small}>Office is unknown</Text>
                </Row>
                <Text mute size={p.type.small}>
                  The Office sensor stopped reporting at 18:02. I can’t say whether it’s empty.
                </Text>
              </Card>
            </Section>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div>
      {header}
      {roomsBlock}
      {devicesBlock}
      <Section label="Just now">
        <Card><ActivityList compact /></Card>
      </Section>
    </div>
  )
}
