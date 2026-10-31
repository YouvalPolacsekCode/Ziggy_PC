import React, { useState } from 'react'
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import ConditionRow from '../ConditionRow'
import { isCompleteCondition } from '../ActionRow'
import { incompleteConditions } from '../../../../lib/automations/completeness'
import { conditionSummary } from '../../../../lib/automations/summaries'

// "Water the garden unless it rains" — one pick in the wizard, and it shows
// up in the review step like every other condition.

afterEach(cleanup)
const visible = (s) => s.replace(/[⁨⁩]/g, '')

function Harness({ initial }) {
  const [c, setC] = useState(initial)
  return (
    <>
      <ConditionRow condition={c} onChange={setC} onRemove={() => {}} />
      <output data-testid="state">{JSON.stringify(c)}</output>
    </>
  )
}
const state = () => JSON.parse(screen.getByTestId('state').textContent)

describe('weather condition', () => {
  it('choosing Weather defaults to "unless it rains today"', () => {
    render(<Harness initial={{ type: 'entity', entity_id: '', operator: 'is', value: 'on' }} />)
    fireEvent.change(screen.getByLabelText('Condition type', { exact: false }), { target: { value: 'weather' } })
    expect(state()).toEqual({ type: 'weather', check: 'rain_today', is: false })
  })

  it('one pick sets both the fact and its direction', () => {
    render(<Harness initial={{ type: 'weather', check: 'rain_today', is: false }} />)
    fireEvent.change(screen.getByLabelText('Only when'), { target: { value: 'rain_yesterday:no' } })
    expect(state()).toEqual({ type: 'weather', check: 'rain_yesterday', is: false })
  })

  it('hot day asks for a temperature, defaulting to 30', () => {
    render(<Harness initial={{ type: 'weather', check: 'rain_today', is: false }} />)
    fireEvent.change(screen.getByLabelText('Only when'), { target: { value: 'hot_today:yes' } })
    expect(state()).toEqual({ type: 'weather', check: 'hot_today', is: true, above: 30 })
    fireEvent.change(screen.getByLabelText('Hotter than (°C)'), { target: { value: '32' } })
    expect(state().above).toBe(32)
  })

  it('a hot-day condition with no number blocks saving', () => {
    expect(incompleteConditions([{ type: 'weather', check: 'hot_today', is: true, above: '' }])).toHaveLength(1)
    expect(incompleteConditions([{ type: 'weather', check: 'rain_today', is: false }])).toHaveLength(0)
  })

  it('reads naturally in summaries', () => {
    expect(visible(conditionSummary({ type: 'weather', check: 'rain_today', is: false }))).toBe('It doesn’t rain today')
    expect(visible(conditionSummary({ type: 'weather', check: 'hot_today', is: true, above: 32 }))).toBe('It’s a hot day (above 32°C)')
  })
})

describe('review step shows every complete condition', () => {
  it('mode, daylight, presence and weather are no longer hidden', () => {
    for (const c of [
      { type: 'mode', mode: 'sleep', is: false },
      { type: 'sun', after: 'sunset' },
      { type: 'presence', value: 'anyone_home' },
      { type: 'weather', check: 'rain_today', is: false },
    ]) expect(isCompleteCondition(c)).toBe(true)
  })

  it('still hides a half-filled condition, as before', () => {
    expect(isCompleteCondition({ type: 'entity', entity_id: '', operator: 'is', value: 'on' })).toBe(false)
    expect(isCompleteCondition({ type: 'time' })).toBe(false)
    expect(isCompleteCondition(null)).toBe(false)
  })

  it('daylight and presence get real summaries instead of "incomplete"', () => {
    expect(visible(conditionSummary({ type: 'sun', after: 'sunset' }))).toBe('Dark (after sunset)')
    expect(visible(conditionSummary({ type: 'presence', value: 'all_away' }))).not.toMatch(/incomplete/i)
  })
})
