// Unified bundle engine — recipe tests.
//
// The behavior-critical layer is derive(): it reconstructs an INSTALLED
// bundle's wizard values from the saved automation/config. If it drifts, "edit"
// silently loses user settings. These tests round-trip each recipe's derive
// against the exact payload shapes its save() produces (ported from the legacy
// wizards), plus the shared pick helpers and the automation→recipe router.

import { describe, expect, it } from 'vitest'
import { pickedIds, pickFrom } from '../engine/context'
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
  roomOf: (eid) => ROOMS[eid] || '__none__',
  nameWithRoom: (e) => e.entity_id,
  asItem: (e) => ({ id: e.entity_id, label: e.entity_id, _entity: e }),
  persons: [{ id: 'p1' }],
  homeZone: { lat: 1, lon: 2 },
  zones: [{ id: 'z1', name: 'Near Home', radius_m: 2000 }],
  hostActions: {},
}

// ── Shared helpers ───────────────────────────────────────────────────────────
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
