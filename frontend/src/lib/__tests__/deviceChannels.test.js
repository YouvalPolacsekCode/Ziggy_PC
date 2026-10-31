import { describe, it, expect, beforeEach } from 'vitest'
import { useDeviceStore } from '../../stores/deviceStore'

// A multi-channel device (David's SONOFF dual valve, 2026-10-31) gets one card
// per channel; every other device renders exactly as before. The backend sends
// `channels` (services/device_channels.py) — [] for ordinary devices.

const V = '0xa4c138dd4d2e1b8c'
const z1 = `switch.${V}_1`
const z2 = `switch.${V}_2`
const plan = `switch.${V}_irrigation_plan_enabled_1`

const valveGroup = {
  group_id: 'ha_valve', kind: 'ha', card_kind: 'switch', name: 'מים לגינון', room: 'garden',
  primary_entity_id: z1, ha_device_id: 'dv',
  entities: [
    { entity_id: z1, role: 'primary', state: 'off' },
    { entity_id: z2, role: 'config', state: 'on' },
    { entity_id: plan, role: 'config', state: 'off' },
  ],
  metrics: [],
  channels: [
    { entity_id: z1, channel: '1', name: 'מים לגינון 1' },
    { entity_id: z2, channel: '2', name: 'מים לגינון 2' },
  ],
}

const plugGroup = {
  group_id: 'ha_plug', kind: 'ha', card_kind: 'switch', name: 'Living room light', room: 'garden',
  primary_entity_id: 'switch.plug', entities: [
    { entity_id: 'switch.plug', role: 'primary' }, { entity_id: 'switch.plug_child_lock', role: 'config' },
  ], metrics: [], channels: [],
}

const ent = (entity_id, extra = {}) => ({ entity_id, domain: 'switch', state: 'off', ...extra })

function load({ entities, groups = [valveGroup, plugGroup], showHidden = false } = {}) {
  const groupById = Object.fromEntries(groups.map(g => [g.group_id, g]))
  const groupByEntityId = {}
  for (const g of groups) for (const e of g.entities) groupByEntityId[e.entity_id] = g.group_id
  useDeviceStore.setState({
    entities: entities || [ent(z1), ent(z2, { state: 'on' }), ent(plan), ent('switch.plug'), ent('switch.plug_child_lock')],
    deviceGroups: groups, groupById, groupByEntityId, showHidden,
    ziggyRooms: [{ id: 'garden', name: 'Garden', devices: [
      { entity_id: z1, ha_state: 'off', domain: 'switch' },
      { entity_id: 'switch.plug', ha_state: 'off', domain: 'switch' },
    ] }],
  })
}

const grouped = () => useDeviceStore.getState().getGroupedEntities()
const roomRows = () => useDeviceStore.getState().getGroupedZiggyRooms()[0].devices

describe('multi-channel devices', () => {
  beforeEach(() => load())

  it('shows every channel as its own card, named for the channel', () => {
    const cards = grouped().filter(e => e.entity_id.startsWith(`switch.${V}`))
    expect(cards.map(e => [e.entity_id, e._group.name, e._group.channel])).toEqual([
      [z1, 'מים לגינון 1', '1'],
      [z2, 'מים לגינון 2', '2'],
    ])
  })

  it('places the second channel like a promoted tile (same room logic)', () => {
    const c2 = grouped().find(e => e.entity_id === z2)
    expect(c2._promotedTile).toBe(true)
    expect(grouped().find(e => e.entity_id === z1)._promotedTile).toBe(false)
  })

  it('never surfaces a setting switch of the same device', () => {
    expect(grouped().map(e => e.entity_id)).not.toContain(plan)
  })

  it('adds the second channel to the room right after the first', () => {
    const rows = roomRows()
    expect(rows.map(r => r.entity_id)).toEqual([z1, z2, 'switch.plug'])
    expect(rows[1]).toMatchObject({ display_name: 'מים לגינון 2', ha_state: 'on' })
    expect(rows[1]._group.name).toBe('מים לגינון 2')
  })

  it('keeps a channel the user hid out of the room and the grid', () => {
    load({ entities: [ent(z1), ent(z2, { hidden: true }), ent('switch.plug')] })
    expect(roomRows().map(r => r.entity_id)).toEqual([z1, 'switch.plug'])
    expect(grouped().map(e => e.entity_id)).not.toContain(z2)
  })

  it('shows a hidden channel again when "show hidden" is on', () => {
    load({ entities: [ent(z1), ent(z2, { hidden: true })], showHidden: true })
    expect(roomRows().map(r => r.entity_id)).toContain(z2)
  })
})

describe('ordinary devices are untouched', () => {
  beforeEach(() => load())

  it('a single-channel device keeps its group name and drops its settings', () => {
    const cards = grouped().filter(e => e.entity_id.startsWith('switch.plug'))
    expect(cards.map(e => [e.entity_id, e._group.name, e._group.channel])).toEqual([
      ['switch.plug', 'Living room light', null],
    ])
  })

  it('groups from a hub without channel support behave exactly as before', () => {
    const legacy = { ...valveGroup }
    delete legacy.channels
    load({ groups: [legacy, plugGroup] })
    expect(grouped().map(e => e.entity_id)).toEqual([z1, 'switch.plug'])
    expect(grouped()[0]._group.name).toBe('מים לגינון')
    expect(roomRows().map(r => r.entity_id)).toEqual([z1, 'switch.plug'])
  })

  it('a lone channel entry is not treated as multi-channel', () => {
    load({ groups: [{ ...valveGroup, channels: [valveGroup.channels[0]] }, plugGroup] })
    expect(grouped().map(e => e.entity_id)).toEqual([z1, 'switch.plug'])
    expect(grouped()[0]._group.name).toBe('מים לגינון')
  })
})
