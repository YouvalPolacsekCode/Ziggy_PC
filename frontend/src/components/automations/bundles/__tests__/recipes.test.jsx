// Unified bundle engine — recipe tests.
//
// The behavior-critical layer is derive(): it reconstructs an INSTALLED
// bundle's wizard values from the saved automation/config. If it drifts, "edit"
// silently loses user settings. These tests round-trip each recipe's derive
// against the exact payload shapes its save() produces (ported from the legacy
// wizards), plus the shared pick helpers and the automation→recipe router.

import { describe, expect, it, vi } from 'vitest'
import { pickedIds, pickFrom, roomEntityIdsOf } from '../engine/context'
import { RECIPES, recipeForAutomation } from '../recipes'

// ── Fake home context ────────────────────────────────────────────────────────
const E = (entity_id, domain, device_class, extra = {}) => ({ entity_id, domain, device_class, ...extra })

const ENTITIES = [
  E('binary_sensor.motion_office', 'binary_sensor', 'motion'),
  E('binary_sensor.motion_living', 'binary_sensor', 'motion'),
  E('binary_sensor.presence_bedroom', 'binary_sensor', 'presence'),
  E('binary_sensor.door_front', 'binary_sensor', 'door'),
  E('binary_sensor.window_kitchen', 'binary_sensor', 'window'),
  E('light.office', 'light'),
  E('light.living', 'light'),
  E('light.bedroom', 'light'),
  E('climate.ac_living', 'climate'),
  E('sensor.temp_living', 'sensor', 'temperature', { state: '27.5' }),
]

const ROOMS = { 'binary_sensor.motion_office': 'Office', 'light.office': 'Office',
  'binary_sensor.motion_living': 'Living Room', 'light.living': 'Living Room',
  'binary_sensor.presence_bedroom': 'Bedroom', 'light.bedroom': 'Bedroom' }

const ctx = {
  t: (k, p) => (p ? `${k}:${JSON.stringify(p)}` : k),
  lang: 'en',
  entities: ENTITIES,
  entityMap: Object.fromEntries(ENTITIES.map((e) => [e.entity_id, e])),
  rooms: [{ id: 'living', name: 'Living Room', entities: ['sensor.temp_living', 'climate.ac_living', 'light.living'] }],
  ziggyRooms: [], occupancySensors: [], automations: [],
  NO_ROOM: '__none__',
  // Mirrors engine/context.js: registry room (ziggyRooms[].devices) first, HA
  // area (rooms[].entities) as fallback.
  roomEntityIds: (room) => {
    if (!room) return []
    const zr = (ctx.ziggyRooms || []).find((r) => String(r.id) === String(room.id) || r.name === room.name)
    if (zr) {
      const ids = []
      for (const d of (zr.devices || [])) { const id = d.entity_id || d.main_entity_id; if (id) ids.push(id) }
      if (ids.length) return ids
    }
    const area = (ctx.rooms || []).find((r) => String(r.id) === String(room.id) || r.name === room.name)
    return (area?.entities || [])
  },
  roomOf: (eid) => ROOMS[eid] || '__none__',
  nameWithRoom: (e) => e.entity_id,
  asItem: (e) => ({ id: e.entity_id, label: e.entity_id, _entity: e }),
  persons: [{ id: 'p1' }],
  homeZone: { lat: 1, lon: 2 },
  zones: [{ id: 'z1', name: 'Near Home', radius_m: 2000 }],
  hostActions: {},
}

// ── Shared helpers ───────────────────────────────────────────────────────────
describe('roomEntityIdsOf (registry-room membership, office-lamp guard)', () => {
  const room = { id: 'office', name: 'Office' }
  // Registry room (ziggyRooms) has BOTH office lights; the HA-area copy (rooms)
  // only has one — the lamp lives in the office only in Ziggy (no HA area).
  const ziggyRooms = [{ id: 'office', name: 'Office', devices: [
    { entity_id: 'light.ceiling' }, { entity_id: 'light.lamp' },
  ] }]
  const rooms = [{ id: 'office', name: 'Office', entities: ['light.ceiling'] }]

  it('returns ALL registry members, including the HA-area-less lamp', () => {
    expect(roomEntityIdsOf(ziggyRooms, rooms, room)).toEqual(['light.ceiling', 'light.lamp'])
  })
  it('falls back to HA-area entities when the room is not a registry room', () => {
    expect(roomEntityIdsOf([], rooms, room)).toEqual(['light.ceiling'])
  })
  it('is empty for an unknown room', () => {
    expect(roomEntityIdsOf(ziggyRooms, rooms, { id: 'garage', name: 'Garage' })).toEqual([])
  })
})

describe('pick helpers', () => {
  it('pickedIds resolves all-mode to every item', () => {
    const items = [{ id: 'a' }, { id: 'b' }]
    expect(pickedIds({ mode: 'all', ids: [] }, items)).toEqual(['a', 'b'])
    expect(pickedIds({ mode: 'choose', ids: ['b'] }, items)).toEqual(['b'])
  })
  it('pickFrom flags a real subset as choose, everything else as all', () => {
    expect(pickFrom(['a'], 3, true).mode).toBe('choose')
    expect(pickFrom(['a', 'b', 'c'], 3, true).mode).toBe('all')
    expect(pickFrom([], 3, false).mode).toBe('all')
  })
})

// ── Motion Light ─────────────────────────────────────────────────────────────
describe('motion_light derive', () => {
  it('reconstructs sensors, lights, brightness, linger and night window from installed stages', () => {
    const installed = {
      _isInstalled: true, id: 'ziggy_motion_light',
      trigger: { type: 'state', entity_id: ['binary_sensor.motion_office'], state: 'on' },
      conditions: [{ type: 'time', after: '22:00', before: '06:00' }],
      actions: [
        { type: 'call_service', entity_id: 'light.office', service: 'light.turn_on', service_data: { brightness_pct: 45 } },
        { type: 'wait_for_state', entity_id: 'binary_sensor.motion_office', state: 'off' },
        { type: 'delay', seconds: 300 },
        { type: 'call_service', entity_id: 'light.office', service: 'light.turn_off' },
      ],
    }
    const c = { ...ctx, automations: [installed] }
    const v = RECIPES.motion_light.derive(installed, c)
    expect(v.motion.ids).toEqual(['binary_sensor.motion_office'])
    expect(v.motion.mode).toBe('choose')
    expect(v.lights.ids).toEqual(['light.office'])
    expect(v.brightness).toBe(45)
    expect(v.lingerMin).toBe(5)
    expect(v.nightOnly).toBe(true)
    expect(v.after).toBe('22:00')
    expect(v.before).toBe('06:00')
    expect(RECIPES.motion_light.canSave(v, c)).toBe(true)
  })
  it('unions sensors and lights across per-room stages', () => {
    const mk = (id, sensor, light) => ({ id, trigger: { entity_id: [sensor], state: 'on' },
      actions: [{ type: 'call_service', entity_id: light, service: 'light.turn_on', service_data: { brightness_pct: 60 } }] })
    const c = { ...ctx, automations: [
      mk('ziggy_motion_light', 'binary_sensor.motion_office', 'light.office'),
      mk('ziggy_motion_light_living', 'binary_sensor.motion_living', 'light.living'),
    ] }
    const v = RECIPES.motion_light.derive({ _isInstalled: true, id: 'ziggy_motion_light' }, c)
    expect(v.motion.ids.sort()).toEqual(['binary_sensor.motion_living', 'binary_sensor.motion_office'])
    expect(v.lights.ids.sort()).toEqual(['light.living', 'light.office'])
  })
  it('defaults night-only ON for a fresh create', () => {
    const v = RECIPES.motion_light.derive(null, ctx)
    expect(v.nightOnly).toBe(true)
    expect(v.motion.mode).toBe('all')
  })
})

// ── Window AC ────────────────────────────────────────────────────────────────
describe('window_ac derive', () => {
  it('recovers the AC from a notify_actionable button and keeps notify mode', () => {
    const installed = {
      _isInstalled: true, id: 'ziggy_window_ac_off',
      trigger: { type: 'state', entity_id: ['binary_sensor.window_kitchen'], state: 'on', for_minutes: 2 },
      actions: [{ type: 'notify_actionable', actions: [{ action: { entity_id: 'climate.ac_living' } }] }],
    }
    const v = RECIPES.window_ac.derive(installed, ctx)
    expect(v.acId).toBe('climate.ac_living')
    expect(v.mode).toBe('notify')
    expect(v.graceMin).toBe(2)
    // Doors count as window sensors too, so 1-of-2 is a real subset → choose.
    expect(v.windows.mode).toBe('choose')
    expect(v.windows.ids).toEqual(['binary_sensor.window_kitchen'])
  })
  it('recovers auto mode with resume from wait_for_state', () => {
    const installed = {
      _isInstalled: true,
      trigger: { entity_id: ['binary_sensor.window_kitchen'], state: 'on' },
      actions: [
        { type: 'call_service', entity_id: 'climate.ac_living', service: 'climate.turn_off' },
        { type: 'wait_for_state', entity_id: 'binary_sensor.window_kitchen', state: 'off' },
        { type: 'call_service', entity_id: 'climate.ac_living', service: 'climate.turn_on' },
      ],
    }
    const v = RECIPES.window_ac.derive(installed, ctx)
    expect(v.mode).toBe('auto')
    expect(v.resume).toBe(true)
  })
  it('recovers an IR AC id', () => {
    const installed = { _isInstalled: true, trigger: {}, actions: [{ type: 'ir_command', ir_device_id: 'rm4-ac', ir_command: 'turn_off' }] }
    expect(RECIPES.window_ac.derive(installed, ctx).acId).toBe('ir.rm4-ac')
  })
})

// ── Leave Home ───────────────────────────────────────────────────────────────
describe('leave_home derive', () => {
  it('maps an all_persons_left trigger plus motion conditions to phone+motion sources', () => {
    const installed = {
      _isInstalled: true, id: 'ziggy_leave_home',
      trigger: { type: 'all_persons_left' },
      conditions: [
        { entity_id: 'binary_sensor.motion_office', operator: 'is', value: 'off' },
      ],
      actions: [
        { type: 'turn_off_all_lights' },
        { type: 'notify', title: 'Leave Home', message: 'x' },
      ],
      securityAlert: true,
    }
    const v = RECIPES.leave_home.derive(installed, ctx)
    expect(v.sources.ids.sort()).toEqual(['motion', 'phone'])
    expect(v.lights.mode).toBe('all')
    expect(v.notify).toBe(true)
    expect(v.acOff).toBe(false)   // no climate action in the installed payload
    expect(v.alert).toBe(true)
  })
  it('maps a no-motion trigger with for_minutes to the motion source + minutes', () => {
    const installed = {
      _isInstalled: true,
      trigger: { type: 'state', entity_id: ['binary_sensor.motion_office'], state: 'off', for_minutes: 45 },
      actions: [{ type: 'call_service', entity_id: 'light.office', service: 'light.turn_off' }],
    }
    const v = RECIPES.leave_home.derive(installed, ctx)
    expect(v.sources.ids).toEqual(['motion'])
    expect(v.motionMin).toBe(45)
    expect(v.lights.mode).toBe('choose')
    expect(v.lights.ids).toEqual(['light.office'])
  })
})

// ── Night Watch ──────────────────────────────────────────────────────────────
describe('night_watch derive', () => {
  it('reconstructs a presence-armed setup with the alert stage living sensors', () => {
    const installed = {
      _isInstalled: true, id: 'ziggy_night_watch',
      trigger: { type: 'state', entity_id: 'binary_sensor.presence_bedroom', state: 'on', for_minutes: 10 },
      conditions: [],
      actions: [
        { type: 'save_entity_states', namespace: 'night_watch', state_key: 'saved_lights', entity_ids: ['light.bedroom'] },
        { type: 'call_service', entity_id: 'light.bedroom', service: 'light.turn_on', service_data: { brightness_pct: 15 } },
      ],
      stages: [{ key: 'alert', trigger: { entity_id: ['binary_sensor.motion_living'] } }],
    }
    const v = RECIPES.night_watch.derive(installed, ctx)
    expect(v.armMode).toBe('presence')
    expect(v.bedroom).toBe('binary_sensor.presence_bedroom')
    expect(v.living.ids).toEqual(['binary_sensor.motion_living'])
    expect(v.dimLevel).toBe(15)
    expect(v.lights.ids).toEqual(['light.bedroom'])
  })
  it('reconstructs a time-armed setup', () => {
    const installed = {
      _isInstalled: true,
      trigger: { type: 'time', time: '23:45:00' },
      conditions: [{ entity_id: 'binary_sensor.presence_bedroom', operator: 'is', value: 'on' }],
      actions: [],
    }
    const v = RECIPES.night_watch.derive(installed, ctx)
    expect(v.armMode).toBe('time')
    expect(v.armTime).toBe('23:45')
    expect(v.bedroom).toBe('binary_sensor.presence_bedroom')
  })
})

// ── Pre-cool ─────────────────────────────────────────────────────────────────
describe('precool derive', () => {
  it('reconstructs AC, target temp, hot-guard and radius from the installed automation + zone', () => {
    const installed = {
      _isInstalled: true, id: 'ziggy_precool_arrival',
      conditions: [{ entity_id: 'sensor.temp_living', operator: 'above', value: '26' }],
      actions: [
        { type: 'call_service', entity_id: 'climate.ac_living', service: 'climate.turn_on' },
        { type: 'call_service', entity_id: 'climate.ac_living', service: 'climate.set_temperature', service_data: { temperature: 22 } },
        { type: 'notify', title: 'x', message: 'y' },
      ],
    }
    const v = RECIPES.precool.derive(installed, ctx)
    expect(v.acId).toBe('climate.ac_living')
    expect(v.temp).toBe(22)
    expect(v.onlyHot).toBe(true)
    expect(v.hotEntity).toBe('sensor.temp_living')
    expect(v.hotThreshold).toBe(26)
    expect(v.notify).toBe(true)
    expect(v.radiusKm).toBe(2)   // from the Near Home zone (2000m)
    expect(RECIPES.precool.canSave(v, ctx)).toBe(true)
  })
  it('cannot save without presence tracking', () => {
    const v = RECIPES.precool.derive(null, ctx)
    expect(RECIPES.precool.canSave({ ...v, acId: 'climate.ac_living' }, { ...ctx, persons: [] })).toBe(false)
  })
})

// ── Circadian ────────────────────────────────────────────────────────────────
describe('circadian derive', () => {
  it('round-trips the engine config (anchors, timing, mode)', () => {
    const status = {
      _isInstalled: true,
      lights: ['light.living'], peak: { kelvin: 5000, pct: 90 }, floor: { kelvin: 2300, pct: 20 },
      wake: '06:30', bedtime: '23:00', auto_on: true,
    }
    const v = RECIPES.circadian.derive(status, ctx)
    expect(v.lights.ids).toEqual(['light.living'])
    expect(v.peakKelvin).toBe(5000)
    expect(v.floorPct).toBe(20)
    expect(v.wake).toBe('06:30')
    expect(v.autoOn).toBe(true)
    expect(RECIPES.circadian.canSave(v)).toBe(true)
  })
  it('rejects malformed times', () => {
    const v = RECIPES.circadian.derive({ lights: ['light.living'] }, ctx)
    expect(RECIPES.circadian.canSave({ ...v, wake: 'ten' })).toBe(false)
  })
  it('carries engine status (incl. off-schedule lights) into the modal', () => {
    // The "Right now" banner lists manual_lights; that only works if derive
    // passes _status through. Regression guard for the dropped off-schedule view.
    const status = { _status: { current: { kelvin: 3200, pct: 55 }, manual_lights: ['light.kitchen', 'light.dining'] } }
    const v = RECIPES.circadian.derive(status, ctx)
    expect(v._status.manual_lights).toEqual(['light.kitchen', 'light.dining'])
    // The now-step is gated on _status, so it renders when status is present.
    const nowStep = RECIPES.circadian.steps.find((s) => s.key === 'now')
    expect(nowStep.visibleWhen({ _installed: true, _status: v._status })).toBe(true)
  })
})

// ── Smart Climate ────────────────────────────────────────────────────────────
describe('climate derive', () => {
  it('round-trips a per-room engine slice including avg mode', () => {
    const slice = {
      _isInstalled: true, room: 'living', sensor: '',
      sensors: ['sensor.temp_living'],
      cooling: { device: { kind: 'climate', id: 'climate.ac_living', name: 'AC' }, on: 25, off: 24 },
      heating: null,
    }
    const v = RECIPES.climate.derive(slice, ctx)
    expect(v.roomId).toBe('living')
    expect(v.useAvg).toBe(true)
    expect(v.cooling.device.id).toBe('climate.ac_living')
    expect(v.showHeating).toBe(false)
    expect(RECIPES.climate.canSave(v, ctx)).toBe(true)
  })
})

// ── Smart Room (installed) ───────────────────────────────────────────────────
describe('smart_room derive (installed)', () => {
  it('reconstructs the wizard opts from the live day/night/off rules', () => {
    const auto = (suffix, over) => ({ id: `ziggy_smart_room_office_${suffix}`, enabled: true, ...over })
    const c = { ...ctx, automations: [
      auto('day', {
        trigger: { type: 'state', entity_id: 'binary_sensor.motion_office', state: 'on' },
        conditions: [{ type: 'time', after: '07:15', before: '20:30' }],
        actions: [
          // Schedule-owned light: empty service_data — must be skipped.
          { type: 'call_service', entity_id: 'light.living', service: 'light.turn_on', service_data: {} },
          { type: 'call_service', entity_id: 'light.office', service: 'light.turn_on', service_data: { brightness_pct: 85 } },
        ],
      }),
      auto('night', {
        trigger: { type: 'state', entity_id: 'binary_sensor.motion_office', state: 'on' },
        conditions: [{ type: 'time', after: '20:30', before: '07:15' }],
        actions: [{ type: 'call_service', entity_id: 'light.office', service: 'light.turn_on',
          service_data: { brightness_pct: 25, color_temp_kelvin: 2500 } }],
      }),
      auto('off', {
        trigger: { type: 'state', entity_id: 'binary_sensor.motion_office', state: 'off', for_minutes: 8 },
        actions: [{ type: 'call_service', entity_id: 'light.office', service: 'light.turn_off' }],
      }),
    ] }
    const v = RECIPES.smart_room.derive({ _isInstalled: true, room: 'office', roomName: 'Office' }, c)
    expect(v.occEntity).toBe('binary_sensor.motion_office')
    expect(v.night_end).toBe('07:15')      // day window start
    expect(v.night_start).toBe('20:30')    // day window end
    expect(v.day_brightness).toBe(85)      // skipped the schedule-owned light
    expect(v.night_brightness).toBe(25)
    expect(v.night_kelvin).toBe(2500)
    expect(v.off_delay_minutes).toBe(8)
    expect(RECIPES.smart_room.canSave({ ...v, _installed: true }, c)).toBe(true)
  })
})

// ── Automation → recipe routing ──────────────────────────────────────────────
describe('recipeForAutomation', () => {
  it('routes each installed bundle id to its recipe', () => {
    expect(recipeForAutomation({ id: 'ziggy_leave_home' })).toBe('leave_home')
    expect(recipeForAutomation({ id: 'ziggy_precool_arrival' })).toBe('precool')
    expect(recipeForAutomation({ id: 'ziggy_window_ac_off' })).toBe('window_ac')
    expect(recipeForAutomation({ id: 'ziggy_motion_light' })).toBe('motion_light')
    expect(recipeForAutomation({ id: 'ziggy_night_watch' })).toBe('night_watch')
    expect(recipeForAutomation({ id: 'my_custom_thing', name: 'Water the plants' })).toBe(null)
  })
})

// ── Contract sanity: every recipe exposes the engine surface ─────────────────
describe('recipe contract', () => {
  it.each(Object.keys(RECIPES))('%s implements the recipe contract', (id) => {
    const r = RECIPES[id]
    expect(r.id).toBe(id)
    expect(typeof r.titleKey).toBe('string')
    expect(typeof r.derive).toBe('function')
    expect(['function', 'object'].includes(typeof r.steps)).toBe(true)
    expect(typeof r.save).toBe('function')
    expect(typeof r.remove).toBe('function')
  })
})

// ── AC pickers must offer ACs, not every IR device ───────────────────────────
//
// Reported live: "Pre-cool on Arrival shows my soundbar as an option to turn on
// when getting close to home." Both AC pickers filtered
// `domain === 'climate' || entity_id.startsWith('ir.')`, and that second clause
// matches EVERY IR device — soundbar, TV, receiver, projector.
//
// It also mattered more than a messy list: autoDefaults() takes items[0], so a
// soundbar sorting first became the thing Pre-cool powered on when you drove
// home. The clause was never needed — deviceStore's IR_TYPE_TO_DOMAIN already
// maps an IR `ac` to domain 'climate', so IR ACs are covered by the first
// clause; only non-ACs were being added.

// Entity-shaped IR devices exactly as deviceStore.irToEntity builds them.
const irEntity = (id, type, domain) => ({
  entity_id: `ir.${id}`, domain, display_name: id, friendly_name: id,
  _ir: true, _irDevice: { id, name: id, type },
})

const IR_CTX = {
  ...ctx,
  entities: [
    ...ENTITIES,
    irEntity('ir_ac', 'ac', 'climate'),
    irEntity('ir_soundbar', 'soundbar', 'media_player'),
    irEntity('ir_tv', 'tv', 'media_player'),
    irEntity('ir_projector', 'projector', 'media_player'),
    irEntity('ir_custom', 'custom', 'switch'),
  ],
}

const acPickerItems = (recipeId, c) => {
  // `steps` is an array on some recipes and a (values, ctx) function on others.
  const raw = RECIPES[recipeId].steps
  const steps = typeof raw === 'function' ? raw({}, c) : raw
  for (const s of steps) {
    for (const f of (s.fields || [])) {
      if (f.key === 'acId') return f.items(c).map((i) => i.id)
    }
  }
  throw new Error(`no acId picker found in ${recipeId}`)
}

describe.each(['precool', 'window_ac'])('%s AC picker', (recipeId) => {
  it('offers real ACs, including IR ones', () => {
    const ids = acPickerItems(recipeId, IR_CTX)
    expect(ids).toContain('climate.ac_living')
    expect(ids).toContain('ir.ir_ac')
  })

  it('never offers a soundbar, TV, projector or generic IR blob as an AC', () => {
    const ids = acPickerItems(recipeId, IR_CTX)
    expect(ids).not.toContain('ir.ir_soundbar')
    expect(ids).not.toContain('ir.ir_tv')
    expect(ids).not.toContain('ir.ir_projector')
    expect(ids).not.toContain('ir.ir_custom')
  })

  it('never DEFAULTS to a non-AC — autoDefaults takes items[0]', () => {
    const ids = acPickerItems(recipeId, IR_CTX)
    expect(ids.every((id) => id === 'climate.ac_living' || id === 'ir.ir_ac')).toBe(true)
  })
})

// ── Pre-cool must not fire at someone who is already home ───────────────────
//
// Live failure (Canary, 2026-08-08): the Near Home ring was crossed late — GPS
// on the drive back was poor, one fix rejected at 500m accuracy — so
// zone_entered arrived at 17:10:11, NINE MINUTES after presence had already
// confirmed the user home at ~17:01. Pre-cool then ran: IR power_on plus a
// "Pre-cool on Arrival" push, for someone standing in the room.
//
// Nothing guarded it. The AC-state condition was not at fault and was not
// wrong: Leave Home had switched the AC off at 15:28, so "not already on" was
// true. An approach automation firing for someone who has arrived has nothing
// to give — the head start is the entire feature.

describe('precool: already-home guard', () => {
  const savedPayload = async (values) => {
    let captured = null
    const api = await import('../../../../lib/api')
    const spy = vi.spyOn(api, 'createAutomation').mockImplementation(async (p) => { captured = p; return p })
    await RECIPES.precool.save(
      { acId: 'ir.ir_ac', temp: 24, radiusKm: 2, onlyHot: false, notify: true, ...values },
      { ...IR_CTX, t: (k) => k, zones: [{ id: 'z1', name: 'Near Home', radius_m: 2000 }] },
    )
    spy.mockRestore()
    return captured
  }

  it('requires everyone to still be away', async () => {
    const p = await savedPayload({})
    expect(p.conditions).toContainEqual({ type: 'presence', value: 'all_away' })
  })

  it('keeps the AC-already-on guard alongside it', async () => {
    const p = await savedPayload({})
    expect(p.conditions).toContainEqual(
      { type: 'ir_device_state', ir_device_id: 'ir_ac', operator: 'is_not', value: 'on' })
  })

  it('still carries the optional hot-day condition', async () => {
    const p = await savedPayload({ onlyHot: true, hotEntity: 'sensor.temp_living', hotThreshold: 27 })
    expect(p.conditions).toContainEqual(
      { entity_id: 'sensor.temp_living', operator: 'above', value: '27' })
    expect(p.conditions).toContainEqual({ type: 'presence', value: 'all_away' })
  })
})

// ── Leave Home must require SUSTAINED quiet, not an instantaneous snapshot ───
//
// Live failure (Canary, 2026-08-14): the AC switched itself off twice in half
// an hour while Youval sat in the living room, then came back on minutes later
// as Pre-cool re-fired. No one touched a remote.
//
// Leave Home was saved with the motion source over 15 sensors, compiling to:
//
//   triggers:   <any of the 15> to 'off' for 00:15:00     # OR across sensors
//   conditions: <each of the 15> state 'off'              # INSTANT snapshot
//
// The trigger is an OR, so any single idle room starts the check — a guest
// bathroom does that all day while you are home. The conditions were the
// intended guard ("whole house quiet"), but with no duration they only ask
// "is every PIR off at this exact instant?" — and a PIR in an OCCUPIED room is
// off most of the time, dropping back after its ~60-90s cooldown.
//
//   13:17:03  guest bathroom hit 15:00 idle; living-room PIR off 93s, on again
//             at 13:18:17
//   13:49:27  kitchen hit 15:00 idle; living-room PIR off 70s, on again at
//             13:49:33 — six seconds after the AC was killed
//
// "Quiet" is a duration. Every sensor must have been off for the same window
// the trigger waited on; the living-room PIR, which saw motion every 1-2
// minutes throughout, then fails the guard and nothing happens.

describe('leave_home: whole-house-quiet is a duration', () => {
  const savedPayload = async (values, c = ctx) => {
    const captured = []
    const api = await import('../../../../lib/api')
    const spy = vi.spyOn(api, 'createAutomation').mockImplementation(async (p) => { captured.push(p); return p })
    const del = vi.spyOn(api, 'deleteAutomation').mockImplementation(async () => ({ ok: true }))
    await RECIPES.leave_home.save(
      { sources: { mode: 'choose', ids: ['motion'] }, motionMin: 15,
        lights: { mode: 'all' }, acOff: true, notify: true, alert: false, ...values },
      { ...c, t: (k) => k },
    )
    spy.mockRestore(); del.mockRestore()
    return captured.find((p) => p.id === 'ziggy_leave_home')
  }

  const motionConds = (p) => p.conditions.filter((c) => c.value === 'off' && String(c.entity_id).includes('motion'))

  it('stamps the quiet window on EVERY motion condition', async () => {
    const p = await savedPayload({})
    const conds = motionConds(p)
    expect(conds.length).toBeGreaterThan(1)
    for (const c of conds) expect(c.for_minutes).toBe(15)
  })

  it('keeps the guard window equal to the trigger window', async () => {
    const p = await savedPayload({ motionMin: 25 })
    expect(p.trigger.for_minutes).toBe(25)
    for (const c of motionConds(p)) expect(c.for_minutes).toBe(25)
  })

  it('still guards when phone presence is ANDed in', async () => {
    // Motion stays the trigger event (priority motion → door → phone) and phone
    // joins as an all_away condition. On 2026-08-14 phone presence was the
    // condition that WRONGLY passed — the phone's pinned LAN IP had gone stale,
    // so "everyone away" was true while Youval sat in the living room. The
    // motion conditions were the only remaining guard, which is exactly why
    // they must assert sustained quiet rather than an instant.
    const p = await savedPayload({ sources: { mode: 'choose', ids: ['phone', 'motion'] } })
    expect(p.conditions).toContainEqual({ type: 'presence', value: 'all_away' })
    const conds = motionConds(p)
    expect(conds.length).toBeGreaterThan(0)
    for (const c of conds) expect(c.for_minutes).toBe(15)
  })

  it('leaves the door condition instantaneous — a shut door has no dwell', async () => {
    const p = await savedPayload({
      sources: { mode: 'choose', ids: ['motion', 'door'] },
      doorEntity: 'binary_sensor.door_front',
    })
    const door = p.conditions.find((c) => String(c.entity_id).includes('door'))
    expect(door).toBeDefined()
    expect(door.for_minutes).toBeUndefined()
  })

  it('round-trips the window from conditions when phone is the trigger', async () => {
    // Editing an installed phone+motion setup must not silently reset the
    // window to the 30-minute default and re-save a weaker guard.
    const v = RECIPES.leave_home.derive({
      _isInstalled: true, id: 'ziggy_leave_home',
      trigger: { type: 'all_persons_left' },
      conditions: [
        { entity_id: 'binary_sensor.motion_office', operator: 'is', value: 'off', for_minutes: 15 },
        { entity_id: 'binary_sensor.motion_living', operator: 'is', value: 'off', for_minutes: 15 },
      ],
      actions: [{ type: 'turn_off_all_lights' }],
    }, ctx)
    expect(v.sources.ids.sort()).toEqual(['motion', 'phone'])
    expect(v.motionMin).toBe(15)
  })

  it('regression: a blinking PIR in an occupied room can no longer pass the guard', async () => {
    // The living-room sensor is 'off' this instant but saw motion 70s ago. With
    // a duration on the condition, HA evaluates "off for 15 minutes" and this
    // sensor fails it — which is the whole point.
    const p = await savedPayload({})
    const living = p.conditions.find((c) => c.entity_id === 'binary_sensor.motion_living')
    expect(living).toBeDefined()
    expect(living.for_minutes).toBe(15)
  })
})
