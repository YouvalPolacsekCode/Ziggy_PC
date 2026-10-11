// Name translation on the phone pass, 2026-09-27.
//
// The Actions page showed "מזגן Schedule": the phrase translator knew "AC" and
// not "Schedule", and shipped half a name. A name is translated whole or left
// alone; a room called "Outside" has a Hebrew word.

import { describe, it, expect } from 'vitest'
import { translateNamePhrase, translateName } from '../nameDict'

describe('translateNamePhrase', () => {
  it('translates a name it fully understands', () => {
    expect(translateNamePhrase('Living Room Lamp', 'he')).not.toMatch(/[A-Za-z]/)
  })

  it('leaves a name alone rather than translating half of it', () => {
    expect(translateNamePhrase('AC Schedule', 'he')).toBe('AC Schedule')
    expect(translateNamePhrase('Bedroom Presence Raw', 'he')).toBe('Bedroom Presence Raw')
  })

  it('still passes through a name that was already mixed', () => {
    expect(translateNamePhrase('Sonos One סלון', 'he')).toBe('Sonos One סלון')
  })

  it('knows the outside of the house', () => {
    expect(translateName('Outside', 'he')).toBe('בחוץ')
    expect(translateName('outdoor', 'he')).toBe('בחוץ')
  })
})
