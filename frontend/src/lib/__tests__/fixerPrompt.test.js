import { describe, it, expect } from 'vitest'
import { buildFixerQuestion } from '../fixerPrompt'

// The device page's "not responding? fix it" affordance hands this text to the
// assistant as if the user had typed it. So it must read like a person asking —
// and it must be CLEAN text: the agent picks its reply language from the string
// itself, and invisible bidi marks would ride along into the model's context.

describe('buildFixerQuestion', () => {
  it('asks about the device by name in Hebrew', () => {
    const q = buildFixerQuestion('נורת הסלון', 'he')
    expect(q).toContain('נורת הסלון')
    expect(q).toMatch(/[֐-׿]/)
  })

  it('asks about the device by name in English', () => {
    const q = buildFixerQuestion('Living Room Lamp', 'en')
    expect(q).toContain('Living Room Lamp')
    expect(q.toLowerCase()).toContain('responding')
  })

  it('carries no invisible bidi marks into the assistant', () => {
    const q = buildFixerQuestion('Living Room Lamp', 'he')
    expect(q).not.toMatch(/[⁦-⁩]/)
  })

  it('still asks something sensible when the name is missing', () => {
    const q = buildFixerQuestion('', 'he')
    expect(q.trim().length).toBeGreaterThan(0)
    expect(q).not.toContain('{name}')
  })
})
