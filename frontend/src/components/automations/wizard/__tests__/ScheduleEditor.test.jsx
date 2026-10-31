import React, { useState } from 'react'
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import ScheduleEditor from '../ScheduleEditor'
import {
  scheduleTimes, scheduleDays, daysPreset, withSlots, withDays, WORKWEEK,
} from '../../../../lib/automations/schedule'
import { scheduleSummary, triggerSummary } from '../../../../lib/automations/summaries'
import { triggerBlocker } from '../../../../lib/automations/completeness'

// "3 times a day, 4 days a week" — and every existing time rule (no days, one
// time) must read, validate and summarise exactly as it did before.

const OLD = { type: 'time', time: '07:00' }
const PLAN = { type: 'time', time: '07:00', times: ['07:00', '13:00', '19:30'], days: ['sun', 'mon', 'tue', 'wed'] }

// The app's default language is English, which these strings assert on.
afterEach(cleanup)

describe('schedule helpers', () => {
  it('reads an old rule as every day at one time', () => {
    expect(scheduleTimes(OLD)).toEqual(['07:00'])
    expect(scheduleDays(OLD)).toBeNull()
    expect(daysPreset(scheduleDays(OLD))).toBe('every')
  })

  it('reads several times and days', () => {
    expect(scheduleTimes(PLAN)).toEqual(['07:00', '13:00', '19:30'])
    expect(scheduleDays(PLAN)).toEqual(['sun', 'mon', 'tue', 'wed'])
    expect(daysPreset(scheduleDays(PLAN))).toBe('custom')
    expect(daysPreset(WORKWEEK)).toBe('workweek')
  })

  it('keeps `time` as the first slot and drops `times` for a single one', () => {
    expect(withSlots(OLD, ['08:00', '20:00'])).toEqual({ type: 'time', time: '08:00', times: ['08:00', '20:00'] })
    expect(withSlots(PLAN, ['09:00'])).not.toHaveProperty('times')
  })

  it('every day / all seven days removes the days field', () => {
    expect(withDays(PLAN, null)).not.toHaveProperty('days')
    expect(withDays(PLAN, ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'])).not.toHaveProperty('days')
  })
})

// The i18n layer wraps interpolated values in bidi isolates (U+2068/U+2069) so
// Hebrew and Latin mix safely; compare the visible text.
const visible = (s) => s.replace(/[\u2068\u2069]/g, '')

describe('summaries', () => {
  it('an old rule reads exactly as before', () => {
    expect(visible(triggerSummary(OLD))).toBe('Every day at 07:00')
  })
  it('several times on chosen days', () => {
    expect(visible(scheduleSummary(PLAN))).toBe('Sun, Mon, Tue, Wed at 07:00, 13:00, 19:30')
  })
  it('Israeli workweek and weekend presets', () => {
    expect(visible(scheduleSummary({ ...OLD, days: WORKWEEK }))).toBe('Sun–Thu at 07:00')
    expect(visible(scheduleSummary({ ...OLD, days: ['fri', 'sat'] }))).toBe('Fri–Sat at 07:00')
  })
})

describe('save check', () => {
  it('accepts an old rule and a full plan', () => {
    expect(triggerBlocker(OLD)).toBeNull()
    expect(triggerBlocker(PLAN)).toBeNull()
  })
  it('blocks no time, a blank extra time, and no days', () => {
    expect(triggerBlocker({ type: 'time', time: '' })).toBe('triggerTime')
    expect(triggerBlocker({ ...PLAN, times: ['07:00', ''] })).toBe('triggerTime')
    expect(triggerBlocker({ ...PLAN, days: [] })).toBe('triggerDays')
  })
})

function Harness({ initial }) {
  const [trigger, setTrigger] = useState(initial)
  return (
    <>
      <ScheduleEditor trigger={trigger} onChange={setTrigger} />
      <output data-testid="state">{JSON.stringify(trigger)}</output>
    </>
  )
}
const state = () => JSON.parse(screen.getByTestId('state').textContent)

describe('ScheduleEditor', () => {
  it('builds 3 times a day, 4 days a week', () => {
    render(<Harness initial={OLD} />)
    // Days: start from every day, switch off Thu, Fri, Sat.
    for (const d of ['Thu', 'Fri', 'Sat']) fireEvent.click(screen.getByRole('button', { name: d }))
    // Times: add two more.
    fireEvent.click(screen.getByRole('button', { name: /Add a time/ }))
    fireEvent.click(screen.getByRole('button', { name: /Add a time/ }))
    const inputs = screen.getAllByLabelText('Time (HH:MM)')
    fireEvent.change(inputs[1], { target: { value: '13:00' } })
    fireEvent.change(inputs[2], { target: { value: '19:30' } })
    expect(state()).toEqual(PLAN)
    expect(triggerBlocker(state())).toBeNull()
  })

  it('presets set the days in one tap', () => {
    render(<Harness initial={OLD} />)
    fireEvent.click(screen.getByRole('button', { name: 'Sun–Thu' }))
    expect(state().days).toEqual(WORKWEEK)
    fireEvent.click(screen.getByRole('button', { name: 'Every day' }))
    expect(state()).not.toHaveProperty('days')
  })

  it('unpicking every day leaves an explicit empty list the wizard blocks', () => {
    render(<Harness initial={{ ...OLD, days: ['mon'] }} />)
    fireEvent.click(screen.getByRole('button', { name: 'Mon' }))
    expect(state().days).toEqual([])
    expect(triggerBlocker(state())).toBe('triggerDays')
  })

  it('removing a time keeps the rest', () => {
    render(<Harness initial={PLAN} />)
    fireEvent.click(screen.getAllByRole('button', { name: 'Remove this time' })[1])
    expect(state()).toMatchObject({ time: '07:00', times: ['07:00', '19:30'] })
  })

  it('an old rule shows one time and no remove button', () => {
    render(<Harness initial={OLD} />)
    expect(screen.getAllByLabelText('Time (HH:MM)')).toHaveLength(1)
    expect(screen.queryByRole('button', { name: 'Remove this time' })).toBeNull()
  })
})
