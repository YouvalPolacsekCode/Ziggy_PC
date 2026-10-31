import React, { useState } from 'react'
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import ActionRow from '../ActionRow'
import { canHaveDuration, withDurationRule } from '../../../../lib/automations/duration'
import { saveBlocker } from '../../../../lib/automations/completeness'
import { actionSummary } from '../../../../lib/automations/summaries'

// "Water the garden for 20 minutes" is one step: a turn-on with for_minutes.
// The hub expands it to on → wait → off (services/timed_actions.py).

afterEach(cleanup)
const visible = (s) => s.replace(/[⁨⁩]/g, '')
const VALVE = { type: 'call_service', entity_id: 'switch.garden_valve', service: 'homeassistant.turn_on', service_value: 'turn_on' }

function Harness({ initial }) {
  const [a, setA] = useState(initial)
  return (
    <>
      <ActionRow action={a} index={0} onChange={setA} onRemove={() => {}} />
      <output data-testid="state">{JSON.stringify(a)}</output>
    </>
  )
}
const state = () => JSON.parse(screen.getByTestId('state').textContent)

describe('for how long', () => {
  it('a turn-on step offers it and stores minutes on the same step', () => {
    render(<Harness initial={VALVE} />)
    fireEvent.change(screen.getByLabelText('For how long (minutes)'), { target: { value: '20' } })
    expect(state()).toEqual({ ...VALVE, for_minutes: 20 })
  })

  it('clearing it removes the timer', () => {
    render(<Harness initial={{ ...VALVE, for_minutes: 20 }} />)
    fireEvent.change(screen.getByLabelText('For how long (minutes)'), { target: { value: '' } })
    expect(state()).toEqual(VALVE)
  })

  it('a turn-off step has no "for how long"', () => {
    render(<Harness initial={{ ...VALVE, service: 'homeassistant.turn_off', service_value: 'turn_off' }} />)
    expect(screen.queryByLabelText('For how long (minutes)')).toBeNull()
  })

  it('switching to turn off drops a hidden timer', () => {
    expect(withDurationRule({ ...VALVE, service: 'homeassistant.turn_off', for_minutes: 20 }).for_minutes).toBeUndefined()
    expect(withDurationRule({ ...VALVE, for_minutes: 20 }).for_minutes).toBe(20)
  })

  it('matches the hub on which steps can take one', () => {
    expect(canHaveDuration(VALVE)).toBe(true)
    expect(canHaveDuration({ ...VALVE, entity_id: 'cover.blind', service: 'homeassistant.open_cover' })).toBe(true)
    expect(canHaveDuration({ ...VALVE, entity_id: 'script.go' })).toBe(false)
    expect(canHaveDuration({ ...VALVE, entity_id: 'lock.door', service: 'homeassistant.unlock' })).toBe(false)
  })

  it('reads as one sentence', () => {
    expect(visible(actionSummary({ ...VALVE, for_minutes: 20 }))).toMatch(/for 20 minutes$/)
    expect(visible(actionSummary({ ...VALVE, for_minutes: 120 }))).toMatch(/for 2 hours$/)
  })

  it('a nonsense length blocks save', () => {
    const base = { name: 'Water', trigger: { type: 'time', time: '06:00' } }
    expect(saveBlocker({ ...base, actions: [{ ...VALVE, for_minutes: 20 }] })).toBeNull()
    expect(saveBlocker({ ...base, actions: [{ ...VALVE, for_minutes: 0 }] })).toBe('actionDuration')
    expect(saveBlocker({ ...base, actions: [{ ...VALVE, for_minutes: 2000 }] })).toBe('actionDuration')
  })
})

describe('wait step', () => {
  it('takes minutes and seconds, stores total seconds', () => {
    render(<Harness initial={{ type: 'delay', seconds: 0 }} />)
    fireEvent.change(screen.getByLabelText('Minutes'), { target: { value: '5' } })
    fireEvent.change(screen.getByLabelText('Seconds'), { target: { value: '30' } })
    expect(state()).toEqual({ type: 'delay', seconds: 330 })
  })

  it('a whole number of minutes reads in minutes', () => {
    expect(visible(actionSummary({ type: 'delay', seconds: 1200 }))).toBe('Wait 20 minutes')
    expect(visible(actionSummary({ type: 'delay', seconds: 45 }))).toBe('Wait 45 seconds')
  })
})
