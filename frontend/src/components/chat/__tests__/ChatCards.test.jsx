// ChatCards — every tool-result `kind` renders without crashing, and the
// interactive bits call the actions registry with the documented args.

import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const runAction = vi.fn()
vi.mock('../../../lib/api', () => ({ runAction: (...a) => runAction(...a) }))
// i18n → identity so assertions match on keys; lang fixed to 'en'.
vi.mock('../../../lib/i18n', () => ({
  useT: () => (k) => k,
  useLang: () => 'en',
  useIsRTL: () => false,
}))

import ChatCard, { CARD_KINDS, verdictTitle } from '../ChatCards'

const SAMPLES = {
  device_list: { kind: 'device_list', devices: [
    { entity_id: 'light.kitchen', name: 'Kitchen light', room: 'kitchen', room_he: 'מטבח', domain: 'light', state: 'on', on: true, he_noun: 'אור במטבח' },
    { entity_id: 'binary_sensor.door', name: 'Front door', room: 'hall', domain: 'binary_sensor', state: 'off', on: false, he_noun: 'דלת' },
  ] },
  automations: { kind: 'automations', automations: [
    { id: 'a1', name: 'Night lights', enabled: true, last_triggered: '2026-09-05T20:00:00Z' },
    { id: 'a2', name: 'Morning', enabled: false },
  ] },
  capabilities: { kind: 'capabilities', overview: true, capabilities: [
    { name: 'Smart Room', pitch: 'Lights follow you', what_it_does: '…', status: 'live', live: true, layer: 'recipe' },
    { name: 'Pre-cool', pitch: 'Cool before you arrive', status: 'planned', live: false, layer: 'bundle' },
  ] },
  why_not: { kind: 'why_not', verdicts: ['device_unreachable', 'automation_disabled'], device_reachable: false,
    routines: [{ name: 'Hall motion', enabled: false, last_run: 'none in window' }],
    room_sensors: [{ room: 'hall', state: 'on', held_minutes: 45, problem: 'stuck' }],
    occupancy: { state: 'occupied' },
    tried: [{ step: 'refresh', outcome: 'no_change' }] },
  home_health: { kind: 'home_health', severity: 'attention', offline_count: 2 },
  down_devices: { kind: 'down_devices', count: 2, names: ['Balcony light', 'Bedroom AC'] },
  repair_history: { kind: 'repair_history', attempts: [{ step: 'reconnect', outcome: 'ok', ts: 1757100000 }] },
  recent_activity: { kind: 'recent_activity', changes: ['Kitchen light turned on', 'Front door opened'] },
  camera_look: { kind: 'camera_look', camera: 'Porch', room: 'entrance', description: 'A person at the door', tags: ['person', 'daylight'], people_count: 1 },
  needs_approval: { kind: 'needs_approval', fix: 'restart_bridge', acted: false },
  pairing_diagnosis: { kind: 'pairing_diagnosis', verdict: 'radio_down', radio: 'off', device_id: 'abc123', hint: 'Plug the stick back in' },
  cause_trace: { kind: 'cause_trace', cause: 'leave_home', at: '21:04', entity_id: 'light.kitchen' },
  device_diagnosis: { kind: 'device_diagnosis', reachable: true, battery: 40, signal: 'weak' },
}

beforeEach(() => { runAction.mockReset() })

describe('ChatCard', () => {
  it('covers every registered kind in the samples', () => {
    for (const k of CARD_KINDS) expect(SAMPLES[k], `missing sample for ${k}`).toBeTruthy()
  })

  for (const [kind, card] of Object.entries(SAMPLES)) {
    it(`renders ${kind} without crashing`, () => {
      const { container } = render(<ChatCard card={card} />)
      expect(container.firstChild).not.toBeNull()
    })
  }

  it('renders nothing for a missing or kind-less card', () => {
    expect(render(<ChatCard card={null} />).container.firstChild).toBeNull()
    expect(render(<ChatCard card={{ devices: [] }} />).container.firstChild).toBeNull()
  })

  it('key/value fallback hides id-looking keys', () => {
    render(<ChatCard card={SAMPLES.pairing_diagnosis} />)
    expect(screen.queryByText('abc123')).toBeNull()
    expect(screen.getByText('Plug the stick back in')).toBeInTheDocument()
  })

  it('device toggle calls control_device and rolls back on failure', async () => {
    runAction.mockRejectedValueOnce(new Error('boom'))
    render(<ChatCard card={SAMPLES.device_list} />)
    // Only the light is switchable; the door sensor gets no switch.
    const switches = screen.getAllByRole('switch')
    expect(switches).toHaveLength(1)
    expect(switches[0]).toHaveAttribute('aria-checked', 'true')
    fireEvent.click(switches[0])
    expect(runAction).toHaveBeenCalledWith('control_device', { entity_id: 'light.kitchen', action: 'off' }, 'en')
    await waitFor(() => expect(switches[0]).toHaveAttribute('aria-checked', 'true'))
    expect(screen.getByText(/chat\.card\.actionFailed/)).toBeInTheDocument()
  })

  it('device toggle keeps the optimistic state on success', async () => {
    runAction.mockResolvedValueOnce({ ok: true })
    const onAction = vi.fn()
    render(<ChatCard card={SAMPLES.device_list} onAction={onAction} />)
    const sw = screen.getAllByRole('switch')[0]
    fireEvent.click(sw)
    await waitFor(() => expect(onAction).toHaveBeenCalled())
    expect(sw).toHaveAttribute('aria-checked', 'false')
  })

  it('automation switch calls toggle_automation with the name', async () => {
    runAction.mockResolvedValueOnce({ ok: true })
    render(<ChatCard card={SAMPLES.automations} />)
    const [night] = screen.getAllByRole('switch')
    fireEvent.click(night)
    expect(runAction).toHaveBeenCalledWith('toggle_automation', { name: 'Night lights', enabled: false }, 'en')
    await waitFor(() => expect(night).toHaveAttribute('aria-checked', 'false'))
  })

  it('why_not shows the verdict title and a fix button only with an entity id', async () => {
    runAction.mockResolvedValueOnce({ ok: true })
    const { unmount } = render(<ChatCard card={SAMPLES.why_not} />)
    expect(screen.getByText('chat.card.verdict.deviceUnreachable')).toBeInTheDocument()
    expect(screen.queryByText('chat.card.tryFix')).toBeNull()
    unmount()

    render(<ChatCard card={SAMPLES.why_not} entityId="light.hall" />)
    fireEvent.click(screen.getByText('chat.card.tryFix'))
    expect(runAction).toHaveBeenCalledWith('refresh_device', { entity_id: 'light.hall' }, 'en')
    await waitFor(() => expect(screen.getByText('chat.card.fixSent')).toBeInTheDocument())
  })

  it('why_not picks up entity_id from the card itself', () => {
    render(<ChatCard card={{ ...SAMPLES.why_not, entity_id: 'light.hall' }} />)
    expect(screen.getByText('chat.card.tryFix')).toBeInTheDocument()
  })

  it('why_not hides the fix button when the device is reachable', () => {
    render(<ChatCard card={{ ...SAMPLES.why_not, device_reachable: true }} entityId="light.hall" />)
    expect(screen.queryByText('chat.card.tryFix')).toBeNull()
  })

  it('verdictTitle humanizes unknown codes', () => {
    const t = (k) => k
    expect(verdictTitle(t, 'device_unreachable')).toBe('chat.card.verdict.deviceUnreachable')
    expect(verdictTitle(t, 'something_new')).toBe('something new')
  })
})
