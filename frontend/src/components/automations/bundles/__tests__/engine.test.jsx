// Unified bundle engine — render smoke tests.
//
// Mounts the REAL BundleHost (engine + recipes + i18n) against a seeded device
// store, drives a create wizard step-by-step to the shared review screen, and
// opens an installed bundle straight into the flat editor. This is the "does
// the engine actually render and save" layer above the pure derive() tests.

import React from 'react'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

// Silence real network — recipes only ever touch the API through these.
vi.mock('../../../../lib/api', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    createAutomation: vi.fn(async () => ({ ok: true })),
    deleteAutomation: vi.fn(async () => ({ ok: true })),
    getEntities: vi.fn(async () => ({ entities: [] })),
    getPresencePersons: vi.fn(async () => ({ persons: [] })),
    getPresenceZone: vi.fn(async () => null),
    listPresenceZones: vi.fn(async () => ({ zones: [] })),
    getIrDevices: vi.fn(async () => []),
  }
})

import { createAutomation } from '../../../../lib/api'
import { useDeviceStore } from '../../../../stores/deviceStore'
import BundleHost from '../engine/BundleHost'

const E = (entity_id, domain, device_class, extra = {}) => ({ entity_id, domain, device_class, ...extra })

beforeEach(() => {
  vi.clearAllMocks()
  useDeviceStore.setState({
    entities: [
      E('climate.ac_living', 'climate', undefined, { name: 'Living AC' }),
      E('binary_sensor.window_kitchen', 'binary_sensor', 'window', { name: 'Kitchen Window' }),
      E('binary_sensor.motion_office', 'binary_sensor', 'motion', { name: 'Office Motion' }),
      E('light.office', 'light', undefined, { name: 'Office Light' }),
    ],
    ziggyRooms: [], rooms: [], occupancySensors: [],
  })
})

const noop = () => {}

describe('BundleWizard (create, stepped)', () => {
  it('walks Window-AC create to the shared review screen and saves', async () => {
    const user = userEvent.setup()
    const onSaved = vi.fn()
    render(<BundleHost recipeId="window_ac" initial={null} automations={[]}
      onSaved={onSaved} onClose={noop} confirmDelete={null} />)

    // Step 1: AC (auto-defaulted to the only AC) — shared shell shows 1/4.
    await screen.findByText(/Which AC\?/)
    expect(screen.getByText('1/4')).toBeInTheDocument()
    await user.click(screen.getByText('Next'))

    // Step 2: windows — defaults to All.
    await screen.findByText('2/4')
    await user.click(screen.getByText('Next'))

    // Step 3: mode choice.
    await screen.findByText('3/4')
    await user.click(screen.getByText('Next'))

    // Review = the flat editor body, with every section visible at once.
    await screen.findByText('Review & confirm')
    expect(screen.getByText('4/4')).toBeInTheDocument()
    await user.click(screen.getByText('Create'))

    await waitFor(() => expect(createAutomation).toHaveBeenCalledTimes(1))
    const payload = createAutomation.mock.calls[0][0]
    expect(payload.id).toBe('ziggy_window_ac_off')
    expect(payload.trigger.entity_id).toEqual(['binary_sensor.window_kitchen'])
    expect(payload.actions[0].type).toBe('notify_actionable')
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith({ updated: false }))
  })
})

describe('BundleEditor (installed, flat)', () => {
  const installed = {
    _isInstalled: true, id: 'ziggy_motion_light',
    trigger: { type: 'state', entity_id: ['binary_sensor.motion_office'], state: 'on' },
    conditions: [{ type: 'time', after: '21:00', before: '07:00' }],
    actions: [
      { type: 'call_service', entity_id: 'light.office', service: 'light.turn_on', service_data: { brightness_pct: 70 } },
      { type: 'delay', seconds: 120 },
    ],
  }

  it('opens LOCKED — full flat summary, Close only — and the pencil unlocks editing', async () => {
    const user = userEvent.setup()
    render(<BundleHost recipeId="motion_light" initial={installed} automations={[installed]}
      onSaved={noop} onClose={noop} confirmDelete={null} />)

    // Locked: a COMPACT one-line-per-setting summary — values as text, no
    // inputs, no Save/Remove. Fits without scrolling.
    await screen.findByText('Close')
    expect(screen.queryByText('Save changes')).not.toBeInTheDocument()
    expect(screen.queryByText('Remove')).not.toBeInTheDocument()
    expect(screen.getByText(/Which motion sensors/i)).toBeInTheDocument()
    expect(screen.getByText('70%')).toBeInTheDocument()          // summary value
    expect(screen.queryByDisplayValue('70')).not.toBeInTheDocument() // not an input

    // Pencil → the same surface expands into the full editor.
    await user.click(screen.getByRole('button', { name: 'Edit' }))
    await screen.findByText('Save changes')
    expect(screen.getByText('Remove')).toBeInTheDocument()
    expect(screen.getByDisplayValue('70')).toBeInTheDocument()   // now a live input
    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument()
  })

  it('a pencil-entry (startEditing) skips the locked view', async () => {
    render(<BundleHost recipeId="motion_light" initial={installed} automations={[installed]}
      startEditing onSaved={noop} onClose={noop} confirmDelete={null} />)
    await screen.findByText('Save changes')
    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument()
  })
})
