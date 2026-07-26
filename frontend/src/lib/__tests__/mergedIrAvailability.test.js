// Merged IR+Wi-Fi device availability + command routing.
//
// A Wi-Fi TV linked to an IR remote must stay OPERABLE while its Wi-Fi side is
// offline (TV powered off → HA entity reports 'unavailable'): the tile shows
// "Off" and available, tapping it sends the IR power code, and once the TV
// rejoins Wi-Fi the smart side takes back over. Locks that contract.

import { describe, expect, it, vi, beforeEach } from 'vitest'

// Mock the API layer so sendDeviceCommand's dispatch is observable and no real
// HTTP happens.
vi.mock('../api', () => ({
  callHaService:      vi.fn(() => Promise.resolve({ ok: true })),
  irSend:             vi.fn(() => Promise.resolve({ ok: true })),
  irSendChannel:      vi.fn(() => Promise.resolve({ ok: true })),
  irSetAcTemperature: vi.fn(() => Promise.resolve({ ok: true })),
  irRunSequence:      vi.fn(() => Promise.resolve({ ok: true })),
  controlDevice:      vi.fn(() => Promise.resolve({ ok: true })),
}))

import {
  isAvailable, isOn, effectiveState, smartSideDown,
  deviceFacts, commandAvailable, sendDeviceCommand,
} from '../devices'
import { irSend, controlDevice } from '../api'

// A merged TV: the Wi-Fi media_player entity carrying a linked IR snapshot with
// a learned power command.
function mergedTv({ state, irAssumed = 'off' } = {}) {
  return {
    entity_id: 'media_player.living_room_tv',
    domain: 'media_player',
    state,
    friendly_name: 'Living Room TV',
    _linkedIr: { id: 'ir_1', type: 'tv', assumed_state: irAssumed,
                 learned_commands: ['power'], commands: { power: '...' } },
  }
}

beforeEach(() => { irSend.mockClear(); controlDevice.mockClear() })

describe('merged IR+Wi-Fi while Wi-Fi is offline', () => {
  it('is available even though the Wi-Fi entity is unavailable', () => {
    expect(isAvailable(mergedTv({ state: 'unavailable' }))).toBe(true)
    expect(smartSideDown(mergedTv({ state: 'unavailable' }))).toBe(true)
  })

  it('reads Off (from the IR assumed state), not Unavailable', () => {
    const facts = deviceFacts(mergedTv({ state: 'unavailable', irAssumed: 'off' }))
    expect(facts.isOn).toBe(false)
    expect(facts.isAvailable).toBe(true)
    expect(facts.stateLabel).toBe('Off')
  })

  it('reflects an IR-assumed ON while Wi-Fi is still catching up', () => {
    const facts = deviceFacts(mergedTv({ state: 'unavailable', irAssumed: 'on' }))
    expect(facts.isOn).toBe(true)
    expect(effectiveState(mergedTv({ state: 'unavailable', irAssumed: 'on' }))).toBe('on')
  })

  it('offers the power toggle (IR power is learned)', () => {
    expect(commandAvailable(mergedTv({ state: 'unavailable' }), 'toggle')).toBe(true)
  })

  it('withholds the toggle when the IR power command is NOT learned', () => {
    const tv = mergedTv({ state: 'unavailable' })
    tv._linkedIr.learned_commands = []
    tv._linkedIr.commands = {}
    expect(commandAvailable(tv, 'toggle')).toBe(false)
  })

  it('routes the ON toggle to IR, not to the (offline) Wi-Fi service', async () => {
    await sendDeviceCommand(mergedTv({ state: 'unavailable', irAssumed: 'off' }), 'toggle')
    expect(irSend).toHaveBeenCalledWith('ir_1', 'power')
    expect(controlDevice).not.toHaveBeenCalled()
  })
})

describe('merged IR+Wi-Fi while Wi-Fi is online — smart side owns it', () => {
  it('reads live Wi-Fi state, not the IR fallback', () => {
    const facts = deviceFacts(mergedTv({ state: 'playing', irAssumed: 'off' }))
    expect(facts.isOn).toBe(true)
    expect(facts.stateLabel).toBe('Playing')
    expect(smartSideDown(mergedTv({ state: 'playing' }))).toBe(false)
  })

  it('routes commands over HA when the Wi-Fi entity is live', async () => {
    // 'on' while playing → toggle expands to power_off → controlDevice (HA).
    await sendDeviceCommand(mergedTv({ state: 'playing' }), 'toggle')
    expect(controlDevice).toHaveBeenCalledTimes(1)
    expect(irSend).not.toHaveBeenCalled()
  })
})

describe('regressions: plain devices unchanged', () => {
  it('a plain Wi-Fi device that is unavailable stays unavailable', () => {
    const plain = { entity_id: 'switch.x', domain: 'switch', state: 'unavailable' }
    expect(isAvailable(plain)).toBe(false)
    expect(commandAvailable(plain, 'toggle')).toBe(false)
  })

  it('a plain online switch is available and toggles over HA', async () => {
    const plain = { entity_id: 'switch.x', domain: 'switch', state: 'off' }
    expect(isAvailable(plain)).toBe(true)
    await sendDeviceCommand(plain, 'toggle')
    expect(controlDevice).toHaveBeenCalledTimes(1)
    expect(irSend).not.toHaveBeenCalled()
  })

  it('a pure IR device is available and sends IR', async () => {
    const ir = { entity_id: 'ir.tv', domain: 'media_player', _ir: true,
                 assumed_state: 'off',
                 _irDevice: { id: 'ir_9', type: 'tv', learned_commands: ['power'],
                              commands: { power: '...' } } }
    expect(isAvailable(ir)).toBe(true)
    await sendDeviceCommand(ir, 'toggle')
    expect(irSend).toHaveBeenCalledWith('ir_9', 'power')
  })
})
