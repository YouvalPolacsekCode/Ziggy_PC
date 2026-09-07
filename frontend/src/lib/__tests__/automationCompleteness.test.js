import { describe, expect, it } from 'vitest'
import { isEffectiveAction, saveBlocker } from '../automations/completeness'

describe('isEffectiveAction', () => {
  it('rejects the empty row "add action" creates', () => {
    expect(isEffectiveAction({ type: 'call_service', entity_id: '', service: 'homeassistant.turn_on' })).toBe(false)
    expect(isEffectiveAction({ type: 'call_service', entity_id: '   ' })).toBe(false)
  })

  it('accepts a call_service with a device', () => {
    expect(isEffectiveAction({ type: 'call_service', entity_id: 'light.balcony', service: 'light.turn_on' })).toBe(true)
  })

  it('leaves other step types alone — they have their own editors', () => {
    expect(isEffectiveAction({ type: 'ir_command', ir_device_name: 'AC', ir_command: 'off' })).toBe(true)
    expect(isEffectiveAction({ type: 'delay', seconds: 120 })).toBe(true)
    expect(isEffectiveAction({ type: 'notify', message: 'hi' })).toBe(true)
  })

  it('rejects nothing at all', () => {
    expect(isEffectiveAction(null)).toBe(false)
    expect(isEffectiveAction(undefined)).toBe(false)
  })
})

describe('saveBlocker', () => {
  it('blocks an automation with no actions — the balcony-light bug', () => {
    expect(saveBlocker({ name: 'תאורת מרפסת', actions: [] })).toBe('actions')
    expect(saveBlocker({ name: 'תאורת מרפסת' })).toBe('actions')
  })

  it('blocks an action row where no device was ever chosen', () => {
    expect(saveBlocker({
      name: 'תאורת מרפסת',
      actions: [{ type: 'call_service', entity_id: '', service: 'homeassistant.turn_on' }],
    })).toBe('actionTarget')
  })

  it('still blocks on a missing name first', () => {
    expect(saveBlocker({ name: '  ', actions: [{ type: 'call_service', entity_id: 'light.a' }] })).toBe('name')
  })

  it('passes a complete automation', () => {
    expect(saveBlocker({
      name: 'תאורת מרפסת',
      actions: [{ type: 'call_service', entity_id: 'light.balcony', service: 'light.turn_on' }],
    })).toBe(null)
  })

  it('passes when only one of several rows is filled in', () => {
    expect(saveBlocker({
      name: 'x',
      actions: [
        { type: 'call_service', entity_id: '' },
        { type: 'call_service', entity_id: 'light.balcony' },
      ],
    })).toBe(null)
  })
})
