import { describe, it, expect } from 'vitest'
import { getConditionTypes, getActionTypes, getModeOptions, HOME_MODES } from '../automations/types'
import { actionSummary, conditionSummary } from '../automations/summaries'

describe('home modes in the builder vocabulary', () => {
  it('offers the mode condition and the set-mode action', () => {
    expect(getConditionTypes().map(o => o.value)).toContain('mode')
    expect(getActionTypes().map(o => o.value)).toContain('set_mode')
  })

  it('exposes exactly the five fixed modes', () => {
    expect(HOME_MODES).toEqual(['sleep', 'movie', 'cleaning', 'guest', 'vacation'])
    expect(getModeOptions().map(o => o.value)).toEqual(HOME_MODES)
    for (const o of getModeOptions()) expect(o.label).toBeTruthy()
  })

  it('summarises mode steps and conditions in plain words', () => {
    expect(actionSummary({ type: 'set_mode', mode: 'movie', on: true })).toMatch(/movie|סרט/i)
    expect(actionSummary({ type: 'set_mode', mode: 'guest', on: false })).toMatch(/off|כיבוי/i)
    expect(conditionSummary({ type: 'mode', mode: 'sleep', is: false })).toMatch(/off|כבוי/i)
    expect(conditionSummary({ type: 'mode', mode: 'cleaning', is: true })).toMatch(/on|פעיל/i)
  })
})
