// The wizard must not let through a rule that cannot work, and must not
// quietly change or discard what the user built.
//
// Until 2026-09-22 `canNext()` was `!!(trigger.type || 'time')` — true for
// every possible input — so a half-filled trigger walked to a save that could
// never fire, and half-filled CONDITIONS were deleted on the way out without
// a word.
import { describe, it, expect } from 'vitest'
import { saveBlocker, triggerBlocker, isEffectiveAction, incompleteConditions } from '../automations/completeness'
import { normaliseTrigger } from '../automations/types'

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
