// The wizard must not let through a rule that cannot work, and must not
// quietly change or discard what the user built.
//
// Until 2026-09-22 `canNext()` was `!!(trigger.type || 'time')` — true for
// every possible input — so a half-filled trigger walked to a save that could
// never fire, and half-filled CONDITIONS were deleted on the way out without
// a word.
import { describe, it, expect } from 'vitest'
import { saveBlocker, triggerBlocker, isEffectiveAction, incompleteConditions } from '../automations/completeness'
import { normaliseTrigger, PRESENCE_TRIGGER_TYPES, PRESENCE_EVENT_TYPES, presenceEventFor } from '../automations/types'
import { readFileSync } from 'node:fs'

const act = [{ type: 'call_service', entity_id: 'light.a', service: 'light.turn_on' }]

describe('trigger completeness', () => {
  it.each([
    [{ type: 'state', entity_id: '' }, 'triggerEntity'],
    [{ type: 'numeric_state', entity_id: '' }, 'triggerEntity'],
    [{ type: 'occupancy', entity_id: '' }, 'triggerRoom'],
    [{ type: 'time', time: '' }, 'triggerTime'],
    [{ type: 'time_pattern' }, 'triggerPattern'],
    [{ type: 'controller', controller_id: '', action: '' }, 'triggerController'],
    // Half of a controller trigger compiles to an EMPTY trigger list in HA —
    // an automation with nothing to set it off at all.
    [{ type: 'controller', controller_id: 'b1', action: '' }, 'triggerController'],
    [{ type: 'webhook', webhook_id: '' }, 'triggerWebhook'],
  ])('blocks %o', (trigger, expected) => {
    expect(triggerBlocker(trigger)).toBe(expected)
  })

  it.each([
    [{ type: 'state', entity_id: 'binary_sensor.door' }],
    [{ type: 'time', time: '07:30' }],
    [{ type: 'time_pattern', minutes: '/15' }],
    [{ type: 'controller', controller_id: 'b1', action: 'single' }],
    [{ type: 'person_arrives', person: '*' }],
    [{ type: 'all_persons_left' }],
    [{ type: 'zone_entered', zone: 'Near Home', person: '*' }],
    [{ type: 'sunrise' }],
    [{ type: 'manual' }],
  ])('allows %o', (trigger) => {
    expect(triggerBlocker(trigger)).toBeNull()
  })

  it('leaves shapes it does not know alone rather than blocking them', () => {
    expect(triggerBlocker({ type: 'something_a_recipe_wrote' })).toBeNull()
  })
})

describe('saveBlocker', () => {
  it('reports the trigger before the actions', () => {
    // Both are wrong; the user is standing on the trigger step.
    expect(saveBlocker({ name: 'x', trigger: { type: 'time', time: '' }, actions: [] }))
      .toBe('triggerTime')
  })

  it('still catches the balcony case — no actions', () => {
    expect(saveBlocker({ name: 'x', trigger: { type: 'manual' }, actions: [] })).toBe('actions')
  })

  it('still catches an action with no device', () => {
    expect(saveBlocker({
      name: 'x', trigger: { type: 'manual' },
      actions: [{ type: 'call_service', entity_id: '' }],
    })).toBe('actionTarget')
  })

  it('refuses a half-filled condition instead of deleting it', () => {
    expect(saveBlocker({
      name: 'x', trigger: { type: 'manual' }, actions: act,
      conditions: [{ type: 'entity', entity_id: '' }],
    })).toBe('conditions')
  })

  it('passes a complete automation', () => {
    expect(saveBlocker({
      name: 'Hall light', trigger: { type: 'person_arrives', person: 'Rachel' }, actions: act,
      conditions: [{ type: 'sun', after: 'sunset' }, { type: 'presence', value: 'anyone_home' }],
    })).toBeNull()
  })
})

describe('action effectiveness', () => {
  it('rejects the empty shapes the wizard can create', () => {
    expect(isEffectiveAction({ type: 'call_service', entity_id: '' })).toBe(false)
    expect(isEffectiveAction({ type: 'speak', text: '  ' })).toBe(false)
    expect(isEffectiveAction({ type: 'wait_for_state', entity_id: '' })).toBe(false)
    expect(isEffectiveAction({ type: 'notify', message: '' })).toBe(false)
  })
  it('accepts filled ones, and shapes that need no target', () => {
    expect(isEffectiveAction({ type: 'speak', text: 'Good night' })).toBe(true)
    expect(isEffectiveAction({ type: 'turn_off_everything' })).toBe(true)
    expect(isEffectiveAction({ type: 'delay', seconds: 5 })).toBe(true)
  })
})

describe('incompleteConditions', () => {
  it('knows each condition type’s own test', () => {
    expect(incompleteConditions([
      { type: 'entity', entity_id: 'light.a' },
      { type: 'time', after: '21:00' },
      { type: 'mode', mode: 'sleep' },
      { type: 'sun', after: 'sunset' },
      { type: 'presence', value: 'all_away' },
      { type: 'or_group', conditions: [{ type: 'entity', entity_id: 'light.a' }] },
    ])).toHaveLength(0)

    expect(incompleteConditions([
      { type: 'entity', entity_id: '' },
      { type: 'time' },
      { type: 'sun' },
      { type: 'presence' },
      { type: 'or_group', conditions: [] },
    ])).toHaveLength(5)
  })
})

describe('trigger round-trip', () => {
  // A legacy `zone` rule re-presents in the presence editor. If it were not
  // normalised on LOAD, editing only the name would write the old shape back
  // and the UI would permanently disagree with storage.
  it('converts a legacy zone-home trigger to the native shape', () => {
    expect(normaliseTrigger({ type: 'zone', entity_id: 'person.youval', zone: 'zone.home', event: 'enter' }))
      .toEqual({ type: 'person_arrives', person: '*' })
    expect(normaliseTrigger({ type: 'zone', entity_id: 'person.youval', zone: 'zone.home', event: 'leave' }))
      .toEqual({ type: 'person_leaves', person: '*' })
  })

  it('converts a legacy named-zone trigger to the named-place shape', () => {
    expect(normaliseTrigger({ type: 'zone', entity_id: 'person.y', zone: 'zone.Near Home', event: 'enter' }))
      .toEqual({ type: 'zone_entered', zone: 'Near Home', person: '*' })
  })

  it('is idempotent, and leaves every other trigger untouched', () => {
    for (const t of [
      { type: 'state', entity_id: 'binary_sensor.door', state: 'on' },
      { type: 'time', time: '07:30' },
      { type: 'person_arrives', person: 'Rachel' },
      { type: 'zone_entered', zone: 'Near Home', person: '*' },
      { type: 'manual' },
    ]) {
      expect(normaliseTrigger(t)).toEqual(t)
      expect(normaliseTrigger(normaliseTrigger(t))).toEqual(normaliseTrigger(t))
    }
  })

  it('normalising a legacy trigger yields something the wizard accepts', () => {
    const out = normaliseTrigger({ type: 'zone', entity_id: '', zone: 'zone.home', event: 'enter' })
    expect(triggerBlocker(out)).toBeNull()
  })
})

describe('occupancy round-trip', () => {
  // The wizard's occupancy trigger resolves to a plain `state` trigger on a
  // room's presence sensor. Reopening it used to be inferred from the
  // sensor's device_class — a guess that is wrong the moment the sensor is
  // deleted or reclassified, silently re-presenting the rule as a bare
  // "device state" trigger. `ui: 'occupancy'` makes it exact.
  it('carries a ui stamp that survives normalisation', () => {
    const saved = { type: 'state', ui: 'occupancy', entity_id: 'binary_sensor.office_occupied', state: 'on' }
    expect(normaliseTrigger(saved)).toEqual(saved)
    expect(triggerBlocker(saved)).toBeNull()
  })

  it('is still blocked when it names no sensor', () => {
    expect(triggerBlocker({ type: 'occupancy', entity_id: '' })).toBe('triggerRoom')
  })
})

describe('presence editor \u2194 TriggerEditor agreement', () => {
  // The bug this exists for: PresenceTriggerEditor could emit `zone_entered`
  // and `zone_left`, but TriggerEditor's `isPresenceTrigger` listed only the
  // three person_* shapes. Picking "Someone arrives at a place" set a type
  // the editor did not claim, so `uiType` fell through, the presence editor
  // unmounted, and the trigger dropdown snapped back to its first option —
  // in front of the user, mid-edit. Two hand-kept lists, one of them stale.
  it('every type the editor can write is a recognised presence trigger', () => {
    const emitted = Object.values(PRESENCE_EVENT_TYPES)
    expect(emitted).toContain('zone_entered')   // "arrives at a place"
    expect(emitted).toContain('zone_left')      // "leaves a place"
    for (const t of emitted) {
      expect(PRESENCE_TRIGGER_TYPES, `editor can write '${t}'`).toContain(t)
    }
  })

  it('round-trips every dropdown choice back to itself', () => {
    for (const [event, type] of Object.entries(PRESENCE_EVENT_TYPES)) {
      expect(presenceEventFor(type), `${type} should read back as '${event}'`).toBe(event)
    }
  })

  it('reads the legacy and unknown shapes as "arrives" rather than blank', () => {
    expect(presenceEventFor('zone')).toBe('arrives')
    expect(presenceEventFor(undefined)).toBe('arrives')
  })

  it('TriggerEditor uses the shared list rather than its own copy', () => {
    const src = readFileSync('src/components/automations/wizard/TriggerEditor.jsx', 'utf-8')
    expect(src).toContain('PRESENCE_TRIGGER_TYPES.includes(effectiveType)')
  })

  it('each presence type maps to the presence editor, not a dead uiType', () => {
    const uiTypeFor = (type) => PRESENCE_TRIGGER_TYPES.includes(type) ? 'presence' : type
    for (const t of [...Object.values(PRESENCE_EVENT_TYPES), 'zone']) {
      expect(uiTypeFor(t)).toBe('presence')
    }
  })
})
