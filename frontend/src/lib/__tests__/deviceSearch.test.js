import { describe, it, expect } from 'vitest'
import { matchesDeviceSearch } from '../deviceSearch'

// Shaped after a real home: a Zigbee smart plug the owner named after the lamp
// plugged into it. Searching "plug" found nothing, so he concluded it was gone.
const plug = {
  entity_id: 'switch.0x842e14fffe2f9f02',
  domain: 'switch',
  friendly_name: 'Living room light',
  display_name: 'Living room light',
}
const plugGroup = {
  card_kind: 'switch',
  name: 'Living room light',
  primary_entity_id: 'switch.0x842e14fffe2f9f02',
  primary_domain: 'switch',
  entities: [
    { entity_id: 'switch.0x842e14fffe2f9f02', domain: 'switch', device_class: null },
    { entity_id: 'sensor.0x842e14fffe2f9f02_power', domain: 'sensor', device_class: 'power' },
    { entity_id: 'sensor.0x842e14fffe2f9f02_energy', domain: 'sensor', device_class: 'energy' },
  ],
}
const wallSwitch = { entity_id: 'switch.hallway', domain: 'switch', friendly_name: 'Hallway' }
const ac = { entity_id: 'climate.bedroom', domain: 'climate', friendly_name: 'Bedroom' }
const motion = { entity_id: 'binary_sensor.entry', domain: 'binary_sensor', device_class: 'motion', friendly_name: 'Entry' }

describe('matchesDeviceSearch', () => {
  it('still matches by name and entity_id', () => {
    expect(matchesDeviceSearch(plug, 'living room')).toBe(true)
    expect(matchesDeviceSearch(plug, '0x842e14')).toBe(true)
    expect(matchesDeviceSearch(plug, '')).toBe(true)
  })

  it('finds a power-metering switch as a plug, in English and Hebrew', () => {
    for (const q of ['plug', 'Smart plug', 'outlet', 'socket', 'שקע']) {
      expect(matchesDeviceSearch(plug, q, plugGroup)).toBe(true)
    }
  })

  it('does not call an unmetered switch a plug', () => {
    expect(matchesDeviceSearch(wallSwitch, 'plug')).toBe(false)
    expect(matchesDeviceSearch(wallSwitch, 'switch')).toBe(true)
    expect(matchesDeviceSearch(wallSwitch, 'מתג')).toBe(true)
  })

  it('matches kind labels and synonyms without a group', () => {
    expect(matchesDeviceSearch(ac, 'air conditioner')).toBe(true)
    expect(matchesDeviceSearch(ac, 'מזגן')).toBe(true)
    expect(matchesDeviceSearch(motion, 'motion')).toBe(true)
    expect(matchesDeviceSearch(motion, 'תנועה')).toBe(true)
    expect(matchesDeviceSearch(ac, 'plug')).toBe(false)
  })

  it('requires every word of a multi-word query', () => {
    expect(matchesDeviceSearch(plug, 'living plug', plugGroup)).toBe(true)
    expect(matchesDeviceSearch(plug, 'kitchen plug', plugGroup)).toBe(false)
  })
})
