// Bug 4: a dimmable bulb named "...Lamp" (or "...Strip") must still expose
// brightness/color-temp controls. Its friendly name makes getKind() return
// KIND.LAMP / KIND.LED_STRIP, and the control + capability paths previously
// only handled KIND.LIGHT — so lamps fell through to bare on/off.
//
// Real Canary data: light.<mac> "Living Room Lamp", supported_color_modes
// ['color_temp'] — genuinely dimmable + tunable, yet rendered on/off only.

import { describe, expect, it } from 'vitest'
import { getKind, getCapabilities, isLightKind, KIND } from '../devices.js'

const lamp = {
  entity_id: 'light.0xa4c13852e1286e50',
  domain: 'light',
  friendly_name: 'Living Room Lamp',
  display_name: 'Living Room Lamp',
  supported_color_modes: ['color_temp'],
  state: 'on',
  brightness: 120,
}

const strip = {
  entity_id: 'light.desk_led_strip',
  domain: 'light',
  friendly_name: 'Desk LED Strip',
  supported_color_modes: ['xy', 'color_temp'],
  state: 'on',
}

const plainLight = {
  entity_id: 'light.office_light',
  domain: 'light',
  friendly_name: 'Office Light',
  supported_color_modes: ['color_temp', 'xy'],
  state: 'on',
}

describe('Bug 4 — lamp/strip kinds are light-kinds with dimming capabilities', () => {
  it('classifies a "Lamp" as KIND.LAMP and a "Strip" as KIND.LED_STRIP', () => {
    expect(getKind(lamp)).toBe(KIND.LAMP)
    expect(getKind(strip)).toBe(KIND.LED_STRIP)
    expect(getKind(plainLight)).toBe(KIND.LIGHT)
  })

  it('treats lamp/led_strip/light uniformly as light-kinds', () => {
    expect(isLightKind(KIND.LAMP)).toBe(true)
    expect(isLightKind(KIND.LED_STRIP)).toBe(true)
    expect(isLightKind(KIND.LIGHT)).toBe(true)
    expect(isLightKind(KIND.SWITCH)).toBe(false)
  })

  it('exposes brightness (and color_temp) for a dimmable lamp', () => {
    const caps = getCapabilities(lamp)
    expect(caps.has('brightness')).toBe(true)
    expect(caps.has('color_temp')).toBe(true)
  })

  it('exposes brightness + color for a colour LED strip', () => {
    const caps = getCapabilities(strip)
    expect(caps.has('brightness')).toBe(true)
    expect(caps.has('color')).toBe(true)
  })
})
